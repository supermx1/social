# Social Presence Autopilot

Personal, single-operator tool that keeps several brands posting on social media
with on-voice, human-approved content — published through a real browser session,
not platform APIs. See [social-presence-autopilot-PRD.md](social-presence-autopilot-PRD.md).

## Architecture (two processes)

- **`backend/`** — PocketBase (`backend/backend`). Owns the database, REST/realtime
  API, auth, the admin dashboard, serves the built frontend from `pb_public`, and
  runs the scheduler + cron timers from `pb_hooks`. Schema lives in `pb_migrations`.
- **`apps/worker`** — thin Node runner. Polls the `jobs` collection and executes what
  PocketBase can't run in-process: Playwright browser automation, LLM generation (any OpenAI-compatible server, e.g. LM Studio), RSS parsing, Telegram alerts.
- **`apps/web`** — SvelteKit SPA (`adapter-static`) built into `backend/pb_public`,
  talking to PocketBase via its JS SDK.

Runtime config and secrets live in the superuser-only **`env` collection**, not files.

## First run

```sh
npm install

# 1. Create the superuser + apply schema/seed migrations
backend/backend superuser upsert admin@example.com <password>
backend/backend migrate

# 2. Build the frontend into backend/pb_public
npm run build

# 3. Start PocketBase (serves UI + API, runs scheduler/crons)
npm run backend            # http://127.0.0.1:8095  (dashboard at /_/)

# 4. In another shell, start the worker
cp apps/worker/.env.example apps/worker/.env   # fill PB_SUPERUSER_* + PB_URL
npm run worker
```

Then in the dashboard (`/_/`): create the app **user** (login for the SPA) and fill
the **`env`** collection values (`LLM_BASE_URL`, `GEN_MODEL`, Telegram, `PROFILES_DIR`, …).

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

## Dev

```sh
npm run backend            # PocketBase (API on :8095)
npm run dev                # Vite dev server for the SPA (proxies to :8095)
npm run worker             # job runner
npm run check && npm test
```
