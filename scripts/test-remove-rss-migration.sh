#!/bin/bash
# Tests supabase/migrations/*_remove_rss_feature.sql on a throwaway LOCAL Postgres database
# (pg_cron is replaced by a stand-in). Nothing here touches production.
set -euo pipefail
cd "$(dirname "$0")/.."
MIG=$(ls supabase/migrations/*_remove_rss_feature.sql)
DB="qlip_rss_test_$$"; trap 'dropdb --if-exists "$DB" >/dev/null 2>&1 || true' EXIT
createdb "$DB"
P="psql -v ON_ERROR_STOP=1 -q -X $DB"
$P <<'SQL'
create schema cron;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create function cron.unschedule(job_id bigint) returns boolean language sql as 'delete from cron.job where jobid = job_id returning true';
insert into cron.job (jobname, schedule, command) values ('refvault-rss-poller','7,37 * * * *','x'),('refvault-job-worker','* * * * *','y');
create table public.rss_subscriptions (id int primary key);
create table public.folders (id int primary key);
create publication supabase_realtime for table public.rss_subscriptions, public.folders;
SQL
fail=0
check() { local r; r=$(psql -X -At "$DB" -c "$2"); if [ "$r" = "t" ]; then echo "PASS  $1"; else echo "FAIL  $1 (got: $r)"; fail=1; fi; }
$P -f "$MIG"
check "poller cron job removed, worker job untouched" "select (select count(*) from cron.job where jobname='refvault-rss-poller')=0 and (select count(*) from cron.job where jobname='refvault-job-worker')=1"
check "rss_subscriptions no longer in the realtime publication" "select count(*)=0 from pg_publication_tables where pubname='supabase_realtime' and tablename='rss_subscriptions'"
check "other tables stay in the publication" "select count(*)=1 from pg_publication_tables where pubname='supabase_realtime' and tablename='folders'"
check "the table itself is kept" "select to_regclass('public.rss_subscriptions') is not null"
$P -f "$MIG" && echo "PASS  re-running is a no-op"
exit $fail
