"use client";

import { useEffect, useRef, useState } from "react";

type Breakdown = {
  agent: "manager" | "specialist";
  input: number;
  output: number;
  cached: number;
  embed: number;
};

type Msg = {
  role: "user" | "assistant" | "error";
  text: string;
  agent?: "manager" | "specialist";
  tokens?: number;
  breakdown?: Breakdown[];
};

const SAMPLES = [
  "Apa itu SLA?",
  "Berapa harga paket Tumbuh?",
  "Batas ukuran lampiran berapa?",
  "Kalau batal langganan, uangnya balik nggak?",
];

export default function Page() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [convId, setConvId] = useState<string | undefined>();
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;

    setMessages((m) => [...m, { role: "user", text: question }]);
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
        setMessages((m) => [...m, { role: "error", text: data.error ?? "Terjadi kesalahan." }]);
      } else {
        setConvId(data.conversationId);
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text: data.answer,
            agent: data.agent,
            tokens: data.tokens,
            breakdown: data.breakdown,
          },
        ]);
      }
    } catch {
      setMessages((m) => [...m, { role: "error", text: "Gagal menghubungi server." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap">
      <header>
        <div>
          <h1>Sigap Assistant</h1>
          <p>Tanya apa saja soal produk, harga, kebijakan, atau operasional.</p>
        </div>
        <a href="/history">Riwayat token →</a>
      </header>

      <div className="thread" ref={threadRef}>
        {messages.length === 0 && (
          <div className="empty">
            Coba salah satu:
            <ul>
              {SAMPLES.map((s) => (
                <li key={s}>
                  <button onClick={() => send(s)}>{s}</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="bubble">{m.text}</div>
            {m.role === "assistant" && (
              <div className="meta">
                <span className="badge">{m.agent}</span>
                <span>{m.tokens?.toLocaleString("id-ID")} token</span>
                {m.breakdown && m.breakdown.length > 0 && (
                  <details>
                    <summary>rincian</summary>
                    <pre>
                      {m.breakdown
                        .map(
                          (b) =>
                            `${b.agent.padEnd(11)} in ${b.input}  out ${b.output}` +
                            (b.cached ? `  cached ${b.cached}` : "") +
                            (b.embed ? `  embed ${b.embed}` : "")
                        )
                        .join("\n")}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div className="msg assistant">
            <div className="bubble" style={{ color: "var(--muted)" }}>
              …
            </div>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
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
        <button className="send" type="submit" disabled={busy || !input.trim()}>
          Kirim
        </button>
      </form>
    </div>
  );
}
