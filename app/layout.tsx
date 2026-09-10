import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sigap",
  description: "AI Assistant for your documents",
};

/**
 * Applied before first paint, so a dark-mode visitor never sees a flash of the
 * light theme. The toggle in the sidebar writes the same key; this only decides
 * what the very first frame looks like.
 */
const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem("theme");var d=window.matchMedia("(prefers-color-scheme: dark)").matches;if(s==="dark"||(!s&&d))document.documentElement.classList.add("dark")}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
