import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sigap Assistant",
  description: "Helpdesk assistant for Sigap",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
