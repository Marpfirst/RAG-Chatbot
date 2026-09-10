"use client";

import { useEffect, useState } from "react";

/**
 * Formats a timestamp in the reader's own timezone.
 *
 * The history page is a server component, so calling toLocaleString there
 * formats in the server's zone — UTC on Vercel — and every row read seven hours
 * early for a visitor in WIB.
 *
 * Formatting happens in an effect rather than during render so the server's
 * output and the first client render agree; the placeholder is what both
 * produce, and the real time replaces it once the browser's zone is known.
 */
export default function LocalTime({ iso }: { iso: string }) {
  const [text, setText] = useState("");

  useEffect(() => {
    setText(
      new Date(iso).toLocaleString(undefined, {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    );
  }, [iso]);

  return <span suppressHydrationWarning>{text || "—"}</span>;
}
