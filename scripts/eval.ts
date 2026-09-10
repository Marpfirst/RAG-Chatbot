/**
 * Run the golden set against a running server and print the numbers that go
 * into NOTES.md.
 *
 * Three levels of measurement, so a regression can be traced to the layer that
 * caused it:
 *   - routing  : did the manager decide correctly?
 *   - retrieval: recall@k / precision@k against expected chunk ids
 *   - answer   : substring assertions on the final text
 *
 * Grading is substring-based on purpose. An LLM judge would spend tokens to
 * grade a token-efficiency exercise, and every fact in this corpus is a number
 * or a name.
 *
 * Usage: npm run dev  (in another terminal)
 *        npm run eval [-- --label v1-retrieval]
 */
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.EVAL_BASE_URL || "http://localhost:3000";
const label = argValue("--label") ?? "run";

type Case = {
  id: string;
  question: string;
  lang: string;
  category: "general" | "doc" | "out_of_scope" | "abuse" | "followup"
    | "multi";
  expected_route: "manager" | "specialist";
  expected_chunk_ids?: string[];
  must_include?: string[];
  must_not_include?: string[];
  max_output_tokens?: number;
  min_output_tokens?: number;
  context?: string[];
};

type Reply = {
  conversationId: string;
  answer: string;
  agent: "manager" | "specialist";
  tokens: number;
  retrieved: string[];
  topSimilarity: number | null;
  outputTokens: number;
  error?: string;
};

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function ask(message: string, conversationId?: string): Promise<Reply> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, conversationId }),
  });
  const json = (await res.json()) as Reply;
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ");
}

async function main() {
  const cases: Case[] = readFileSync(join(process.cwd(), "eval", "golden.jsonl"), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  const rows: any[] = [];

  for (const c of cases) {
    let convId: string | undefined;

    // A follow-up case needs its prior turn in the same conversation, which is
    // exactly what makes it a test of history rather than of retrieval.
    for (const prior of c.context ?? []) {
      const r = await ask(prior, convId);
      convId = r.conversationId;
    }

    const started = Date.now();
    let reply: Reply;
    try {
      reply = await ask(c.question, convId);
    } catch (e) {
      rows.push({
        id: c.id,
        category: c.category,
        route: "ERROR",
        pass: false,
        tokens: 0,
        notes: e instanceof Error ? e.message : "error",
      });
      continue;
    }
    const latency = Date.now() - started;

    const failures: string[] = [];

    if (reply.agent !== c.expected_route)
      failures.push(`route=${reply.agent}`);

    for (const s of c.must_include ?? [])
      if (!norm(reply.answer).includes(norm(s))) failures.push(`missing "${s}"`);

    for (const s of c.must_not_include ?? [])
      if (norm(reply.answer).includes(norm(s))) failures.push(`leaked "${s}"`);

    if (c.max_output_tokens && reply.outputTokens > c.max_output_tokens)
      failures.push(`output=${reply.outputTokens}>${c.max_output_tokens}`);

    // Guards against an answer that is technically on-route but empty of
    // content — a refusal, or the model reciting its own instructions. Both
    // slipped past assertions that only checked routing and keywords.
    if (c.min_output_tokens && reply.outputTokens < c.min_output_tokens)
      failures.push(`output=${reply.outputTokens}<${c.min_output_tokens}`);

    const expected = c.expected_chunk_ids ?? [];
    const retrieved = reply.retrieved ?? [];
    const hit = expected.filter((id) => retrieved.includes(id));

    if (expected.length && hit.length === 0) failures.push("chunk miss");

    rows.push({
      id: c.id,
      category: c.category,
      route: reply.agent,
      tokens: reply.tokens,
      output: reply.outputTokens,
      sim: reply.topSimilarity,
      recall: expected.length ? hit.length / expected.length : null,
      precision: expected.length && retrieved.length ? hit.length / retrieved.length : null,
      latency,
      pass: failures.length === 0,
      notes: failures.join("; "),
      answer: reply.answer,
    });

    const mark = failures.length === 0 ? "ok  " : "FAIL";
    console.log(
      `${mark} ${c.id.padEnd(4)} ${c.category.padEnd(13)} ${String(reply.agent).padEnd(10)} ` +
        `${String(reply.tokens).padStart(6)} tok  ${failures.join("; ")}`
    );
  }

  const passed = rows.filter((r) => r.pass).length;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  const byCat = (cat: string) => rows.filter((r) => r.category === cat);
  // An errored row carries no recall field at all, so filter on the type
  // rather than on null — otherwise one transport error turns the whole
  // retrieval score into NaN.
  const isNum = (v: unknown): v is number => typeof v === "number" && !Number.isNaN(v);
  const recalls = rows.map((r) => r.recall).filter(isNum);
  const precisions = rows.map((r) => r.precision).filter(isNum);

  console.log("\n" + "-".repeat(62));
  console.log(`label            : ${label}`);
  console.log(`passed           : ${passed}/${rows.length}`);
  console.log(`avg tokens (all) : ${avg(rows.map((r) => r.tokens)).toFixed(0)}`);
  for (const cat of ["general", "doc", "multi", "out_of_scope", "abuse", "followup"]) {
    const g = byCat(cat);
    if (!g.length) continue;
    console.log(
      `  ${cat.padEnd(14)} : ${avg(g.map((r) => r.tokens)).toFixed(0)} tok  (${g.filter((r) => r.pass).length}/${g.length} pass)`
    );
  }
  if (recalls.length) {
    console.log(`recall@k         : ${(avg(recalls) * 100).toFixed(0)}%`);
    console.log(`precision@k      : ${(avg(precisions) * 100).toFixed(0)}%`);
  }
  console.log(`avg latency      : ${avg(rows.map((r) => r.latency || 0)).toFixed(0)} ms`);
  console.log("-".repeat(62));

  mkdirSync(join(process.cwd(), "eval", "results"), { recursive: true });
  const out = join(process.cwd(), "eval", "results", `${label}.json`);
  writeFileSync(
    out,
    JSON.stringify(
      {
        label,
        at: new Date().toISOString(),
        env: {
          MATCH_COUNT: process.env.MATCH_COUNT,
          MATCH_THRESHOLD: process.env.MATCH_THRESHOLD,
          HISTORY_TURNS: process.env.HISTORY_TURNS,
          NAIVE_MODE: process.env.NAIVE_MODE,
          MODEL_MANAGER: process.env.MODEL_MANAGER,
        },
        passed,
        total: rows.length,
        avgTokens: Number(avg(rows.map((r) => r.tokens)).toFixed(1)),
        rows,
      },
      null,
      2
    ) + "\n"
  );
  console.log(`saved ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
