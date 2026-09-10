import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

// Service-role client. Server-side only — never import this from a component.
export function db() {
  return createClient(env.supabaseUrl(), env.supabaseKey(), {
    auth: { persistSession: false },
  });
}
