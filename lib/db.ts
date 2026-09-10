import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

/**
 * Service-role client. Server-side only — never import this from a component.
 *
 * `revalidate` decides how Next treats the reads made through this client:
 *
 *   false (default)  never cached; every read hits Supabase
 *   a number         cached for that many seconds, which also lets the page
 *                    that made the read be statically rendered
 *
 * The default is uncached because that is the safe answer, and because getting
 * it wrong already cost a real bug once: supabase-js talks to PostgREST over
 * `fetch`, Next replaces `fetch` with a caching version inside server
 * components, and the History page served rows from a request made hours
 * earlier while an identical query from a script returned the newest ones.
 * `export const dynamic = "force-dynamic"` had not helped, because it governs
 * how the route is rendered, not whether the data underneath it is cached.
 *
 * A caller that opts into caching is stating that it knows how its data
 * changes and what invalidates it. Both callers that do so say which in their
 * own comments.
 */
export function db(revalidate: number | false = false) {
  return createClient(env.supabaseUrl(), env.supabaseKey(), {
    auth: { persistSession: false },
    global: {
      fetch: (input, init) => {
        const u = typeof input === "string" ? input : (input as Request).url;
        const t = u.split("/rest/v1/")[1]?.split("?")[0] ?? u;
        console.log(`[SUPABASE] ${t}`);
        return revalidate === false
          ? fetch(input, { ...init, cache: "no-store" })
          : fetch(input, { ...init, next: { revalidate } });
      },
    },
  });
}
