<div align="center">

# Sigap Assistant

**Two agents. One chat column. Every token accounted for.**

[![Next.js](https://img.shields.io/badge/Next.js-14-000000?logo=next.js&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Supabase](https://img.shields.io/badge/Supabase-pgvector-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com)
![Tokens](https://img.shields.io/badge/tokens%2Fquestion-843-informational)
![Golden set](https://img.shields.io/badge/golden%20set-40%2F42-brightgreen)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**[Live demo](https://rag-chatbot-marp.vercel.app)** ·
[Repository](https://github.com/Marpfirst/RAG-Chatbot)

</div>

---

## What this is

A small RAG chat application where a **Manager** agent handles general questions
and delegates document-grounded questions to a **Specialist** agent. The reader
sees one chat column; each answer shows which agent produced it and what it cost
in tokens.

The corpus is a fictional Indonesian helpdesk SaaS called Sigap — four documents,
38 sections. Fictional on purpose: the model cannot know Sigap's pricing from
training, so a correct answer proves retrieval worked rather than that the model
guessed well.

## Architecture

```
                  ┌─ answers directly ──────────────────────────► answer
User ── Manager ──┤
                  └─ search_docs ─► retrieval ─► Specialist ────► answer
                                                                    │
                                                              usage_log
```

**There is no separate classifier.** Routing happens inside the Manager's own
turn: it either returns an answer or emits a `search_docs` tool call. A
dedicated classification call would make every trivial question pay twice, in
tokens and in latency.

When nothing clears the similarity floor, the Specialist is skipped entirely and
the system replies "not in the documents" — so an out-of-corpus question is one
of the *cheapest* paths, not the most expensive.

## Routing philosophy

| Question | Route |
|---|---|
| "Apa itu SLA?", "Apa itu API?" | Manager answers from general knowledge |
| "Apa itu Sigap?", "Berapa SLA P1?" | Specialist, grounded in the documents |
| "Buatkan puisi tentang laut." | One-sentence refusal |

The Manager handles general knowledge and conversation. The Specialist is the
source of truth for anything whose answer lives in the provided documents —
including what Sigap itself is, because that definition is in `product.md`.

Neither message length nor capitalisation is a routing criterion; only scope and
whether an internal fact is needed.

## Token accounting

Every API call's `usage` field is recorded — never estimated. `usage_log` stores
one row **per agent call**, not per answer, so the cost of delegating stays
visible instead of being hidden in a total. The chat UI shows the same number
next to each answer, and `/history` shows the stored rows.

## Evaluation

`eval/golden.jsonl` — 42 questions across seven categories: general, scope
boundary, document facts, two-section comparisons, absent-from-corpus,
out-of-domain, and history-dependent follow-ups.

| | Result |
|---|---|
| Golden set | **40/42** |
| Tokens per question | **843** |
| recall@k | **100%** |
| Naive baseline (historical, 18-question set) | 2,654 tokens |

The two failures are known and left unpatched rather than hidden:

- **"Apa itu reimbursement?"** can be declined. The term reads either as a
  general concept or as a request for the company's reimbursement policy, and
  the assignment does not define that boundary — so there is no answer key to
  claim. Adding a question-specific exception would make the router more
  brittle, which this project has already demonstrated once.
- **"wHaT iS sLa"** is declined while "WHAT IS SLA" is answered. Capitalisation
  is stated in the prompt as not being a routing criterion, and it does not hold
  for that alternating form.

`eval/results/` keeps three runs on purpose: the naive starting point, the final
result, and one rejected optimisation — prompt compression reached 694 tokens
but scored 32/34, which is why it was reverted. The engineering decisions behind
these numbers are written up in a separate one-page note, delivered alongside
this repository.

```bash
npm run eval     # the 42-question golden set
npm run repro    # one 8-turn conversation, for cross-turn consistency
npm run smoke    # provider check: tool calling, embeddings, honest usage
```

## Local setup

Requires Node 18+, a [Supabase](https://supabase.com) project, and an OpenAI API
key (or any OpenAI-compatible endpoint — see `.env.example`).

```bash
npm install
cp .env.example .env
```

Fill in three values; the rest ship with working defaults:

```bash
OPENAI_API_KEY=sk-...
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

Paste [`supabase/schema.sql`](supabase/schema.sql) into the Supabase SQL editor
and run it once — it creates the tables, the vector search function, and enables
row-level security with no policies, so nothing is reachable except through the
server.

```bash
npm run smoke    # verify the provider before spending anything
npm run seed     # chunk -> embed -> store
npm run dev
```

Open <http://localhost:3000>.

To deploy, import the repository on Vercel and set the same environment
variables. `NAIVE_MODE` must stay `false`, or visitors get the 2,654-token
baseline instead of the real system.

## Project layout

```
app/           chat UI, /history, /documents, POST /api/chat
components/    shell, document table, local-time formatting
lib/agents/    manager.ts (routing + general answers), specialist.ts (grounded)
lib/           retrieval, usage logging, history, db, llm, env
docs/id/       the four source documents
eval/          golden.jsonl + three saved results
scripts/       seed, eval, repro, smoke
supabase/      schema.sql
```

## License

[MIT](LICENSE) — © 2026 Alvin.

The corpus in `docs/id/` describes a fictional company. Any resemblance to a
real product named Sigap is coincidental.
