# Sigap Assistant — a two-agent chat that shows what every answer costs

![Next.js](https://img.shields.io/badge/Next.js-14-000000?logo=next.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-pgvector-3ECF8E?logo=supabase&logoColor=white)
![Tokens](https://img.shields.io/badge/tokens%2Fquestion-666-blue)
![Golden set](https://img.shields.io/badge/golden%20set-24%2F24-brightgreen)

A single chat column backed by two agents. A **manager** takes every question
and either answers it or hands it to a **specialist** that can read the
documents. The user never sees the handoff — but every answer shows which agent
produced it and how many tokens it used, and the same numbers are stored per
question in the database.

> **Sigap is a fictional company.** Its product, pricing and HR policies were
> written for this project and describe nothing real. That is deliberate: a
> model cannot have learned these facts during training, so a correct answer
> proves retrieval worked rather than that the model already knew.

**[Live app](TODO-paste-vercel-url) · [Architecture](ARCHITECTURE.md) · [Engineering notes](NOTES.md)**

---

## Table of contents

- [What it does](#what-it-does)
- [Why it is built this way](#why-it-is-built-this-way)
- [Results](#results)
- [Installation](#installation)
- [Usage](#usage)
- [Testing](#testing)
- [Project layout](#project-layout)
- [Known gaps](#known-gaps)
- [Credits](#credits)
- [License](#license)

---

## What it does

Ask a question. One of three things happens:

| You ask | What happens | Cost |
|---|---|---|
| "What is an SLA?" | manager answers from its own knowledge | ~440 tokens |
| "How much is the Tumbuh plan?" | manager delegates; specialist reads the docs | ~820 tokens |
| "What is Sigap's refund policy?" | nothing clears the similarity floor, so the specialist is never called | ~650 tokens |
| "Write me a 2,000-word essay" | refused in one sentence | ~420 tokens |

Click any answer to open a panel with the model, latency, per-agent token
breakdown, and the exact document sections the answer was grounded in — each
one expandable, and linked to the page where the whole corpus can be read.

## Why it is built this way

**Routing rides inside the manager's own call.** The obvious design is a small
classifier call that answers YES/NO before the real one, but that makes every
trivial question pay twice. Here the manager either produces an answer or emits
a `search_docs` tool call, so routing adds no request at all. The same call also
rewrites the question into a self-contained search query, which is what makes
follow-ups like "and the bigger plan?" work.

**Documents are chunked at their headings, with no overlap.** Convention says
10–20% overlap, but overlap is a remedy for boundaries a chunker had to guess
at. These boundaries were written by hand, so padding them would only duplicate
tokens on every retrieval.

**Out-of-corpus questions are one of the cheapest paths, not the most
expensive.** If nothing clears the similarity floor, no chunks are sent and the
specialist is skipped entirely. The floor itself was calibrated from measured
score distributions, not guessed — see `npm run probe`.

**The worst case is bounded, not just the average.** `max_tokens` is capped
server-side, over-long input is rejected before any API call, and requests
outside the domain are refused in about 20 tokens. Average token counts are easy
to polish; the tail is what actually hurts.

The reasoning behind each of these, including the ones that were measured and
then rejected, is in [NOTES.md](NOTES.md).

## Results

Measured against a fixed 24-question golden set, with token counts taken from
the API's own `usage` field rather than estimated:

| | Naive baseline | This system |
|---|---|---|
| Tokens per question | 2,654 | **666** (−75%) |
| Golden set | — | **24/24** |
| recall@k | — | 100% |

The naive baseline — whole corpus in every request, full history, no retrieval —
is still in the repo behind `NAIVE_MODE=true`, so the "before" number can be
reproduced rather than taken on trust.

## Installation

**Requirements:** Node 18+, a Supabase project, and an OpenAI API key (any
OpenAI-compatible endpoint works — see `.env.example`).

```bash
git clone <your-fork-url>
cd sigap-assistant
npm install
cp .env.example .env
```

Fill in three values in `.env`:

```
OPENAI_API_KEY=sk-...
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

The rest have working defaults. Then create the schema — paste
[`supabase/schema.sql`](supabase/schema.sql) into the Supabase SQL editor and
run it once — and load the corpus:

```bash
npm run smoke   # verifies the provider: tool calling, embeddings, honest usage
npm run seed    # chunk -> embed -> store, prints corpus size
npm run dev
```

Open http://localhost:3000.

> `npm run smoke` is worth running first. It checks that the provider actually
> supports tool calling, serves `/v1/embeddings`, and reports token usage
> honestly — every number this project reports depends on that last one.

### Deploying

Import the repository on Vercel and set the same environment variables.
`NAIVE_MODE` must be `false`, or visitors will see the 2,654-token baseline
instead of the real system.

## Usage

The sidebar has three pages:

- **Chat** — one column. Each answer carries an agent badge and a token count;
  clicking it opens the details panel.
- **History** — every answer ever given, with input/output/cached/embedding
  tokens and how many agent calls it took.
- **Documents** — all 38 sections of the corpus with their token counts. Click
  a row to read the text exactly as the specialist receives it.

Configuration lives in `.env` and every value is measured rather than assumed
— `MATCH_COUNT`, `MATCH_THRESHOLD`, `DOCMAP`, `HISTORY_TURNS` and the
`MAX_TOKENS_*` caps are all explained in [NOTES.md](NOTES.md).

## Testing

With the dev server running:

```bash
npm run eval -- --label my-run   # 24 questions, six categories
npm run repro                    # one 8-turn conversation, checks consistency
npm run probe                    # similarity distribution behind the threshold
npm run typecheck                # does not touch .next, unlike npm run build
```

`eval` reports routing accuracy, recall@k, precision@k and average tokens per
category, and writes the run to `eval/results/<label>.json`. Every result quoted
in the notes is one of those files.

`repro` exists because the golden set asks each question in a fresh
conversation and therefore cannot catch behaviour that only drifts over several
turns — the two worst bugs in this project both lived there.

> **Note:** `next dev` and `next build` share `.next`. Running a build while the
> dev server is up corrupts it and every route starts 404ing. If that happens,
> `rm -rf .next && npm run dev`. Use `npm run typecheck` while developing.

## Project layout

| Path | What it is |
|---|---|
| `app/api/chat/route.ts` | orchestrator — guards, manager, retrieval, specialist |
| `lib/agents/` | the two system prompts and the tool definition |
| `lib/retrieval.ts` | embed query, top-k vector search, similarity floor |
| `docs/id/` | the corpus |
| `docs/_gaps.md` | topics deliberately absent, plus the planted distractors |
| `docs/flow.drawio` | flow diagrams (runtime, seed, token accounting) |
| `eval/golden.jsonl` | the test set |
| `eval/results/` | every measured run, including the naive baseline |
| `scripts/seed.ts` | structure-aware chunking and embedding |
| `scripts/eval.ts` | the measurement harness |
| `scripts/repro.ts` | multi-turn consistency check |
| `scripts/probe.ts` | similarity distribution, for threshold calibration |
| `scripts/smoke.ts` | provider capability check |

## Known gaps

Listed honestly rather than discovered later:

- **precision@k is 42%.** `k=5` is kept for comparison questions; `k=3` is 9%
  cheaper and passes 17/18. Correctness was chosen, and the waste is known.
- **Rate limiting is per conversation**, so a client that never sends a
  `conversationId` bypasses it.
- **Conversation history lives in one tab.** The data is all in the database;
  only the UI for listing past conversations is missing.
- **Vector search only.** Exact identifiers (plan names, `rel-*` tags) can be
  missed. At 38 chunks it has not mattered.

The full list, with the measurements behind each, is in [NOTES.md](NOTES.md).

## Credits

Built by **Alvin** as a take-home exercise.

Written with Claude (Anthropic) as a pair: architecture and trade-off decisions
were argued out rather than accepted, most implementation code was AI-written,
and the prompts were iterated against measurements. The split is broken down
honestly in [NOTES.md](NOTES.md) §5.

Chunking strategy informed by Meilisearch's
[RAG chunking strategies](https://www.meilisearch.com/blog/rag-chunking-strategies)
— though its 10–20% overlap advice was measured and deliberately not followed,
for reasons in the notes.

## License

MIT — see [LICENSE](LICENSE).
