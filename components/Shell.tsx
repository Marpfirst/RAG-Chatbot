"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, type ReactNode } from "react";

const NAV = [
  {
    href: "/",
    label: "Chat",
    icon: <i className="far fa-comment-dots" style={{ fontSize: '20px' }}></i>,
  },
  {
    href: "/history",
    label: "History",
    icon: <i className="fas fa-history" style={{ fontSize: '20px' }}></i>,
  },
  {
    href: "/documents",
    label: "Documents",
    icon: <i className="far fa-file-alt" style={{ fontSize: '20px' }}></i>,
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
  const [isDark, setIsDark] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    const savedTheme = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (savedTheme === "dark" || (!savedTheme && prefersDark)) {
      setIsDark(true);
      document.documentElement.classList.add("dark");
    }

    const savedSidebar = localStorage.getItem("sidebar_collapsed");
    if (savedSidebar === "true") {
      setIsCollapsed(true);
    }
  }, []);

  const toggleTheme = () => {
    if (isDark) {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
      setIsDark(false);
    } else {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
      setIsDark(true);
    }
  };

  const toggleCollapse = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    localStorage.setItem("sidebar_collapsed", String(newState));
  };

  return (
    <div className={`shell ${isCollapsed ? "is-collapsed" : ""}`}>
      {open && (
        <div 
          className="mobile-overlay mobile-only" 
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside className="sidebar" data-open={open}>
        <div className="sidebar-header">
          <div className="brand">
            <h1>Sigap</h1>
            <p>Chatbot untuk dokumen internal.</p>
          </div>
          <button className="collapse-btn desktop-only" onClick={toggleCollapse} aria-label="Toggle Sidebar">
            <i className="fas fa-chevron-left" style={{ fontSize: '16px' }}></i>
          </button>
          <button className="close-btn mobile-only" onClick={() => setOpen(false)} aria-label="Close Sidebar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6L6 18M6 6l12 12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
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
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          {session && <div className="session">{session}</div>}

          <div className="theme-toggle-wrap">
            <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
              {isDark ? (
                <i className="far fa-moon" style={{ fontSize: '18px' }}></i>
              ) : (
                <i className="far fa-sun" style={{ fontSize: '18px' }}></i>
              )}
              <span>{isDark ? "Dark mode" : "Light mode"}</span>
            </div>
            <div className="toggle-switch" onClick={toggleTheme}>
              <div className="toggle-switch-handle" />
            </div>
          </div>
          <button onClick={toggleTheme} className="theme-icon-btn" aria-label="Toggle Theme">
            {isDark ? (
              <i className="far fa-moon" style={{ fontSize: '20px' }}></i>
            ) : (
              <i className="far fa-sun" style={{ fontSize: '20px' }}></i>
            )}
          </button>

          <div className="user-profile">
            <div className="user-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="far fa-user" style={{ fontSize: '20px' }}></i>
            </div>
            <div className="user-info">
              <strong>Demo User</strong>
              <span>Exploring with AI</span>
            </div>
          </div>
        </div>
      </aside>

      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <div className="main-area">
        <div className="topbar">
          <strong style={{fontSize: 20, color: 'var(--text-main)'}}>Sigap</strong>
          <button onClick={() => setOpen(true)} aria-label="Buka menu" style={{background: 'transparent', border: 'none', color: 'var(--text-main)', cursor: 'pointer', padding: 8}}>
            <svg viewBox="0 0 24 24" strokeLinecap="round" strokeWidth="2" fill="none" stroke="currentColor" width="24" height="24">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
