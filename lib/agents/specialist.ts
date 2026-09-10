import { chatClient, readUsage, type Usage } from "../llm";
import { env } from "../env";
import type { Chunk } from "../retrieval";

/**
 * The specialist receives the user's ORIGINAL question plus the manager's
 * normalised query — and no conversation history.
 *
 * Sending only the normalised query was cheaper but lost information: for a
 * two-part question the manager narrows it to one search phrase, and the second
 * half disappears before the specialist ever sees it. Sending only the original
 * question breaks follow-ups ("the bigger plan?"), which are meaningless without
 * the conversation. Sending both costs ~10 tokens and fixes both.
 *
 * When `chunks` is empty (nothing cleared the similarity floor) we skip the API
 * entirely and return a fixed refusal. An out-of-corpus question therefore
 * costs one manager call plus one embedding, and nothing else.
 */
const NOT_FOUND =
  "Informasi itu tidak ada di dokumen Sigap yang saya punya.";

export type SpecialistResult = {
  text: string;
  usage: Usage;
  model: string;
  latency: number;
  skipped: boolean;
};

export async function runSpecialist(
  question: string,
  resolvedQuery: string,
  chunks: Chunk[]
): Promise<SpecialistResult> {
  const model = env.modelSpecialist();

  if (chunks.length === 0) {
    return {
      text: NOT_FOUND,
      usage: { input: 0, output: 0, cached: 0 },
      model,
      latency: 0,
      skipped: true,
    };
  }

  const context = chunks.map((c) => c.content).join("\n\n");

  const started = Date.now();
  const res = await chatClient().chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: [
          "Answer using ONLY the context below.",
          "Answer every part of the question. If the context covers only some",
          "parts, answer those and say which part is not in the documents —",
          "do not refuse the whole question over a missing half.",
          `Only if the context supports nothing at all, reply exactly: ${NOT_FOUND}`,
          "Do not guess numbers. Reply in the user's language. Be brief.",
          "",
          context,
        ].join("\n"),
      },
      {
        role: "user",
        content:
          question === resolvedQuery
            ? question
            : `${question}
(maksud: ${resolvedQuery})`,
      },
    ],
    max_tokens: env.maxTokensSpecialist(),
    temperature: 0,
  });
  const latency = Date.now() - started;

  return {
    text: res.choices[0].message.content?.trim() || NOT_FOUND,
    usage: readUsage(res.usage),
    model,
    latency,
    skipped: false,
  };
}

export { NOT_FOUND };
