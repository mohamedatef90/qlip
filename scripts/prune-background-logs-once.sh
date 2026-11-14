#!/bin/bash
# One-time cleanup of the pg_cron / pg_net log backlog on the hosted project, in small batches.
#
#   ./scripts/prune-background-logs-once.sh                       dry run: prints counts and sizes only (read-only)
#   ./scripts/prune-background-logs-once.sh --apply               deletes old cron.job_run_details rows in batches
#   ./scripts/prune-background-logs-once.sh --apply --truncate-http-response
#                                                                 also empties net._http_response (transient rows)
#
# Needs the Supabase CLI, SUPABASE_ACCESS_TOKEN in the environment, and PROJECT_REF.
# Every batch runs in its own transaction with SET LOCAL statement_timeout and lock_timeout, and the
# script pauses between batches so a small database is never hit with one large statement.
# Run it off-peak. Never run it before the 20261114220000_reduce_background_io migration is applied.
set -euo pipefail

: "${PROJECT_REF:?Set PROJECT_REF to the hosted project ref}"
: "${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN (never put it in this file)}"
BATCH="${BATCH:-5000}"          # rows per delete
PAUSE="${PAUSE:-5}"             # seconds between batches
MAX_BATCHES="${MAX_BATCHES:-60}" # safety stop (60 x 5000 = 300k rows)
KEEP_DAYS="${KEEP_DAYS:-3}"
APPLY=0; TRUNC=0
for a in "$@"; do
  case "$a" in
    --apply) APPLY=1 ;;
    --truncate-http-response) TRUNC=1 ;;
    *) echo "Unknown option: $a" >&2; exit 2 ;;
  esac
done

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
( cd "$WORK" && supabase init --workdir "$WORK" >/dev/null 2>&1 && supabase link --workdir "$WORK" --project-ref "$PROJECT_REF" >/dev/null 2>&1 )

q_ro() { supabase db query --workdir "$WORK" --remote --read-only "$1" 2>&1 | python3 -I -c "import sys,json;r=sys.stdin.read();d=json.loads(r[r.index('{'):]);print(json.dumps(d.get('rows',d)))"; }
q_rw() { supabase db query --workdir "$WORK" --remote --yes --file "$1" 2>&1; }

echo "== before"
q_ro "select (select count(*) from cron.job_run_details) job_run_details_rows,
             (select count(*) from cron.job_run_details where end_time < now() - interval '$KEEP_DAYS days') deletable_rows,
             pg_size_pretty(pg_total_relation_size('cron.job_run_details')) job_run_details_size,
             (select count(*) from net._http_response) http_response_rows,
             pg_size_pretty(pg_total_relation_size('net._http_response')) http_response_size"
if [ "$APPLY" -ne 1 ]; then echo "Dry run only. Pass --apply to delete."; exit 0; fi

echo "== deleting old cron.job_run_details rows in batches of $BATCH (keeping $KEEP_DAYS days)"
cat > "$WORK/batch.sql" <<SQL
begin;
set local statement_timeout = '15s';
set local lock_timeout = '3s';
with d as (
  delete from cron.job_run_details
  where ctid in (select ctid from cron.job_run_details where end_time < now() - interval '$KEEP_DAYS days' limit $BATCH)
  returning 1
) select count(*) as deleted from d;
commit;
SQL
for i in $(seq 1 "$MAX_BATCHES"); do
  OUT="$(q_rw "$WORK/batch.sql")" || { echo "$OUT" >&2; echo "Stopped: a batch failed." >&2; exit 1; }
  N="$(echo "$OUT" | python3 -I -c "import sys,json,re;r=sys.stdin.read();d=json.loads(r[r.index('{'):]);print(d['rows'][0]['deleted'])" 2>/dev/null || echo ERR)"
  [ "$N" = "ERR" ] && { echo "$OUT" >&2; echo "Stopped: could not read the batch result." >&2; exit 1; }
  echo "batch $i: deleted $N"
  [ "$N" -eq 0 ] && break
  sleep "$PAUSE"
done

if [ "$TRUNC" -eq 1 ]; then
  echo "== truncating net._http_response (transient rows; deleting them would not return the space)"
  cat > "$WORK/trunc.sql" <<'SQL'
begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';
truncate net._http_response;
commit;
SQL
  for t in 1 2 3; do
    if q_rw "$WORK/trunc.sql" >/dev/null 2>"$WORK/err"; then echo "truncated"; break; fi
    echo "attempt $t failed (lock busy?), retrying in 20 s"; sleep 20
    [ "$t" -eq 3 ] && { echo "Gave up on the truncate; nothing was changed by it." >&2; exit 1; }
  done
fi

echo "== after"
q_ro "select (select count(*) from cron.job_run_details) job_run_details_rows,
             pg_size_pretty(pg_total_relation_size('cron.job_run_details')) job_run_details_size,
             (select count(*) from net._http_response) http_response_rows,
             pg_size_pretty(pg_total_relation_size('net._http_response')) http_response_size"
