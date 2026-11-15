-- Remove RSS from Qlip: server side.
--
-- The RSS poller cron job was already unscheduled in production when ingestion was paused; this
-- makes a fresh database match. The `rss_subscriptions` table is KEPT for now (dropping it is a
-- separate, later cleanup), but it no longer publishes changes over Realtime.
--
-- Apply inside one transaction (BEGIN ... COMMIT) so the SET LOCAL timeouts take effect.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- 1. No RSS poll schedule (no-op when it is already gone).
select cron.unschedule(jobid) from cron.job where jobname = 'refvault-rss-poller';

-- 2. Stop publishing rss_subscriptions over Realtime (no-op when it is not listed).
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rss_subscriptions'
  ) then
    alter publication supabase_realtime drop table public.rss_subscriptions;
  end if;
end;
$$;
