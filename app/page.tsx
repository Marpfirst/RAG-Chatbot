"use client";

import React, { useEffect, useMemo, useRef, useState, Fragment } from "react";
import { createPortal } from "react-dom";
import { refreshHistory } from "./actions";
import Link from "next/link";

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
  text: string;
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

const STORAGE_KEY = "chat.session.v2";

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
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    if (!Array.isArray(parsed?.turns)) return null;

    // Drop anything that does not match the shape this build expects. Persisted
    // state has a schema; a stale entry should start a fresh session, not throw
    // in the middle of a render.
    const turns = parsed.turns.filter(
      (t) =>
        t &&
        typeof t.id === "number" &&
        typeof t.text === "string" &&
        (!t.sources || t.sources.every((s) => typeof s?.text === "string"))
    );
    return { convId: parsed.convId, turns };
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

type Reply = { conversationId?: string; turn: Omit<Turn, "id"> };

/**
 * The in-flight request, held outside the component.
 *
 * A fetch started inside the chat page dies with it: navigating to History
 * unmounts the page, the request still completes on the server, but the
 * setState that would have shown the answer runs against a component that no
 * longer exists and React drops it silently. The answer was in the database and
 * nowhere on screen.
 *
 * Kept at module scope, the promise outlives the unmount, and the page picks it
 * back up when it mounts again. Cleared by whichever side consumes it, so the
 * answer is appended exactly once.
 */
let inFlight: { convId?: string; promise: Promise<Reply> } | null = null;

function startRequest(question: string, convId: string | undefined) {
  const promise = (async (): Promise<Reply> => {
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: question, conversationId: convId }),
      });
      const data = await res.json();
      if (!res.ok) {
        return {
          conversationId: convId,
          turn: { role: "error", text: data.error ?? "Terjadi kesalahan.", at: clock() },
        };
      }
      return {
        conversationId: data.conversationId,
        turn: {
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
      };
    } catch {
      return {
        conversationId: convId,
        turn: { role: "error", text: "Gagal menghubungi server.", at: clock() },
      };
    }
  })();

  inFlight = { convId, promise };
  return promise;
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
  const mounted = useRef(true);
  const [portalNode, setPortalNode] = useState<Element | null>(null);

  useEffect(() => {
    mounted.current = true;
    setPortalNode(document.getElementById("sidebar-session-portal"));
    const stored = load();
    if (stored) {
      setTurns(stored.turns ?? []);
      setConvId(stored.convId);
      nextId.current = Math.max(0, ...(stored.turns ?? []).map((t) => t.id)) + 1;
    }
    setHydrated(true);

    // A request that was in flight when this page unmounted is still running.
    // Reattach to it so its answer lands here instead of being dropped.
    if (inFlight) {
      const waiting = inFlight;
      setBusy(true);
      waiting.promise.then((reply) => {
        // Already resolved if the request finished while the page was away —
        // then this fires immediately.
        if (!mounted.current || inFlight !== waiting) return;
        inFlight = null;
        applyReply(reply);
      });
    }
    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    inFlight = null;
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

    setTurns((t) => [...t, { id: nextId.current++, role: "user", text: question, at: clock() }]);
    setInput("");
    setBusy(true);

    const reply = await startRequest(question, convId);
    // If the page was left mid-request, leave inFlight in place with its
    // resolved promise. Whichever mount comes next claims it.
    if (!mounted.current) return;
    inFlight = null;
    applyReply(reply);
  }

  function applyReply(reply: Reply) {
    if (reply.conversationId) setConvId(reply.conversationId);
    setTurns((t) => [...t, { id: nextId.current++, ...reply.turn }]);
    setBusy(false);
    boxRef.current?.focus();
    window.dispatchEvent(new Event("recent-chats:refresh"));
    // The answer is already in the database by the time the reply lands, so
    // History is now one row out of date. Telling it so here is what lets that
    // page be cached at all: it no longer has to refetch on every visit just in
    // case. Fire and forget — nothing on this screen depends on the result.
    void refreshHistory();
  }

  return (
    <Fragment>
      {portalNode &&
        createPortal(
          <div className="session">
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
          </div>,
          portalNode
        )}
      <div className={`main${detail ? " with-panel" : ""}`}>
        <div className="column">
          <div className="thread" ref={threadRef}>
            <div className="thread-inner">
              {turns.length === 0 && (
                <div className="empty">
                  <div style={{display: 'flex', justifyContent: 'center', marginBottom: 24}}>
                    <div style={{width: 64, height: 64, borderRadius: '50%', background: 'var(--bg-sidebar)', display: 'grid', placeItems: 'center', position: 'relative'}}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" style={{width: 32, height: 32, strokeWidth: 1.5}}><path d="M12 2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM5 10h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zm3 4h2v2H8v-2zm6 0h2v2h-2v-2z" /></svg>
                      <div style={{position: 'absolute', bottom: -4, right: -4, width: 24, height: 24, background: '#f6e84d', borderRadius: '50%', display: 'grid', placeItems: 'center', boxShadow: '0 0 0 4px var(--bg-main)'}}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="#101c3d" style={{width: 14, height: 14, strokeWidth: 3}}><path d="M5 13l4 4L19 7"/></svg>
                      </div>
                    </div>
                  </div>
                  <h2 style={{color: 'var(--text-main)', fontSize: 26, fontWeight: 700, marginBottom: 12}}>Tanya apa saja</h2>
                  <p style={{color: 'var(--text-muted)', fontSize: 16, lineHeight: 1.5, marginBottom: 40}}>
                    Saya dapat menjawab pertanyaan atau<br />mencari dari dokumen Anda.
                  </p>
                  <div className="suggestions">
                    <button onClick={() => send("Apa itu SLA?")}>
                      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                        <span style={{fontWeight: 500}}>Apa itu SLA?</span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{width: 16, height: 16}}><path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </div>
                    </button>
                    <button onClick={() => send("Jelaskan proses deployment kita.")}>
                      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                        <span style={{fontWeight: 500}}>Jelaskan proses deployment kita.</span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{width: 16, height: 16}}><path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </div>
                    </button>
                    <button onClick={() => send("Apa kata buku panduan karyawan tentang kerja remote?")}>
                      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                        <span style={{fontWeight: 500}}>Apa kata panduan karyawan tentang kerja remote?</span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{width: 16, height: 16}}><path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </div>
                    </button>
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
              Sigap dapat menjawab pertanyaan atau mencari informasi dari dokumen Anda.
            </div>
          </div>
        </div>

        {detail && <Panel turn={detail} onClose={() => setSelected(null)} />}
      </div>
    </Fragment>
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
                      {/* A real link to the Documents page, scrolled to this
                          exact section. The external-link icon now describes
                          something that happens.
                          Chunk ids contain a '#' ("runbook#jendela-deploy"), so
                          the fragment has to be encoded or the URL ends up with
                          two of them. */}
                      <Link className="source-link" href={`/documents#${encodeURIComponent(turn.sources[0].id)}`}>
                        <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
                          <path d="M14 3v5h5" />
                        </svg>
                        <span>
                          <strong>{DOC_TITLES[turn.sources[0].doc] ?? turn.sources[0].doc}</strong>
                          <small>{turn.sources[0].section}</small>
                        </span>
                        <svg className="go" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </Link>
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
                    <Excerpt key={s.id} source={s} />
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

/**
 * One retrieved chunk. Collapsed it shows the opening lines; expanded it shows
 * the whole thing, because a reader checking whether the answer is supported
 * needs the text the model actually saw, not a preview of it.
 */
function Excerpt({ source }: { source: Source }) {
  const [open, setOpen] = useState(false);
  const text = source.text ?? "";
  const long = text.length > 150;

  return (
    <li className="excerpt" data-open={open}>
      <button
        className="excerpt-toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        disabled={!long}
      >
        <span className="excerpt-body">
          <span className={open || !long ? "full" : "clamped"}>{text}</span>
          <em>
            {source.section} · similarity {source.similarity.toFixed(3)}
          </em>
        </span>
        {long && (
          <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    </li>
  );
}
