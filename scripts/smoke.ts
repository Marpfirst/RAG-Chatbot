/**
 * Provider smoke test.
 *
 * Any OpenAI-compatible endpoint can be dropped in via env vars, but three
 * things have to actually work before this project can trust it:
 *
 *   1. tool calling  — the whole routing design is a tool call
 *   2. /v1/embeddings — retrieval dies without it
 *   3. honest `usage` — every number reported in NOTES.md comes from here.
 *      A gateway that estimates or zeroes these makes the whole report fiction.
 *
 * Usage: npx tsx scripts/smoke.ts
 */
import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
  baseURL: process.env.OPENAI_BASE_URL,
});
const embedder = new OpenAI({
  apiKey: process.env.EMBED_API_KEY || process.env.OPENAI_API_KEY!,
  baseURL: process.env.EMBED_BASE_URL || process.env.OPENAI_BASE_URL,
});

const model = process.env.MODEL_MANAGER || "gpt-4o-mini";
const embedModel = process.env.EMBED_MODEL || "text-embedding-3-small";

const results: [string, boolean, string][] = [];
function check(name: string, ok: boolean, note = "") {
  results.push([name, ok, note]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? "  — " + note : ""}`);
}

async function main() {
  console.log(`chat  : ${process.env.OPENAI_BASE_URL} (${model})`);
  console.log(`embed : ${process.env.EMBED_BASE_URL || process.env.OPENAI_BASE_URL} (${embedModel})\n`);

  // 1. plain chat + usage fidelity
  try {
    const r = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: "Balas persis satu kata: siap" }],
      max_tokens: 10,
      temperature: 0,
    });
    check("chat completion", !!r.choices[0].message.content, r.choices[0].message.content?.slice(0, 40));

    const u = r.usage as any;
    check(
      "usage.prompt_tokens",
      typeof u?.prompt_tokens === "number" && u.prompt_tokens > 0,
      `= ${u?.prompt_tokens}`
    );
    check(
      "usage.completion_tokens",
      typeof u?.completion_tokens === "number" && u.completion_tokens > 0,
      `= ${u?.completion_tokens}`
    );
    check(
      "usage.prompt_tokens_details.cached_tokens",
      u?.prompt_tokens_details?.cached_tokens !== undefined,
      u?.prompt_tokens_details?.cached_tokens === undefined
        ? "absent — prompt caching cannot be measured"
        : `= ${u.prompt_tokens_details.cached_tokens}`
    );
  } catch (e) {
    check("chat completion", false, msg(e));
  }

  // 2. tool calling — the routing mechanism
  try {
    const r = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "Call search_docs when the user asks about company facts." },
        { role: "user", content: "Berapa harga paket Tumbuh di perusahaan kami?" },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "search_docs",
            description: "Search internal documents.",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
            },
          },
        },
      ],
      max_tokens: 100,
      temperature: 0,
    });
    const call = r.choices[0].message.tool_calls?.[0];
    check(
      "tool calling",
      !!call && call.type === "function" && call.function.name === "search_docs",
      call && call.type === "function" ? call.function.arguments : "no tool_call returned"
    );
  } catch (e) {
    check("tool calling", false, msg(e));
  }

  // 3. embeddings
  try {
    const r = await embedder.embeddings.create({ model: embedModel, input: "tes embedding" });
    const dim = r.data[0].embedding.length;
    check("embeddings endpoint", dim > 0, `dim = ${dim}`);
    check(
      "embedding usage.prompt_tokens",
      typeof r.usage?.prompt_tokens === "number" && r.usage.prompt_tokens > 0,
      `= ${r.usage?.prompt_tokens}`
    );
    if (dim !== 1536)
      console.log(`\n  NOTE: schema declares vector(1536). Change it to vector(${dim}).`);
  } catch (e) {
    check("embeddings endpoint", false, msg(e));
  }

  const failed = results.filter(([, ok]) => !ok);
  console.log("\n" + "-".repeat(56));
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log("blocking failures:");
    for (const [n, , note] of failed) console.log(`  - ${n} ${note}`);
    process.exit(1);
  }
}

function msg(e: unknown) {
  return e instanceof Error ? e.message.slice(0, 120) : String(e);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
