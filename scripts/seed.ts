/**
 * Chunk -> embed -> store.
 *
 * Structure-aware ("subdocument") chunking: one `##` section becomes one chunk,
 * prefixed with a contextual header so it still makes sense read alone.
 *
 * Zero overlap. Overlap exists to soften boundaries a chunker had to guess at;
 * these boundaries are authored by hand, so padding them would only duplicate
 * tokens on every retrieval.
 *
 * Usage: npm run seed [-- --lang en]
 */
import "dotenv/config";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const lang = argValue("--lang") ?? process.env.CORPUS_LANG ?? "id";
const docsDir = join(process.cwd(), "docs", lang);

const supabase = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } }
);

const embedder = new OpenAI({
  apiKey: process.env.EMBED_API_KEY || requireEnv("OPENAI_API_KEY"),
  baseURL: process.env.EMBED_BASE_URL || process.env.OPENAI_BASE_URL,
});
const embedModel = process.env.EMBED_MODEL || "text-embedding-3-small";

const NL = String.fromCharCode(10);

type Parsed = { id: string; doc: string; section: string; content: string };

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseDoc(file: string): { title: string; chunks: Parsed[] } {
  const docName = file.replace(/\.md$/, "");
  const raw = readFileSync(join(docsDir, file), "utf8");
  const lines = raw.split(/\r?\n/);

  let title = docName;
  const chunks: Parsed[] = [];
  let section: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (!section) return;
    const body = buffer.join("\n").trim();
    if (body) {
      chunks.push({
        id: `${docName}#${slug(section)}`,
        doc: docName,
        section,
        // Contextual header: ~12 tokens that keep the chunk unambiguous once it
        // is pulled out of its document and read on its own.
        content: `[${title} > ${section}]\n${body}`,
      });
    }
    buffer = [];
  };

  for (const line of lines) {
    if (line.startsWith("# ")) {
      title = line.slice(2).trim();
    } else if (line.startsWith("## ")) {
      flush();
      section = line.slice(3).trim();
    } else if (section) {
      buffer.push(line);
    }
  }
  flush();

  return { title, chunks };
}

async function main() {
  const files = readdirSync(docsDir).filter((f) => f.endsWith(".md"));
  const all: Parsed[] = [];
  const mapLines: string[] = [];

  for (const file of files.sort()) {
    const { chunks } = parseDoc(file);
    all.push(...chunks);
    // The document map the manager routes on: doc name + its section titles,
    // compressed. This is the whole basis for "do I need to search?".
    mapLines.push(
      `${file.replace(/\.md$/, "")}: ${chunks.map((c) => c.section.toLowerCase()).join(", ")}`
    );
  }

  console.log(`Parsed ${all.length} chunks from ${files.length} docs (lang=${lang})`);

  // A compact alternative to the full section list. The full map costs ~220
  // tokens on every manager call; this one costs ~40. Which routes better is an
  // empirical question, so both are emitted and selected by the DOCMAP env var.
  const compactLines = files
    .sort()
    .map((f) => `${f.replace(/\.md$/, "")}: ${parseDoc(f).chunks.length} sections`);

  // Middle variant: doc name plus its first four section titles. The section
  // titles are not only a routing signal — they are the vocabulary the manager
  // uses to write a self-contained search query. Dropping them entirely makes
  // follow-up questions ("the bigger plan?") unanswerable even when retrieval
  // still lands on the right chunk.
  const mediumLines = files
    .sort()
    .map((f) => {
      const { chunks } = parseDoc(f);
      return `${f.replace(/\.md$/, "")}: ${chunks.slice(0, 4).map((c) => c.section.toLowerCase()).join(", ")}, ...`;
    });

  const rows = [];
  let embedTokens = 0;

  for (const chunk of all) {
    const res = await embedder.embeddings.create({
      model: embedModel,
      input: chunk.content,
    });
    const tokens = res.usage?.prompt_tokens ?? 0;
    embedTokens += tokens;
    rows.push({
      ...chunk,
      lang,
      token_count: tokens,
      embedding: res.data[0].embedding,
    });
    process.stdout.write(".");
  }
  process.stdout.write("\n");

  await supabase.from("chunks").delete().eq("lang", lang);
  const { error } = await supabase.from("chunks").insert(rows);
  if (error) throw new Error(`insert chunks: ${error.message}`);

  if (lang === (process.env.CORPUS_LANG ?? "id")) {
    writeFileSync(
      join(process.cwd(), "lib", "docmap.json"),
      JSON.stringify(
        { generatedAt: new Date().toISOString(), map: mapLines.join(NL), compact: compactLines.join(NL), medium: mediumLines.join(NL) },
        null,
        2
      ) + "\n"
    );
    console.log("Wrote lib/docmap.json");
  }

  const corpusTokens = rows.reduce((n, r) => n + r.token_count, 0);
  const sizes = rows.map((r) => r.token_count).sort((a, b) => a - b);

  console.log(`\nSeeded ${rows.length} chunks (lang=${lang})`);
  console.log(`Corpus size    : ${corpusTokens} tokens`);
  console.log(`Chunk tokens   : min ${sizes[0]}, median ${sizes[Math.floor(sizes.length / 2)]}, max ${sizes[sizes.length - 1]}`);
  console.log(`Embedding cost : ${embedTokens} tokens (one-off)`);
  console.log(`\nNaive baseline stuffs all ${corpusTokens} tokens into every request.`);
  console.log(`Top-3 retrieval sends roughly ${sizes[Math.floor(sizes.length / 2)] * 3} tokens.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
