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
  new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

export default function Page() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [convId, setConvId] = useState<string>();
  const [selected, setSelected] = useState<number | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({
      top: threadRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns, busy]);

  const answers = turns.filter((t) => t.role === "assistant");
  const detail = turns.find((t) => t.id === selected && t.role === "assistant");

  const session = useMemo(
    () => ({
      questions: turns.filter((t) => t.role === "user").length,
      tokens: answers.reduce((n, t) => n + (t.tokens ?? 0), 0),
    }),
    [turns, answers]
  );

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;

    const at = clock();
    setTurns((t) => [...t, { id: Date.now(), role: "user", text: question, at }]);
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
          { id: Date.now(), role: "error", text: data.error ?? "Terjadi kesalahan.", at: clock() },
        ]);
      } else {
        setConvId(data.conversationId);
        setTurns((t) => [
          ...t,
          {
            id: Date.now(),
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
        { id: Date.now(), role: "error", text: "Gagal menghubungi server.", at: clock() },
      ]);
    } finally {
      setBusy(false);
      boxRef.current?.focus();
    }
  }

  return (
    <Shell
      session={
        <dl>
          <dt>Sesi ini</dt>
          <dd>{session.questions} pertanyaan</dd>
          <dd>{session.tokens.toLocaleString("id-ID")} token</dd>
        </dl>
      }
    >
      <div className={`main${detail ? " with-panel" : ""}`}>
        <div className="column">
          <div className="thread" ref={threadRef}>
            <div className="thread-inner">
              {turns.length === 0 && (
                <div className="empty">
                  <h2>Tanya apa saja</h2>
                  <p>
                    Saya bisa menjawab pertanyaan umum, atau mencari jawabannya di
                    dokumen Sigap.
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
                    <div className="bubble-user">{t.text}</div>
                    <div className="stamp">{t.at}</div>
                  </div>
                ) : (
                  <div className={`turn ${t.role}`} key={t.id}>
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
                      {t.agent && <div className="who">{t.agent}</div>}
                      <p>{t.text}</p>

                      {t.sources && t.sources.length > 0 && (
                        <div className="source-chip">
                          <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
                            <path d="M14 3v5h5" />
                          </svg>
                          <span>
                            <strong>{DOC_TITLES[t.sources[0].doc] ?? t.sources[0].doc}</strong>
                            <span>{t.sources[0].section}</span>
                          </span>
                        </div>
                      )}
                    </div>

                    {t.role === "assistant" && (
                      <div className="meta">
                        <span className="agent">{t.agent}</span>
                        <span className="dot" />
                        <span>{t.tokens?.toLocaleString("id-ID")} token</span>
                        {t.latencyMs != null && (
                          <>
                            <span className="dot" />
                            <span>{(t.latencyMs / 1000).toFixed(1)}s</span>
                          </>
                        )}
                        <span className="dot" />
                        <span>{t.at}</span>
                      </div>
                    )}
                  </div>
                )
              )}

              {busy && (
                <div className="turn assistant">
                  <div className="answer" style={{ cursor: "default" }}>
                    <span className="typing">
                      <i />
                      <i />
                      <i />
                    </span>
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
                placeholder="Tulis pertanyaan…"
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
          Detail
        </button>
        <button
          className="tab"
          aria-selected={tab === "rincian"}
          onClick={() => setTab("rincian")}
        >
          Rincian token
        </button>
        <button className="close" onClick={onClose} aria-label="Tutup">
          <svg viewBox="0 0 24 24" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {tab === "detail" ? (
        <>
          <h3>Detail jawaban</h3>
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
                <th>Token</th>
                <td>{turn.tokens?.toLocaleString("id-ID")}</td>
              </tr>
              <tr>
                <th>Latensi</th>
                <td>{turn.latencyMs != null ? `${(turn.latencyMs / 1000).toFixed(1)}s` : "—"}</td>
              </tr>
              <tr>
                <th>Chunk terambil</th>
                <td>{turn.sources?.length ?? 0}</td>
              </tr>
              {turn.sources && turn.sources.length > 0 && (
                <tr>
                  <th>Dokumen sumber</th>
                  <td>
                    {DOC_TITLES[turn.sources[0].doc] ?? turn.sources[0].doc}
                    <small>{turn.sources[0].section}</small>
                  </td>
                </tr>
              )}
              <tr>
                <th>Waktu</th>
                <td>{turn.at}</td>
              </tr>
            </tbody>
          </table>

          {turn.sources && turn.sources.length > 0 ? (
            <>
              <h3>Isi yang terambil</h3>
              <ol className="excerpts">
                {turn.sources.map((s) => (
                  <li key={s.id}>
                    <div>
                      {s.snippet}…
                      <em>
                        {s.section} · kemiripan {s.similarity.toFixed(3)}
                      </em>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="hint">
              Tidak ada dokumen yang dipakai. Manager menjawab langsung, atau tidak
              ada bagian dokumen yang melewati ambang kemiripan — dalam kedua kasus
              itu, specialist tidak pernah dipanggil.
            </p>
          )}
        </>
      ) : (
        <>
          <h3>Token per agent call</h3>
          <table className="rows">
            <thead>
              <tr>
                <th>Agent</th>
                <td style={{ color: "var(--muted)" }}>in / out / cached / embed</td>
              </tr>
            </thead>
            <tbody>
              {turn.breakdown?.map((b, i) => (
                <tr key={i}>
                  <th style={{ textTransform: "capitalize", color: "var(--ink)" }}>{b.agent}</th>
                  <td>
                    {b.input} / {b.output} / {b.cached} / {b.embed}
                  </td>
                </tr>
              ))}
              <tr>
                <th style={{ color: "var(--ink)", fontWeight: 600 }}>Total</th>
                <td style={{ fontWeight: 600 }}>{turn.tokens?.toLocaleString("id-ID")}</td>
              </tr>
            </tbody>
          </table>
          <p className="hint">
            Satu baris per panggilan agent, bukan per jawaban. Jawaban yang
            didelegasikan menghasilkan dua baris, jadi ongkos delegasi tetap
            terlihat dan tidak tersembunyi di dalam satu angka total.
          </p>
        </>
      )}
    </aside>
  );
}
