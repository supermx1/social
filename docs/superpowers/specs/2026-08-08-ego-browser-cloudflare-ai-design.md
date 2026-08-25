# Design: ego-browser publishing + Cloudflare AI generation (text & image)

**Date:** 2026-08-08
**Status:** approved for implementation
**Supersedes (does not replace) PRD sections:** §5.2, §139, §141, §193, §290, §301, §311, §592, §615.2
**Evidence base:** [docs/x-posting-recon.md](../../x-posting-recon.md) — a live verified post

## Summary

Three changes, one release:

1. **Publishing moves from Playwright to ego-browser.** Driven by a live recon run, not preference.
2. **Generation moves from LM Studio to Cloudflare Workers AI** over its OpenAI-compatible REST endpoint. Nothing is deployed to Cloudflare — no Worker, no Pages, no binding.
3. **Image generation ships now**, not in Phase 2, via Workers AI text-to-image.

The residential-IP non-goal (§3.2) is untouched: the browser and every session stay on the home machine. Only inference moves off-box, and inference has no IP reputation to protect.

## 1. Why ego-browser, and what was actually wrong

The recon settled a question that was previously guesswork. X exposes stable, well-named `data-testid` hooks — `tweetTextarea_0`, `tweetButtonInline`, `UserCell`, `SideNav_AccountSwitcher_Button`. These are ordinary CSS selectors that work identically in Playwright and ego-browser.

**So brittle selectors were never the failure.** The difference is the session:

| Session model | Result |
|---|---|
| ego-browser task space on the automation browser | verified working, first attempt |
| Playwright `launchPersistentContext` on a cold per-account profile | PRD as written; the likely cause of poor results |
| Playwright attached to the automation browser | Chromium locks `user-data-dir` to one process — conflicts with the resident ego-browser service |

ego lite is installed only for automation and is not a daily driver, so it already *is* the dedicated profile §139 asked for. §139's isolation requirement is therefore satisfied, not violated — and its stated concern (contention with the operator's working browser) is satisfied twice over, since task spaces isolate tabs as well.

The durable asset from this work is [docs/x-posting-recon.md](../../x-posting-recon.md). It is driver-agnostic and survives any future change of driver.

## 2. Browser layer

### 2.1 Launching

`ego lite` lives at `/Applications/ego lite.app`, bundle id `com.citrolabs.ego.lite`, and hosts the browser service the CLI connects to (`--startup-ego-browser-service`).

```
open -b com.citrolabs.ego.lite     # idempotent; no-op when already running
poll a trivial `ego-browser nodejs` heredoc until it answers
```

No launch manager, no process supervision. Cookies persist on disk, so a cold launch returns already logged in. This removes the operator-must-be-present constraint: the worker starts the app itself.

### 2.2 Runner

New `apps/worker/src/lib/ego.ts`:

- `ensureBrowser()` — `open -b`, then poll for readiness.
- `runEgo(script)` — `execFile('ego-browser', ['nodejs'])`, script on stdin, parse `cliLog` output from stdout. Non-zero exit or a script throw becomes a rejected promise carrying stderr.
- One task space, reused across jobs, named per platform.

`apps/worker/src/lib/browser.ts` keeps `enqueueBrowserTask` **verbatim** — it is a plain promise chain with no Playwright dependency, and it is what enforces global concurrency 1 (§3.5). Its Playwright internals are replaced by calls into `ego.ts`.

**§141 revision.** "Browsers spawned per job and torn down immediately, never left resident" no longer holds — the ego-browser service is resident by design. Concurrency 1 still holds, and it is the part that carried the detection rationale. Runs remain short and sporadic.

### 2.3 The account guard (non-negotiable)

One session holds four X accounts — `@TheAvgTechDad`, `@super__mx`, `@usepowershare`, `@kasa_africa` — each one click apart. A silently-failed switch publishes one brand's copy under another brand's name, publicly, in the wrong voice. This is the worst failure mode in the system.

Recon established that the guard cannot read the switcher popup: the **active** account is absent from the `UserCell` list and its row carries no `data-testid`, `role`, or `aria-checked` anywhere in its ancestor chain. The green check is presentational only.

The guard therefore reads the **sidebar button**, always present without opening any menu:

```
read [data-testid="SideNav_AccountSwitcher_Button"] -> must equal '@' + account.handle, else abort
```

It runs **twice per post**: once before composing, once immediately before the irreversible click. And a third, post-hoc check comes free — the send toast's link is `https://x.com/<handle>/status/<id>`, so the published handle is confirmed from the server's own URL after the fact. A mismatch there is a hard error and an alert.

Account switching, when needed, must scope `UserCell` queries to the switcher popup. Unscoped, a `UserCell` query also matched `@missowaa`, a "who to follow" suggestion carrying a **Follow button** — an unscoped switch attempt can follow a stranger while believing it changed accounts. Switching takes >1s and <10s; poll for the handle, never sleep a fixed interval.

### 2.4 Session status — one read, all accounts

The switcher is a live session inventory. The active handle plus the scoped `UserCell` handles is exactly the set of X accounts with live sessions.

This replaces §311's per-account check, which launched a browser per account. Now **one page read resolves `session_status` for every X account at once**. If `account.handle` is absent from that set, it is `needs_reauth`. If the sidebar button is missing entirely, or the page is a login screen, every X account flips to `needs_reauth`.

No new states — `accounts.session_status` already has `unknown` / `active` / `needs_reauth` / `disabled`.

**Re-auth flow** (§3.3 intact — the system never types a password): `handOffTaskSpace` → Telegram alert → operator logs in by hand → operator confirms → `takeOverTaskSpace` resumes. This replaces §301's headed-Playwright `waitForEvent('close')` dance.

### 2.5 Post confirmation

The existing [x.ts](../../../apps/worker/src/platforms/x.ts) confirms a post by intercepting the `CreateTweet` GraphQL response rather than trusting the UI. That instinct is correct and is preserved, but the mechanism simplifies: the send toast provides both confirmation (`Your post was sent.`) and the permalink (`[data-testid="toast"] a` → absolute URL). So `posts.post_url` comes free, with no profile scrape.

Read the toast before it auto-dismisses; if missed, fall back to the account's latest post on `/{handle}`. A post that yields neither is an error, never a silent success.

### 2.6 Platform scope — honest boundary

**X is ported. LinkedIn is not.** There is no recon for LinkedIn, and porting it on guessed selectors would reintroduce exactly the brittleness this work disproved. `linkedin.ts` is left in place but its module is marked as requiring its own recon run before use; `getPlatform('linkedin')` throws a clear "needs recon" error rather than failing subtly mid-post. Instagram, TikTok and Threads are likewise untouched. PRD Phase 0 is X-only, so this blocks nothing.

## 3. Generation — text

Workers AI is OpenAI-compatible at:

```
https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/chat/completions
Authorization: Bearer <api_token>
```

[generator.ts:96](../../../apps/worker/src/lib/generator.ts:96) already issues a bare `/chat/completions` fetch with a bearer header, so the swap is **two values in the `env` collection** (`LLM_BASE_URL`, `GEN_MODEL`) and one code change.

**That code change:** Cloudflare does not document `/v1/models`, and [generator.ts:105](../../../apps/worker/src/lib/generator.ts:105) currently falls back to probing it when `GEN_MODEL` is unset. `GEN_MODEL` becomes **mandatory** — an unset value raises a clear configuration error instead of a confusing 404 from a model-discovery call that will never work.

Model: start at `@cf/zai-org/glm-4.7-flash` (cheap, function calling, structured output), escalate to `@cf/openai/gpt-oss-120b` if voice quality disappoints. Swapping is one env value, so a wrong first pick costs nothing.

**`GEN_MODEL` must be the fully-prefixed id.** Verified 2026-08-08: `glm-4.7-flash` returns *"No such model"*; `@cf/zai-org/glm-4.7-flash` is accepted. The `@cf/<author>/<model>` prefix is required, and the model catalogue is the only reliable source for the author segment.

### 3.1 The free tier will not carry this — plan on Workers Paid

Measured 2026-08-08, and it is a bigger constraint than expected. **Text and image generation share one daily neuron budget**, and images consume it fast: roughly a dozen image generations exhausted the entire 10,000-neuron daily free allocation, after which *every* Workers AI call — including text — returned:

```
HTTP 429  code 4006
"you have used up your daily free allocation of 10,000 neurons"
```

Two consequences:

1. **Images can starve text.** A batch generation run with `withImages` on can burn the day's budget and leave the system unable to write drafts at all. The failure is loud (the quota message is surfaced verbatim to the operator via `errorMessage`), but the coupling is real and is a reason to leave `withImages` off by default rather than on.
2. **Workers Paid is effectively a prerequisite** for using images at any real cadence. This was not visible from the docs and only showed up under live use.

Nothing else in the generator changes. Persona grounding, the untrusted-signal handling for topical posts, and the JSON contract all stay as they are.

## 4. Generation — images

### 4.1 Style is a persona attribute

`personas.image_style` (text) sits beside `voice_tone`. Kasa's visuals must not look like PowerShare's, for the same reason their prose must not — the brand brief is the grounding for everything generated.

The plumbing is identical regardless of what the image depicts, so there is no branching anywhere: **Workers AI → file in `MEDIA_DIR` → path in `posts.media` → `uploadFile` into `input[data-testid="fileInput"]`.** Only the prompt varies, and it varies per persona. An empty `image_style` means that persona generates no images.

### 4.2 When images are made

At **draft** time, alongside the text, so the operator reviews the image before approving. An off-brand image is worse than off-brand prose, and the existing approval gate (§2.5 of the PRD) is the right place to catch it. This costs an image for drafts that later get deleted; at this volume that is cheaper than a second review loop.

- `generate` job payload gains `withImages?: boolean`. A UI checkbox sets it.
- New job type `generate_image` with `{ postId }` regenerates one post's image when the operator dislikes it. This is the only genuinely new job type.

No per-platform image matrix. `image_style` set plus `withImages` is the whole control surface.

### 4.3 Module — OpenAI, not Workers AI

Images run on the **OpenAI Images API**; text stays on Workers AI. The two providers are split
deliberately, for one reason that matters more than price: on Workers AI they shared a single
neuron budget, and images exhausted the daily allocation in about a dozen generations, after which
**text generation failed too** (§3.1). Splitting them means a batch of images can never starve the
drafting the whole product depends on.

Price was *not* the deciding factor — at ~65 images/month the entire spread between every option
considered is a few dollars (§4.5).

`apps/worker/src/lib/images.ts`:

- Builds the prompt from `persona.image_style` + the post body, body treated as untrusted.
- POSTs to `https://api.openai.com/v1/images/generations`, decodes `data[0].b64_json`, writes the
  bytes to `MEDIA_DIR` under a UUID filename, returns an **absolute** path (`resolve`, not `join` —
  the browser uploads from a filesystem path but `MEDIA_DIR` may be relative).
- `posts.media` already exists as `string[]` and stores paths, not bytes (§242) — no change there.
- `env`: `OPENAI_API_KEY` (required), `IMAGE_MODEL` (default `gpt-image-2`), `IMAGE_QUALITY`
  (default `medium`), `IMAGE_SIZE` (default `1024x1024`). Quality/size/model have working defaults
  rather than being required, so a missing one never stops a post going out.
- 120s `AbortSignal.timeout` — image models take tens of seconds, node's `fetch` has no default
  timeout, and a hung request would stall a queue whose browser concurrency is 1.

**`gpt-image-2` requires API Organization Verification** in the OpenAI developer console. An
unverified account gets a 403; the module surfaces OpenAI's own message so that is diagnosable
from a Telegram alert rather than looking like a code fault.

### 4.4 What the Workers AI image testing established

These measurements are why images left Workers AI, and two of them shaped code that survives the
move. Tested live on 2026-08-08 with identical benign prompts:

| Model | Response shape | `content-type` | Actual bytes | Result |
|---|---|---|---|---|
| `@cf/leonardo/lucid-origin` | base64 in JSON | `application/json` | JPEG | 2/2 ok — **default** |
| `@cf/leonardo/phoenix-1.0` | raw binary | `image/jpeg` | JPEG | 2/2 ok |
| `@cf/stabilityai/stable-diffusion-xl-base-1.0` | raw binary | `image/png` | PNG | 2/2 ok |
| `@cf/bytedance/stable-diffusion-xl-lightning` | raw binary | `image/png` | **JPEG** | 2/2 ok, header lies |
| `@cf/black-forest-labs/flux-1-schnell` | base64 in JSON | `application/json` | JPEG | **1/4** — unusable |
| `@cf/black-forest-labs/flux-2-*` | — | — | — | rejects JSON, needs `multipart` |

Three findings that shaped the code:

1. **`flux-1-schnell` is unusable here.** It rejected `"a plain blue circle on a white background, minimal, flat vector illustration"` as *"Input prompt contains NSFW content"* on three of four attempts. Every other model accepted the identical prompt. `IMAGE_MODEL` defaults to `@cf/leonardo/lucid-origin`.
2. **Both response shapes are real**, so the dual branch is required, not defensive padding — Leonardo `lucid-origin` returns base64-in-JSON while `phoenix-1.0` and the SDXL models return raw bytes.
3. **`content-type` cannot be trusted for the file extension.** `stable-diffusion-xl-lightning` reports `image/png` and returns JPEG bytes. The extension is therefore sniffed from magic bytes; the header only selects the parse branch. A `.png` file holding JPEG data would otherwise fail much later, at upload time, far from its cause.

Finding 3 is the one that outlived the provider change: `images.ts` still sniffs magic bytes
rather than trusting any declared format, because a declared format is not proof of content
anywhere. Finding 1 is moot now, and the dual-shape branch from finding 2 is gone — OpenAI returns
one shape (`b64_json`).

The FLUX.2 family (`flux-2-dev`, `flux-2-klein-*`) needs a `multipart` request body rather than
`{"prompt": ...}`, so it was never reachable through this code path.

### 4.5 Cost, for the record

Roughly 65 images/month (3 brands × ~5 posts/week):

| Option | per 1024×1024 | per month |
|---|---|---|
| OpenAI `gpt-image-2`, low | ~$0.02 | ~$1.30 |
| **OpenAI `gpt-image-2`, medium** — chosen | ~$0.07 | ~$4.50 |
| OpenAI `gpt-image-2`, high | ~$0.19 | ~$12 |
| CF `lucid-origin` | ~$0.03 | ~$2 |
| CF SDXL variants | $0/step listed | ~free, but burns neurons |

The spread is a few dollars, so cost is noise at this volume and should not drive the decision.
Medium quality is the choice; escalate `IMAGE_QUALITY` to `high` per-brand only if medium visibly
underserves a persona's imagery. Moving images off Workers AI may also keep text generation inside
Cloudflare's free daily allocation, which roughly cancels the OpenAI spend.
- Treats the post body as untrusted input to the image prompt, consistent with how [generator.ts](../../../apps/worker/src/lib/generator.ts) already treats topic content.

Failure to generate an image is **non-fatal**: the draft is still written, with the error recorded. Text posting must never be blocked by an image service.

## 5. Schema changes

| Change | Collection | Note |
|---|---|---|
| drop `profile_dir` | `accounts` | no per-account profiles exist any more |
| add `image_style` (text) | `personas` | empty = no images for this persona |
| add `CF_ACCOUNT_ID`, `CF_API_TOKEN` | `env` seed | Workers AI, **text only** |
| add `OPENAI_API_KEY` | `env` seed | images only |
| add `IMAGE_MODEL`, `IMAGE_QUALITY`, `IMAGE_SIZE` | `env` seed | `gpt-image-2` / `medium` / `1024x1024` |
| retire `PROFILES_DIR` | `env` | |

Two migrations, both verified by running `up` / `down` / `up` against a scratch database:
`1783372200_cf_images_schema.js` (schema + Workers AI env) and `1783372300_openai_images.js`
(repoints images at OpenAI).

**`LLM_BASE_URL` is not seeded with the Workers AI URL** because that URL embeds the account id.
It still defaults to LM Studio, so setting `GEN_MODEL` to an `@cf/...` id without also setting
`LLM_BASE_URL` sends a Cloudflare model id to a local LM Studio. Both must move together.

`handle` (§193) is promoted from "display handle for reference" to load-bearing — it is now how a script identifies and verifies an account. It must be stored without the leading `@`, and the guard adds it.

Deleted: `apps/web/src/lib/profile-dir.ts` and its test, plus profile-dir UI. `MEDIA_DIR` stays.

## 6. Testing

Existing vitest suites under `apps/worker/src/__tests__` continue to cover generation, feeds, jobs and scheduling. Added:

- **Guard tests** — the highest-value tests here. Given a sidebar handle that does not match the target account, `composePost` must throw before any compose or click occurs. Given a mismatched toast URL after posting, it must raise. These encode the cross-post failure mode.
- **Scoped-switcher test** — a `UserCell` matching the target handle *outside* the switcher popup must not be treated as an account row.
- **Image module test** — mocked `fetch`; asserts the prompt includes `persona.image_style`, that bytes land under `MEDIA_DIR`, and that a generation failure still yields a draft.
- **`GEN_MODEL` unset** — raises a configuration error rather than probing `/v1/models`.

Real Workers AI calls are **not** covered by tests and require `CF_ACCOUNT_ID` + `CF_API_TOKEN` to verify manually.

## 7. Known limits at ship

- LinkedIn, Instagram, TikTok, Threads unported — each needs its own recon run.
- Media **upload** into X is unexercised; `input[data-testid="fileInput"]` was found present but never driven. First real image post needs watching.
- Switch-then-post has never been chained in one job against the live site; switching and posting
  were each verified separately by hand, and the chained path is covered only by unit tests.
- The composer readback is whitespace-tolerant because only a **single-line** post was verified
  live. Multi-line posting is untested against the real editor.
- **OpenAI image generation is entirely unverified against the live API** — there is no key yet, so
  it is covered by mocked unit tests only. The request shape, `gpt-image-2` model id, `quality`
  values and `data[0].b64_json` response field come from OpenAI's current API docs, not a live call.
  First real call also needs API Organization Verification to be complete.
- Workers AI **text** generation reached the model dispatch layer with the correct base URL, auth and
  model id — it failed on the neuron quota (§3.1), not on configuration — but no completion has been
  read back yet. Retry after the daily reset (00:00 UTC).
- `playwright` remains a dependency: `linkedin.ts` still imports its `Page` type and is left in
  place unported. It can be dropped once LinkedIn is ported or the file is deleted.
