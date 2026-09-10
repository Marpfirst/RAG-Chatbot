-- Sigap Assistant — database schema
-- Run once in the Supabase SQL editor.

create extension if not exists vector;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- corpus

create table if not exists chunks (
  id           text primary key,        -- 'pricing#paket-tumbuh'
  lang         text not null default 'id',
  doc          text not null,           -- 'pricing'
  section      text not null,           -- 'Paket Tumbuh'
  content      text not null,           -- includes the contextual header
  token_count  int  not null,
  embedding    vector(1536) not null
);

create index if not exists chunks_lang_idx on chunks (lang);

-- No ANN index on purpose. At ~38 rows a sequential scan is instant, and
-- ivfflat needs far more rows before its lists carry any meaning.

-- ---------------------------------------------------------------- chat

create table if not exists conversations (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists messages (
  id              bigserial primary key,
  conversation_id uuid not null references conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  created_at      timestamptz not null default now()
);

create index if not exists messages_conversation_idx
  on messages (conversation_id, id desc);

-- ---------------------------------------------------------------- usage

-- One row per AGENT CALL, not per message. A specialist answer produces two
-- rows (the manager turn that delegated + the specialist turn). The UI badge
-- shows their sum, so delegation overhead stays visible instead of hidden.

create table if not exists usage_log (
  id             bigserial primary key,
  message_id     bigint not null references messages(id) on delete cascade,
  agent          text   not null check (agent in ('manager', 'specialist')),
  model          text   not null,
  input_tokens   int    not null default 0,
  output_tokens  int    not null default 0,
  cached_tokens  int    not null default 0,
  embed_tokens   int    not null default 0,
  retrieved_ids  text[],
  top_similarity real,
  routed         boolean not null default false,
  latency_ms     int,
  created_at     timestamptz not null default now()
);

create index if not exists usage_log_message_idx on usage_log (message_id);

-- ---------------------------------------------------------------- retrieval

-- Vector search over the corpus. Called from lib/retrieval.ts.
-- match_threshold is applied here so chunks below the floor never leave the DB.

create or replace function match_chunks (
  query_embedding vector(1536),
  match_lang      text default 'id',
  match_count     int  default 3,
  match_threshold real default 0.0
)
returns table (
  id         text,
  doc        text,
  section    text,
  content    text,
  similarity real
)
language sql stable
as $$
  select
    c.id,
    c.doc,
    c.section,
    c.content,
    (1 - (c.embedding <=> query_embedding))::real as similarity
  from chunks c
  where c.lang = match_lang
    and (1 - (c.embedding <=> query_embedding)) >= match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- ---------------------------------------------------------------- history view

create or replace view question_history as
select
  m.id                                   as message_id,
  m.conversation_id,
  m.created_at,
  m.content                              as answer,
  (select u.agent from usage_log u
    where u.message_id = m.id
    order by u.id desc limit 1)           as answered_by,
  coalesce(sum(u.input_tokens), 0)        as input_tokens,
  coalesce(sum(u.output_tokens), 0)       as output_tokens,
  coalesce(sum(u.cached_tokens), 0)       as cached_tokens,
  coalesce(sum(u.embed_tokens), 0)        as embed_tokens,
  coalesce(sum(u.input_tokens + u.output_tokens + u.embed_tokens), 0) as total_tokens,
  count(u.id)                             as agent_calls
from messages m
left join usage_log u on u.message_id = m.id
where m.role = 'assistant'
group by m.id;

-- ---------------------------------------------------------------- access

-- Every query in this app runs server-side through the service_role key
-- (lib/db.ts). Nothing is queried from the browser, so no table needs to be
-- reachable by the anon or authenticated roles.
--
-- RLS is enabled with NO policies: anon and authenticated can read nothing.
-- service_role bypasses RLS, so the server keeps full access.
--
-- Stated explicitly here rather than left to a dashboard toggle, so the repo
-- describes its own security posture.

alter table chunks        enable row level security;
alter table conversations enable row level security;
alter table messages      enable row level security;
alter table usage_log     enable row level security;

revoke all on chunks, conversations, messages, usage_log from anon, authenticated;
revoke all on function match_chunks from anon, authenticated;

grant all on chunks, conversations, messages, usage_log to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on function match_chunks to service_role;

-- The history view reads the same rows, so it gets the same treatment.
-- security_invoker makes it respect the caller's RLS instead of the definer's.
alter view question_history set (security_invoker = on);
revoke all on question_history from anon, authenticated;
grant select on question_history to service_role;
