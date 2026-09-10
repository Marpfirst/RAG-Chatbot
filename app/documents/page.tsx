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

          {chunks.length > 0 && (
            <div className="table-card">
              <div className="scroll-x">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Dokumen</th>
                      <th>Bagian</th>
                      <th className="num">Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chunks.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <strong>{TITLES[c.doc] ?? c.doc}</strong>
                          <br />
                          <span style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4, display: "inline-block" }}>
                            {c.doc}.md
                          </span>
                        </td>
                        <td>{c.section}</td>
                        <td className="num">{c.token_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

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
