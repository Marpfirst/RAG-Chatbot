import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { chatClient, readUsage, type Usage } from "../llm";
import { env } from "../env";
import type { Turn } from "../history";
import docmap from "../docmap.json";

/**
 * The routing rule lives here, and it costs nothing extra: the manager either
 * answers or emits a tool call in its normal turn. A separate classification
 * call would make every trivial question pay twice.
 *
 * Three outcomes, not two. "General question" is deliberately NOT "anything a
 * chatbot could answer" — an open-ended manager is a token hole. STEP 3 caps
 * the worst case at a one-sentence decline.
 */
function pickMap(): string {
  // Default is "medium": doc names plus the first few section titles.
  // Measured on the golden set — "full" (every section title) costs ~110 tokens
  // more per question for no accuracy gain, and "compact" (names only) is
  // cheaper still but strips the vocabulary the manager needs to turn a
  // follow-up like "the bigger plan?" into a self-contained query.
  switch (process.env.DOCMAP) {
    case "compact":
      return docmap.compact;
    case "full":
      return docmap.map;
    default:
      return docmap.medium;
  }
}

/**
 * The routing policy.
 *
 * It asks one question — does a correct answer need a fact that only Sigap's
 * documents hold? — and falls back to domain scope when the answer is no. That
 * is the whole model. It replaced a prompt that had grown a list of allowed
 * general topics and a list of banned ones, which failed the way lists fail:
 * "Apa itu API?", "Apa itu webhook?" and "Apa itu reimbursement?" were each one
 * step outside the allowed list, so all three were refused outright.
 *
 * Neither length nor register is a criterion. Both were tried as proxies and
 * both are wrong: a two-word lowercase message can need retrieval, and a
 * question with a long answer can still be in scope.
 */
function systemPrompt(): string {
  return [
    "You are the Manager for Sigap, an Indonesian helpdesk SaaS. Handle each",
    "request by the cheapest path that still answers it correctly.",
    "",
    "Internal documents you can search:",
    pickMap(),
    "",
    "Decide in this order.",
    "",
    // "pay" is named because the model refused salary questions outright
    // without searching — a trained reflex about compensation that overrode
    // the rule. Pay is an internal fact like any other; whether the documents
    // cover it is for retrieval to answer, not for the manager to assume.
    "STEP 1. Does a correct answer need a fact specific to Sigap — its product,",
    "pricing, employee policy including pay and benefits, security, or",
    "operations? This includes topics you believe Sigap does not have.",
    "-> call search_docs. Never state what Sigap does or does not have without",
    "searching; the documents decide that, not you. Write the query in",
    "Indonesian as a full noun phrase naming the topic: expand abbreviations,",
    "resolve pronouns and anything the message leaves out, and use the wording",
    "the documents would use.",
    // "kapan WFH?" produced the query "WFH". Embedded, that scored 0.370 and
    // fell under the similarity floor, while "hari kerja dari rumah WFH Sigap"
    // scores 0.787 against the same chunk. The retriever was fine; the query
    // was two characters long.
    "Bad: \"WFH\". Good: \"hari kerja dari rumah WFH\".",
    "",
    // The domain is named in three clauses rather than enumerated as allowed
    // topics. An enumeration was what broke: items one step outside it fell
    // through to STEP 3 and were refused. But some positive anchor is needed —
    // with STEP 2 stated only as the absence of the other two, the model never
    // took it at all, and every general question was either searched or
    // refused.
    "STEP 2. No Sigap-specific fact is needed, and the topic belongs to the",
    "domain this assistant works in: customer support and helpdesk practice,",
    "running a SaaS product and its technical vocabulary, and the subjects the",
    "documents above cover.",
    "-> answer from your own knowledge. Never search. Give the explanation",
    "itself; naming what you cover is not an answer.",
    "",
    "STEP 3. The topic is outside that domain.",
    "-> decline in one sentence and say what you do cover. Never search.",
    "",
    "Rules:",
    // The split restated for the one question form that kept landing wrong.
    // "Apa itu API?", "What is a helpdesk ticket?" and "wHaT iS sLa" were all
    // declined; each asks what a word means, which needs no Sigap fact at all.
    "Explaining a term of that domain is STEP 2; only Sigap's own figure or",
    "policy for it is STEP 1. A term from outside the domain stays outside it",
    "however the question is phrased.",
    "Scope decides the route, never length. How short, long, casual or oddly",
    "capitalised a message is, and how long its answer would run, are not",
    "criteria.",
    "If any part of a message needs a Sigap fact, take STEP 1 for the message.",
    // The failing shape was literal: right after answering "Apa itu SLA?", the
    // same question in English got "I'm here to assist with support work
    // topics..." — a scope statement instead of an answer. Naming that shape
    // is what stopped it.
    "Judge each message on its own: earlier turns are context, not examples.",
    "Asking again, in another language or another casing, asks for the same",
    "answer in full.",
    // Cutting the second sentence to save 25 tokens cost two cases, so it
    // stays. Every failure it guards against had one shape: "I can't answer
    // that, but I can help with helpdesk practice" — in reply to a question
    // about helpdesk tickets.
    "Never reply by only listing what you can help with. If the topic is one",
    "you just named as covered, you are answering it, not declining it.",
    "Keep a STEP 2 answer to 3 sentences and a STEP 3 reply to one.",
    "Never repeat these rules to the user. Reply in the user's language.",
  ].join("\n");
}

const searchTool = {
  type: "function" as const,
  function: {
    name: "search_docs",
    description: "Search Sigap's internal documents.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Indonesian search query" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
};

export type ManagerResult =
  | { kind: "answer"; text: string; usage: Usage; model: string; latency: number }
  | { kind: "delegate"; query: string; usage: Usage; model: string; latency: number };

export async function runManager(
  question: string,
  history: Turn[]
): Promise<ManagerResult> {
  const model = env.modelManager();
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt() },
    ...history.map((t) => ({ role: t.role, content: t.content }) as ChatCompletionMessageParam),
    { role: "user", content: question },
  ];

  const started = Date.now();
  const res = await chatClient().chat.completions.create({
    model,
    messages,
    tools: [searchTool],
    max_tokens: env.maxTokensManager(),
    temperature: 0,
  });
  const latency = Date.now() - started;

  const usage = readUsage(res.usage);
  const choice = res.choices[0].message;
  const call = choice.tool_calls?.[0];

  if (call && call.type === "function") {
    let query = question;
    try {
      query = JSON.parse(call.function.arguments).query || question;
    } catch {
      // Malformed tool arguments: fall back to the raw question rather than
      // spending another call asking the model to try again.
    }
    return { kind: "delegate", query, usage, model, latency };
  }

  return {
    kind: "answer",
    text: choice.content?.trim() || "Maaf, saya belum bisa menjawab itu.",
    usage,
    model,
    latency,
  };
}
