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
          <h2>Token history</h2>
          <p>
            {rows.length} most recent answers · {avg.toLocaleString("en-US")} tokens on average
            {byManager.length > 0 && ` · manager ${mean(byManager).toLocaleString("en-US")}`}
            {bySpecialist.length > 0 && ` · specialist ${mean(bySpecialist).toLocaleString("en-US")}`}
          </p>

          {error && <p className="hint">Could not load: {error.message}</p>}
          {!error && rows.length === 0 && <p className="hint">No conversations yet.</p>}

          {rows.length > 0 && (
            <div className="table-card">
              <div className="scroll-x">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Answered by</th>
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
                          <span style={{color: 'var(--text-muted)'}}>
                          {new Date(r.created_at).toLocaleString("en-US", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          </span>
                        </td>
                        <td>
                          {r.answered_by ? (
                            <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                              <div className={`avatar-wrapper avatar-${r.answered_by}`} style={{width: 28, height: 28}}>
                                <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" style={{width: 16, height: 16}}>
                                  <path d="M12 2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM5 10h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zm3 4h2v2H8v-2zm6 0h2v2h-2v-2z" />
                                </svg>
                              </div>
                              <span style={{ textTransform: "capitalize", fontWeight: 600, fontSize: 14, color: 'var(--text-main)' }}>
                                {r.answered_by}
                              </span>
                            </div>
                          ) : (
                            <span style={{color: 'var(--text-muted)'}}>—</span>
                          )}
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
