<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Qlip

An **AI knowledge vault** for everything you save. Qlip is the React web app; it shares one Supabase backend with the **Qlip** iOS app, so a link saved on your phone and a link saved on the web land in the same place and go through the same AI pipeline.

Every URL you save is fetched, read, and enriched by AI — a clean title, a summary, key points, a topic, and tags — then made searchable. Plain website links live in the **Vault Hub**; articles, videos, social posts, and PDFs live in the **Library**.

## Features

- **AI enrichment on everything** — every saved link gets a title, summary, key points, topic, and tags. Even bare bookmarks and blocked social links get a useful AI description.
- **Two-tier AI router** — short items go to a fast model (`openai/gpt-oss-20b`), long-form articles/PDFs/transcripts to a frontier reasoner (`z-ai/glm-5.2`), both on NVIDIA's API, with an automatic **Gemini fallback** so nothing ever stalls.
- **Social & media parsers** — YouTube (captions or AI transcription), X/Twitter, Reddit, PDF, and **Instagram / TikTok / Facebook** via Apify (downloads the clip and transcribes the audio; resolves Facebook `share/…` links).
- **Hybrid semantic search** — Postgres full-text + pgvector embeddings, merged with RRF.
- **Reader** — distraction-free reading with a hero image, AI summary, key points, **text-to-speech**, and a one-tap **Translate to Arabic** (RTL).
- **Resurfacing** — a nightly "Today's Picks" of things you read a while ago.
- **MCP server** — connect AI agents (Claude, Codex, …) to read and write your vault: create categories, save links & notes, search, and organize. See [MCP server](#mcp-server) below.
- **Three themes**, drag-to-reorder home sections, folder categories, and a mobile-friendly layout.

## Tech stack

- **Frontend:** React 19, TypeScript 5.7, Vite 6 (SPA), Tailwind CSS
- **Backend:** Supabase — Postgres 17, Auth, Edge Functions (Deno), pg_cron + pg_net job queue, pgvector
- **AI:** NVIDIA (`gpt-oss-20b` / `glm-5.2`) for enrichment/translation; Google Gemini for embeddings, TTS, and multimodal transcription; Apify for social scraping
- **Deployment:** Vercel (static) + Supabase Edge Functions

## Run locally

**Prerequisites:** Node.js 18+

```bash
npm install
npm run dev        # Vite dev server on http://localhost:3000
```

`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are optional (fallbacks are hardcoded in `services/supabase.ts`). **No AI keys live in the client** — all model keys are stored in Supabase Vault and used only by Edge Functions.

```bash
npm run build      # TypeScript compile + production build
npm run preview    # preview the production build
```

## How the pipeline works

`save-item` inserts a `content_items` row + a job → pg_cron invokes the `job-worker` every minute → it parses (per-source-type parser) → enriches (AI) → embeds → the item flips `pending → parsing → enriching → ready`. Clients get live updates via Supabase Realtime. TTS, resurfacing, and translation are separate Edge Functions on the same pattern.

## MCP server

AI agents can read and write your vault over MCP (Streamable HTTP). In the app, go to **Settings → MCP Access**, generate a personal API key, then connect any MCP-capable agent:

```bash
claude mcp add --transport http qlip \
  https://sjskpjgepbvblojohtlr.supabase.co/functions/v1/mcp \
  --header "Authorization: Bearer rv_YOUR_KEY"
```

Tools: `save_link`, `save_note`, `search`, `list_items`, `get_item`, `update_item`, `delete_item`, `list_folders`, `create_folder`, `get_daily_picks`. Every key is scoped to your account.

## Project layout

```
components/            React UI (cards, modals, views)
views/                 LibraryView, ReaderView
services/              api.ts (data layer), supabase.ts
supabase/functions/    Edge Functions (save-item, job-worker, semantic-search,
                       tts-generate, translate, mcp)
supabase/migrations/   SQL migrations
```

See [CLAUDE.md](CLAUDE.md) for the full architecture reference.
