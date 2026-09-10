"use client";

import { Fragment, useEffect, useState } from "react";

export type DocChunk = {
  id: string;
  doc: string;
  section: string;
  token_count: number;
  text: string;
};

const TITLES: Record<string, string> = {
  product: "Produk Sigap",
  pricing: "Harga Sigap",
  "employee-policy": "Kebijakan Karyawan",
  runbook: "Runbook Teknis",
};

export default function DocumentTable({ chunks }: { chunks: DocChunk[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<string | null>(null);

  /**
   * Arriving from a chat answer's "Source document" link should land on the
   * exact section AND open it — a highlighted row the reader still has to click
   * is only half an answer.
   *
   * `:target` is no help: Next navigates client-side, so the browser never
   * marks a target element. The fragment is also percent-encoded, because chunk
   * ids contain a '#' ("runbook#jendela-deploy") — which is likewise why the
   * lookup uses getElementById instead of a selector.
   */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const apply = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;

      setOpen((prev) => new Set(prev).add(id));
      setFlash(id);

      // Let the row expand before scrolling, or it lands at the wrong offset.
      timer = setTimeout(() => {
        document.getElementById(id)?.scrollIntoView({ block: "center", behavior: "smooth" });
        setTimeout(() => setFlash(null), 2200);
      }, 60);
    };

    apply();
    window.addEventListener("hashchange", apply);
    return () => {
      window.removeEventListener("hashchange", apply);
      clearTimeout(timer);
    };
  }, []);

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="table-card">
      <div className="scroll-x">
        <table className="data">
          <thead>
            <tr>
              <th>Document</th>
              <th>Section</th>
              <th className="num">Tokens</th>
              <th aria-label="Expand" />
            </tr>
          </thead>
          <tbody>
            {chunks.map((c) => {
              const isOpen = open.has(c.id);
              return (
                <Fragment key={c.id}>
                  <tr
                    id={c.id}
                    className={`doc-row${flash === c.id ? " row-flash" : ""}`}
                    data-open={isOpen}
                    onClick={() => toggle(c.id)}
                    tabIndex={0}
                    role="button"
                    aria-expanded={isOpen}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggle(c.id);
                      }
                    }}
                  >
                    <td>
                      <div className="doc-name">
                        <div className="doc-icon">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                            <line x1="16" y1="13" x2="8" y2="13" />
                            <line x1="16" y1="17" x2="8" y2="17" />
                          </svg>
                        </div>
                        <div>
                          <strong>{TITLES[c.doc] ?? c.doc}</strong>
                          <span>{c.doc}.md</span>
                        </div>
                      </div>
                    </td>
                    <td className="doc-section">{c.section}</td>
                    <td className="num">
                      <span className="pill">{c.token_count}</span>
                    </td>
                    <td className="num">
                      <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </td>
                  </tr>

                  {isOpen && (
                    <tr className="doc-detail">
                      <td colSpan={4}>
                        <p>{c.text}</p>
                        <footer>
                          <code>{c.id}</code>
                          <span>
                            {c.token_count} tokens · this is exactly what the specialist
                            receives when this section is retrieved
                          </span>
                        </footer>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
