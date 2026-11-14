# Qlip

An AI knowledge vault for everything you save (formerly RefVault / BentoLinks AI). This repository holds the Qlip web app (React), the shared Supabase backend (Postgres, Edge Functions, migrations), and the native iOS client (SwiftUI). Web and iOS read and write the same Supabase data, so a link saved on one shows up on the other and goes through the same AI pipeline.

Every saved URL is fetched, parsed, and enriched by AI (title, summary, key points, topic, tags), then made searchable. Plain website links and reading material are separated in the library.

## Features

- **AI enrichment:** each saved item goes through a parse, enrich, and embed pipeline and moves through the statuses `pending`, `parsing`, `enriching`, and `ready`. Clients receive live updates through Supabase Realtime.
- **Two-tier model router:** with the `nvidia` provider, content shorter than 12,000 characters goes to the fast model `openai/gpt-oss-20b` and longer content to `z-ai/glm-5.2` (`supabase/functions/_shared/llm.ts`). The provider falls back to Gemini on failure, and both model names can be overridden through Vault secrets.
- **Source parsers:** articles, YouTube (captions, with a Gemini transcription path), tweets, Reddit, PDFs, Facebook, and Instagram/TikTok reels (via Apify), in `supabase/functions/_shared/parsers/`.
- **Hybrid search:** Postgres full-text search plus pgvector embeddings (`gemini-embedding-001`), merged with reciprocal rank fusion (`semantic-search` function and migration `0006`).
- **RSS feeds:** a feed poller runs every 30 minutes and ingests only entries published in the last 48 hours; feed discovery by URL; a Feeds view.
- **Reader:** distraction-free reading with AI summary and key points, text-to-speech (Gemini voice "Kore"), and translation to Arabic.
- **Resurfacing:** a nightly job picks up to 5 items you finished reading more than two weeks ago ("Today's Picks").
- **MCP server:** AI agents can read and write your vault over MCP (Streamable HTTP) with a personal API key generated in Settings. Tools: `save_link`, `save_note`, `search`, `list_items`, `get_item`, `update_item`, `delete_item`, `list_folders`, `create_folder`, `list_feeds`, `subscribe_feed`, `get_daily_picks`.
- **Organization:** folders, smart collections, three app themes (`default`, `professional`, `funny`), and drag-to-reorder settings lists.
- **Native iOS app:** email/password sign-in, paginated library with an offline cache, Share Extension, Realtime updates, reader, and folder, RSS, and MCP key management. See [`ios/Qlip/README.md`](ios/Qlip/README.md).

## Tech stack

- **Web:** React 19, TypeScript, Vite 6, React Router 6, Tailwind CSS 3, `@supabase/supabase-js`
- **Backend:** Supabase Postgres, Auth, Storage, Realtime, Edge Functions (Deno), `pg_cron` and `pg_net` job queue, pgvector, Vault for secrets
- **AI providers:** NVIDIA API (default routing), Google Gemini (embeddings, text-to-speech, transcription, fallback); `llm.ts` also supports `claude` and `openai` providers. Apify for Instagram/TikTok scraping.
- **iOS:** SwiftUI, SwiftData cache, Supabase Swift package, iOS 17 deployment target
- **Hosting:** Vercel for the web app (`vercel.json` rewrites all routes to `index.html`) and Supabase for the backend

## How the pipeline works

`save-item` inserts a `content_items` row and a job. A `pg_cron` tick calls `job-worker` every minute, which parses the item with the parser for its source type, enriches it with the LLM, and embeds it. Feeds, text-to-speech, resurfacing, and translation are separate Edge Functions and scheduled jobs on the same pattern. The architecture reference is in [`CLAUDE.md`](CLAUDE.md).

## Getting started (web)

Prerequisites: Node.js and npm.

```bash
npm install
npm run dev       # Vite dev server on http://localhost:3000
npm run build     # tsc + production build
npm run preview   # preview the production build
```

### Environment variables

Web client (both optional; `services/supabase.ts` contains fallback values):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

No AI keys live in the client. The Edge Functions read these secrets by name from Supabase Vault: `GEMINI_API_KEY`, `NVIDIA_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `LLM_PROVIDER`, `LLM_MODEL`, `LLM_MODEL_FAST`, `APIFY_TOKEN`, `SCRAPER_API_KEY`, `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, and `WORKER_SECRET`. The functions also use the standard `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.

### Tests and audits

| Command | Purpose |
| --- | --- |
| `npm run test:ai` | AI output contract tests |
| `npm run test:routing` | Link routing and AI category tests |
| `npm run test:ownership` | Ownership checks |
| `npm run test:net` | Network safety helpers |
| `npm run test:edge` | Deno tests for the MCP and RSS functions (requires Deno) |
| `npm run audit:ai` | AI quality audit report (`scripts/ai-audit-report.mjs`) |
| `npm run audit:ai:corpus` | Validate the audit corpus |

## MCP server

In the app, open Settings, go to MCP Access, and generate a personal API key (keys start with `rv_`). Then connect an MCP-capable agent, for example:

```bash
claude mcp add --transport http qlip \
  https://sjskpjgepbvblojohtlr.supabase.co/functions/v1/mcp \
  --header "Authorization: Bearer rv_YOUR_KEY"
```

## iOS app

Open `ios/Qlip/Qlip.xcodeproj`, select a development team for the `Qlip` and `QlipShare` targets, register the App Group, and run the `Qlip` scheme. Setup details are in [`ios/Qlip/README.md`](ios/Qlip/README.md).

## Project structure

```
components/, views/      React UI (library, reader, feeds, settings)
services/                Data layer and Supabase client
supabase/functions/      Edge Functions: save-item, job-worker, semantic-search, rss-poller,
                         discover-feed, tts-generate, translate, mcp
supabase/migrations/     SQL migrations
tests/                   Node and Deno tests, pipeline recovery SQL
ios/Qlip/                SwiftUI app and Share Extension
docs/                    Brand guidelines, UX spec, AI audit, release audit notes
```
