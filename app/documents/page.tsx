import { unstable_cache } from "next/cache";
import DocumentTable, { type DocChunk } from "@/components/DocumentTable";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * The corpus only changes when `npm run seed` is run, which happens outside the
 * application entirely — nothing in the UI writes to `chunks`. So this page is
 * cached and served without touching Supabase, and navigating back to it costs
 * no request at all.
 *
 * An hour is the ceiling on how long a re-seed can go unnoticed. There is no
 * mutation to hang an invalidation off, so time is the only honest trigger; a
 * redeploy clears it sooner.
 */
export const revalidate = 3600;

// Rendered per request, but the query above it is not repeated per request:
// `unstable_cache` serves that. Stated explicitly because the reads go
// through a `no-store` client, so static generation would fail the build.
export const dynamic = "force-dynamic";

type Row = {
  id: string;
  doc: string;
  section: string;
  token_count: number;
  content: string;
};

/**
 * Cached by result rather than by `fetch`.
 *
 * Marking the fetch itself cacheable did not work: measured over five requests
 * it still hit Supabase five times, because supabase-js drives its own request
 * and Next's patched `fetch` would not take it. `unstable_cache` keys on the
 * function instead, so it does not depend on how the client builds a request.
 */
const loadChunks = unstable_cache(
  async () => {
    const { data, error } = await db()
      .from("chunks")
      .select("id, doc, section, token_count, content")
      .eq("lang", env.corpusLang())
      .order("id");
    return { rows: (data ?? []) as Row[], error: error?.message ?? null };
  },
  ["documents-chunks"],
  { revalidate, tags: ["chunks"] }
);

export default async function Documents() {
  const { rows, error } = await loadChunks();

  // The stored content carries the contextual header ("[Harga Sigap > Paket
  // Tumbuh]") that the retriever relies on. It is shown as the Document and
  // Section columns instead, so strip it from the body rather than repeat it.
  const chunks: DocChunk[] = rows.map((r) => ({
    id: r.id,
    doc: r.doc,
    section: r.section,
    token_count: r.token_count,
    text: r.content.replace(/^\[[^\]]*\]\s*/, "").trim(),
  }));

  const docs = [...new Set(chunks.map((c) => c.doc))];
  const total = chunks.reduce((n, c) => n + c.token_count, 0);

  return (
    <>
      <div className="page">
        <div className="page-inner">
          <h2>Documents</h2>
          <p style={{color: 'var(--text-muted)'}}>
            {docs.length} dokumen · {chunks.length} bagian ·{" "}
            {total.toLocaleString("en-US")} token embedding keseluruhan. Ini adalah sumber data
            pencarian. Setiap bagian dapat ditarik secara terpisah. Klik pada baris mana saja
            untuk membaca isinya.
          </p>

          {error && <p className="hint">Could not load: {error}</p>}
          {!error && chunks.length === 0 && (
            <p className="hint">Corpus not seeded yet. Run `npm run seed`.</p>
          )}

          {chunks.length > 0 && <DocumentTable chunks={chunks} />}

          {chunks.length > 0 && (
            <p className="hint" style={{ marginTop: 22 }}>
              Counted by the embedding model, which is what filled this column — the
              chat model tokenises the same corpus about 19% cheaper. The naive
              baseline sends all of it on every request; the current version sends
              only the closest few sections.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
