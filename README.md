<div align="center">

# Sigap Assistant

**Two agents. One chat column. Every token accounted for.**

[![Next.js](https://img.shields.io/badge/Next.js-14-000000?logo=next.js&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Supabase](https://img.shields.io/badge/Supabase-pgvector-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![Tokens](https://img.shields.io/badge/tokens%2Fquestion-674-informational)
![Golden set](https://img.shields.io/badge/golden%20set-24%2F24-brightgreen)

[Live demo](TODO-paste-vercel-url) ·
[What is this?](#-what-is-sigap-assistant) ·
[Get started](#-get-started) ·
[Key features](#-key-features) ·
[Architecture](#-system-architecture) ·
[Results](#-results)

</div>

---

## 💡 What is Sigap Assistant?

A small chat application where **two agents split the work**, and the split is
measured rather than assumed.

A **manager** receives every question. If it can answer from general knowledge,
it does. If the answer lives in the documents, it hands off to a **specialist**
that reads them. If the question has nothing to do with the domain, it declines
in one sentence.

The user sees one chat column and never learns there were two agents — but every
answer shows which one produced it, how many tokens it cost, and which document
sections it was grounded in. The same numbers are stored per question in
Postgres.

> [!NOTE]
> **Sigap is a fictional company.** Its product, pricing and HR policies were
> written for this project and describe nothing real. That is deliberate: a model
> cannot have learned these facts during training, so a correct answer proves
> retrieval worked rather than that the model already knew.

---

## 🎬 Get Started

### Prerequisites

- Node 18 or newer
- A [Supabase](https://supabase.com) project (free tier is enough)
- An OpenAI API key — or any OpenAI-compatible endpoint, see `.env.example`

### Install

```bash
git clone https://github.com/<your-account>/sigap-assistant.git
cd sigap-assistant
npm install
cp .env.example .env
```

Fill in three values in `.env`. The rest ship with working defaults:

```bash
OPENAI_API_KEY=sk-...
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

### Create the schema

Paste [`supabase/schema.sql`](supabase/schema.sql) into the Supabase SQL editor
and run it once. It creates the tables, the vector search function, and enables
row-level security with no policies — nothing is reachable except through the
server.

### Verify the provider, then load the corpus

```bash
npm run smoke    # tool calling, embeddings endpoint, honest token usage
npm run seed     # chunk -> embed -> store, prints corpus size
npm run dev
```

Open **http://localhost:3000**.

> [!TIP]
> Run `npm run smoke` first. It checks that the provider actually supports tool
> calling, serves `/v1/embeddings`, and reports token usage honestly — every
> number this project publishes rests on that last one.

### Deploy

Import the repository on Vercel and set the same environment variables.
`NAIVE_MODE` must be `false`, or visitors will see the 2,654-token baseline
instead of the real system.

---

## 🌟 Key Features

### 🎯 Routing that costs nothing

The obvious design puts a small classifier call in front of the real one. That
makes every trivial question pay twice. Here the manager either produces an
answer or emits a `search_docs` tool call in its normal turn, so routing adds no
request at all — and the same call rewrites the question into a self-contained
search query, which is what makes follow-ups like *"and the bigger plan?"* work.

### 📉 A bounded worst case, not just a good average

`max_tokens` is capped server-side, over-long input is rejected before any API
call, and questions outside the domain are refused in about 20 tokens. Average
token counts are easy to polish; the tail is what actually hurts.

### 🪶 Out-of-corpus questions are cheap, not expensive

When nothing clears the similarity floor, no chunks are sent and the specialist
is never called. Asking about something the documents do not cover is one of the
*cheapest* paths through the system. The floor was calibrated from a measured
score distribution — run `npm run probe` to see it.

### ✂️ Structure-aware chunking, zero overlap

Convention says 10–20% overlap. Overlap is a remedy for boundaries a chunker had
to guess at; these boundaries are section headings written by hand, so padding
them would only duplicate tokens on every retrieval.

### 🔍 Answers you can check

Click any answer to open a panel with the model, latency, per-agent token
breakdown, and the exact document sections the answer used — each expandable,
each linked to the page where the whole corpus can be read.

### 📊 Numbers that came from somewhere

Every token count is read from the API's own `usage` field, never estimated, and
stored one row per **agent call** rather than per answer — so the cost of
delegating stays visible instead of hidden inside a total.

---

## 🔎 System Architecture

```
                  ┌──────────────┐
   user message → │ rule guards  │ → too long / too fast → rejected, 0 tokens
                  └──────┬───────┘
                         ▼
              ┌────────────────────┐
              │      MANAGER       │  1 call · doc map + 3 rules
              │  tool: search_docs │
              └─────────┬──────────┘
                        │
        ┌───────────────┴───────────────┐
        ▼                               ▼
   answers directly              emits search_docs
   ~440 tokens                          │
                                        ▼
                          embed(question + rewritten query)
                                        │
                                 vector search
                                        │
                     ┌──────────────────┴──────────────────┐
                     ▼                                     ▼
           below similarity floor                  chunks retrieved
           specialist skipped                             │
           "not in the documents"                         ▼
           ~650 tokens                          ┌───────────────────┐
                                                │    SPECIALIST     │
                                                │ answers only from │
                                                │   the context     │
                                                └─────────┬─────────┘
                                                          ▼
                                          messages + usage_log → UI badge
```

Full diagrams — runtime, seeding, and where the token numbers come from — are in
[`docs/flow.drawio`](docs/flow.drawio) and [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 📊 Results

Measured against a fixed 24-question golden set, token counts taken from the
API's `usage` field:

| | Naive baseline | This system |
|---|---|---|
| Tokens per question | 2,654 | **674** (−75%) |
| Golden set | — | **24/24** |
| recall@k | — | **100%** |

Per category:

| Category | Naive | Now |
|---|---|---|
| General knowledge | 2,640 | 518 |
| Needs the documents | 2,519 | 890 |
| Comparison across two sections | 2,636 | 888 |
| Absent from the documents | 2,554 | 715 |
| Out of domain | 3,296 | 481 |

The naive baseline — whole corpus in every request, full history, no retrieval —
is still in the repository behind `NAIVE_MODE=true`, so the "before" number can
be reproduced rather than taken on trust.

---

## 🧪 Testing

With the dev server running:

```bash
npm run eval -- --label my-run   # 24 questions across six categories
npm run repro                    # one 8-turn conversation, checks consistency
npm run probe                    # the similarity distribution behind the floor
npm run typecheck                # unlike npm run build, does not touch .next
```

`eval` reports routing accuracy, recall@k, precision@k and average tokens per
category, then writes the run to `eval/results/<label>.json`. Every number
quoted anywhere in this repository is one of those files.

`repro` exists because the golden set asks each question in a fresh
conversation, so it cannot catch behaviour that only drifts across turns — the
two worst bugs in this project both lived exactly there.

> [!WARNING]
> `next dev` and `next build` share `.next`. Running a build while the dev
> server is up corrupts it and every route starts returning 404. If that
> happens: `rm -rf .next && npm run dev`.

---

## 📁 Project Layout

| Path | What it is |
|---|---|
| `app/api/chat/route.ts` | orchestrator — guards, manager, retrieval, specialist |
| `lib/agents/` | the two system prompts and the tool definition |
| `lib/retrieval.ts` | embed query, top-k vector search, similarity floor |
| `docs/id/` | the corpus |
| `docs/_gaps.md` | topics deliberately absent, plus the planted distractors |
| `docs/flow.drawio` | flow diagrams |
| `eval/golden.jsonl` | the test set |
| `eval/results/` | every measured run, including the naive baseline |
| `scripts/seed.ts` | structure-aware chunking and embedding |
| `scripts/eval.ts` | the measurement harness |
| `scripts/repro.ts` | multi-turn consistency check |
| `scripts/probe.ts` | similarity distribution, for threshold calibration |
| `scripts/smoke.ts` | provider capability check |

---

## ⚠️ Known Gaps

Stated here rather than left to be discovered:

- **precision@k is 42%.** `k=5` is kept for comparison questions; `k=3` is 9%
  cheaper and passes 17/18. Correctness was chosen, and the waste is known.
- **Rate limiting is per conversation**, so a client that never sends a
  `conversationId` bypasses it.
- **Conversation history lives in one browser tab.** The data is all in the
  database; only the UI for listing past conversations is missing.
- **Vector search only.** Exact identifiers — plan names, `rel-*` tags — can be
  missed. At 38 chunks it has not mattered yet.

The full list, with the measurement behind each, is in [NOTES.md](NOTES.md).

---

## 📚 Documentation

| Document | What it covers |
|---|---|
| [NOTES.md](NOTES.md) | the routing rule, before/after token numbers, how correctness was verified, what went wrong, and what is still wasteful |
| [ARCHITECTURE.md](ARCHITECTURE.md) | flow diagrams, data model, token strategy |
| [docs/_gaps.md](docs/_gaps.md) | what the corpus deliberately does not say, and why |

---

## 🙌 Credits

Built by **Alvin** as a take-home exercise.

Written alongside Claude (Anthropic). Architecture and trade-offs were argued
out rather than accepted, most implementation code was AI-written, and the
prompts were iterated against measurements. The split is broken down honestly in
[NOTES.md](NOTES.md) §5.

Chunking approach informed by Meilisearch's
[RAG chunking strategies](https://www.meilisearch.com/blog/rag-chunking-strategies)
— whose 10–20% overlap advice was measured and deliberately not followed.

---

## 📜 License

[MIT](LICENSE)
