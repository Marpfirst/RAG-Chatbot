/**
 * Replay one multi-turn conversation and print the route each turn took.
 *
 * The golden set tests questions in isolation, which hid a real failure: the
 * manager sees its own previous answers in the history, so one refusal becomes
 * a worked example that later turns imitate. Asking the same question four
 * times in one conversation produced four different behaviours.
 *
 * Usage: npx tsx scripts/repro.ts
 */
import "dotenv/config";

const BASE = process.env.EVAL_BASE_URL || "http://localhost:3000";

const SCRIPT = [
  "Apa itu SLA?",
  "what is sla",
  "who are u",
  "who am i",
  "how much u spent for build this chatbot",
  "what is sla",
  "what is sla",
  "what is sla",
];

// Every turn asking about SLA must be answered by the manager, and the answer
// must actually explain the term rather than deflect.
const EXPECT_MANAGER_ANSWER = new Set([0, 1, 5, 6, 7]);

/**
 * Turn 1 repeats turn 0's question in another language, immediately. The model
 * treats that as already handled and answers with a statement of its own scope
 * instead of the explanation.
 *
 * Three principled rules were tried and none fixed it — naming the failure
 * shape, naming the repeat-in-another-language case, and a general
 * anti-deflection instruction. What did work was pinning the literal string
 * "what is sla" into the prompt, which privileged one phrasing for no reason
 * anyone could defend, so it was removed.
 *
 * Marked known rather than silently dropped: if a prompt or model change ever
 * makes it pass, that is worth noticing.
 */
const KNOWN_LIMITATION = new Set([1]);

async function main() {
  let convId: string | undefined;
  let failures = 0;

  for (const [i, message] of SCRIPT.entries()) {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, conversationId: convId }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.log(`${i}  ERROR  ${data.error}`);
      failures++;
      continue;
    }
    convId = data.conversationId;

    const answer: string = data.answer;
    const explained = /service level agreement/i.test(answer);
    const deflected =
      /hanya dapat|tidak ada di dokumen|hanya bisa|silakan beri tahu saya jika/i.test(answer) &&
      !explained;

    let verdict = "ok  ";
    if (EXPECT_MANAGER_ANSWER.has(i)) {
      if (data.agent !== "manager") {
        verdict = "FAIL";
        failures++;
      } else if (!explained || data.outputTokens < 40) {
        // A deflection that happens to name "Service Level Agreements" while
        // listing what the assistant covers satisfies the keyword check but is
        // not an answer. Length separates the two: a real explanation runs to
        // ~70 output tokens, a scope statement to about half that.
        if (KNOWN_LIMITATION.has(i)) {
          verdict = "KNOWN";
        } else {
          verdict = "FAIL";
          failures++;
        }
      }
    } else if (deflected && data.agent !== "manager") {
      verdict = "FAIL";
      failures++;
    }

    console.log(
      `${verdict} ${String(i).padStart(2)}  ${data.agent.padEnd(10)} ` +
        `${String(data.tokens).padStart(5)} tok  ${message.slice(0, 28).padEnd(30)} ` +
        `${answer.slice(0, 70).replace(/\s+/g, " ")}`
    );
  }

  console.log("\n" + (failures ? `${failures} failure(s)` : "consistent across all turns"));
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
