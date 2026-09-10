/**
 * Scores every chunk in the corpus against the five factors commonly cited for
 * "chunk quality" in RAG writing.
 *
 * Deliberately heuristic and deliberately offline. An LLM judge would be the
 * obvious tool and is the wrong one here: it costs tokens to grade a project
 * measured on tokens, and its verdict is not reproducible. Everything below is
 * a proxy that runs the same way every time, and each proxy is named so a
 * reader can disagree with it.
 *
 * The five factors, and what stands in for them:
 *
 *   1. self-contained     no dangling reference in the opening sentence
 *   2. claim up front     the section subject appears in the first sentence
 *   3. clear language     concrete numbers or named entities present
 *   4. right size         token count inside the range being tested
 *   5. entity signals     the subject is named rather than pronominalised
 *
 * Usage: npx tsx scripts/chunkscore.ts
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

// The commonly quoted range. Our chunks sit well under it, which is the point
// of running this: to see whether that costs anything measurable.
const IDEAL_MIN = 200;
const IDEAL_MAX = 500;

/** Words that only mean something if an earlier chunk is present. */
const DANGLING = [
  "ini", "itu", "tersebut", "mereka", "nya",
  "seperti disebut", "di atas", "sebelumnya", "berikut ini",
];

/** Connectors that carry no information on their own. */
const VAGUE = ["hal tersebut", "sehubungan dengan", "adapun", "dengan demikian", "oleh karena itu"];

type Row = { id: string; doc: string; section: string; content: string; token_count: number };

function stripHeader(content: string) {
  return content.replace(/^\[[^\]]*\]\s*/, "").trim();
}

function firstSentence(text: string) {
  const m = text.match(/^[^.!?\n]+[.!?]?/);
  return (m ? m[0] : text).trim();
}

/** Words of the section title that carry meaning, lowercased. */
function subjectWords(section: string) {
  return section
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3 && !["dan", "atau", "untuk", "yang", "pada"].includes(w));
}

function score(row: Row) {
  const body = stripHeader(row.content);
  const first = firstSentence(body);
  const lower = first.toLowerCase();

  // 1. self-contained — an opening that starts with a bare reference needs a
  //    neighbour to make sense.
  const opensWithReference = DANGLING.some((w) =>
    new RegExp(`^${w}\\b|^\\w+\\s+${w}\\b`, "i").test(lower)
  );
  const selfContained = !opensWithReference;

  // 2. claim up front — the first sentence should be about the section subject,
  //    not a preamble leading to it.
  const subject = subjectWords(row.section);
  const claimUpFront =
    subject.length === 0 || subject.some((w) => lower.includes(w.slice(0, Math.min(w.length, 6))));

  // 3. clear language — a concrete figure OR a named entity beats prose.
  //    An earlier version required a digit, which flagged perfectly good
  //    sections: "Visa, Mastercard, Midtrans" is as concrete as a number. That
  //    proxy was measuring punctuation, not clarity.
  const hasNumber = /\d/.test(body);
  // "a capitalised word that is not the first one". No lookbehind and no
  //  escape: an earlier version of this line ended up with literal
  // backspace bytes in the pattern, so it never matched anything.
  const hasProperNoun = /\S\s+[A-Z][a-zA-Z]{2,}/.test(body);
  const hasVague = VAGUE.some((v) => body.toLowerCase().includes(v));
  const clear = (hasNumber || hasProperNoun) && !hasVague;

  // 4. size
  const inRange = row.token_count >= IDEAL_MIN && row.token_count <= IDEAL_MAX;

  // 5. entity signals — the subject named in the body, not left to a pronoun.
  const named = subject.length === 0 || subject.some((w) => body.toLowerCase().includes(w.slice(0, 6)));

  const checks = { selfContained, claimUpFront, clear, inRange, named };
  const passed = Object.values(checks).filter(Boolean).length;
  return { ...checks, passed, total: 5 };
}

async function main() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data, error } = await db
    .from("chunks")
    .select("id, doc, section, content, token_count")
    .eq("lang", process.env.CORPUS_LANG ?? "id")
    .order("id");
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Row[];
  const scored = rows.map((r) => ({ row: r, s: score(r) }));

  console.log("chunk                                        tok  self claim clear size named");
  console.log("-".repeat(84));
  const mark = (b: boolean) => (b ? " ok " : " -- ");
  for (const { row, s } of scored) {
    console.log(
      `${row.id.slice(0, 42).padEnd(44)}${String(row.token_count).padStart(4)} ` +
        `${mark(s.selfContained)} ${mark(s.claimUpFront)} ${mark(s.clear)} ${mark(s.inRange)} ${mark(s.named)}`
    );
  }

  const tally = (k: keyof ReturnType<typeof score>) =>
    scored.filter(({ s }) => s[k] === true).length;

  const sizes = rows.map((r) => r.token_count).sort((a, b) => a - b);
  console.log("\n" + "-".repeat(84));
  console.log(`chunks                : ${rows.length}`);
  console.log(`self-contained        : ${tally("selfContained")}/${rows.length}`);
  console.log(`claim in first line   : ${tally("claimUpFront")}/${rows.length}`);
  console.log(`concrete language     : ${tally("clear")}/${rows.length}`);
  console.log(`subject named in body : ${tally("named")}/${rows.length}`);
  console.log(
    `within ${IDEAL_MIN}-${IDEAL_MAX} tokens : ${tally("inRange")}/${rows.length}` +
      `   (actual: min ${sizes[0]}, median ${sizes[Math.floor(sizes.length / 2)]}, max ${sizes.at(-1)})`
  );

  const failing = scored.filter(({ s }) => s.passed < 4);
  if (failing.length) {
    console.log(`\nchunks failing two or more checks:`);
    for (const { row, s } of failing) {
      const missed = Object.entries(s)
        .filter(([k, v]) => v === false && k !== "passed" && k !== "total")
        .map(([k]) => k);
      console.log(`  ${row.id}  — ${missed.join(", ")}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
