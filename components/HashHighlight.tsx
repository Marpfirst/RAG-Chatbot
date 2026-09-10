"use client";

import { useEffect } from "react";

/**
 * Scrolls to the row named by the URL fragment and flashes it.
 *
 * `:target` alone does not work here: Next.js navigates client-side, so the
 * document is never actually re-navigated and the browser never marks an
 * element as the target. The fragment also has to be decoded, because chunk ids
 * contain a '#' ("runbook#jendela-deploy") and are percent-encoded in the link.
 */
export default function HashHighlight() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const apply = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;

      // getElementById, not querySelector — a '#' inside the id is not valid
      // CSS selector syntax.
      const el = document.getElementById(id);
      if (!el) return;

      document.querySelectorAll(".row-flash").forEach((n) => n.classList.remove("row-flash"));
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("row-flash");
      timer = setTimeout(() => el.classList.remove("row-flash"), 2400);
    };

    apply();
    window.addEventListener("hashchange", apply);
    return () => {
      window.removeEventListener("hashchange", apply);
      clearTimeout(timer);
    };
  }, []);

  return null;
}
