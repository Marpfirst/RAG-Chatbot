"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Shell from "@/components/Shell";

type Breakdown = {
  agent: "manager" | "specialist";
  input: number;
  output: number;
  cached: number;
  embed: number;
};

type Source = {
  id: string;
  doc: string;
  section: string;
  similarity: number;
  snippet: string;
};

type Turn = {
  id: number;
  role: "user" | "assistant" | "error";
  text: string;
  at: string;
  agent?: "manager" | "specialist";
  model?: string;
  tokens?: number;
  latencyMs?: number;
  breakdown?: Breakdown[];
  sources?: Source[];
};

const SAMPLES = [
  "Apa itu SLA?",
  "Berapa harga paket Tumbuh?",
  "Batas ukuran lampiran berapa?",
  "Kalau batal langganan, uangnya balik nggak?",
];

const DOC_TITLES: Record<string, string> = {
  product: "Produk Sigap",
  pricing: "Harga Sigap",
  "employee-policy": "Kebijakan Karyawan",
  runbook: "Runbook Teknis",
};

const clock = () =>
  new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

const STORAGE_KEY = "chat.session.v1";

type Stored = { convId?: string; turns: Turn[] };

/**
 * The thread lives in component state, so navigating to History or Documents
 * unmounts it and the conversation disappears. sessionStorage keeps it across
 * navigation and reloads while still matching what the sidebar calls "this
 * session" — closing the tab starts fresh.
 *
 * Reads and writes are wrapped: storage throws outright in some privacy modes,
 * and losing a thread is better than a blank screen.
 */
function load(): Stored | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

function save(value: Stored) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* over quota or storage blocked — the thread just won't survive navigation */
  }
}

export default function Page() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [convId, setConvId] = useState<string>();
  const [selected, setSelected] = useState<number | null>(null);
  // Hydration happens in an effect, never during render, so the server-rendered
  // markup and the first client render still match.
  const [hydrated, setHydrated] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const nextId = useRef(1);

  useEffect(() => {
    const stored = load();
    if (stored) {
      setTurns(stored.turns ?? []);
      setConvId(stored.convId);
      nextId.current = Math.max(0, ...(stored.turns ?? []).map((t) => t.id)) + 1;
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    // Guarded on `hydrated`, otherwise the first render would overwrite the
    // stored thread with an empty one before it has been read back.
    if (hydrated) save({ convId, turns });
  }, [hydrated, convId, turns]);

  useEffect(() => {
    threadRef.current?.scrollTo({
      top: threadRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns, busy]);

  const detail = turns.find((t) => t.id === selected && t.role === "assistant");

  const session = useMemo(
    () => ({
      questions: turns.filter((t) => t.role === "user").length,
      tokens: turns.reduce((n, t) => n + (t.role === "assistant" ? t.tokens ?? 0 : 0), 0),
    }),
    [turns]
  );

  function newChat() {
    setTurns([]);
    setConvId(undefined);
    setSelected(null);
    nextId.current = 1;
    save({ convId: undefined, turns: [] });
    boxRef.current?.focus();
  }

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;

    const at = clock();
    setTurns((t) => [...t, { id: nextId.current++, role: "user", text: question, at }]);
    setInput("");
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: question, conversationId: convId }),
      });
      const data = await res.json();

      if (!res.ok) {
        setTurns((t) => [
          ...t,
          { id: nextId.current++, role: "error", text: data.error ?? "Terjadi kesalahan.", at: clock() },
        ]);
      } else {
        setConvId(data.conversationId);
        setTurns((t) => [
          ...t,
          {
            id: nextId.current++,
            role: "assistant",
            text: data.answer,
            at: clock(),
            agent: data.agent,
            model: data.model,
            tokens: data.tokens,
            latencyMs: data.latencyMs,
            breakdown: data.breakdown,
            sources: data.sources ?? [],
          },
        ]);
      }
    } catch {
      setTurns((t) => [
        ...t,
        { id: nextId.current++, role: "error", text: "Gagal menghubungi server.", at: clock() },
      ]);
    } finally {
      setBusy(false);
      boxRef.current?.focus();
    }
  }

  return (
    <Shell
      session={
        <>
          <dl>
            <dt>Session</dt>
            <dd>{session.questions} questions</dd>
            <dd>{session.tokens.toLocaleString("en-US")} tokens</dd>
          </dl>
          {turns.length > 0 && (
            <button className="new-chat" onClick={newChat}>
              New chat
            </button>
          )}
        </>
      }
    >
      <div className={`main${detail ? " with-panel" : ""}`}>
        <div className="column">
          <div className="thread" ref={threadRef}>
            <div className="thread-inner">
              {turns.length === 0 && (
                <div className="empty">
                  <h2>Ask anything</h2>
                  <p>
                    I can answer general questions or search through your documents.
                  </p>
                  <div className="suggestions">
                    {SAMPLES.map((s) => (
                      <button key={s} onClick={() => send(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {turns.map((t) =>
                t.role === "user" ? (
                  <div className="turn user" key={t.id}>
                    <div className="message-content">
                      <div className="bubble-user">{t.text}</div>
                      <div className="msg-footer" style={{justifyContent: 'flex-end'}}>{t.at}</div>
                    </div>
                    <div className="avatar-wrapper avatar-user">
                      <svg viewBox="0 0 24 24">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                    </div>
                  </div>
                ) : (
                  <div className={`turn ${t.role}`} key={t.id}>
                    <div className={`avatar-wrapper avatar-${t.agent || "manager"}`}>
                      <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM5 10h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zm3 4h2v2H8v-2zm6 0h2v2h-2v-2z" />
                      </svg>
                    </div>
                    <div className="message-content">
                      <div
                        className="answer"
                        role={t.role === "assistant" ? "button" : undefined}
                        tabIndex={t.role === "assistant" ? 0 : undefined}
                        aria-pressed={t.role === "assistant" ? selected === t.id : undefined}
                        onClick={() =>
                          t.role === "assistant" &&
                          setSelected(selected === t.id ? null : t.id)
                        }
                        onKeyDown={(e) => {
                          if (t.role === "assistant" && (e.key === "Enter" || e.key === " ")) {
                            e.preventDefault();
                            setSelected(selected === t.id ? null : t.id);
                          }
                        }}
                      >
                        {t.agent && <div className="who" style={{textTransform: 'capitalize'}}>{t.agent}</div>}
                        <p>{t.text}</p>

                        {t.sources && t.sources.length > 0 && (
                          <div className="source-chip" style={{justifyContent: 'space-between', width: '100%', maxWidth: 420}}>
                            <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
                              <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
                                <path d="M14 3v5h5" />
                              </svg>
                              <span>
                                <strong>{DOC_TITLES[t.sources[0].doc] ?? t.sources[0].doc}</strong>
                                <span>{t.sources[0].section}</span>
                              </span>
                            </div>
                            <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" style={{width: 16, height: 16, stroke: 'var(--text-muted)', fill: 'none'}}>
                              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                              <polyline points="15 3 21 3 21 9" />
                              <line x1="10" y1="14" x2="21" y2="3" />
                            </svg>
                          </div>
                        )}
                      </div>

                      {t.role === "assistant" && (
                        <div className="msg-footer" style={{justifyContent: 'space-between', display: 'flex', width: '100%'}}>
                          <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                            <span className="agent" style={{ textTransform: "capitalize" }}>
                              {t.agent}
                            </span>
                            <span className="dot" />
                            <span>{t.tokens?.toLocaleString("en-US")} tokens</span>
                            {t.latencyMs != null && (
                              <>
                                <span className="dot" />
                                <span>{(t.latencyMs / 1000).toFixed(1)}s</span>
                              </>
                            )}
                          </div>
                          <span>{t.at}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              )}

              {busy && (
                <div className="turn assistant">
                  <div className="avatar-wrapper avatar-manager">
                    <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM5 10h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zm3 4h2v2H8v-2zm6 0h2v2h-2v-2z" />
                    </svg>
                  </div>
                  <div className="message-content">
                    <div className="answer" style={{ cursor: "default" }}>
                      <span className="typing">
                        <i />
                        <i />
                        <i />
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="composer">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <textarea
                ref={boxRef}
                rows={1}
                value={input}
                placeholder="Ask a question..."
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
              />
              <button className="send" type="submit" disabled={busy || !input.trim()} aria-label="Kirim">
                <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </button>
            </form>
            <div className="composer-hint">
              DocuMind can answer general questions or search through your documents.
            </div>
          </div>
        </div>

        {detail && <Panel turn={detail} onClose={() => setSelected(null)} />}
      </div>
    </Shell>
  );
}

function Panel({ turn, onClose }: { turn: Turn; onClose: () => void }) {
  const [tab, setTab] = useState<"detail" | "rincian">("detail");

  return (
    <aside className="panel">
      <div className="panel-head">
        <button
          className="tab"
          aria-selected={tab === "detail"}
          onClick={() => setTab("detail")}
        >
          Details
        </button>
        <button
          className="tab"
          aria-selected={tab === "rincian"}
          onClick={() => setTab("rincian")}
        >
          Tokens
        </button>
        <button className="close" onClick={onClose} aria-label="Tutup">
          <svg viewBox="0 0 24 24" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="panel-content">
        {tab === "detail" ? (
          <>
            <h3>Response details</h3>
            <table className="rows">
              <tbody>
                <tr>
                  <th>Agent</th>
                  <td style={{ textTransform: "capitalize" }}>{turn.agent}</td>
                </tr>
                <tr>
                  <th>Model</th>
                  <td>{turn.model || "—"}</td>
                </tr>
                <tr>
                  <th>Tokens</th>
                  <td>{turn.tokens?.toLocaleString("en-US")}</td>
                </tr>
                <tr>
                  <th>Latency</th>
                  <td>{turn.latencyMs != null ? `${(turn.latencyMs / 1000).toFixed(1)}s` : "—"}</td>
                </tr>
                <tr>
                  <th>Retrieved chunks</th>
                  <td>{turn.sources?.length ?? 0}</td>
                </tr>
                {turn.sources && turn.sources.length > 0 && (
                  <tr>
                    <th>Source document</th>
                    <td>
                      <div style={{display: 'flex', alignItems: 'center', gap: 12, border: '1px solid var(--border)', padding: '10px 12px', borderRadius: 8}}>
                        <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" style={{width: 20, height: 20, fill: 'none', stroke: 'currentColor'}}>
                          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
                          <path d="M14 3v5h5" />
                        </svg>
                        <div style={{flex: 1}}>
                          <strong style={{display: 'block', fontSize: 13, color: 'var(--text-main)', fontWeight: 600}}>{DOC_TITLES[turn.sources[0].doc] ?? turn.sources[0].doc}</strong>
                          <small style={{marginTop: 2, fontSize: 11, color: 'var(--text-muted)'}}>{turn.sources[0].section}</small>
                        </div>
                        <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" style={{width: 14, height: 14, stroke: 'var(--text-muted)', fill: 'none'}}>
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </div>
                    </td>
                  </tr>
                )}
                <tr>
                  <th>Timestamp</th>
                  <td>{turn.at}</td>
                </tr>
              </tbody>
            </table>

            {turn.sources && turn.sources.length > 0 ? (
              <>
                <h3>Retrieved content ({turn.sources.length})</h3>
                <ol className="excerpts">
                  {turn.sources.map((s) => (
                    <li key={s.id} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                      <div style={{flex: 1}}>
                        {s.snippet}…
                        <em style={{fontStyle: 'normal'}}>
                          {s.section}
                        </em>
                      </div>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{width: 16, height: 16, strokeWidth: 2, flex: 'none', marginLeft: 16}}>
                        <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <p className="hint">
                No documents were used. Either the manager answered on its own, or
                nothing in the corpus cleared the similarity floor — in both cases
                the specialist was never called.
              </p>
            )}
          </>
        ) : (
          <>
            <h3>Tokens per agent call</h3>
            <table className="rows">
              <thead>
                <tr>
                  <th>Agent</th>
                  <td style={{ color: "var(--text-muted)" }}>in / out / cached / embed</td>
                </tr>
              </thead>
              <tbody>
                {turn.breakdown?.map((b, i) => (
                  <tr key={i}>
                    <th style={{ textTransform: "capitalize", color: "var(--text-main)" }}>{b.agent}</th>
                    <td>
                      {b.input} / {b.output} / {b.cached} / {b.embed}
                    </td>
                  </tr>
                ))}
                <tr>
                  <th style={{ color: "var(--text-main)", fontWeight: 600 }}>Total</th>
                  <td style={{ fontWeight: 600 }}>{turn.tokens?.toLocaleString("en-US")}</td>
                </tr>
              </tbody>
            </table>
            <p className="hint">
              One row per agent call, not per answer. A delegated answer produces
              two rows, so the cost of delegating stays visible instead of hidden
              inside a single total.
            </p>
          </>
        )}
      </div>
    </aside>
  );
}
