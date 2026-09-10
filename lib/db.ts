import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

// Service-role client. Server-side only — never import this from a component.
export function db() {
  return createClient(env.supabaseUrl(), env.supabaseKey(), {
    auth: { persistSession: false },
    global: {
      /**
       * Opt every query out of Next's data cache.
       *
       * supabase-js talks to PostgREST over `fetch`, and Next replaces `fetch`
       * with a caching version inside server components. The History page then
       * served rows from a request made hours earlier while an identical query
       * from a script returned the newest ones — `export const dynamic =
       * "force-dynamic"` had not helped, because it governs how the route is
       * rendered, not whether the data underneath it is cached.
       *
       * Every read here is meant to reflect the database right now, so none of
       * it should be cached.
       */
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
}
