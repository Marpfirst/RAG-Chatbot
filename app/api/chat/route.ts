import { NextRequest, NextResponse } from "next/server";
import { runManager } from "@/lib/agents/manager";
import { runSpecialist } from "@/lib/agents/specialist";
import { searchDocs, fetchWholeCorpus } from "@/lib/retrieval";
import { recentTurns } from "@/lib/history";
import { persist, totalTokens, answeringAgent, type AgentCall } from "@/lib/usage";
import { chatClient, readUsage } from "@/lib/llm";
import { env } from "@/lib/env";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 30;

const LOOPBACK = new Set(["::1", "127.0.0.1", "::ffff:127.0.0.1", "localhost"]);

/**
 * The client's address, or null when there is no one to rate limit.
 *
 * `x-real-ip` is preferred because Vercel sets it itself. `x-forwarded-for` can
 * carry values the caller sent, so only its first entry is trusted, and only as
 * a fallback.
 *
 * Loopback returns null on purpose. `next dev` does populate `x-forwarded-for`
 * for local requests — an assumption that was wrong the first time and only
 * surfaced when `npm run eval` hit the limit halfway through its 24 questions.
 * A caller on the loopback interface is the developer, not a stranger. On a
 * deployment the client address is never loopback.
 */
function clientIp(req: NextRequest): string | null {
  const real = req.headers.get("x-real-ip")?.trim();
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0].trim();
  const ip = real || fwd;
  if (!ip || LOOPBACK.has(ip)) return null;
  return ip;
}

type Blocked = { error: string; status: number };

/** Rule-based guards. Cheap, deterministic, and they run before any API call. */
async function guard(req: NextRequest, message: string): Promise<Blocked | null> {
  if (!message.trim()) return { error: "Pertanyaan kosong.", status: 400 };
  if (message.length > env.maxInputChars())
    return {
      error: `Pertanyaan terlalu panjang (maks ${env.maxInputChars()} karakter).`,
      status: 400,
    };

  const ip = clientIp(req);
  if (!ip) return null;

  const client = db();
  const since = new Date(Date.now() - 60_000).toISOString();

  // Counted per address rather than per conversation. The old guard counted
  // messages inside one conversation, which a caller bypassed by never sending
  // a conversationId — every request then began a fresh conversation whose
  // count was zero. An address is not the caller's to choose.
  const { count, error } = await client
    .from("request_log")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .gte("created_at", since);

  // Fails open on purpose. If the table is missing — the migration was not run
  // — throwing here would take the whole chat down to protect a budget. A
  // limiter that is broken should not break the product it guards.
  if (error) {
    console.error("rate limit unavailable, allowing request:", error.message);
    return null;
  }

  if ((count ?? 0) >= env.rateLimitPerMin())
    return {
      error: "Terlalu banyak permintaan. Coba lagi sebentar lagi.",
      status: 429,
    };

  await client.from("request_log").insert({ ip });

  // Only the last minute is ever read. Pruning occasionally rather than on
  // every request keeps the write cost down; Supabase's free tier has no
  // scheduler to do it instead.
  if (Math.random() < 0.02) {
    await client
      .from("request_log")
      .delete()
      .lt("created_at", new Date(Date.now() - 600_000).toISOString());
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { message, conversationId } = (await req.json()) as {
      message?: string;
      conversationId?: string;
    };

    if (typeof message !== "string")
      return NextResponse.json({ error: "message required" }, { status: 400 });

    // Guards run before a conversation is created, so a blocked request leaves
    // nothing behind in the database.
    const blocked = await guard(req, message);
    if (blocked)
      return NextResponse.json(
        { error: blocked.error },
        { status: blocked.status }
      );

    const convId = conversationId || (await newConversation());

    const result = env.naiveMode()
      ? await naiveTurn(convId, message)
      : await agentTurn(convId, message);

    // persist may move the messages to a new conversation if the one the client
    // sent no longer exists, so the id it returns is the one to report back.
    const { conversationId: storedIn } = await persist({
      conversationId: convId,
      question: message,
      answer: result.answer,
      calls: result.calls,
    });

    return NextResponse.json({
      conversationId: storedIn,
      answer: result.answer,
      agent: answeringAgent(result.calls),
      tokens: totalTokens(result.calls),
      breakdown: result.calls.map((c) => ({
        agent: c.agent,
        input: c.input_tokens,
        output: c.output_tokens,
        cached: c.cached_tokens,
        embed: c.embed_tokens,
      })),
      model: result.calls.at(-1)?.model ?? "",
      latencyMs: result.calls.reduce((n, c) => n + (c.latency_ms ?? 0), 0),
      // Chunk text is sent to the client so the details panel can show what the
      // answer was actually grounded in. It costs no model tokens — it is data
      // the server already had.
      sources: result.sources ?? [],
      // Exposed so scripts/eval.ts can score retrieval, not just the answer.
      retrieved: result.calls.at(-1)?.retrieved_ids ?? [],
      topSimilarity: result.calls.at(-1)?.top_similarity ?? null,
      outputTokens: result.calls.reduce((n, c) => n + c.output_tokens, 0),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function newConversation(): Promise<string> {
  const { data, error } = await db()
    .from("conversations")
    .insert({})
    .select("id")
    .single();
  if (error) throw new Error(`create conversation: ${error.message}`);
  return data.id as string;
}

/** The real path: manager decides, specialist only when documents are needed. */
async function agentTurn(convId: string, message: string) {
  const history = await recentTurns(convId);
  const calls: AgentCall[] = [];

  const manager = await runManager(message, history);

  if (manager.kind === "answer") {
    calls.push({
      agent: "manager",
      model: manager.model,
      input_tokens: manager.usage.input,
      output_tokens: manager.usage.output,
      cached_tokens: manager.usage.cached,
      embed_tokens: 0,
      routed: false,
      latency_ms: manager.latency,
    });
    return { answer: manager.text, calls, sources: [] };
  }

  // Embed the original question together with the manager's rewritten query.
  //
  // Using the rewrite alone loses named entities: for "Bedanya paket Tumbuh
  // sama Skala apa?" the manager writes a shorter phrase and "Skala" drops out,
  // so that chunk never enters the candidate set. Using the question alone
  // breaks follow-ups, which are meaningless without the rewrite. Both together
  // cost ~5 embedding tokens and keep each one's strength.
  const search = await searchDocs(
    manager.query === message ? message : `${message} ${manager.query}`
  );

  calls.push({
    agent: "manager",
    model: manager.model,
    input_tokens: manager.usage.input,
    output_tokens: manager.usage.output,
    cached_tokens: manager.usage.cached,
    embed_tokens: search.embedTokens,
    retrieved_ids: search.chunks.map((c) => c.id),
    top_similarity: search.topSimilarity,
    routed: true,
    latency_ms: manager.latency,
  });

  const specialist = await runSpecialist(message, manager.query, search.chunks);

  calls.push({
    agent: "specialist",
    model: specialist.model,
    input_tokens: specialist.usage.input,
    output_tokens: specialist.usage.output,
    cached_tokens: specialist.usage.cached,
    embed_tokens: 0,
    retrieved_ids: search.chunks.map((c) => c.id),
    top_similarity: search.topSimilarity,
    routed: true,
    latency_ms: specialist.latency,
  });

  return { answer: specialist.text, calls, sources: toSources(search.chunks) };
}

/** Strip the contextual header back off — it is shown as structured fields instead. */
function toSources(chunks: { id: string; doc: string; section: string; content: string; similarity: number }[]) {
  return chunks.map((c) => ({
    id: c.id,
    doc: c.doc,
    section: c.section,
    similarity: c.similarity,
    // Full text, not a preview. The panel truncates for display but lets the
    // reader expand — a snippet cut at 160 characters cannot be checked against
    // the answer, which is the whole point of showing sources.
    text: c.content.replace(/^\[[^\]]*\]\s*/, "").trim(),
  }));
}

/**
 * The deliberately naive baseline, kept in the repo so the "before" number in
 * NOTES.md is reproducible rather than remembered: whole corpus in every
 * request, full history, no retrieval, no output cap, no brevity instruction.
 */
async function naiveTurn(convId: string, message: string) {
  const history = await recentTurns(convId);
  const corpus = await fetchWholeCorpus();
  const model = env.modelSpecialist();

  const started = Date.now();
  const res = await chatClient().chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content:
          "You are the assistant for Sigap. Use the documents below to answer.\n\n" +
          corpus.chunks.map((c) => c.content).join("\n\n"),
      },
      ...history.map((t) => ({ role: t.role, content: t.content }) as const),
      { role: "user", content: message },
    ],
    temperature: 0,
  });
  const latency = Date.now() - started;
  const usage = readUsage(res.usage);

  const calls: AgentCall[] = [
    {
      agent: "specialist",
      model,
      input_tokens: usage.input,
      output_tokens: usage.output,
      cached_tokens: usage.cached,
      embed_tokens: 0,
      routed: true,
      latency_ms: latency,
    },
  ];

  return {
    answer: res.choices[0].message.content?.trim() || "-",
    calls,
    sources: [],
  };
}
