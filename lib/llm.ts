import OpenAI from "openai";
import { env } from "./env";

export function chatClient() {
  return new OpenAI({ apiKey: env.openaiKey(), baseURL: env.openaiBase() });
}

export function embedClient() {
  return new OpenAI({ apiKey: env.embedKey(), baseURL: env.embedBase() });
}

export type Usage = {
  input: number;
  output: number;
  cached: number;
};

export function readUsage(u: unknown): Usage {
  const raw = u as
    | {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      }
    | undefined;
  return {
    input: raw?.prompt_tokens ?? 0,
    output: raw?.completion_tokens ?? 0,
    cached: raw?.prompt_tokens_details?.cached_tokens ?? 0,
  };
}

/**
 * Embed one string. Returns the vector plus the exact token count reported by
 * the API, so we never have to estimate or ship a tokenizer.
 */
export async function embed(text: string) {
  const res = await embedClient().embeddings.create({
    model: env.embedModel(),
    input: text,
  });
  return {
    vector: res.data[0].embedding,
    tokens: res.usage?.prompt_tokens ?? 0,
  };
}
