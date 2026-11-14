-- Reduce idle background IO on the small (free-plan) database.
--
-- Measured on 2026-11-14: `cron.job_run_details` held 186k rows (162 MB, never pruned),
-- `net._http_response` was 147 MB for ~370 live rows (almost all dead space), and the
-- worker cron fired every minute even with nothing queued, each tick booting an Edge
-- Function that read several Vault secrets and ran `reclaim_stuck_jobs()`.
--
-- This migration:
--   1. adds two small indexes for the queries that run on a timer;
--   2. only invokes `job-worker` when a job is actually due (a cheap indexed check);
--   3. runs `reclaim_stuck_jobs()` from its own cron job every 10 minutes
--      (the worker no longer calls it on every tick);
--   4. prunes the cron and pg_net log tables daily, in bounded batches.
--
-- Apply this migration BEFORE deploying the matching `job-worker` change.
-- Rollback SQL is in the pull request description.

-- Fail fast instead of queueing behind a lock or running long on a small database.
-- SET LOCAL only takes effect inside a transaction, so apply this file in one (BEGIN ... COMMIT).
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- 1. Indexes ---------------------------------------------------------------------
-- reclaim_stuck_jobs() looks up the newest job per stuck item (`where item_id = ?
-- order by id desc limit 1`); today that walks jobs_pkey and filters on item_id
-- (EXPLAIN cost ~1100 per probe). It also scans running jobs by lock time.
create index if not exists jobs_item_id_idx on public.jobs (item_id, id);
create index if not exists jobs_running_locked_idx on public.jobs (locked_at) where status = 'running';

-- 2. Conditional worker tick ------------------------------------------------------
-- True when at least one job is queued and due (same predicate as claim_jobs()).
create or replace function public.job_worker_has_work()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.jobs where status = 'queued' and run_after <= now()
  );
$$;
revoke all on function public.job_worker_has_work() from public, anon, authenticated;

-- Same request as migration 0004, but sent only when there is work. Secrets are still
-- read from Vault at fire time.
select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'refvault-job-worker'),
  command := $cmd$
  select net.http_post(
    url := 'https://sjskpjgepbvblojohtlr.supabase.co/functions/v1/job-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'ANON_KEY'),
      'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'WORKER_SECRET')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  )
  where public.job_worker_has_work();
  $cmd$
);

-- 3. Reclaim on its own, slower schedule -----------------------------------------
select cron.schedule(
  'refvault-reclaim-stuck-jobs',
  '*/10 * * * *',
  'select public.reclaim_stuck_jobs();'
);

-- 4. Daily prune of the log tables (bounded) --------------------------------------
-- Deletes at most `batch_size` rows per table per run, so it can never turn into one huge
-- statement on a small database. Steady-state volume is a few hundred rows a day; the
-- existing backlog is cleared once, in small batches, by scripts/prune-background-logs-once.sh.
create or replace function public.prune_background_logs(batch_size int default 10000)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_cron int;
  n_net int;
begin
  with d as (
    delete from cron.job_run_details
    where ctid in (
      select ctid from cron.job_run_details where end_time < now() - interval '3 days' limit batch_size
    )
    returning 1
  ) select count(*) into n_cron from d;

  with d as (
    delete from net._http_response
    where ctid in (
      select ctid from net._http_response where created < now() - interval '1 day' limit batch_size
    )
    returning 1
  ) select count(*) into n_net from d;

  return n_cron + n_net;
end;
$$;
revoke all on function public.prune_background_logs(int) from public, anon, authenticated;

select cron.schedule(
  'refvault-prune-background-logs',
  '41 3 * * *',
  'select public.prune_background_logs();'
);
