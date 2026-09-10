"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

const NAV = [
  {
    href: "/",
    label: "Chat",
    icon: (
      <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-3.9-.9L3 21l1.9-4.1A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4Z" />
      </svg>
    ),
  },
  {
    href: "/history",
    label: "Riwayat",
    icon: (
      <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v5h5" />
        <path d="M3.5 13a9 9 0 1 0 2.1-6.4L3 8" />
        <path d="M12 7v5l3 2" />
      </svg>
    ),
  },
  {
    href: "/documents",
    label: "Dokumen",
    icon: (
      <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
        <path d="M14 3v5h5" />
      </svg>
    ),
  },
];

export default function Shell({
  children,
  session,
}: {
  children: ReactNode;
  session?: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="shell">
      <aside className="sidebar" data-open={open}>
        <div className="brand">
          <h1>Sigap Assistant</h1>
          <p>Dokumenmu, terjawab.</p>
        </div>

        <nav>
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={pathname === item.href ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              {item.icon}
              {item.label}
            </Link>
          ))}
        </nav>

        {session && <div className="session">{session}</div>}
      </aside>

      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <div className="main-area">
        <div className="topbar">
          <strong>Sigap Assistant</strong>
          <button onClick={() => setOpen(true)} aria-label="Buka menu">
            <svg viewBox="0 0 24 24" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
