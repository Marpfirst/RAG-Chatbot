import { db } from "./db";

export type AgentCall = {
  agent: "manager" | "specialist";
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  embed_tokens: number;
  retrieved_ids?: string[] | null;
  top_similarity?: number | null;
  routed: boolean;
  latency_ms: number;
};

export function totalTokens(calls: AgentCall[]): number {
  return calls.reduce(
    (n, c) => n + c.input_tokens + c.output_tokens + c.embed_tokens,
    0
  );
}

/** The agent the user is told about: whoever produced the final answer. */
export function answeringAgent(calls: AgentCall[]): "manager" | "specialist" {
  return calls[calls.length - 1]?.agent ?? "manager";
}

export async function persist(opts: {
  conversationId: string;
  question: string;
  answer: string;
  calls: AgentCall[];
}) {
  const client = db();

  const { error: userErr } = await client.from("messages").insert({
    conversation_id: opts.conversationId,
    role: "user",
    content: opts.question,
  });
  if (userErr) throw new Error(`insert user message: ${userErr.message}`);

  const { data: assistant, error: aErr } = await client
    .from("messages")
    .insert({
      conversation_id: opts.conversationId,
      role: "assistant",
      content: opts.answer,
    })
    .select("id")
    .single();
  if (aErr) throw new Error(`insert assistant message: ${aErr.message}`);

  // One row per agent call, not per message. A delegated answer writes two
  // rows, so the cost of delegation stays visible instead of hidden in a total.
  const { error: uErr } = await client.from("usage_log").insert(
    opts.calls.map((c) => ({ message_id: assistant.id, ...c }))
  );
  if (uErr) throw new Error(`insert usage_log: ${uErr.message}`);

  return assistant.id as number;
}
