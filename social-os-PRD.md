# Social OS — Product Requirements Document

**Name:** Social OS
**Owner / sole operator:** Emeka
**Status:** Ready for implementation
**Audience for this doc:** An engineer or a code-generation model implementing the system phase by phase.

---

## 0. How to read this document

This PRD is written to be implemented **in order, one phase at a time**, starting with a thin vertical slice (Phase 0) that exercises the entire loop for a single account on a single platform. Do not build breadth before the slice works end to end.

Every architectural decision here is deliberate and was chosen to avoid a specific failure mode. The **Non-Goals (§3)** are not preferences — they are load-bearing. A naive implementation will "helpfully" reintroduce official APIs, cloud hosting, or automated login. **Do not.** Each non-goal explains why.

---

## 1. Problem Statement

Emeka runs three distinct brands — **TheAverageTechDad** (tech, open source, teaching), **Kasa** (Nigerian/African property-management B2B SaaS), and **PowerShare** (an early-stage hardware idea: a device that lets people monetize the energy they generate) — and cannot maintain a consistent, credible posting cadence across their social accounts by hand. Presence decays, timely moments are missed, and each brand needs a *different* voice. The cost of silence is lost audience growth, lost B2B pipeline (Kasa), and lost validation signal (PowerShare).

The tool must keep each brand **visibly active** on social media with on-voice content — including **reacting to time-sensitive real-world events** — while keeping Emeka in final editorial control and without getting his accounts flagged or banned.

---

## 2. Goals

1. **Consistent cadence, low effort.** Each active brand publishes on a schedule Emeka sets, generated ahead of time, with his role reduced to reviewing/editing/approving from his phone or laptop.
2. **On-voice, per-brand content.** Every generated post is grounded in that brand's identity (mission, audience, voice, content pillars) so TheAverageTechDad never sounds like Kasa.
3. **Timely reactive posts.** The system can turn a real, current event (a headline, link, or note Emeka drops in) into an on-voice post with the brand's own take, and publish time-sensitive ones before their deadline.
4. **Human-like publishing that survives unattended operation.** Posts go out via a real browser session (not APIs), from Emeka's own network, with sessions kept warm and re-auth surfaced to him when needed — no silent failures.
5. **Editorial control by default.** Nothing is published without Emeka's approval (at least through Phase 1).

---

## 3. Non-Goals (load-bearing — do not violate)

1. **No official platform APIs for posting or engagement.** All publishing is done by driving the real web UI in a browser. Rationale: the entire point is to post as a human from a real session; APIs are rate-limited, expensive (X charges per post, more for links), gated (LinkedIn), or incapable (YouTube community posts have no create API). Browser automation is also the *only* path that unlocks YouTube community posts.
2. **No cloud / VPS / datacenter hosting of the browser or session.** The browser runner and all session state live on a machine on Emeka's **home residential network**. Rationale: a social session that normally originates from a residential IP in Oxford, then suddenly makes requests from a datacenter IP, is the textbook signature of a **stolen/hijacked account** and trips a security checkpoint faster than the automation itself. A cheap VPS is the single worst place to run this.
3. **No automated entry of usernames/passwords, and no credential storage.** Login is performed manually by Emeka, once per account, into that account's browser profile. The app's job is to **detect when a session has died and ask him to re-auth** — not to log in for him. Rationale: login pages are the most bot-hardened surface on every platform, and storing plaintext credentials is unacceptable. (OAuth "sign in with Google" collapses to the same manual-login-once story in a browser — it just lands in the same cookie session.)
4. **No unsupervised engagement.** No automated liking, commenting, following, or DMing at scale. Engagement, if built (Phase 2), is **draft-and-approve only**: the system surfaces relevant posts and drafts a comment for Emeka to post with one tap. Rationale: high-volume, repetitive engagement is exactly the pattern ML detection is tuned to catch, and it's his personal brand at risk.
5. **No 24/7 continuous activity, no parallel sessions, no exceeding per-account caps.** Global browser concurrency is **1**. Rationale: continuous or parallel activity is itself a detection signal.
6. **Not a guarantee against detection.** The system must **fail gracefully** (detect dead sessions, alert, back off) and must never assume it is undetectable. "Look human" is an arms race, not a solved state.
7. **Not multi-tenant / not a SaaS.** Single operator, personal tool. No user management beyond protecting the UI.

---

## 4. Core Concepts & Domain Model

Three levels plus a signal feed:

- **Persona** — a brand's identity and voice, defined once. (TheAverageTechDad, Kasa, PowerShare.) This is the grounding for all generation.
- **Account** — a persona's presence on **one platform** (e.g., TheAverageTechDad-on-X, Kasa-on-LinkedIn). Each account owns exactly one persistent **browser profile** and one **session**. A persona can have many accounts.
- **Post** — the unit that gets published to one account. Editable. Carries scheduling and status.
- **Topic (signal)** — a real-world event/fact fed into the system that can seed one or more **topical** posts. Never invented by the model.

**Two kinds of content:**
- **Evergreen** — generated ahead from a persona's content pillars; safe to batch a week+ in advance.
- **Topical** — generated from a Topic; reacts to current events; may carry urgency and a hard expiry.

Both kinds flow through the same pipeline: **generate → store as draft → edit → approve → schedule → publish**.

---

## 5. Architecture

### 5.1 Deployment (fixed)

- **Host:** a machine on Emeka's home network. This can be his **day-to-day work laptop** — the system runs headless in the background and is designed not to interfere with his work (see §5.4) — or a dedicated always-on box (mini-PC, spare laptop). All components run here.
- **Access:** the web UI is reached from his laptop/phone over **Tailscale** (already in use). The UI is never exposed publicly.
- **Browser profiles:** stored on this machine's disk under `PROFILES_DIR`, one directory per account.
- **Datastore / app server:** a single **PocketBase** instance (the `backend/backend` binary). PocketBase owns the SQLite database (`backend/pb_data`), exposes REST + realtime APIs for every collection, provides auth and the admin dashboard, **serves the built frontend** from `backend/pb_public`, and **runs the scheduler and all cron timers** in `backend/pb_hooks` (embedded JS). Runtime config and secrets live in an `env` collection (§6.9) instead of scattered env vars.
- **Post media:** real files on disk under `MEDIA_DIR` — the DB stores the *path*, not the bytes, because Playwright uploads media from a filesystem path into the browser.

**Repo layout (monorepo):**
```
backend/        PocketBase binary + pb_migrations (schema) + pb_hooks (scheduler, crons)
                + pb_public (built frontend) + pb_data (database)
apps/web        SvelteKit (adapter-static) SPA — builds into backend/pb_public,
                talks to PocketBase via its JS SDK
apps/worker     thin Node runner — executes jobs PocketBase can't: Playwright browser
                automation, Anthropic generation, RSS parsing
```
Two processes (`backend`, `worker`), one PocketBase database, one schema defined once in `pb_migrations`. That's the whole system.

### 5.2 Components

| Component | Tech | Responsibility |
|---|---|---|
| **Datastore + app server** | PocketBase (`backend/backend`) | Collections + REST/realtime API + auth + admin dashboard; serves the frontend from `pb_public`; schema versioned in `pb_migrations` |
| **Scheduler + crons** | PocketBase `pb_hooks` (embedded JS, `cronAdd`) | Every-minute scheduler tick (expiry, random-roll, due-check, window/caps/gap → enqueue `jobs`); keep-warm timer; feed-poll timer; topic TTL cleanup |
| **Web app** | SvelteKit (adapter-static) SPA in `pb_public` | UI; all CRUD via the PocketBase JS SDK; PocketBase auth; creates `jobs` records for imperative actions |
| **Worker (runner)** | Node (long-running process) | Executes `jobs` PocketBase can't run in-process: Playwright runner, content generator, session manager, feed fetcher, Telegram alerter. Talks to PocketBase via the JS SDK as a superuser |
| **Browser automation** | Playwright + `playwright-extra` + stealth plugin | Drives real browser profiles to post and keep sessions warm |
| **Content generation** | Anthropic SDK (in the worker) | Persona-grounded evergreen + topical drafting |
| **Feed ingestion** | `rss-parser` (in the worker) | Fetches/parses RSS/Atom when a `feed_poll` job fires, filters for relevance, creates candidate `topics` |
| **Alerts** | Telegram Bot API (from the worker) | Re-auth needed, post failures, daily summary |

Keep **PocketBase and the worker as separate processes**. A crash in the worker (e.g. a Playwright hang) must not take down the UI/API, and vice versa. The split of logic is mechanical: **anything that is pure DB logic or a timer lives in `pb_hooks`; anything that needs Node (a browser, the Anthropic SDK, an XML parser) lives in the worker** and is triggered by a `jobs` record.

### 5.3 Data & control flow

- **All CRUD** (personas, accounts, topics, feeds, posts) happens in the **frontend via the PocketBase JS SDK** against PocketBase's generated REST API, gated by collection API rules (§7.9). No custom server routes to write.
- **Imperative actions** that need the worker — because they require a browser or the model — are not API calls. The frontend **creates a record in the `jobs` collection**, and the worker (which is already polling on a timer) picks it up. The `pb_hooks` scheduler enqueues jobs the same way. Job types:
  - `login_start` — launch a **headed** browser at an account's profile for manual login
  - `login_confirm` — verify session after manual login, set status
  - `generate` — run evergreen or topical generation for a persona/topic
  - `post_now` — force-publish an approved post immediately
  - `warm` / `verify` — manual keep-warm / session check
  - `feed_poll` — poll a feed on demand ("Poll now")
- The worker **writes results back through the PocketBase API** (as a superuser) — it does not depend on the UI being open. The `pb_hooks` scheduler reads its work (due `posts`, active `feeds`, `app_state`) directly in-process.
- Job results surface back through normal collection state (e.g. `accounts.session_status`, `posts.status`, `jobs.status`/`jobs.error`), which the UI reads via the SDK (polling or realtime subscription).

```
[ Phone/Laptop ] --Tailscale--> [ PocketBase (backend/backend) ]
                                  ├─ serves pb_public (SvelteKit SPA, PB JS SDK + PB auth)
                                  ├─ REST/realtime API over all collections
                                  ├─ pb_hooks crons: scheduler tick, keep-warm, feed-poll,
                                  │        topic TTL  →  create `jobs` records
                                  └─ env collection (keys, tokens, config)
                                       ^
                                       |  PocketBase JS SDK (superuser)
                                       |  claim jobs, write results
                                 [ Worker (runner): Playwright + generator + feed fetcher + alerter ]
                                       |
                                       v
                             [ real browser profiles ] --> social sites
                                       (home residential IP)
```

### 5.4 Co-resident operation (running on Emeka's work laptop)

**Decision (resolves former Open Question 8):** Emeka logs in manually on the host machine, then the system takes over and runs in the background. The host may be his everyday work laptop; the automation must run **without interfering with his work** — no stolen focus, no browser windows popping in front of him, no input capture.

**Requirements:**

1. **Headless for everything automated.** All scheduled posting, keep-warm, and session checks launch the browser with `headless: true`. Headless Chromium renders no visible window and never takes keyboard/mouse focus, so it is genuinely invisible while he works. The **only** visible (headed) browser is the manual login he initiates himself (`login_start`), and it closes on `login_confirm`. This is why `HEADLESS=true` is the default and login is the sole exception. (Headless still needs the stealth layer from §7.6 to mask headless-detection tells — already specced.)

2. **Dedicated profiles, isolated from his own browsing.** Automation uses its own per-account profile dirs under `PROFILES_DIR` — never his personal Chrome profile. Because Chromium locks a user-data-dir to one running instance, this isolation is what prevents the automation from ever contending with the browser he's using for work. He must not manually open an automation profile except during the login step, and the scheduler never launches an account whose session isn't `active` (so a run can't collide with an in-progress login on the same profile).

3. **Light footprint.** Global concurrency stays **1**; browsers are spawned per job and torn down immediately (never left resident); runs are short and sporadic (see §10 — not 24/7). Optionally run the worker at reduced OS priority. On a modern laptop this is unnoticeable alongside normal work.

4. **Survives sleep, lid-close, and restarts.** A laptop sleeps and reboots, unlike an always-on box. Run the worker as a **background service that auto-starts and auto-restarts** (launchd agent on macOS, `systemd --user` on Linux, Task Scheduler on Windows) so it comes back after wake/reboot without a terminal window. Posts scheduled while the machine was asleep are handled by the scheduler's **catch-up rule** (§7.5): on resume, publish still-valid due posts gently — one at a time, respecting caps, min-gap, posting window, and expiry — never a backlog flood (a burst is both robotic and a detection signal).

5. **Egress-IP consistency (the real caveat of a mobile host).** The whole home-hosting rationale is a **stable residential egress IP**; a laptop that roams between home, office, and public Wi-Fi reintroduces IP variability, and a session that normally posts from Oxford home suddenly posting from the office/a café can trip a checkpoint (far milder than a datacenter IP, but non-zero). Two mitigations, in order of preference:
   - **Pin egress to home via a Tailscale exit node.** Emeka already runs Tailscale; routing the worker's traffic through a home exit node gives a **constant home IP regardless of where the laptop physically is**. This is the clean fix and keeps roaming invisible to the platforms.
   - **Or: post only on the home network.** Gate posting on a detected home network/IP; while roaming, keep generating and queueing but hold publishing until back home. Simpler, but posts can slip past their window while he's out.

   Recommend the Tailscale exit node; fall back to home-network gating if he'd rather not route traffic.

---

## 6. Data Model (PocketBase collections)

All collections are defined in **JS migrations under `backend/pb_migrations`** (versioned, applied automatically on start). The field tables below stay conceptual; map the **Type** column to PocketBase field types using this convention:

- `text` → `text` field
- `number` → `number` field
- `bool` → `bool` field
- `date` → `date` field (PocketBase stores UTC datetimes — see §7.5 for how account-local windows are computed)
- `json (...)` → `json` field
- `select` → `select` field (single, with the listed values)
- `relation → X` → single `relation` field to collection `X`
- `relation → X (multi)` → **multi `relation` field** (native in PocketBase — no join tables)
- `url` → `url` field

Every collection has PocketBase's `id` (15-char string PK) plus `created` / `updated` autodate fields. **All ids in payloads and code are strings.** Shared TS types for the enum unions and job payloads live in a small `apps/worker/src/types.ts` (and are mirrored loosely in the frontend — PocketBase is the source of truth, not a compiled schema).

PocketBase fields have no column defaults; the writing side (UI, hooks, worker) sets initial values like `status = 'draft'` explicitly.

### 6.1 `personas`
| Field | Type | Notes |
|---|---|---|
| `name` | text | e.g. "TheAverageTechDad" |
| `slug` | text (unique) | e.g. "techdad" |
| `mission` | text | What the brand is / stands for |
| `audience` | text | Who it speaks to |
| `voice_tone` | text | How it sounds (person, register, quirks) |
| `content_pillars` | json (string[]) | Recurring themes for evergreen generation |
| `domain_keywords` | json (string[]) | For topical relevance matching + future RSS filtering |
| `guardrails` | text | Do's and don'ts, hard rules ("never give financial advice", "always first-person") |
| `example_posts` | json (string[]) | 3–6 real posts as voice anchors (few-shot) |
| `links` | json ({label,url}[]) | Canonical CTAs (site, waitlist). Links are fine — no API link-tax on browser posting |
| `default_hashtags` | json (string[]) | Optional |
| `active` | bool | |

### 6.2 `accounts`
| Field | Type | Notes |
|---|---|---|
| `persona` | relation → personas | |
| `platform` | select | `linkedin` \| `x` \| `facebook_page` \| `youtube_community` \| `instagram` \| `threads` |
| `handle` | text | Display handle for reference |
| `profile_dir` | text | Path to this account's persistent browser user-data-dir |
| `session_status` | select | `active` \| `needs_reauth` \| `unknown` \| `disabled` |
| `last_verified_at` | date | Last confirmed-alive check |
| `last_warmed_at` | date | Last keep-warm run |
| `timezone` | text | IANA tz, e.g. `Africa/Lagos` (Kasa), `Europe/London` (TechDad) |
| `posting_window_start` | text | Local "HH:MM", earliest publish time |
| `posting_window_end` | text | Local "HH:MM", latest publish time |
| `max_posts_per_day` | number | e.g. 1–3 |
| `min_gap_minutes` | number | Min spacing between posts on this account, e.g. 90 |
| `active` | bool | |

### 6.3 `topics`
| Field | Type | Notes |
|---|---|---|
| `title` | text | Short label |
| `source_type` | select | `manual` \| `rss` \| `web_search` |
| `source_url` | url | Optional |
| `raw_content` | text | **The facts the generator must ground on** (pasted note / RSS summary / fetched text). Required. |
| `personas` | relation → personas (multi) | Which brands this is for (native multi-relation) |
| `urgency` | select | `low` \| `normal` \| `high` |
| `expires_at` | date | Optional hard deadline; derived posts must publish before this |
| `status` | select | `new` \| `drafted` \| `dismissed` |
| `feed` | relation → feeds | Nullable; set when `source_type=rss` |
| `published_at` | date | Item's original publish date (from the feed) — used for freshness |
| `relevance_score` | number | Nullable; 0–100 from the relevance gate (§7.4) |
| `relevance_reason` | text | Nullable; one-line rationale from the relevance gate |
| `dedup_key` | text (indexed) | Item GUID or normalized URL; prevents re-ingesting the same story |

### 6.4 `feeds`
| Field | Type | Notes |
|---|---|---|
| `name` | text | e.g. "Anthropic News", "Nairametrics Real Estate" |
| `url` | url | RSS/Atom feed URL |
| `personas` | relation → personas (multi) | Which brands this feed feeds (native multi-relation) |
| `poll_interval_minutes` | number | e.g. 60–360 |
| `freshness_hours` | number | Ignore items older than this, e.g. 48 |
| `max_items_per_poll` | number | Cap candidates created per poll, e.g. 10 |
| `auto_draft` | bool | If true, high-relevance items auto-run Mode B into **drafts** (never auto-publish) |
| `last_polled_at` | date | |
| `last_error` | text | Last fetch/parse error, if any |
| `active` | bool | |

### 6.5 `posts`
| Field | Type | Notes |
|---|---|---|
| `account` | relation → accounts | Implies platform + persona |
| `topic` | relation → topics | Nullable; set for topical posts |
| `kind` | select | `evergreen` \| `topical` |
| `body` | text | The post text — **editable in the UI** |
| `media` | json (string[]) | Optional image **paths on disk** under `MEDIA_DIR` (not blobs) — Playwright uploads from a filesystem path |
| `status` | select | `draft` \| `approved` \| `scheduled` \| `posting` \| `posted` \| `error` \| `expired` \| `skipped` |
| `timing_mode` | select | `exact` \| `random` |
| `scheduled_for` | date | Exact mode: the time. Random mode: filled in by scheduler once rolled |
| `random_window_start` | date | Random mode only |
| `random_window_end` | date | Random mode only |
| `posted_at` | date | Actual publish time |
| `post_url` | url | Live post URL once verified |
| `attempts` | number | Retry counter |
| `error_message` | text | Last failure reason |
| `variant_group` | text | Groups N drafts generated together so the UI can show alternatives |

### 6.6 `run_log` (P1, optional but recommended)
`timestamp`, `account` (relation), `post` (relation, optional), `action` (text: warm/verify/post/generate/feed_poll), `result` (select: ok/fail), `detail` (text). For observability/debugging.

### 6.7 `app_state` (single record)
`paused` (bool) — global kill switch that halts all posting; `updated`.

### 6.8 `jobs` (worker task queue — replaces the old control API)
| Field | Type | Notes |
|---|---|---|
| `type` | select | `login_start` \| `login_confirm` \| `generate` \| `post_now` \| `warm` \| `verify` \| `feed_poll` |
| `payload` | json | Type-specific args, e.g. `{ accountId }`, `{ personaId, topicId, platform, n }`, `{ postId }`, `{ feedId }` |
| `status` | select | `queued` \| `running` \| `done` \| `error` |
| `error` | text | Failure detail if `status=error` |
| `attempts` | number | |

The frontend and the `pb_hooks` crons **create** jobs; the worker **claims** them (set `queued → running` before executing — with a single worker process this optimistic claim is race-free), executes, then sets `done`/`error`. The worker polls `jobs` on a short interval. This is the single mechanism for every action that needs the browser or the model.

### 6.9 `env` (runtime config + secrets)
| Field | Type | Notes |
|---|---|---|
| `key` | text (unique) | e.g. `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `GEN_MODEL`, `HEADLESS` |
| `value` | text | |

Replaces most of the old `.env` (§9). **All API rules are `null` (superuser-only)** — the frontend can never read it. The worker authenticates as a superuser and loads it at startup; `pb_hooks` reads it in-process. Editable in the PocketBase dashboard, so rotating a key needs no file edit or redeploy.

### 6.10 `users` (PocketBase auth collection)
The built-in `users` auth collection, holding exactly one record: Emeka. All app collections' API rules require an authenticated user (§7.9). No registration (create the record in the dashboard), no roles.

---

## 7. Component Specifications

### 7.1 Persona & Account management + browser profiles

**Behavior**
- CRUD personas and accounts in the web app (PocketBase JS SDK against the collections API).
- Creating an account allocates a `profile_dir` (e.g. `${PROFILES_DIR}/${persona.slug}-${platform}`) and sets `session_status = unknown`.
- A persona can have multiple accounts across platforms; the persona brief is shared by all of them.

**Acceptance criteria**
- [ ] Given a new account, when it is created, then a unique `profile_dir` is assigned and no other account shares it.
- [ ] Given three personas each with their own brief, when generating for one, then only that persona's brief is used (see §7.3).

### 7.2 Session manager (manual login, keep-warm, death detection, re-auth)

**Manual login flow (never automated)**
1. UI "Log in" → web app inserts a `login_start` job with `{ accountId }`.
2. Worker claims it and launches Playwright `launchPersistentContext(profile_dir, { headless: false })`, opening the platform's login URL. (Headed browser appears on the home machine's display, or a VNC/`xpra` session if headless-hosted — see Open Questions.)
3. Emeka logs in by hand (email/pass or OAuth) and clears any 2FA/checkpoint.
4. UI "I'm logged in" → web app inserts a `login_confirm` job → worker runs `platform.checkSession(page)`; if true, sets `session_status = active`, `last_verified_at = now`, persists context, closes browser.
5. **No credentials are ever entered by the app or stored.**

**Keep-warm heartbeat**
- Per active account, on a jittered timer (e.g. every 6–18h, at a random time inside the posting window), launch the profile and run `platform.warm(page)` — benign human-like activity (open home feed, small scroll, maybe open notifications), then persist context. This extends session life and lets the server rotate/reissue cookies.
- After warming, run `checkSession`. If false → `session_status = needs_reauth` + alert.

**Session death detection**
- Immediately **before any post**, run `checkSession`. If false: do not post, set account `needs_reauth`, alert, and return the post to `approved` (retry later).
- If a checkpoint/interstitial is detected mid-flow, abort gracefully, set `needs_reauth`, alert.

**Acceptance criteria**
- [ ] Given a logged-out account, when the scheduler tries to post, then it does not post, flips the account to `needs_reauth`, sends a Telegram alert, and leaves the post `approved`.
- [ ] Given a successful manual login, when confirmed, then `session_status` becomes `active` and no password is written anywhere in the system.
- [ ] Keep-warm never posts anything.

### 7.3 Content generator (the brain)

In the **worker**, Anthropic SDK, model from `GEN_MODEL`. Produces drafts only; **never** schedules or posts. Writes N `posts` rows as `draft` with a shared `variant_group`. Triggered by a `generate` job (from the UI) or directly by the feed poller's `auto_draft` path.

**Platform constraints table** (generator/module enforces):
| Platform | Length target | Style notes |
|---|---|---|
| `x` | ≤ 280 chars (unless long-form enabled) | Punchy, 1 idea, optional 1–2 hashtags |
| `linkedin` | 500–1300 chars | Line breaks, hook first line, 3–5 hashtags |
| `facebook_page` | 300–800 chars | Conversational |
| `youtube_community` | 200–600 chars | Community-tab tone, can tease videos |

**Mode A — evergreen(persona, pillar, platform, n)**
- System prompt = persona brief (mission, audience, voice_tone, guardrails, example_posts).
- User prompt = write `n` `platform` posts about `pillar`, obey the platform constraints, return a **JSON array of strings only, no preamble**.

**Mode B — topical(persona, topic, platform, n)** — this is the time-sensitive path
- System prompt = persona brief **plus a strict grounding block**:
  ```
  You are writing as {persona.name}. Base every factual claim ONLY on the SIGNAL below.
  Do NOT invent events, dates, numbers, names, or quotes. If the SIGNAL is thin, write a
  lighter take rather than fabricating detail. Add {persona.name}'s own distinctive opinion
  / angle — do not merely report the news. Match this voice: {voice_tone}. Obey these rules:
  {guardrails}.
  If URGENCY is high or an EXPIRY is given, convey timeliness naturally (e.g. act-before-X),
  but never state a deadline not present in the SIGNAL.
  ```
- User prompt includes `topic.raw_content`, `topic.source_url`, `topic.urgency`, `topic.expires_at`, target platform + constraints; return JSON array of strings only.
- **Worked example** (illustrative): Topic `raw_content` = "Anthropic re-released Claude Fable 5 on Jul 1 2026 after a brief suspension; access ends Jul 7." → TheAverageTechDad-on-X draft: a first-person hot take telling his audience why it's worth trying and to jump on it before the 7th — grounded only on those facts.

**Mode C — topical_with_search (P1)**
- Same as B, but call Claude with the web-search tool enabled so it can enrich/verify the signal with fresh sources before writing. Baseline (B) grounds only on provided `raw_content`.

**Output handling**
- Parse the JSON array (strip code fences defensively). For each string, create a `posts` row: `status=draft`, `kind`, `account` (the persona's account for that platform), `topic` (if topical), shared `variant_group`.
- On topical generation, set the topic's `status = drafted`.

**Acceptance criteria**
- [ ] Given a persona with distinct voice and guardrails, when generating, then output reflects that voice and violates no guardrail.
- [ ] Given a topical request, when the SIGNAL contains no dates, then the draft states no dates (no fabrication).
- [ ] Generation creates `draft` rows only and never sets `scheduled`/`approved`/`posted`.
- [ ] N variants share one `variant_group`.

### 7.4 Topic / signal ingestion

A **topic** is a real-world signal that seeds topical posts. Topics arrive two ways; both land as `topics` rows with `status=new` and both are **approval-gated** — ingestion never publishes anything.

**7.4.1 Manual (P0)**
UI form — paste `title`, `raw_content` (facts), optional `source_url`, pick `relevant_personas`, set `urgency` and optional `expires_at`. Then "Generate drafts" → runs Mode B per selected persona/platform.

**7.4.2 RSS feed ingestion (P1/P2 — specced below)**
A background module that turns a set of RSS/Atom feeds into a steady stream of candidate topics, filtered for relevance so the Topics list stays signal, not noise.

**Feed poller (a `pb_hooks` cron enqueues `feed_poll` jobs; the worker fetches/parses)**
For each `active` feed whose `poll_interval_minutes` has elapsed, the cron creates a `feed_poll` job; the worker then:
1. Fetch + parse with `rss-parser` (handles RSS and Atom). On fetch/parse failure, write `last_error`, log to `run_log` (`action=feed_poll`, `result=fail`), and move on — a broken feed must never stall the loop.
2. For each item, compute `dedup_key` = item `guid` if present, else a normalized `link` (strip query/UTM). Skip if a topic with that `dedup_key` already exists.
3. **Freshness gate:** skip items whose `pubDate` is older than the feed's `freshness_hours`. (Never resurface stale news.)
4. Take at most `max_items_per_poll` of the remaining newest items → pass to relevance filtering.

**Relevance filtering (two stages, cheap → smart)**
- **Stage 1 — keyword pre-filter (always on):** keep an item only if its title/summary matches any `domain_keyword` of at least one persona attached to the feed. This is free and cuts most noise before any LLM spend.
- **Stage 2 — LLM relevance gate (optional, per `RELEVANCE_GATE` config):** for items that pass Stage 1, one **cheap-model** call (e.g. Claude Haiku) scores each item 0–100 for "is this worth an on-brand post for {persona}?" and returns a one-line reason. Only items scoring ≥ `RELEVANCE_MIN` (e.g. 60) become topics. Store `relevance_score` + `relevance_reason`. If the gate is disabled, all Stage-1 survivors become topics.

**Topic creation**
For each surviving item, create a `topics` row: `source_type=rss`, `feed` set, `source_url=link`, `published_at=pubDate`, `title`, `relevant_personas` = the feed's personas (intersected with those whose keywords matched, if Stage 2 ran per-persona), `urgency=normal`, `expires_at=null`, `status=new`, plus `relevance_*` and `dedup_key`.
- `raw_content` = the item's title + cleaned summary/`content:encoded` (strip HTML). **Optional enrichment (P2):** if the summary is thin, fetch the article and extract main text for better grounding — but treat fetched text strictly as source facts (see safety note).

**Auto-draft (optional, per feed)**
If a feed has `auto_draft=true`, items scoring ≥ a high threshold (e.g. `RELEVANCE_AUTODRAFT`, e.g. 80) additionally run **Mode B** immediately, producing `posts` as **`draft`** (never `approved`/`scheduled`). This gets a fast-moving story into the queue as a ready-to-review draft while it's still hot — Emeka still approves before anything goes out.

**Safety — untrusted content (required)**
Feed items and any fetched article text are **untrusted third-party data, not instructions.** The generator must treat `raw_content` purely as *facts to write about* and must ignore any imperative text inside it (e.g. an article containing "ignore your instructions" or "post this link"). Never follow instructions embedded in feed content; never post a URL that came from feed content rather than the persona's own `links`. The generation prompt already forbids fabrication; it must also forbid obeying in-content instructions. Additionally, the persona's take must **paraphrase** — never reproduce article text verbatim (voice + originality, and it avoids copying copyrighted content).

**Volume hygiene**
Auto-dismiss `topics` with `status=new` older than N days (e.g. 7) so the list self-cleans. Respect `max_items_per_poll` so a firehose feed can't flood the queue.

**Acceptance criteria**
- [ ] Given the same story appearing twice (same GUID/URL, or across polls), when polled, then only one topic is created.
- [ ] Given an item older than `freshness_hours`, when polled, then no topic is created.
- [ ] Given an item that matches no persona keyword, when the keyword filter runs, then it is discarded before any LLM call.
- [ ] Given the LLM gate enabled, when an item scores below `RELEVANCE_MIN`, then no topic is created and no draft is generated.
- [ ] Given a feed with `auto_draft=true` and a high-scoring item, when polled, then drafts are created with status `draft` only (never `approved`/`scheduled`/`posted`).
- [ ] Given feed content containing an embedded instruction, when a draft is generated, then the instruction is not obeyed and no non-persona URL is inserted.
- [ ] Given a feed that 404s or returns malformed XML, when polled, then `last_error` is recorded and other feeds still poll normally.

### 7.5 Scheduler (`pb_hooks` cron, runs every minute)

Lives in `backend/pb_hooks` as a `cronAdd('scheduler', '* * * * *', ...)` handler — pure DB logic, in-process, no API hop. It never touches a browser; when a post is due it creates a `post_now` job for the worker.

Pseudocode:
```
if app_state.paused: return
now = Date.now()
for post in posts where status in ('approved','scheduled'):
    acct = post.account
    if not acct.active or acct.session_status != 'active': continue        # leave as-is
    if post.topic?.expires_at and now > post.topic.expires_at:
        set post.status = 'expired'; continue

    if post.timing_mode == 'random' and post.status != 'scheduled':
        # roll ONE concrete time inside [random_window_start, random_window_end]
        # constrained to the account's posting window; then lock it in
        post.scheduled_for = rollRandomWithin(post, acct)
        post.status = 'scheduled'; save; continue

    dueTime = post.scheduled_for
    if now >= dueTime
       and withinPostingWindow(now, acct)                                   # acct.timezone
       and postsPublishedToday(acct) < acct.max_posts_per_day
       and minutesSinceLastPost(acct) >= acct.min_gap_minutes:
        enqueueForPosting(post)     # global queue, concurrency 1
```
- **Expiry rule:** time-sensitive posts past their topic's `expires_at` are marked `expired` and never published late.
- **Catch-up after sleep/downtime (co-resident hosts, §5.4):** when the worker resumes after the laptop was asleep or restarted, posts whose `scheduled_for` passed while it was down are handled gently — process them **one at a time**, honoring the posting window, `max_posts_per_day`, `min_gap_minutes`, and expiry. Any post now **past its posting window or its topic's expiry** is marked `skipped`/`expired`, not published late. **Never** flush a backlog in a burst (a burst is robotic and a detection signal).
- **Random timing** is rolled once then locked (idempotent). It also doubles as anti-detection jitter.
- **Keep-warm**, **session-verify**, **feed polling** (§7.4.2), and **topic TTL cleanup** run as their own `pb_hooks` crons (not every minute), each of which only *creates jobs* (or, for TTL cleanup, dismisses stale topics directly). Feed polling is independent of posting and has no browser/IP constraint — it's just HTTP + parse (in the worker).

**Acceptance criteria**
- [ ] Given an approved post due now, within window, under caps, on an active session, when the scheduler runs, then it is enqueued exactly once.
- [ ] Given a topical post whose expiry has passed, when the scheduler runs, then it becomes `expired` and is not posted.
- [ ] Given `random` timing, when first seen, then a concrete `scheduled_for` inside the window is set and does not change on subsequent ticks.
- [ ] Posting never occurs outside an account's posting window or above its daily cap.
- [ ] Given several posts came due while the host was asleep, when the worker resumes, then they publish one at a time within window/caps (no burst), and any past their window/expiry are `skipped`/`expired`.

### 7.6 Poster / runner (Playwright)

- **Global concurrency 1** — a simple in-memory queue; one browser action at a time across the whole system.
- Per job: set post `status=posting` → `launchPersistentContext(profile_dir)` (headless per `HEADLESS`, stealth per `STEALTH`) → `platform.checkSession` → `platform.compose(page, post)` → on success set `posted`, `posted_at`, `post_url`; persist context; close. On failure: `attempts++`, set `error_message`; retry up to 3 with backoff; then `status=error` + alert.
- **Human pacing** lives in the modules: per-character typing delays, small random pauses, scroll before/after composing, no instant clicks.

**Platform module interface**
```ts
interface PlatformModule {
  platform: string;
  loginUrl: string;
  checkSession(page): Promise<boolean>;         // logged in?
  warm(page): Promise<void>;                     // benign human-like browse
  compose(page, post): Promise<{ postUrl?: string }>;  // create + publish, return live URL if detectable
}
```
Modules to implement (P0: one only): `linkedin`, `x`, `facebookPage`, `youtubeCommunity`. Each encapsulates its (brittle, frequently-changing) selectors so breakage is localized to one file.

**Acceptance criteria**
- [ ] Only one browser/session is ever active at a time.
- [ ] Given a successful compose, when done, then the post row has `posted`, a `posted_at`, and (if detectable) a `post_url`.
- [ ] Given a compose failure, when retries exhaust, then status is `error`, `error_message` is set, and an alert is sent.
- [ ] Composing types with human-like pacing (not an instant paste-and-submit).

### 7.7 Alerter (Telegram)

- Sends: **needs_reauth** (which account), **post failed after retries** (which post/account + reason), optional **daily summary** (published today, queued, accounts needing attention).
- Implementation: `sendMessage` to Telegram Bot API using `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`.

**Acceptance criteria**
- [ ] Every `needs_reauth` transition and every terminal `error` produces exactly one Telegram message.

### 7.8 Web UI (SvelteKit SPA, mobile-friendly)

Built with `adapter-static` into `backend/pb_public`; PocketBase serves it (with SPA index fallback). All data access is client-side via the PocketBase JS SDK; imperative actions create `jobs` records.

Screens:
1. **Dashboard** — accounts with session status (green/red), today's posted vs. queued, a prominent "needs re-auth" list, global pause toggle.
2. **Personas** — CRUD the persona brief (all §6.1 fields).
3. **Accounts** — per persona; add account (pick platform → allocate profile), **Log in** (launches headed browser), session status, per-account posting rules (window, caps, tz), **Warm now** / **Verify now**.
4. **Topics** — add a manual signal (title, facts, link, personas, urgency, expiry); **inbox of RSS-sourced candidates** sorted by `relevance_score`, each showing source feed + reason, with **Generate drafts** and **Dismiss** actions.
5. **Feeds** — CRUD feeds (name, URL, personas, poll interval, freshness, caps, `auto_draft`); shows `last_polled_at` / `last_error`; **Poll now** button.
6. **Content queue / Calendar** *(the heart)* — posts by status; per post: inline **edit body**, view **variants**, **approve**, set **timing** (exact datetime or random window), reschedule, **post now**, delete; filter by persona/account/status.
7. **Generate** — trigger an evergreen batch (persona, pillar(s), platform(s), count, and a date range to spread drafts across).
8. **Activity log** (P1) — from `run_log`.

**Acceptance criteria**
- [ ] The content queue works well on a phone: edit, approve, and reschedule are all reachable without a desktop.
- [ ] Approving a draft flips it to `approved`; the scheduler then owns it with no further UI action.

### 7.9 Access control (PocketBase auth)

One operator, private Tailscale network. PocketBase's built-in auth replaces the hand-rolled password check:
- One record in the `users` auth collection (created in the dashboard). The SPA's `/login` calls `authWithPassword`; the SDK persists the token; unauthenticated visitors are routed to `/login`.
- **API rules** on every app collection (`personas`, `accounts`, `topics`, `feeds`, `posts`, `jobs`, `run_log`, `app_state`): all of list/view/create/update/delete require `@request.auth.id != ""`. The `env` collection's rules are all `null` (superuser-only).
- No registration, no roles, no password reset flow.
- The worker authenticates as a **superuser** (`_superusers` `authWithPassword`) using the two bootstrap values in `.env` (§9).

**Acceptance criteria**
- [ ] Given no valid auth token, when any collection is queried via the API, then PocketBase rejects the request; the SPA redirects to `/login`.
- [ ] Given correct credentials, when submitted, then the SDK stores the token and the user reaches the dashboard.
- [ ] The `env` collection is unreadable with a normal user token.

---

## 8. Key Flows

**A. Add an account and log in**
Create account → allocate profile → **Log in** (headed browser) → Emeka authenticates + clears 2FA → **I'm logged in** → `checkSession` passes → `active`.

**B. Weekly evergreen batch**
Generate screen → pick persona + pillars + platform + count + date range → Mode A creates `draft`s spread across the range → Emeka reviews/edits/approves in the queue → scheduler publishes each on its slot.

**C. Time-sensitive topical post (the Fable 5 / Lagos-flood case)**
Topics → paste the facts + link, pick persona(s), `urgency=high`, set `expires_at` → **Generate drafts** (Mode B) → Emeka edits the take + approves with tight timing → scheduler publishes **before expiry**; if the window is missed, it's marked `expired`, not posted late.

**D. A scheduled post firing**
Scheduler finds it due/in-window/under-cap/session-active → enqueues → runner posts with human pacing → `posted` + `post_url`.

**E. A session dies unattended**
Keep-warm or pre-post `checkSession` fails → account `needs_reauth` → Telegram alert → affected posts stay `approved` → Emeka logs in once (Flow A) → posting resumes.

**F. Feed-sourced topical post**
Feed poller fetches items → dedup + freshness + keyword filter → (optional) LLM relevance gate → surviving items become `topics` (`source_type=rss`, `status=new`) in the Topics inbox → Emeka reviews a high-relevance candidate (or, if the feed is `auto_draft`, a draft is already waiting) → **Generate drafts** (Mode B) → edit + approve + timing → scheduler publishes. Nothing here auto-publishes.

---

## 9. Configuration & Secrets (`env` collection + bootstrap `.env`)

Almost all config lives in the **`env` collection** (§6.9) — superuser-only, editable in the PocketBase dashboard, read by the worker at startup and by `pb_hooks` in-process. Keys (same semantics as before):

```
MEDIA_DIR                          # post images on disk (paths stored in DB)
ANTHROPIC_API_KEY
GEN_MODEL                          # e.g. a current Claude model
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
PROFILES_DIR                       # base dir for per-account browser profiles
HEADLESS=true                      # runner headless? (login is always headed)
STEALTH=true                       # enable playwright-extra stealth plugin
DEFAULT_TIMEZONE=Europe/London
DEFAULT_MAX_POSTS_PER_DAY=2
DEFAULT_MIN_GAP_MINUTES=120
EGRESS_MODE=tailscale_exit         # tailscale_exit | home_network_gate | none  (§5.4)
HOME_NETWORK_CIDR=                 # for home_network_gate
RELEVANCE_GATE=true                # feed ingestion (§7.4.2)
RELEVANCE_MODEL=
RELEVANCE_MIN=60
RELEVANCE_AUTODRAFT=80
FEED_DEFAULT_POLL_MINUTES=180
FEED_DEFAULT_FRESHNESS_HOURS=48
TOPIC_INBOX_TTL_DAYS=7
```

The only file-based secrets are the worker's bootstrap credentials (it must authenticate before it can read `env`), in `apps/worker/.env`:

```
PB_URL=http://127.0.0.1:8095
PB_SUPERUSER_EMAIL=
PB_SUPERUSER_PASSWORD=
```

Secrets never leave the home machine. The UI/API is protected by PocketBase auth (§7.9) and only reachable over Tailscale; the database (`backend/pb_data`) and browser profiles sit on local disk.

---

## 10. Anti-Detection Rules (codified)

These are requirements, not suggestions:
- Global browser concurrency **= 1**; never run two sessions at once.
- Post **only inside each account's posting window** (its own timezone).
- Respect `max_posts_per_day` and `min_gap_minutes` per account.
- Prefer **random** timing; jitter everything; avoid identical daily cadence.
- Human pacing in every module (typing delays, pauses, scrolling, no instant submit).
- **Do not run 24/7.** Keep-warm and posting happen only in windows; observe quiet hours.
- Warm profiles + **residential IP** (home box) — never a datacenter.
- **Consistent egress IP even on a roaming laptop (§5.4):** pin traffic to the home network via a Tailscale exit node, or gate posting to the home network. Avoid posting a session from office/café IPs when it normally originates from home.
- **Headless for all automated runs** (§5.4) — invisible on a co-resident host, and dedicated per-account profiles never contend with the operator's own browser.
- On any checkpoint/anomaly: stop, flag `needs_reauth`, alert. Never brute-force through.

---

## 11. Phased Rollout

**Phase 0 — Vertical slice (MVP).** Monorepo (`backend`, `apps/web`, `apps/worker`); PocketBase collections via `pb_migrations`; PocketBase auth + API rules (§7.9); the `jobs` collection + `pb_hooks` scheduler + worker claim loop; **one persona**; **one account on one platform** (pick the platform Emeka most wants presence on — see Open Questions); manual login flow (via `login_start`/`login_confirm` jobs); manual topic + evergreen generation (Modes A & B); content queue with edit/approve; scheduler with exact + random timing and expiry handling; runner + that **one** platform module; keep-warm; Telegram alerts for `needs_reauth` and terminal errors. **Goal: the full loop works end to end for one account.**

**Phase 1 — Breadth + feed ingestion.** Remaining platform modules (`linkedin`, `x`, `facebook_page`, `youtube_community`); multiple accounts/personas; per-account rules; evergreen batch spread across a date range; variants in the UI; dashboard polish; daily summary; `run_log`. **RSS feed ingestion (§7.4.2):** feeds CRUD, poller, dedup + freshness + keyword filter, Topics inbox. (Keyword filter first; the LLM relevance gate and `auto_draft` can follow as 1.5.)

**Phase 2 — Intelligence & reach.** LLM relevance gate + `auto_draft` (if deferred); article full-text enrichment; `topical_with_search` generation; **draft-and-approve engagement** (surface relevant posts + draft comments for one-tap manual posting — never unsupervised); optional AI image generation + attachment.

---

## 12. Success Metrics (personal-tool framing)

**Leading (days–weeks)**
- Posts published per week per active brand (target: hits the cadence Emeka sets, e.g. 3–5/brand/week).
- % of scheduled posts that publish successfully with **no manual intervention** (target: ≥ 90%).
- % of time-sensitive topical posts published **within their expiry window** (target: 100% — missing is a bug, not a late post).
- Mean time from session death → Emeka alerted (target: < 1 keep-warm cycle).

**Lagging (weeks–months)**
- Follower / engagement growth per brand.
- Kasa: inbound/pipeline attributable to consistent presence.
- PowerShare: validation signal (waitlist/interest) from build-in-public posts.
- Manual hours saved per week vs. posting by hand.

---

## 13. Open Questions

1. **[Emeka]** Which platform should Phase 0 target first (where does he most want presence / post most)?
2. **[Emeka]** Media in v1: text-only, or AI-generated images from the start? (Images add real complexity — recommend text-only for Phase 0.)
3. **[Emeka]** Confirm per-persona timezones (Kasa → `Africa/Lagos`? TechDad → `Europe/London`?).
4. **[Emeka / risk tolerance]** Keep-warm frequency vs. detection risk — start conservative (once/12–18h)?
5. **[Emeka]** Should a per-persona **"auto-approve evergreen"** trust flag exist later, or stays manual-approval forever? (Topical should always stay manual.)
6. **[Emeka]** Which starter feeds per brand? (TechDad → e.g. Anthropic news, Hacker News, dev-tool blogs; Kasa → Nigerian real-estate / Lagos news; PowerShare → energy / solar / Nigerian power-sector feeds.) List the actual feed URLs to seed the `feeds` collection.
7. **[Emeka]** Is the LLM relevance gate worth the per-item cost from day one, or start keyword-only and add it once feed noise proves it's needed?
8. **[RESOLVED — see §5.4]** Driving the headed login browser: Emeka logs in manually on the host (his work laptop is fine); the system then runs headless in the background without interfering with his work. Remaining sub-decision for him: **egress mode** — Tailscale exit node (recommended) vs. home-network posting gate (§5.4 item 5).

---

## 14. Definition of Done — Phase 0 checklist

- [ ] PocketBase collections via `pb_migrations`: `personas`, `accounts`, `topics`, `feeds`, `posts`, `jobs`, `run_log`, `app_state`, `env` — editable through the web app (and the PB dashboard).
- [ ] PocketBase auth guards every collection and the SPA redirects unauthenticated users to `/login`; `env` is superuser-only; the worker authenticates as a superuser.
- [ ] PocketBase serves the built SPA from `pb_public` and runs the scheduler + crons from `pb_hooks` — `web` needs no server process of its own.
- [ ] A UI-triggered action (login/generate/post-now) creates a `jobs` record that the worker claims exactly once.
- [ ] One persona and one account created; manual **headed** login works and sets `active`; no credentials stored.
- [ ] With the account logged in, automated posting/warming runs **headless** on the same laptop while the operator works — no window is raised, no focus/input is stolen, and the automation profile never contends with his personal browser.
- [ ] The worker runs as a background service that auto-restarts after sleep/reboot, and posts that came due during downtime catch up gently (no burst) or are `skipped`/`expired` if past window/expiry.
- [ ] Keep-warm runs on a jittered timer and flips dead sessions to `needs_reauth` with a Telegram alert.
- [ ] Evergreen generation (Mode A) produces on-voice `draft` variants grounded in the persona brief.
- [ ] Topical generation (Mode B) produces an on-voice, **fact-grounded** draft from a manual signal, with no fabricated dates/numbers.
- [ ] Content queue allows edit, approve, and setting exact/random timing from a phone.
- [ ] Scheduler publishes an approved post at the right time, in-window, under caps, via the one platform module, with human pacing.
- [ ] A time-sensitive post past its expiry is marked `expired`, not posted late.
- [ ] Global concurrency is 1; posting never happens outside the window or above the cap.
- [ ] Post failures retry, then land in `error` with a Telegram alert.
