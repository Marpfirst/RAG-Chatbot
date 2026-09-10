import { db } from "./db";
import { embed } from "./llm";
import { env } from "./env";

export type Chunk = {
  id: string;
  doc: string;
  section: string;
  content: string;
  similarity: number;
};

export type SearchResult = {
  chunks: Chunk[];
  embedTokens: number;
  topSimilarity: number | null;
};

/**
 * Embed the query, take the top-k nearest chunks, and drop everything below the
 * similarity floor. When nothing clears the floor we return zero chunks — the
 * specialist then answers "not in the documents" without ever reading context.
 * That makes an out-of-corpus question one of the CHEAPEST paths, not the most
 * expensive one.
 */
export async function searchDocs(query: string): Promise<SearchResult> {
  const { vector, tokens } = await embed(query);

  const { data, error } = await db().rpc("match_chunks", {
    query_embedding: vector,
    match_lang: env.corpusLang(),
    match_count: env.matchCount(),
    match_threshold: env.matchThreshold(),
  });

  if (error) throw new Error(`match_chunks failed: ${error.message}`);

  const all = (data ?? []) as Chunk[];

  // Adaptive k. A fixed k pays the same price for every question: k=3 was one
  // chunk short on comparison questions ("Tumbuh vs Skala"), and k=5 fixed
  // those but charged every other question ~60 tokens for the privilege.
  //
  // Instead: fetch a wider net, then keep only the chunks scoring close to the
  // best one. A single-answer question has one clear winner and sends 1-2
  // chunks; a comparison has two near-equal winners and sends both.
  const top = all.length ? all[0].similarity : 0;
  const gap = env.relativeGap();
  const chunks = all.filter((c) => c.similarity >= top - gap);

  return {
    chunks,
    embedTokens: tokens,
    topSimilarity: all.length ? top : null,
  };
}

/** Naive baseline: send every chunk, no embedding, no ranking. */
export async function fetchWholeCorpus(): Promise<SearchResult> {
  const { data, error } = await db()
    .from("chunks")
    .select("id, doc, section, content")
    .eq("lang", env.corpusLang());

  if (error) throw new Error(`fetchWholeCorpus failed: ${error.message}`);

  return {
    chunks: (data ?? []).map((c) => ({ ...(c as Omit<Chunk, "similarity">), similarity: 1 })),
    embedTokens: 0,
    topSimilarity: null,
  };
}
