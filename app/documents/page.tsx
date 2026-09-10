import Shell from "@/components/Shell";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

type Chunk = { id: string; doc: string; section: string; token_count: number };

const TITLES: Record<string, string> = {
  product: "Produk Sigap",
  pricing: "Harga Sigap",
  "employee-policy": "Kebijakan Karyawan",
  runbook: "Runbook Teknis",
};

export default async function Documents() {
  const { data, error } = await db()
    .from("chunks")
    .select("id, doc, section, token_count")
    .eq("lang", env.corpusLang())
    .order("id");

  const chunks = (data ?? []) as Chunk[];
  const docs = [...new Set(chunks.map((c) => c.doc))];
  const total = chunks.reduce((n, c) => n + c.token_count, 0);

  return (
    <Shell>
      <div className="page">
        <div className="page-inner">
          <h2>Dokumen</h2>
          <p>
            {docs.length} dokumen · {chunks.length} bagian · {total.toLocaleString("id-ID")} token
            total. Specialist mencari di sini; setiap bagian di bawah adalah satu
            unit yang bisa diambil sendiri.
          </p>

          {error && <p className="hint">Gagal memuat: {error.message}</p>}
          {!error && chunks.length === 0 && (
            <p className="hint">Korpus belum di-seed. Jalankan `npm run seed`.</p>
          )}

          {docs.map((doc) => {
            const own = chunks.filter((c) => c.doc === doc);
            const docTokens = own.reduce((n, c) => n + c.token_count, 0);
            return (
              <section className="doc-card" key={doc}>
                <h3>{TITLES[doc] ?? doc}</h3>
                <p>
                  {doc}.md · {own.length} bagian · {docTokens.toLocaleString("id-ID")} token
                </p>
                <ul>
                  {own.map((c) => (
                    <li key={c.id}>
                      {c.section}
                      <span>{c.token_count}</span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          {chunks.length > 0 && (
            <p className="hint" style={{ marginTop: 22 }}>
              Seluruh korpus berukuran {total.toLocaleString("id-ID")} token. Baseline
              naif mengirim semuanya di setiap permintaan; versi sekarang mengirim
              beberapa bagian teratas saja.
            </p>
          )}
        </div>
      </div>
    </Shell>
  );
}
