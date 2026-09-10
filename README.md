# Sigap Assistant

Two-agent chat over a small document corpus, built with Next.js and Supabase.

- **manager** — receives every question. Answers general ones itself, delegates
  document-grounded ones.
- **specialist** — answers strictly from retrieved chunks, or says the answer is
  not in the documents.

The user sees one chat column. Each answer carries a badge showing which agent
produced it and how many tokens it cost; the same numbers are stored per
question in Supabase and listed at `/history`.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the flow diagrams and data model, and
[NOTES.md](NOTES.md) for the routing rule, the token before/after numbers, and
what is still wasteful.

## Setup

```bash
cp .env.example .env
# fill in OPENAI_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
```

Run `supabase/schema.sql` once in the Supabase SQL editor, then:

```bash
npm install
npm run seed        # chunk -> embed -> store, prints corpus size
npm run dev
```

## Evaluation

With the dev server running:

```bash
npm run eval -- --label v1
```

Runs `eval/golden.jsonl` (16 questions across five categories) and reports
routing accuracy, recall@k, precision@k, and average tokens per category.
Results are written to `eval/results/<label>.json`.

To reproduce the naive baseline that the "before" numbers come from, set
`NAIVE_MODE=true` and run the same command with a different label.

## Layout

| Path | What it is |
|---|---|
| `app/api/chat/route.ts` | orchestrator — guards, manager, retrieval, specialist |
| `lib/agents/` | the two system prompts and the tool definition |
| `lib/retrieval.ts` | embed query, top-k vector search, similarity floor |
| `docs/id/` | the corpus (Indonesian) |
| `docs/_gaps.md` | topics deliberately absent, plus the planted distractors |
| `eval/golden.jsonl` | the test set |
| `scripts/seed.ts` | structure-aware chunking and embedding |
| `scripts/eval.ts` | the measurement harness |
