"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Forces a server refetch each time the page is opened.
 *
 * Client-side navigation serves a cached copy of a dynamic route's payload, so
 * clicking History straight after asking a question showed the list as it stood
 * before the answer landed.
 *
 * Two separate caches were in play. `cache: "no-store"` in lib/db.ts fixed the
 * server side. This handles the client router cache, which
 * `experimental.staleTimes: { dynamic: 0 }` did not: removing this component
 * and testing again put the list one question behind. Costs one refetch of
 * around 130ms per visit, against a page that renders in about the same.
 *
 * Safe to run on mount: refresh() replaces the server payload without
 * remounting client components, so it cannot loop.
 */
export default function RefreshOnMount() {
  const router = useRouter();
  useEffect(() => {
    router.refresh();
  }, [router]);
  return null;
}
