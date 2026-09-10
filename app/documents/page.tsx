import Shell from "@/components/Shell";
import DocumentTable, { type DocChunk } from "@/components/DocumentTable";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  doc: string;
  section: string;
  token_count: number;
  content: string;
};

export default async function Documents() {
  const { data, error } = await db()
    .from("chunks")
    .select("id, doc, section, token_count, content")
    .eq("lang", env.corpusLang())
    .order("id");

  const rows = (data ?? []) as Row[];

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
    <Shell>
      <div className="page">
        <div className="page-inner">
          <h2>Documents</h2>
          <p style={{color: 'var(--text-muted)'}}>
            {docs.length} dokumen · {chunks.length} bagian ·{" "}
            {total.toLocaleString("en-US")} token keseluruhan. Ini adalah sumber data pencarian.
            Setiap bagian dapat ditarik secara terpisah. Klik pada baris mana saja untuk membaca isinya.
          </p>

          {error && <p className="hint">Could not load: {error.message}</p>}
          {!error && chunks.length === 0 && (
            <p className="hint">Corpus not seeded yet. Run `npm run seed`.</p>
          )}

          {chunks.length > 0 && <DocumentTable chunks={chunks} />}

          {chunks.length > 0 && (
            <p className="hint" style={{ marginTop: 22 }}>
              The whole corpus is {total.toLocaleString("en-US")} tokens. The naive
              baseline sends all of it on every request; the current version sends
              only the closest few sections.
            </p>
          )}
        </div>
      </div>
    </Shell>
  );
}
