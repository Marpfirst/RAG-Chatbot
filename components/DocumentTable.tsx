"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

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

/**
 * Grouped by document rather than listed flat.
 *
 * The flat table was accurate and misleading at the same time: it showed 38
 * chunks with the document name repeated on every row, so the fact that there
 * are four source documents was something a reader had to reconstruct. The
 * corpus is the thing being demonstrated, so it should be legible as documents
 * first and chunks second.
 *
 * There is deliberately no "read the whole document" view. Reassembling one
 * would mean printing its sections in order, and the order is not stored: the
 * `chunks` table has no column for it, so the page reads `.order("id")`, which
 * is alphabetical. For product.md that puts "Bahasa Antarmuka" first and
 * "Ringkasan Produk" fourth. Presenting that as the document would be a lie
 * about the source, so the sections are shown as what they are instead.
 */
export default function DocumentTable({ chunks }: { chunks: DocChunk[] }) {
  const groups = useMemo(() => {
    const by = new Map<string, DocChunk[]>();
    for (const c of chunks) {
      if (!by.has(c.doc)) by.set(c.doc, []);
      by.get(c.doc)!.push(c);
    }
    return [...by.entries()].map(([doc, items]) => ({
      doc,
      items,
      tokens: items.reduce((n, c) => n + c.token_count, 0),
    }));
  }, [chunks]);

  const [openDocs, setOpenDocs] = useState<Set<string>>(
    () => new Set(chunks.map((c) => c.doc))
  );
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<string | null>(null);

  /**
   * Arriving from a chat answer's "Source document" link should land on the
   * exact section AND open it — a highlighted row the reader still has to click
   * is only half an answer. Now it has to open the section's document too, or
   * the row it scrolls to is inside a collapsed group.
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

      setOpenDocs((prev) => new Set(prev).add(id.split("#")[0]));
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

  const flip = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  return (
    <div className="doc-groups">
      {groups.map((g) => {
        const docOpen = openDocs.has(g.doc);

        return (
          <div className="doc-group" key={g.doc}>
            <button
              className="doc-group-head"
              onClick={() => setOpenDocs((p) => flip(p, g.doc))}
              aria-expanded={docOpen}
            >
              <div className="doc-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              </div>
              <div className="doc-group-name">
                <strong>{TITLES[g.doc] ?? g.doc}</strong>
                <span>
                  {g.doc}.md · {g.items.length} bagian · {g.tokens.toLocaleString("en-US")} token
                </span>
              </div>
              <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {docOpen && (
              <div className="doc-group-body">
                <div className="scroll-x">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Section</th>
                          <th className="num">Tokens</th>
                          <th aria-label="Expand" />
                        </tr>
                      </thead>
                      <tbody>
                        {g.items.map((c) => {
                          const isOpen = open.has(c.id);
                          return (
                            <Fragment key={c.id}>
                              <tr
                                id={c.id}
                                className={`doc-row${flash === c.id ? " row-flash" : ""}`}
                                data-open={isOpen}
                                onClick={() => setOpen((p) => flip(p, c.id))}
                                tabIndex={0}
                                role="button"
                                aria-expanded={isOpen}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    setOpen((p) => flip(p, c.id));
                                  }
                                }}
                              >
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
                                  <td colSpan={3}>
                                    <p>{c.text}</p>
                                    <footer>
                                      <code>{c.id}</code>
                                      <span>
                                        {c.token_count} embedding tokens · this is exactly the
                                        text the specialist receives when this section is
                                        retrieved
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
            )}
          </div>
        );
      })}
    </div>
  );
}
