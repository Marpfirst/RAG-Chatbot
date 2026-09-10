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

/** Rule-based guards. Cheap, deterministic, and they run before any API call. */
async function guard(conversationId: string, message: string) {
  if (!message.trim()) return "Pertanyaan kosong.";
  if (message.length > env.maxInputChars())
    return `Pertanyaan terlalu panjang (maks ${env.maxInputChars()} karakter).`;

  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await db()
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("role", "user")
    .gte("created_at", since);

  if ((count ?? 0) >= 10) return "Terlalu cepat. Tunggu sebentar.";
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

    const convId = conversationId || (await newConversation());

    const blocked = await guard(convId, message);
    if (blocked) return NextResponse.json({ error: blocked }, { status: 400 });

    const result = env.naiveMode()
      ? await naiveTurn(convId, message)
      : await agentTurn(convId, message);

    await persist({
      conversationId: convId,
      question: message,
      answer: result.answer,
      calls: result.calls,
    });

    return NextResponse.json({
      conversationId: convId,
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
