-- Remove the "RSS" system smart collection (follow-up to 20261115070000_remove_rss_feature.sql).
--
-- The RSS feature is gone, but the sidebar still listed an "RSS" smart collection because
-- it is a data row seeded per user. This removes the existing rows and stops seeding it
-- for new users. Other system collections are unchanged.
--
-- Apply inside one transaction (BEGIN ... COMMIT) so the SET LOCAL timeouts take effect.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- 1. Seed function without the RSS entry (same signature, attributes and other rows as before).
create or replace function public.seed_system_collections(uid uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.smart_collections (user_id, name, icon, position, is_system, query)
  values
    (uid, 'Inbox',           '📥', 0, true, '{"system":"inbox"}'),
    (uid, 'Reading Queue',   '⏳', 1, true, '{"system":"queue","read_status":["unread","reading"]}'),
    (uid, 'Starred',         '⭐', 2, true, '{"system":"starred","is_starred":true}'),
    (uid, 'Resurface',       '🔁', 3, true, '{"system":"resurface"}'),
    (uid, 'From your phone', '📱', 5, true, '{"system":"mobile","saved_via":["mobile"]}'),
    (uid, 'Social',          '💬', 6, true, '{"system":"social","source_type":["tweet","reel","reddit"]}')
  on conflict do nothing;
$$;
revoke all on function public.seed_system_collections(uuid) from public, anon, authenticated;

-- 2. Existing users: drop the RSS system collection (no-op when none exists).
delete from public.smart_collections where is_system and query ->> 'system' = 'rss';
