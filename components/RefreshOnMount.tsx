"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Forces a server refetch each time the page is opened.
 *
 * Client-side navigation serves a cached copy of a dynamic route's payload, so
 * clicking History straight after asking a question showed the list as it stood
 * before the answer landed. `experimental.staleTimes` is meant to control that
 * and did not take effect here, so the page asks for fresh data itself.
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
