# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Start Vite dev server on port 3000
npm run build        # TypeScript compilation + Vite production build
npm run preview      # Preview production build locally
```

**Environment:** Optional `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (fallbacks are hardcoded in `services/supabase.ts`). No AI keys live in the client — the Gemini key is stored in Supabase Vault and used only by Edge Functions.

## Architecture Overview

Qlip is evolving into **Qlip**, an AI knowledge vault (see `~/.claude/plans/` Qlip plan / docs). Web MVP phases are complete: Phase 1 (async parse + AI-enrich pipeline), Phase 2 (router/library/reader UI + FTS), Phase 4 (video/tweet/PDF parsers, embeddings + hybrid semantic search), Phase 5 (TTS, resurfacing). Phase 3 (Qlip mobile client) is the remaining MVP work.

### Tech Stack
- **Frontend:** React 19, TypeScript 5.7, Vite 6 SPA (stays a SPA — no Next.js)
- **Styling:** Tailwind CSS (CDN), Font Awesome icons
- **Backend:** Supabase — Postgres 17 (project `sjskpjgepbvblojohtlr`, "Qlip-Vault"), Auth, Edge Functions, pg_cron + pg_net job queue, pgvector (Phase 4)
- **AI:** Pluggable enrichment provider (`_shared/llm.ts`, Vault `LLM_PROVIDER` = `gemini` | `claude` | `openai` | `nvidia`, default `gemini`; **production runs `nvidia`**). The nvidia provider is a **two-tier router** (`routeNvidiaModel`): content `< ROUTER_DEEP_CHARS` (2000) → **fast** model `openai/gpt-oss-20b` (thin bookmarks/social posts/short pages — answers in seconds, no queue); content `≥ 2000` → **deep** model `z-ai/glm-5.2` (long-form articles/PDFs/transcripts — the shared endpoint queues 1.5-3min, so it's reserved for content that needs a frontier reasoner). Both overridable via Vault `LLM_MODEL` (deep) / `LLM_MODEL_FAST` (fast); both default in code, so no Vault change needed. Both verified live via `GET /v1/models` + a test call (the research agent's IDs were wrong — `nemotron-nano-3-30b-a3b` 404s on inference; `nemotron-3-nano-30b-a3b` leaks chain-of-thought into `content`; **always verify a model with a real call before wiring it**). Shared NVIDIA plumbing: OpenAI-compatible chat completions, json_schema→json_object retry, markdown-fence stripping, 140s timeout, **auto-falls back to Gemini on any failure/timeout** so items never stall. Every enrichment stamps `raw_metadata.enriched_by` (`nvidia:openai/gpt-oss-20b` / `nvidia:z-ai/glm-5.2` / `gemini:fallback`) for SQL-verifiable provenance + tier accounting. Other providers: Gemini `gemini-2.5-flash`, Claude `claude-haiku-4-5` (tool-use JSON), OpenAI `gpt-4o-mini` (json_schema) — each needs its key in Vault (`NVIDIA_API_KEY`/`GEMINI_API_KEY`/`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`). Embeddings (`gemini-embedding-001`), TTS, and the YouTube/PDF/reel multimodal fallbacks stay Gemini-only regardless of provider. All server-side, keys read via `public.get_secret` RPC.
- **Deployment:** Vercel (static) + Supabase Edge Functions
- **Mobile (Phase 3):** the Linkat Flutter app (github.com/mohamedatef90/linkat) becomes the mobile client

### Async Pipeline (replaces any worker/queue infra)
`save-item` Edge Function inserts a `content_items` row (`status='pending'`) + a `jobs` row → pg_cron (`refvault-job-worker`, every minute) invokes `job-worker` via `net.http_post` (Bearer = anon key from Vault + `x-worker-secret` header) → worker claims ≤5 jobs via `claim_jobs()` (`FOR UPDATE SKIP LOCKED`), runs parse (per-source-type parser) → enqueues enrich → enqueues embed → item flips `pending → parsing → enriching → ready`. Clients get live updates via Supabase Realtime on `content_items`.

**Every item is enriched** (job-worker v11): thin/metadata-only items (plain bookmarks, blocked social links) skip nothing — enrich receives description/scraps and the LLM prompt's "thin content" branch describes the destination from URL+title, so every card gets an AI summary; the AI `suggested_title` replaces missing/URL-looking titles (real parsed titles are kept). Parse failures no longer kill an item: specialized parser → OG article parse → metadata stub (`raw_metadata.parse_error`), then enrichment still runs. Cards with `degraded`/`failed` status show a visible **Retry AI** button (plus the hover re-fetch icon on every card).

### Social parsers & translation
Instagram (`/reel|reels|p|tv/`) and TikTok route to `source_type='reel'` → `parsers/reel.ts` (Apify `apify~instagram-scraper` / `clockworks~tiktok-scraper`, `APIFY_TOKEN` in Vault; downloads the clip and Gemini-transcribes the audio, merged with the caption). Facebook has no source_type — `job-worker` dispatches by URL via `isFacebookContentUrl` (share/r|p|v, reel, watch, posts, videos, permalink, story, fb.watch — NOT tool pages) → `parsers/facebook.ts` (Apify `apify~facebook-posts-scraper`, resolves share wrappers, returns caption+author+thumbnail; FB exposes no downloadable video/transcript so caption is the content). All social parsers set `thumbnail_url`, which `ItemCard`/`LinkCard` render as the card image (falling back to favicon).

`translate` Edge Function (user JWT): POST `{item_id, target_lang='ar'}` → translates title/summary/key_points/body via the NVIDIA fast model (gpt-oss-20b) with Gemini fallback, **caches in `raw_metadata.translations.<lang>`**. ReaderView has a "ترجم للعربية · Translate to Arabic" toggle that renders an RTL translation card.

### MCP server (agent read/write)
`mcp` Edge Function (deployed **verify_jwt OFF** — custom auth) lets AI agents (Claude, Codex, etc.) read/write the vault over **MCP Streamable HTTP, stateless** (hand-rolled JSON-RPC: initialize / tools/list / tools/call, single JSON response per POST, no SSE). Auth = personal API key `rv_` + 24 random-bytes hex, stored **sha-256-hashed** in `api_keys` (migration 0013; key_hash revoked from `authenticated` select; minted only via `create_api_key()` RPC which returns the plaintext once). `_shared/apiKeys.ts` `resolveApiKey` hashes the incoming Bearer token → user_id; **every tool query is `.eq('user_id', userId)`** (service client), so an agent only ever touches its owner's rows. **10 tools**: save_link (batch), save_note (`note://` uuid, source_type='other', `raw_metadata.kind='note'`), search (FTS on `search_tsv`), list_items, get_item, update_item, delete_item (needs `confirm:true`), list_folders, create_folder, get_daily_picks. Items save with `saved_via='mcp'` (constraint updated in 0013). Settings → "MCP Access" card mints/lists/revokes keys (`api.apiKeys`, one-time plaintext reveal + `claude mcp add` snippet). Endpoint: `https://sjskpjgepbvblojohtlr.supabase.co/functions/v1/mcp`.

### TTS (Phase 5)
`tts-generate` (user JWT) POST `{item_id, mode: "summary"|"full"}`: if `content_items.tts_<mode>_path` is set it just re-signs a 24h URL (cached, no Gemini call); otherwise it synthesizes with `gemini-2.5-flash-preview-tts` (voice Kore), chunking at sentence boundaries (~2k chars ≈ 500 tokens), concatenates the PCM into one WAV, uploads to the **private `tts-audio` bucket** at `{user_id}/{item_id}/{mode}.wav`, saves the path and returns a signed URL. Summary mode has a hard 30s budget; full mode caps input at 10k chars. Every served URL bumps `tts_last_accessed_at`. Weekly pg_cron `refvault-tts-cleanup` (Sun 03:23) calls `tts-generate` with the worker secret + `{action:"cleanup"}`, which deletes audio untouched >30 days via the Storage API (SQL deletes on `storage.objects` would orphan the real files) and nulls the path columns. Web player: `components/TtsPlayer.tsx` in ReaderView (play/pause/seek/speed, position persisted in localStorage).

### Resurface (Phase 5)
Pure-SQL mechanism: nightly pg_cron `refvault-daily-picks` (02:23) runs `public.refresh_daily_picks()`, which repopulates the `daily_picks` table with ≤5 random items per user where `read_status='read'` and `created_at` older than 14 days. The web app's `api.items.fetchByFilter` detects the Resurface system collection (`{"system":"resurface"}`) and inner-joins `daily_picks`. `daily_picks` RLS is select-own only; writes happen only from the cron.

### Key Directories
- `components/` - React UI components (modals, cards, views)
- `services/`
  - `supabase.ts` - Supabase client only (no data logic)
  - `api.ts` - Data layer: content_items/folders CRUD, save-item invocation, Realtime subscription, `toLink()` adapter
  - `bookmarkService.ts` - HTML bookmark import parsing
- `supabase/migrations/` - SQL migrations (applied via Supabase MCP / CLI)
- `views/` - routed views: `LibraryView`, `ReaderView` (with TtsPlayer)
- `supabase/functions/` - Edge Functions (Deno)
  - `save-item/` - validate/canonicalize URL, dedupe, insert + enqueue (supports `{urls: []}` batch)
  - `job-worker/` - cron-invoked job processor (parse → enrich → embed; per-source-type parser dispatch)
  - `semantic-search/` - hybrid FTS + pgvector search with RRF merge (user JWT)
  - `tts-generate/` - on-demand Gemini TTS + cache + weekly cleanup mode
  - `_shared/` - db/gemini/canonical/queue/cors modules + `parsers/{article,youtube,tweet,pdf,reel,types}.ts`

### Database Schema (Qlip)
- `content_items` — superset of old `links`: canonical_url (unique per user = dedupe), source_type, status, `saved_via` (web/mobile/extension/import/mcp — client origin, set by save-item (`rss` remains an allowed historical value in the constraint); powers the "From your phone" home section + system collection, migration 0009), `item_kind` (generated column, migration 0012 (v2) — `'content'` for rich source types (youtube/reel/tweet/reddit/pdf/podcast/rss) or a real extracted body (word_count≥120 / content_text≥200); **an AI summary alone does NOT make an item content** since v2, because every bookmark now gets one; drives the Vault Hub vs Library split), content_text, summary, key_points, tags[], topic, read_status, is_starred/pinned, embedding vector(768), generated `search_tsv`
- `folders` (tree, max depth 3), `item_folders` (many-to-many), `smart_collections` (query jsonb; system rows seeded per user), `rss_subscriptions` (kept but unused since RSS was removed), `daily_picks` (nightly Resurface set), `jobs` (queue; service-role only, no RLS policies by design)
- Legacy `links`/`categories` tables still exist read-only; drop at Phase 2 cutover. Backup in `backups/`.

### Key Patterns
- All RLS: `user_id = auth.uid()`; `jobs` and Vault access are service-role only
- Secrets in Supabase Vault, read by Edge Functions via locked-down `public.get_secret(name)` RPC
- Gemini structured output (`responseMimeType: application/json` + responseSchema) with 429/5xx backoff retry
- Edge Function deploys were done via Supabase MCP `deploy_edge_function` with the full file bundle including `_shared/*` (files under `supabase/functions/` are the source of truth — redeploy after editing)
- Cron-invoked functions (`job-worker`, `tts-generate` cleanup) are gated by the `x-worker-secret` header checked against Vault; the cron SQL reads ANON_KEY/WORKER_SECRET from Vault at fire time (pattern in `0004_cron_worker_tick.sql`)
- Source-type parsers: youtube (oEmbed + caption endpoints, Gemini URL-ingestion fallback; stores `video_url`/`embed_url` in raw_metadata), tweet (fxtwitter), reddit (app-only OAuth via `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET` in Vault → oauth.reddit.com; falls back to public `.json` which 403s from cloud IPs), pdf (unpdf + Gemini Files fallback), reel (opt-in paid scrapers via APIFY_TOKEN/SCRAPER_API_KEY in Vault; captures `video_url` + transcribes spoken audio via Gemini Files (`transcribeVideoBytes`, 20MB cap) merged with the caption; else `status='degraded'`)

### Theming & Home UX
Three themes via CSS variables: `default` (dark), `professional` (light), `funny` (playful). Theme preference persisted in localStorage.

The `default` theme uses the **magic_black** design language: navy canvas (`--ink #0A1320`), glass panels (`--panel` + backdrop-blur), green→lime gradient accent (`--grad`, `--lime #A8CF38` drives the legacy `neon-accent` classes). Motion helpers in `components/magic.tsx` (Reveal, CountUp, card spotlight, CursorGlow) — all `prefers-reduced-motion`-guarded; tokens/CSS live in `index.html`.

**Bookmark vs content split (`item_kind`):** the two kinds of saved link route to two surfaces — **Vault Hub** (home) is for `item_kind='bookmark'` (plain website links, e.g. the ~979 migrated Qlip links), and the **Library** is for `item_kind='content'` (articles, videos, social posts, PDFs). The client filters on `link.kind` (mapped from `item_kind` in `toLink`); `fetchByFilter` accepts a `kind` filter. Library has a **Reading / Bookmarks / Mobile** tab in its own `?kind=` URL param (absent = content/Reading, the default; `kind=bookmark`; `kind=mobile` is a `saved_via=['mobile']` view, not a kind). Card treatment (`ItemCard` + home `LinkCard`) diverges by kind: **content** cards carry a lime book badge (top-right, cross-fades to hover controls), a Read / Continue reading / Read again primary button, and open the in-app reader (`/item/:id`) on card click; **bookmark** cards carry a neutral bookmark badge, a "Visit site" button, and open the source URL directly (`window.open`, never the reader) — and show "bookmark" instead of the raw `source_type`. **Exception: links saved from Linkat (`saved_via='mobile'`) always open the in-app reader**, even bookmark-kind ones, so phone saves get "read mode". Cards show `thumbnail_url` as the tile image when present (social posts/reels/FB), else the favicon.

Home ("Vault Hub") is a **daily briefing**, not an archive: capped sections — Continue reading (content, read_status='reading', ≤6), Today's Picks (daily_picks, ≤5), Fresh in your Library (latest content, ≤6, → /library), From your phone (`saved_via='mobile'`, both kinds, ≤8, cards open the reader, "View all" → /library?kind=mobile), Recently bookmarked (≤12, **excludes mobile saves**, "View all" → /library?kind=bookmark) — each linking into the Library; the hero stats read Bookmarks / Library / Unread; the hero's right panel shows the live processing queue; the nav search switches home to a results grid. The home grid is bookmarks only (`kind='bookmark'`); content sections bridge into the Library. Skeleton shimmer while loading. Card titles open the reader (/item/:id); "Visit site" opens the source.

Card affordances: hover **float preview** (`components/HoverPreview.tsx` — full title + AI summary in a fixed-position portal panel, because `.bento-card` is `overflow:hidden`; attaches to the parent card's mouseenter, pointer-events:none, 350ms delay); entry date on every card (LinkCard header subline, ItemCard footer; published_at preferred, created_at fallback); a sky **mobile badge** next to the kind badge when `saved_via='mobile'` (Linkat); a hover **re-fetch button** on all cards that re-runs the parse pipeline (`api.items.retry` → save-item `{retry_item_id}` mode, deployed v3 — resets status to pending + enqueues parse; realtime streams progress); bookmark cards (LinkCard + ItemCard grid/list) carry a **move-to-folder dropdown** (folders act as categories, `api.items.setFolder`). Home personalization (localStorage): Priority Vault pins reorder via **drag & drop** (`pinned-order`), briefing sections reorder via hover **chevrons** (`home-section-order`, keys phone/continue/picks/fresh/bookmarked). Library FilterBar: source type + read status (+ Starred) are **multi-select dropdowns** (`MultiDropdown` in FilterBar.tsx); topic/sort native selects; tag chips unchanged.

Responsive/a11y: mobile (<lg) gets a fixed bottom nav (Vault/Library/Settings) and the Library sidebar collapses to a chip scroller; hover-revealed card actions become visible on touch devices via the `.hover-reveal` class (`@media (hover:none)` in index.html); Library filter state lives in URL query params (`views/LibraryView.tsx` filterFromParams/paramsFromFilter). Library has three view modes persisted in localStorage (`library-view`): grid, list, and **reader** — a Readwise-style split pane (`components/ReaderSplit.tsx`, j/k navigation, metadata rail, AI summary block). System collections show explanatory empty states.
