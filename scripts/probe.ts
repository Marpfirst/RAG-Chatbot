/**
 * Print the similarity distribution for a set of queries.
 *
 * This is where MATCH_THRESHOLD and RELATIVE_GAP come from: the floor has to
 * sit in the gap between "questions the corpus answers" and "questions it
 * doesn't", and that gap is measured, not guessed.
 *
 * Usage: npx tsx scripts/probe.ts
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);
const embedder = new OpenAI({
  apiKey: process.env.EMBED_API_KEY || process.env.OPENAI_API_KEY!,
  baseURL: process.env.EMBED_BASE_URL || process.env.OPENAI_BASE_URL,
});

const QUERIES: [string, string][] = [
  ["in-corpus", "harga paket Tumbuh"],
  ["in-corpus", "jatah cuti tahunan karyawan"],
  ["in-corpus", "batas ukuran lampiran tiket"],
  ["in-corpus", "waktu respons insiden P1"],
  ["comparison", "perbedaan paket Tumbuh dan paket Skala"],
  ["comparison", "batas ukuran lampiran dan batas ukuran ekspor"],
  ["follow-up", "harga paket yang lebih besar dari Tumbuh"],
  ["out-of-corpus", "kebijakan refund pembatalan langganan"],
  ["out-of-corpus", "cuti melahirkan"],
  ["out-of-corpus", "sertifikasi ISO 27001"],
  ["out-of-corpus", "resep rendang"],
];

async function main() {
  console.log("kind          query                                    top    #2     #3     gap(1-2)");
  console.log("-".repeat(96));

  const byKind: Record<string, number[]> = {};

  for (const [kind, q] of QUERIES) {
    const e = await embedder.embeddings.create({
      model: process.env.EMBED_MODEL || "text-embedding-3-small",
      input: q,
    });
    const { data } = await supabase.rpc("match_chunks", {
      query_embedding: e.data[0].embedding,
      match_lang: "id",
      match_count: 5,
      match_threshold: 0,
    });
    const rows = (data ?? []) as { id: string; similarity: number }[];
    const s = rows.map((r) => r.similarity);
    (byKind[kind] ??= []).push(s[0] ?? 0);

    console.log(
      `${kind.padEnd(14)}${q.slice(0, 40).padEnd(41)}` +
        `${s[0]?.toFixed(3) ?? "-"}  ${s[1]?.toFixed(3) ?? "-"}  ${s[2]?.toFixed(3) ?? "-"}  ` +
        `${s[0] && s[1] ? (s[0] - s[1]).toFixed(3) : "-"}   ${rows[0]?.id ?? ""}`
    );
    if (kind === "comparison") {
      console.log(`${" ".repeat(14)}  -> ${rows.map((r) => `${r.id}:${r.similarity.toFixed(3)}`).join("  ")}`);
    }
  }

  console.log("\nTop-similarity range by kind:");
  for (const [kind, xs] of Object.entries(byKind)) {
    console.log(
      `  ${kind.padEnd(14)} min ${Math.min(...xs).toFixed(3)}   max ${Math.max(...xs).toFixed(3)}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
