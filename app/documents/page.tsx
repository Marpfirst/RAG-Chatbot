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
          <h2>Documents</h2>
          <p>
            {docs.length} documents · {chunks.length} sections ·{" "}
            {total.toLocaleString("en-US")} tokens total. This is what the specialist
            searches; each section below is one unit that can be retrieved on its own.
          </p>

          {error && <p className="hint">Could not load: {error.message}</p>}
          {!error && chunks.length === 0 && (
            <p className="hint">Corpus not seeded yet. Run `npm run seed`.</p>
          )}

          {chunks.length > 0 && (
            <div className="table-card">
              <div className="scroll-x">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>Section</th>
                      <th className="num">Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chunks.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <div style={{display: 'flex', alignItems: 'center', gap: 16}}>
                            <div style={{width: 40, height: 40, borderRadius: 10, background: 'var(--bubble-user)', display: 'grid', placeItems: 'center', color: 'var(--text-muted)'}}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{width: 20, height: 20, strokeWidth: 1.5}}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                            </div>
                            <div>
                              <strong style={{color: 'var(--text-main)', fontSize: 14.5, fontWeight: 600}}>{TITLES[c.doc] ?? c.doc}</strong>
                              <span style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4, display: "block" }}>
                                {c.doc}.md
                              </span>
                            </div>
                          </div>
                        </td>
                        <td style={{color: 'var(--text-main)', fontWeight: 500}}>{c.section}</td>
                        <td className="num">
                          <span style={{background: 'var(--bubble-user)', padding: '6px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600, color: 'var(--text-main)'}}>
                            {c.token_count}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

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
