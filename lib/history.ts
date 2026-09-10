import { db } from "./db";
import { env } from "./env";

export type Turn = { role: "user" | "assistant"; content: string };

/**
 * Last N messages of the conversation, oldest first.
 *
 * History goes to the MANAGER only. The specialist never sees it: by the time
 * the manager delegates it has already resolved pronouns into a standalone
 * search query, so the conversation would be dead weight on the more expensive
 * call.
 */
export async function recentTurns(conversationId: string): Promise<Turn[]> {
  const limit = env.naiveMode() ? 100 : env.historyTurns();

  const { data, error } = await db()
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("id", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`recentTurns failed: ${error.message}`);
  return ((data ?? []) as Turn[]).reverse();
}
