-- 002 — Rate limiting by client address.
--
-- Numbering starts at 002 because supabase/schema.sql is 001: it holds the
-- initial state, and a fresh install runs it alone. Existing databases run the
-- migrations after it, in order.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- The previous guard counted messages within one conversation, which a client
-- bypassed simply by never sending a conversationId: each request then started
-- a fresh conversation whose count was zero. Counting requests per address
-- closes that, because the address is not the caller's to choose.

create table if not exists request_log (
  id         bigserial primary key,
  ip         text not null,
  created_at timestamptz not null default now()
);

-- The only query is "how many from this ip since <timestamp>", so the index
-- matches it exactly.
create index if not exists request_log_ip_time_idx
  on request_log (ip, created_at desc);

-- Rows older than the window are dead weight. Deleted opportunistically from
-- the app rather than on a schedule, which Supabase's free tier does not offer.
create index if not exists request_log_time_idx
  on request_log (created_at);

alter table request_log enable row level security;
revoke all on request_log from anon, authenticated;
grant all on request_log to service_role;
grant usage, select on sequence request_log_id_seq to service_role;
