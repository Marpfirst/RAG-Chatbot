"use server";

import { revalidateTag } from "next/cache";

/**
 * Marks the History page's data stale after a new answer has been stored.
 *
 * This replaces a `router.refresh()` that ran on every History mount. That
 * refetched unconditionally — measured at two extra Supabase queries per visit,
 * whether or not anything had changed — because it had no way to know whether
 * the list was actually out of date. A mutation does know, so the invalidation
 * belongs here.
 *
 * It is a Server Action rather than a `revalidateTag` inside the chat route on
 * purpose. Two caches had to be cleared, not one: `revalidateTag` alone clears
 * the server's data cache, while calling a Server Action from the client also
 * expires the client's router cache — which is the half that previously left
 * History showing one question behind.
 */
export async function refreshHistory() {
  revalidateTag("history");
}
