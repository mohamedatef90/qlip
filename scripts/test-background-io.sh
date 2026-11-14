#!/bin/bash
# Tests supabase/migrations/*_reduce_background_io.sql on a throwaway LOCAL Postgres database.
# pg_cron and pg_net are replaced by small stand-ins; nothing here touches production.
# Usage: ./scripts/test-background-io.sh        (needs psql, createdb and dropdb on PATH)
set -euo pipefail
cd "$(dirname "$0")/.."
MIG=$(ls supabase/migrations/*_reduce_background_io.sql)
DB="qlip_io_test_$$"
cleanup() { dropdb --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT
createdb "$DB"
P="psql -v ON_ERROR_STOP=1 -q -X $DB"

$P <<'SQL'
create extension if not exists pgcrypto;
create schema auth;       create table auth.users (id uuid primary key);
create schema vault;      create table vault.decrypted_secrets (name text, decrypted_secret text);
create schema net;
create table net._http_response (id bigserial primary key, created timestamptz not null default now(), body text);
create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint language sql as 'select 1::bigint';
create schema cron;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true);
create table cron.job_run_details (runid bigserial primary key, jobid bigint, start_time timestamptz, end_time timestamptz, status text);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $f$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid;
$f$;
create function cron.alter_job(job_id bigint, schedule text default null, command text default null, database text default null, username text default null, active boolean default null)
returns void language sql as $f$
  update cron.job set schedule = coalesce(alter_job.schedule, cron.job.schedule), command = coalesce(alter_job.command, cron.job.command) where jobid = job_id;
$f$;
create table public.content_items (id uuid primary key default gen_random_uuid(), user_id uuid, status text, updated_at timestamptz default now());
create table public.jobs (
  id bigint generated always as identity primary key, user_id uuid not null,
  item_id uuid references public.content_items(id) on delete cascade,
  job_type text not null, status text not null default 'queued', attempts int not null default 0,
  run_after timestamptz not null default now(), locked_at timestamptz);
create index jobs_queued_idx on public.jobs (status, run_after) where status = 'queued';
-- the original worker cron job from migration 0004
select cron.schedule('refvault-job-worker', '* * * * *', 'select net.http_post(url := ''x'', headers := ''{}'', body := ''{}'', timeout_milliseconds := 10000);');
-- stand-in for the existing reclaim function
create function public.reclaim_stuck_jobs() returns int language sql as 'select 0';
SQL

# The migration references roles that do not exist locally: strip only the revoke lines.
sed -E 's/ from public, anon, authenticated;/ from public;/' "$MIG" > "/tmp/$DB.sql"
$P -f "/tmp/$DB.sql"
$P -f "/tmp/$DB.sql"   # must be safe to re-run
rm -f "/tmp/$DB.sql"

fail=0
check() { # check <name> <sql returning t/f>
  local r; r=$(psql -X -At "$DB" -c "$2")
  if [ "$r" = "t" ]; then echo "PASS  $1"; else echo "FAIL  $1 (got: $r)"; fail=1; fi
}
sql_ok() { psql -X -At "$DB" -c "$1" >/dev/null; }

echo "--- schedules"
check "worker cron job is guarded by job_worker_has_work()" "select command like '%where public.job_worker_has_work()%' and command like '%net.http_post%' and schedule = '* * * * *' from cron.job where jobname='refvault-job-worker'"
check "reclaim cron job every 10 minutes" "select schedule='*/10 * * * *' and command='select public.reclaim_stuck_jobs();' from cron.job where jobname='refvault-reclaim-stuck-jobs'"
check "prune cron job daily" "select schedule='41 3 * * *' and command='select public.prune_background_logs();' from cron.job where jobname='refvault-prune-background-logs'"
check "re-running the migration did not duplicate jobs" "select count(*)=3 from cron.job"
echo "--- job_worker_has_work()"
check "idle: no jobs -> false" "select not public.job_worker_has_work()"
psql -X -q "$DB" -c "insert into public.jobs (user_id, job_type, status) values (gen_random_uuid(),'parse','queued')"
check "a due queued job -> true" "select public.job_worker_has_work()"
psql -X -q "$DB" -c "update public.jobs set run_after = now() + interval '5 minutes'"
check "a queued job in the future (backoff) -> false" "select not public.job_worker_has_work()"
psql -X -q "$DB" -c "update public.jobs set status='running', run_after=now(), locked_at=now()"
check "only running jobs -> false (an invocation is already working)" "select not public.job_worker_has_work()"
psql -X -q "$DB" -c "update public.jobs set status='done'"
check "only done jobs -> false" "select not public.job_worker_has_work()"
echo "--- prune"
psql -X -q "$DB" <<'SQL'
insert into cron.job_run_details (jobid, start_time, end_time, status) values
 (1, now()-interval '10 days', now()-interval '10 days', 'succeeded'),
 (1, now()-interval '4 days',  now()-interval '4 days',  'succeeded'),
 (1, now()-interval '1 day',   now()-interval '1 day',   'succeeded'),
 (1, now(), null, 'running');
insert into net._http_response (created, body) values (now()-interval '3 days','old'),(now()-interval '2 hours','recent');
select public.prune_background_logs();
SQL
check "job_run_details: rows older than 3 days removed, newer and in-flight kept" "select count(*)=2 from cron.job_run_details"
check "job_run_details: the in-flight row (no end_time) survives" "select count(*)=1 from cron.job_run_details where end_time is null"
check "net._http_response: older than 1 day removed, recent kept" "select count(*)=1 and min(body)='recent' from net._http_response"
psql -X -q "$DB" <<'SQL'
-- batch limit: 25 old rows with a batch size of 10 are removed 10 at a time
insert into cron.job_run_details (jobid, start_time, end_time, status)
  select 1, now()-interval '20 days', now()-interval '20 days', 'succeeded' from generate_series(1,25);
create temp table prune_counts (n int);
insert into prune_counts select public.prune_background_logs(10);
insert into prune_counts select public.prune_background_logs(10);
SQL
check "batch limit: each run removes at most batch_size rows (25 old rows, batch 10 -> 10 then 10, 5 left)" "select (select count(*) from cron.job_run_details where end_time < now() - interval '3 days')=5"
echo "--- indexes"
check "jobs(item_id) index exists" "select count(*)=1 from pg_indexes where indexname='jobs_item_id_idx'"
check "running-jobs partial index exists" "select count(*)=1 from pg_indexes where indexname='jobs_running_locked_idx' and indexdef like '%WHERE (status = ''running''%'"
echo "--- the reclaim probe uses the new index (30k synthetic jobs)"
psql -X -q "$DB" <<'SQL'
insert into public.content_items (user_id, status) select gen_random_uuid(), 'enriching' from generate_series(1,3000);
insert into public.jobs (user_id, item_id, job_type, status) select gen_random_uuid(), c.id, 'enrich', 'failed' from public.content_items c, generate_series(1,10);
analyze public.jobs; analyze public.content_items;
SQL
PLAN=$(psql -X -At "$DB" -c "explain select j.status from public.content_items c cross join lateral (select status from public.jobs where item_id = c.id order by id desc limit 1) j limit 20")
if echo "$PLAN" | grep -q "jobs_item_id_idx"; then echo "PASS  newest-job-per-item probe uses jobs_item_id_idx"; else echo "FAIL  probe does not use jobs_item_id_idx"; echo "$PLAN"; fail=1; fi
exit $fail
