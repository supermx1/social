# Social OS

A personal social-media operating system: one place to define a brand's voice, generate
on-voice content, review it, and publish it — through a real, logged-in browser session,
not a platform API. Runs as a single Mac app, or from source.

See [social-os-PRD.md](social-os-PRD.md) for the full product spec.

## Why

Most social schedulers either need each platform's official API (rate-limited, partial,
often paid) or a headless-Chrome scraper you have to babysit. Social OS instead drives
[**ego lite**](https://lite.ego.app/download) — a real, already-logged-in browser — so it
publishes exactly the way a human would, with no API keys per platform and no scraping
fragility. Everything else (who you're posting as, what you're posting, when) is a small,
self-contained app you own and run yourself.

- **Personas** — a brand's mission, audience, voice, and guardrails, written once and
  reused for every draft.
- **Any AI provider** — Workers AI, Groq, OpenAI, OpenRouter, Ollama, LM Studio, or
  anything else that speaks the OpenAI `/chat/completions` shape. Settings suggests
  cost-effective picks, but nothing is hardcoded to one vendor.
- **Human-approved queue** — nothing posts until you approve it. Edit, reschedule, or
  delete any draft before it goes out.
- **Feeds → Topics** — point it at an RSS feed and it surfaces on-topic, on-brand items
  worth writing about, filtered by keywords and an optional relevance score, before
  anything reaches a draft.
- **One Mac app** — `./scripts/package.sh` builds the database, backend, and worker into
  a single double-clickable `.app`. No server to rent, no Docker Compose.

## Architecture (two processes)

- **`backend/`** — PocketBase (`backend/backend`). Owns the database, REST/realtime
  API, auth, the admin dashboard, serves the built frontend from `pb_public`, and
  runs the scheduler + cron timers from `pb_hooks`. Schema lives in `pb_migrations`.
- **`apps/worker`** — thin runner (plain Node, or `bun build --compile`d into the
  packaged app). Polls the `jobs` collection and executes what PocketBase can't run
  in-process: browser automation via [ego lite](https://lite.ego.app/download),
  LLM generation (any OpenAI-compatible server), RSS parsing, Telegram alerts.
- **`apps/web`** — SvelteKit SPA (`adapter-static`) built into `backend/pb_public`,
  talking to PocketBase via its JS SDK.

Runtime config and secrets live in the superuser-only **`env` collection**, edited from
the app's own **Settings** page — not in dotfiles scattered across the repo.

## Prerequisite: ego lite

Publishing drives a real logged-in browser session through
[**ego lite**](https://lite.ego.app/download) — a separate free macOS app that gives each
agent an isolated Space, so several accounts can be driven without them fighting over one
session. It cannot be bundled here (it's a signed third-party app, and it holds your
logins), so install it once. The dashboard shows a banner with a download button whenever
it's missing.

## Build the Mac app

```sh
./scripts/package.sh          # → dist/Social OS.app  (~92 MB)
```

One double-clickable bundle: UI, API, database, cron and worker. The database lives in
`~/Library/Application Support/Social OS`, never inside the app, so replacing the app
never touches your accounts, posts or API keys. On first launch it generates a random
password for the worker's own PocketBase superuser (mode `600`, never typed by you),
seeds one example persona/account/feed/post so the app isn't a blank slate, and opens the
first-run screen where you create your own account.

Prebuilt for **Apple Silicon only**. On Intel, change `--target=bun-darwin-arm64` in
`scripts/package.sh` and drop in a `darwin_amd64` PocketBase binary.

The bundle is **unsigned**, which is fine on the Mac that built it. To hand it to someone
else without Gatekeeper quarantining it you need an Apple Developer ID:

```sh
codesign --deep --force --options runtime --sign "Developer ID Application: YOUR NAME (TEAMID)" "dist/Social OS.app"
xcrun notarytool submit "dist/Social OS.app" --keychain-profile YOUR_PROFILE --wait
xcrun stapler staple "dist/Social OS.app"
```

The icon is built from `assets/icon.svg` by `./scripts/make-icon.sh`, using only macOS
built-ins (`sips` + `iconutil`) — no image dependencies to install.

## First run (from source)

```sh
npm install

# 1. Apply schema/seed migrations
backend/backend migrate

# 2. Build the frontend into backend/pb_public
npm run build

# 3. Start PocketBase (serves UI + API, runs scheduler/crons)
npm run backend            # http://127.0.0.1:8095  (dashboard at /_/)

# 4. In another shell, start the worker
cp apps/worker/.env.example apps/worker/.env   # fill PB_SUPERUSER_* + PB_URL
npm run worker
```

Open <http://127.0.0.1:8095>. With no account yet you land on **/setup**, which creates
your PocketBase **superuser** — that one account is both the app login and the dashboard
login, so you rarely need `/_/` at all. Then fill in **Settings** (`LLM_BASE_URL`,
`LLM_API_KEY`, `GEN_MODEL`, Telegram, …), which edits the `env` collection directly.
The essentials are one open card; everything with a working default starts collapsed,
and fields like `GEN_MODEL` and `DEFAULT_TIMEZONE` offer suggested values as you type.

The worker reads `env` once at startup — restart it after changing Settings.

**Model / provider agnostic.** `LLM_BASE_URL` takes any OpenAI-compatible
`/chat/completions` endpoint (Workers AI, Groq, OpenAI, OpenRouter, Together, Ollama,
LM Studio, llama.cpp, vLLM) with `LLM_API_KEY` as its bearer token. Leave `LLM_BASE_URL`
blank to derive the Workers AI endpoint from `CF_ACCOUNT_ID`.

## Using it

**Concepts**

- **Persona** — a brand's identity: mission, audience, voice, guardrails, example
  posts. Everything generated is grounded in one persona's brief.
- **Account** — one persona's presence on one platform (e.g. TechDad on X), with
  its own browser profile, login session, and posting window/caps.
- **Topic** — a thing to potentially post about: pasted in by hand, or created
  automatically from a feed item (see below).
- **Feed** — an RSS/Atom source that gets polled for candidate topics.
- **Post** — a draft (or scheduled/posted) piece of content tied to one account.

**Typical flow**

1. **Personas** — create the brand brief.
2. **Accounts** — add an account per platform for that persona, then **Log in**
   (opens a real headed browser once, to establish the session).
3. Get content into the queue, two ways:
   - **Generate** page → evergreen batch: pick persona + pillar + platform + count
     → queues a `generate` job → worker writes N draft posts grounded in the
     persona brief.
   - **Topics** page → topical: paste facts (or let a feed surface them, see
     below) → **Generate drafts** → worker writes drafts grounded *only* in that
     topic's `raw_content`, never fabricating beyond it.
4. **Queue** — review, edit body, approve, set/adjust timing, or delete. Nothing
   posts until it's `approved` and its scheduled time arrives.
5. **Activity** — job and run history, for when something needs debugging.

**Feeds → Topics, in detail**

Adding a feed doesn't post anything by itself — it just gives the system a
source to watch. Here's the pipeline once a feed is `active`:

1. A PocketBase cron (`pb_hooks`, every 15 min) checks all active feeds; once
   `poll_interval_minutes` has passed since a feed's `last_polled_at`, it queues
   a `feed_poll` job for it.
2. The worker fetches the feed's RSS/Atom and, per item: drops it if older than
   `freshness_hours`, drops it if its dedup key (guid, or URL with query/hash
   stripped) already exists on a `topics` row, and caps how many it processes at
   `max_items_per_poll`.
3. **Keyword filter (always on):** an item only survives if its title/summary
   contains one of the `domain_keywords` from at least one persona attached to
   the feed. This is free and cuts most noise before any LLM call.
4. **Relevance gate (optional, `RELEVANCE_GATE` config):** survivors get scored
   0–100 by a cheap model for "worth an on-brand post for this persona?" — items
   below `RELEVANCE_MIN` are dropped.
5. Everything left becomes a `topics` row: `source_type=rss`, `status=new`,
   linked back to the feed and to whichever persona(s) matched, with the
   relevance score/reason attached.
6. Those show up in the **Topics** inbox, sorted by relevance, for you to
   **Generate drafts** or **Dismiss** — nothing is auto-posted, and nothing is
   even auto-drafted yet. (Feeds have an `auto_draft` field for "skip the inbox
   and draft high-relevance items automatically," but it isn't wired up yet —
   today every topic needs a manual click regardless of that setting.)

## Roadmap

- **Cross-posting** — pick several accounts on one post instead of creating one
  per platform. Planned: [docs/superpowers/plans/2026-08-25-cross-posting-and-video.md](docs/superpowers/plans/2026-08-25-cross-posting-and-video.md).
- **Video posts** — attach a video, not just AI-generated images, to X and
  LinkedIn posts. Same plan doc.
- **YouTube** — not started. `youtube_community` exists as a schema value but has
  no platform module yet; it needs its own recon run first, the same way X,
  LinkedIn, and WhatsApp each got one (`docs/*-posting-recon.md`).

## Dev

```sh
npm run backend            # PocketBase (API on :8095)
npm run dev                # Vite dev server for the SPA (proxies to :8095)
npm run worker             # job runner
npm run check && npm test
```
