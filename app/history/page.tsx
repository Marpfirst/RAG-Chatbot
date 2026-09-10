import Shell from "@/components/Shell";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Row = {
  message_id: number;
  created_at: string;
  answer: string;
  answered_by: "manager" | "specialist" | null;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  embed_tokens: number;
  total_tokens: number;
  agent_calls: number;
};

export default async function History() {
  const { data, error } = await db()
    .from("question_history")
    .select("*")
    .order("message_id", { ascending: false })
    .limit(50);

  const rows = (data ?? []) as Row[];
  const avg = rows.length
    ? Math.round(rows.reduce((n, r) => n + r.total_tokens, 0) / rows.length)
    : 0;
  const byManager = rows.filter((r) => r.answered_by === "manager");
  const bySpecialist = rows.filter((r) => r.answered_by === "specialist");
  const mean = (xs: Row[]) =>
    xs.length ? Math.round(xs.reduce((n, r) => n + r.total_tokens, 0) / xs.length) : 0;

  return (
    <Shell>
      <div className="page">
        <div className="page-inner">
          <h2>Riwayat token</h2>
          <p>
            {rows.length} jawaban terakhir · rata-rata {avg.toLocaleString("id-ID")} token
            {byManager.length > 0 && ` · manager ${mean(byManager).toLocaleString("id-ID")}`}
            {bySpecialist.length > 0 && ` · specialist ${mean(bySpecialist).toLocaleString("id-ID")}`}
          </p>

          {error && <p className="hint">Gagal memuat: {error.message}</p>}
          {!error && rows.length === 0 && <p className="hint">Belum ada percakapan.</p>}

          {rows.length > 0 && (
            <div className="table-card">
              <div className="scroll-x">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Waktu</th>
                      <th>Dijawab oleh</th>
                      <th className="num">In</th>
                      <th className="num">Out</th>
                      <th className="num">Cached</th>
                      <th className="num">Embed</th>
                      <th className="num">Total</th>
                      <th className="num">Call</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.message_id}>
                        <td>
                          {new Date(r.created_at).toLocaleString("id-ID", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td>
                          <span className="tag" style={{ textTransform: "capitalize" }}>
                            {r.answered_by ?? "—"}
                          </span>
                        </td>
                        <td className="num">{r.input_tokens}</td>
                        <td className="num">{r.output_tokens}</td>
                        <td className="num">{r.cached_tokens}</td>
                        <td className="num">{r.embed_tokens}</td>
                        <td className="num">
                          <strong>{r.total_tokens}</strong>
                        </td>
                        <td className="num">{r.agent_calls}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
