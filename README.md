<div align="center">

# Sigap Assistant

**Two agents. One chat column. Every token accounted for.**

[![Next.js](https://img.shields.io/badge/Next.js-14-000000?logo=next.js&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Supabase](https://img.shields.io/badge/Supabase-pgvector-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com)
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

The decision is one question, not a list of allowed topics: **does a correct
answer need a fact that only Sigap's documents hold?** If yes, search. If no,
answer it when the topic belongs to the domain and decline when it does not.
Neither the length of the question nor the length of its answer is a criterion.

### 📉 A bounded worst case, not just a good average

`max_tokens` is capped server-side, over-long input is rejected before any API
call, questions outside the domain are refused in about 20 tokens, and requests
are rate limited per client address. Average token counts are easy to polish;
the tail is what actually hurts.

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

Measured against a fixed 34-question golden set, token counts taken from the
API's `usage` field:

| | Naive baseline | This system |
|---|---|---|
| Tokens per question | 2,654 | **818** (−69%) |
| Golden set | — | **34/34** |
| recall@k | — | **100%** |

Per category:

| Category | Naive | Now |
|---|---|---|
| General knowledge | 2,640 | 692 |
| Scope boundary | — | 684 |
| Needs the documents | 2,519 | 1,019 |
| Comparison across two sections | 2,636 | 1,051 |
| Absent from the documents | 2,554 | 864 |
| Out of domain | 3,296 | 651 |
| Follow-up question | 2,575 | 1,076 |

The golden set grew from 24 to 34 questions, so the totals are not directly
comparable to an earlier reading of this table. The comparable measurement is
the one taken on the same 34 questions before and after the routing rewrite:
**31/34 at 789 tokens → 34/34 at 842 tokens.** Fifty-three more tokens per
question bought three classes of in-domain question that used to be refused
outright. A later measured change — dropping the `[Doc > Section]` header from
the context sent to the specialist, but not from what is embedded — brought that
back to **818** with the score unchanged. Two other reductions were tried
against the same 34 questions and both cost correctness; the numbers are in
[NOTES.md](NOTES.md) §7.

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
| `docs/flow.drawio` | flow diagrams — runtime, seeding, token accounting |
| `docs/rag-flow.drawio` | the RAG pipeline in detail, and what re-indexing costs |
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

- **About 175 tokens per document question are padding.** `k` is fixed at 5, but
  most questions are answered by one section, so four of the five chunks are
  ballast. `k=5` is kept because comparison questions genuinely need two, and
  both `k=4` and `k=3` broke the same follow-up case when measured. Adaptive `k`
  was tried at two thresholds and made things worse.

  This is the honest form of a number the harness reports as *"precision@k
  37%"*. That figure looks worse than it is: when one chunk is correct and five
  are sent, precision **cannot** exceed 0.20 — it is arithmetic, not quality.
  The tokens are the real cost.

  An earlier version of this line said *340 tokens*. That was wrong, and the
  error is worth naming: `chunks.token_count` is filled in from the **embedding**
  API's `usage.prompt_tokens`, so it counts with `cl100k_base`, the embedding
  model's tokenizer. The chat model bills with `o200k_base`, which is about 19%
  cheaper on this corpus. Every per-chunk figure taken from that column was
  therefore inflated.
- **The line between "general but relevant" and "out of domain" has no
  objective answer.** The task specification says the manager may answer general
  questions and does not define *general*, so every routing score in this
  repository is measured against one interpretation of that word rather than
  against a supplied key. 34/34 means the system is consistent with that
  interpretation, not that the interpretation is right. *"Apa itu API?"* is
  answered and *"What is Python?"* is refused; both are technical terms, and
  only a judgement call separates them.
- **Repeating an identical question several times in one conversation can move
  the route.** The fourth *"what is sla"* in a row turns into a document search
  and comes back "not in the documents", after three correct answers. Three
  fixes were tried and measured; none moved it.
- **Every dynamic page render used to cross the Pacific twice.** The Supabase
  project runs in Singapore, and Vercel's default function region is `iad1`
  (Washington DC), so a request from Jakarta went edge Singapore -> function US
  East -> database Singapore and back. The query itself takes 40-80 ms; the
  measured page render was 683 ms. `vercel.json` now pins the function to
  `sin1`. Worth re-measuring on any redeploy: `curl -sI <url>/history` and read
  `X-Vercel-Id`, which names the edge and the execution region.
- **Navigation used to refetch data that had not changed.** One Chat -> History
  click cost three Supabase queries: one render plus two from a `router.refresh()`
  that ran on every mount. It fixed a stale-data bug, but by guessing — a
  navigation does not know whether anything changed, whereas a mutation does.
  History is now cached and invalidated once per new answer; Documents, which
  nothing in the UI writes to, is cached for an hour. Measured the same way
  afterwards: five back-and-forth navigations cost zero queries, and History
  after a new answer costs exactly one.
- **Rate limiting shares a budget across one address.** Requests are counted per
  client address, 15 a minute — generous for a person, but an office behind one
  NAT shares that allowance, and a distributed caller is not stopped at all. It
  bounds the rate, not the total: the actual ceiling on spend is the provider's
  own budget cap.
- **Conversation history lives in one browser tab.** A recent-chats list was
  built and then deliberately removed: it served none of the project's stated
  requirements, and a schema migration close to a deadline was not a trade worth
  making. Every conversation is still in the database — only the UI is missing.
- **Vector search only.** Exact identifiers — plan names, `rel-*` tags — could
  be missed where a keyword index would not miss them. Left alone on purpose:
  recall@k is 100% across the golden set, so there is no measured problem to
  fix. It becomes one on a larger corpus.

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