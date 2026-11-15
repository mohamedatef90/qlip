# Qlip Product, UX & App Structure

Qlip is a personal knowledge vault for saving links from anywhere, turning them
into readable knowledge, and finding them again later.

Core promise:

> Save now. Understand later. Find it when it matters.

This document describes the current app structure and the UX rules that should
guide future work.

## 1. Product model

Qlip has two kinds of saved items:

| Kind | Purpose | Primary action |
|---|---|---|
| Bookmark | A link saved for reference | Open the original link |
| Content | An article, video, post, PDF, podcast, or other readable item | Read the AI summary, key points, or translated content |

Every saved item may also have:

- source platform: Facebook, Instagram, X, YouTube, LinkedIn, or Website;
- content type: article, video, reel, short, post, image, podcast, and others;
- AI title, summary, topic, and tags;
- optional folder;
- read/unread, starred, and pinned states;
- processing state and sync state.

The app is cloud-backed but offline-friendly. Isar is the local cache. Supabase
is the source of truth, and server-side processing generates the enriched
metadata.

## 2. Information architecture

```text
Qlip
├── Vault
│   ├── Search vault
│   ├── Bookmarks count
│   ├── Library/content count
│   ├── Unread count
│   ├── Priority vault (pinned)
│   ├── From your phone
│   ├── Recently bookmarked
│   ├── Continue reading
│   ├── Today's picks
│   └── Fresh in your library
├── Library
│   ├── Mobile
│   ├── Bookmarks
│   ├── Reading
│   ├── Filters
│   ├── Folders
│   ├── Tags
│   └── Manage folders
├── Settings
│   ├── Account
│   ├── Cloud sync status
│   ├── Sync all links
│   ├── Manage folders
│   └── Sign out
├── Add Link
├── Item Detail
└── Reader
```

Persistent navigation is the three-tab bottom bar:

1. Vault — the home dashboard and rediscovery surface.
2. Library — the complete collection and filtering surface.
3. Settings — account, sync, folders, and sign-out.

The `+` action is available on Vault and Library. Add Link, Item Detail, and
Reader open as focused full-screen experiences.

## 3. Primary user journeys

### First-time setup

1. User opens Qlip.
2. User signs in or creates an account with email and password.
3. User lands in Vault.
4. Empty state explains the value: save a link with `+` or use the system share
   sheet.
5. User saves the first link.
6. Qlip confirms the save immediately and explains that enrichment continues in
   the background.

Recommended first-run improvement: show a short three-step onboarding card:
`Save from any app → Qlip organizes it → Read it later`.

### Save from inside Qlip

1. Tap `+`.
2. Paste or type a valid URL.
3. Wait for the optional local preview.
4. Optionally choose a folder.
5. Tap `Save Link`.
6. Return to the previous surface.
7. Show the new item with a processing status.

The user should not need to wait for AI enrichment before continuing.

### Save from another app

1. Open Safari, a social app, or another source.
2. Tap Share.
3. Select Qlip.
4. Qlip extracts the URL and saves it automatically.
5. A confirmation says `Link saved — processing in the background`.
6. If the device is offline, the item is queued and sent when connectivity
   returns.

### Rediscover something

Recommended decision path:

```text
Remember the item?
├── Recent or important → Vault sections
├── Exact words/topic → Search vault
├── Saved from phone → Library > Mobile
├── Plain link → Library > Bookmarks
├── Readable media → Library > Reading
└── Organized manually → Library > Folder
```

### Read and act on an item

1. Tap an item card.
2. Review title, source, processing state, summary, key points, tags, and
   details.
3. For content, tap `Reader`.
4. In Reader, scan the summary and key points.
5. Optionally translate to Arabic.
6. Open the original link when deeper context is needed.
7. Mark read, star, pin, share, or delete from Item Detail.

## 4. Screen specifications

### Vault

Purpose: help the user decide what to save, read, or revisit next.

Structure:

- greeting and current date;
- global search field with `Search your vault…`;
- three quick metrics: Bookmarks, Library, Unread;
- pinned items under `Priority vault`;
- personalized sections such as `From your phone`, `Recently bookmarked`,
  `Continue reading`, `Today's picks`, and `Fresh in your library`;
- each section may have `View all`.

UX rules:

- keep the dashboard useful even when the collection is small;
- make every metric tappable;
- show the newest actionable content above passive statistics;
- keep the empty state focused on one action: save the first link;
- search results should preserve the same item card used everywhere else.

### Library

Purpose: provide complete collection control.

Top-level modes:

- `Mobile`: links saved from this phone, grouped by platform;
- `Bookmarks`: plain website/reference links;
- `Reading`: articles, videos, posts, PDFs, and other content items.

Controls:

- filter sheet;
- folder chips;
- tag chips;
- folder management;
- pull to refresh.

UX rules:

- keep the active mode visible at all times;
- show active filter count;
- allow filters to be cleared in one action;
- preserve the selected mode when the user opens an item and returns;
- explain empty states differently for Mobile, Bookmarks, and Reading.

### Link card

Use one consistent card component across Vault, Library, and folders.

Card anatomy:

1. thumbnail or favicon;
2. source/kind badge;
3. processing or sync status;
4. title;
5. short AI summary when available;
6. content-type badge for readable content;
7. footer actions: read state, star, pin, and primary action.

Card behavior:

- tap the card to open Item Detail;
- use explicit icon buttons for star and pin;
- use a visible status chip for processing and failures;
- never hide a failed item; show a retry action;
- use optimistic updates for read, star, and pin, with a sync notice if offline.

### Add Link

Purpose: make saving fast and low-friction.

Required:

- URL field;
- validation and useful error message;
- Save Link action.

Optional:

- local metadata preview;
- folder selection.

After save:

- return quickly;
- show success confirmation;
- explain that title, summary, tags, and topic are generated automatically;
- show the new item as pending/parsing/enriching until ready.

Recommended copy:

- invalid URL: `Enter a complete link starting with https://`;
- offline save: `Saved on this device. It will sync when you’re online.`;
- duplicate: `This link is already in your vault.`

### Item Detail

Purpose: provide control and confidence before opening the source.

Content order:

1. source and content type;
2. title;
3. status;
4. thumbnail and original URL;
5. AI Summary;
6. Key Points;
7. Description;
8. Tags;
9. Details: topic, date, read status;
10. actions: Reader, Open Link, share, mark read, retry AI, delete.

Primary action should depend on item kind:

- content: `Reader`;
- bookmark: `Open Link`.

Destructive actions must use a confirmation dialog and clearly state that the
item is removed from all synced devices.

### Reader

Purpose: let the user understand saved content without immediately leaving the
app.

Structure:

- title and source;
- open original action;
- summary;
- key points;
- tags;
- extracted content when available;
- `Translate to Arabic` action;
- RTL Arabic result.

Reader should be calm and readable: larger text, generous line height, strong
contrast, and fewer controls than Item Detail.

### Settings

Purpose: reassure the user that the account and data are safe and synchronized.

Sections:

- Account: signed-in email and cloud sync state;
- Vault: sync all links and manage folders;
- Account action: sign out.

Recommended additions:

- last successful sync time;
- offline/queued operation count;
- retry failed sync;
- privacy and data export;
- share extension setup help.

## 5. State and feedback model

### Enrichment states

| State | Meaning | User-facing treatment |
|---|---|---|
| Pending | Saved, waiting to be processed | Spinner + `Processing` |
| Parsing | Source is being fetched/read | Spinner + `Reading source` |
| Enriching | AI metadata is being generated | Spinner + `Organizing` |
| Ready | Full result available | Normal card |
| Degraded | Partial result available | Warning badge + usable content |
| Failed | Processing failed | Error badge + `Retry AI` |

### Sync states

| State | Meaning | User-facing treatment |
|---|---|---|
| Synced | Local and cloud agree | Quiet status in Settings |
| Waiting to sync | Local change is queued | Small queue badge or toast |
| Syncing | Push/pull is active | Progress indicator where relevant |
| Offline | No network | Non-blocking banner; allow local work |
| Sync failed | Operation needs another attempt | Retry action and clear explanation |

Feedback principles:

- immediate confirmation for user actions;
- no silent data loss;
- do not present background AI work as a blocking loader;
- distinguish processing failure from network failure;
- preserve the item locally while a retry is possible.

## 6. UX design system

Visual direction: dark, focused, editorial, and slightly magical.

Current visual language:

- dark `magic_black` background;
- glass-like panels and soft borders;
- lime accent for selected and positive actions;
- compact eyebrow labels for sections;
- rounded cards and chips;
- subtle reveal and count-up motion.

Interaction rules:

- minimum touch target: 44 × 44 points;
- use one strong primary action per screen;
- use lime only for action, selection, or success—not for decorative body text;
- maintain readable contrast for fog/secondary text;
- keep destructive actions red and separated from normal actions;
- support system font scaling without clipped cards;
- provide text labels with icon-only controls via tooltips/accessibility labels.

Recommended component vocabulary:

- `GlassCard` — grouped content surface;
- `LinkCard` — universal saved-item representation;
- `StatusChip` — processing/sync state;
- `FilterPill` — mode, folder, and filter selection;
- `GradientButton` — primary save/confirm action;
- `EmptyState` — icon, explanation, and one next action;
- `SectionHeader` — eyebrow, title, optional View all;
- `SyncBanner` — offline or queued work explanation.

## 7. Error, empty, and loading states

Every data surface should define all four states:

1. Loading — show structure or a centered progress indicator.
2. Empty — explain why it is empty and provide a next action.
3. Error — explain what failed and provide Retry.
4. Offline — show cached data and explain what will happen later.

Examples:

- Vault empty: `Save your first link to get started` + `Save a link`.
- Mobile empty: `Nothing from your phone yet` + share-sheet instructions.
- Bookmarks empty: `No bookmarks yet` + `Add Link`.
- Reading empty: `No reading yet` + explanation that articles/videos/posts go here.
- AI failure: `We saved the link, but couldn’t organize it yet` + `Retry AI`.

## 8. Accessibility and trust requirements

- announce save success and sync failures to screen readers;
- do not rely on color alone for processing states;
- label source icons with platform names;
- make Arabic reader layout RTL and test mixed Arabic/English content;
- show the original URL and provide copy/open actions;
- explain cloud sync and offline behavior in plain language;
- confirm deletion scope before removing a synced item;
- never expose provider/API keys in the client.

## 9. Recommended product priorities

### P0 — make the core loop obvious

- consistent first-run onboarding;
- reliable Save → Processing → Ready feedback;
- clear empty states on every tab;
- visible offline/queued status;
- consistent Item Detail primary action.

### P1 — improve rediscovery

- filter bottom sheet with clear-all;
- search across title, summary, tags, URL, and topic;
- sort controls: newest, oldest, unread, starred, pinned;
- recently viewed and continue-reading behavior;
- folder assignment from Item Detail.

### P2 — improve retention

- reminders for unread saved content;
- bulk select/archive/delete;
- export and import;
- cross-device sync diagnostics;
- onboarding/help for enabling the share extension.

## 10. Current implementation map

| Product area | Main code |
|---|---|
| App routing and auth guard | `lib/main.dart` |
| Persistent navigation, sync bootstrap, share handling | `lib/presentation/shell/app_shell.dart` |
| Vault dashboard and search | `lib/presentation/screens/vault_hub_screen.dart` |
| Collection modes and filters | `lib/presentation/screens/library_screen.dart` |
| Save flow | `lib/presentation/screens/add_link_screen.dart` |
| Item detail and actions | `lib/presentation/screens/link_detail_screen.dart` |
| Reading and Arabic translation | `lib/presentation/screens/reader_screen.dart` |
| Folder management | `lib/presentation/screens/manage_folders_screen.dart` |
| Account and sync controls | `lib/presentation/screens/settings_screen.dart` |
| Shared item UI | `lib/presentation/widgets/link_card.dart` |
| Enrichment status UI | `lib/presentation/widgets/status_chip.dart` |
| Domain item model | `lib/domain/entities/link.dart` |
| Sync engine | `lib/data/services/sync_service.dart` |

## 11. Simple user guide

### Save a link

Tap `+`, paste the URL, optionally choose a folder, then tap `Save Link`.

### Save from another app

Use the system Share menu and choose Qlip. The link is saved automatically.

### Find a saved link

Start in Vault search. If you know the type of item, open Library and choose
Mobile, Bookmarks, or Reading. Use folders, tags, or filters to narrow the list.

### Read a saved item

Open the item card, review its summary and key points, then tap `Reader`.

### Organize an item

Use star for important items, pin for priority items, mark read/unread as you
progress, and use folders for manual organization.

### Work offline

You can continue viewing cached links and saving new ones. Changes are queued
and synchronized when the connection returns.

### Sign out

Open Settings and tap `Sign out`. Cloud-saved links remain in the account.

