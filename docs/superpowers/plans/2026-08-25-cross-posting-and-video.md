# Cross-Posting & Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one piece of content (text + media) go out to several accounts at once instead of requiring a separate post per account, and extend media support from images-only to images-or-one-video.

**Architecture:** No new collection, no new job type, no worker changes for the cross-posting half. `posts.account` stays a single required relation — the existing scheduler, per-account timing windows, retry, and error handling are all already correct for "one post, one account, one job" and none of that needs to change. Cross-posting becomes purely a **creation-time fan-out**: the New Post dialog creates N independent post records (one per selected account) that share the same body and media and are tagged with a new `cross_post_group` id so the UI can show they belong together. Video is a separate, platform-by-platform extension to the existing media-attach code in `apps/worker/src/platforms/*.ts`.

**Tech Stack:** SvelteKit 5 (runes) + PocketBase JS SDK on the web app, Bun/Node worker driving `ego-browser`, PocketBase JS migrations for schema.

## Global Constraints

- No new PocketBase collection and no new `jobs.type` value for cross-posting — reuse `post_now` exactly as it exists today (`apps/worker/src/lib/worker.ts`, `apps/worker/src/lib/jobs.ts`).
- Every fanned-out post is a fully independent `posts` record. If posting to X succeeds and posting to LinkedIn fails, that must look exactly like two unrelated posts today: one `posted`, one `error` — no shared-failure semantics, no partial-batch UI state to invent.
- Follow existing test conventions exactly: pure logic in `apps/web/src/lib/*.ts` gets a co-located `*.test.ts` (see `errors.ts`/`errors.test.ts`, `realtime.ts`/`realtime.test.ts`). Svelte page components and PocketBase migrations have **no** existing test files anywhere in this codebase and are verified manually via the dev server — do not introduce component-test scaffolding that has no precedent here.
- Migration filenames follow the existing `<unix-ms-timestamp>_<description>.js` pattern; the next free timestamp after `1783373500_drop_relevance_model.js` is `1783373600`.
- Every migration needs both an up and a down (see any existing file in `backend/pb_migrations/` for the pattern).

---

## Phase 1 — Multi-account cross-posting (fully planned, ready to execute)

### Task 1: `posts.cross_post_group` schema field

**Files:**
- Create: `backend/pb_migrations/1783373600_cross_post_group.js`
- Modify: `apps/worker/src/types.ts:127` (the `PostRecord` type)

**Interfaces:**
- Produces: `PostRecord.cross_post_group: string` — empty string means "not part of a cross-post batch," matching how `variant_group` and `repeat` already use `''` as their none-sentinel. **Not** the same field as `variant_group`: `variant_group` links N different bodies for the SAME account (pick one to keep); `cross_post_group` links the SAME body/media across DIFFERENT accounts (all of them actually get published). Conflating the two would make the Queue UI lie about which posts are alternatives and which are duplicates going out together.

- [ ] **Step 1: Write the migration**

```js
/// <reference path="../pb_data/types.d.ts" />
//
// posts.cross_post_group: links posts created together as one cross-post action (same body/media,
// different accounts — see docs/superpowers/plans/2026-08-25-cross-posting-and-video.md). Deliberately
// a separate field from variant_group: variant_group is N candidate bodies for ONE account where only
// one gets kept; cross_post_group is ONE body going to N accounts where all of them get published.

migrate(
	(app) => {
		const posts = app.findCollectionByNameOrId('posts');
		posts.fields.add(new Field({ type: 'text', name: 'cross_post_group' }));
		app.save(posts);
	},
	(app) => {
		const posts = app.findCollectionByNameOrId('posts');
		posts.fields.removeByName('cross_post_group');
		app.save(posts);
	},
);
```

- [ ] **Step 2: Apply it and verify**

Run: `pkill -f "backend/backend serve"; npm run backend &` then, once healthy:
```bash
curl -s http://127.0.0.1:8095/api/health
```
Expected: `{"message":"API is healthy.",...}` and the backend log shows `1783373600_cross_post_group.js` applied (no error lines beyond the pre-existing, unrelated `loadAuthToken failure` noise present before this change).

- [ ] **Step 3: Add the field to the worker's type**

In `apps/worker/src/types.ts`, inside `PostRecord` (around line 127, next to `variant_group`):

```ts
	variant_group: string;
	/** Links posts created together as one cross-post action — see cross_post_group migration. */
	cross_post_group: string;
```

- [ ] **Step 4: Typecheck**

Run: `npm run check`
Expected: `0 ERRORS 0 WARNINGS` for both `apps/worker` and `apps/web`.

- [ ] **Step 5: Commit**

```bash
git add backend/pb_migrations/1783373600_cross_post_group.js apps/worker/src/types.ts
git commit -m "feat: add posts.cross_post_group for multi-account cross-posting"
```

---

### Task 2: Platform character-limit helper

**Files:**
- Create: `apps/web/src/lib/cross-post.ts`
- Test: `apps/web/src/lib/cross-post.test.ts`

**Interfaces:**
- Consumes: nothing (pure function, no imports from the rest of the app).
- Produces: `overLimitPlatforms(body: string, platforms: string[]): string[]` — returns the subset of `platforms` whose character limit `body` exceeds, in the order they appear in `platforms`. Task 4 calls this with the platforms of the currently-selected accounts to warn before a cross-post gets created with copy that will hard-fail on one of the targets.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { overLimitPlatforms } from './cross-post';

describe('overLimitPlatforms', () => {
	it('flags x when the body exceeds its 280-character limit', () => {
		const body = 'a'.repeat(281);
		expect(overLimitPlatforms(body, ['x', 'linkedin'])).toEqual(['x']);
	});

	it('returns nothing when every selected platform is within its limit', () => {
		expect(overLimitPlatforms('short post', ['x', 'linkedin', 'whatsapp'])).toEqual([]);
	});

	it('is silent about platforms with no known limit', () => {
		// linkedin/whatsapp have no hard limit encoded in this app today — absence of a limit
		// must not be misread as "always over," which would make the warning cry wolf.
		expect(overLimitPlatforms('a'.repeat(5000), ['linkedin', 'whatsapp'])).toEqual([]);
	});

	it('preserves the input platform order in its output', () => {
		const body = 'a'.repeat(281);
		expect(overLimitPlatforms(body, ['whatsapp', 'x'])).toEqual(['x']);
	});
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd apps/web && npx vitest run src/lib/cross-post.test.ts`
Expected: FAIL — `Cannot find module './cross-post'` (the file doesn't exist yet).

- [ ] **Step 3: Implement it**

```ts
/**
 * Per-platform hard character limits, sourced from the same constants the worker enforces —
 * see apps/worker/src/platforms/x.ts's MAX_BODY. Kept here rather than imported: the worker
 * and web app are separate npm workspaces with no shared package, and this list is short
 * enough that duplicating three numbers is cheaper than building one.
 */
const PLATFORM_LIMITS: Partial<Record<string, number>> = {
	x: 280,
};

/** Which of `platforms` would reject `body` outright for being too long. */
export function overLimitPlatforms(body: string, platforms: string[]): string[] {
	return platforms.filter((platform) => {
		const limit = PLATFORM_LIMITS[platform];
		return limit !== undefined && body.length > limit;
	});
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `cd apps/web && npx vitest run src/lib/cross-post.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  4 passed (4)`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/cross-post.ts apps/web/src/lib/cross-post.test.ts
git commit -m "feat: add overLimitPlatforms helper for cross-post length warnings"
```

---

### Task 3: Multi-select account picker + fan-out creation

**Files:**
- Modify: `apps/web/src/routes/queue/+page.ts:39-61` (loader's post mapping)
- Modify: `apps/web/src/routes/queue/+page.svelte:112-154` (New Post state + `createPost`)
- Modify: `apps/web/src/routes/queue/+page.svelte:518-534` (New Post dialog's account field)

**Interfaces:**
- Consumes: `overLimitPlatforms` from `$lib/cross-post` (Task 2); `data.accounts: { id: string; platform: string; handle: string; personaName: string }[]` (already produced by the loader, unchanged shape).
- Produces: nothing new consumed elsewhere — this is the leaf UI change.

- [ ] **Step 1: Map `cross_post_group` through the loader**

In `apps/web/src/routes/queue/+page.ts`, in the `posts:` mapping (right after `variantGroup: p.variant_group,` on line 56):

```ts
			variantGroup: p.variant_group,
			crossPostGroup: p.cross_post_group,
```

- [ ] **Step 2: Replace the single-account state with a multi-select array**

In `apps/web/src/routes/queue/+page.svelte`, replace:

```ts
	let newAccount = $state('');
```

with:

```ts
	let newAccountIds = $state<string[]>([]);

	function toggleNewAccount(id: string) {
		newAccountIds = newAccountIds.includes(id)
			? newAccountIds.filter((existing) => existing !== id)
			: [...newAccountIds, id];
	}
```

- [ ] **Step 3: Update `openNew` to reset the array**

Replace:

```ts
	function openNew() {
		newAccount = data.accounts[0]?.id ?? '';
```

with:

```ts
	function openNew() {
		newAccountIds = data.accounts[0] ? [data.accounts[0].id] : [];
```

(leave the rest of `openNew` — `newBody`, `newScheduledFor`, etc. — untouched)

- [ ] **Step 4: Add the length-warning derived value**

Add this near the other New Post state (after the `toggleNewAccount` function from Step 2):

```ts
	import { overLimitPlatforms } from '$lib/cross-post';

	const newOverLimitPlatforms = $derived(
		overLimitPlatforms(
			newBody,
			newAccountIds.map((id) => data.accounts.find((a) => a.id === id)?.platform ?? '')
		)
	);
```

(the `import` line goes at the top of the `<script>` block with the other imports, not inline — written here next to its usage only so the two are easy to read together)

- [ ] **Step 5: Rewrite `createPost` to fan out**

Replace the whole function body:

```ts
	async function createPost(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		if (newAccountIds.length === 0) {
			error = 'Choose at least one account.';
			return;
		}
		// Only tag a real cross-post — a single-account post carries '', same as an untouched
		// variant_group, so the common case doesn't grow a meaningless group of one.
		const crossPostGroup = newAccountIds.length > 1 ? crypto.randomUUID() : '';
		try {
			for (const accountId of newAccountIds) {
				await pb.collection('posts').create({
					account: accountId,
					// 'evergreen', not 'topical': there is no topic behind a hand-written post, and a
					// topical post with no topic gets expired by the scheduler on its first tick.
					kind: 'evergreen',
					body: newBody,
					media: [],
					// 'approved' skips the review step the generator's drafts need — this copy was
					// written by hand in this dialog, so there is nothing left to review.
					status: 'approved',
					timing_mode: 'exact',
					scheduled_for: newScheduledFor || null,
					repeat: newRepeat,
					repeat_until: newRepeat ? newRepeatUntil || null : null,
					attempts: 0,
					cross_post_group: crossPostGroup
				});
			}
			newOpen = false;
			await invalidateAll();
		} catch (err) {
			error = errorMessage(err, 'Could not create the post.');
		}
	}
```

(this drops the `return created;` the old version had — nothing called `createPost`'s return value, `grep -n "createPost(" apps/web/src/routes/queue/+page.svelte` to confirm before removing it, and if some other code did depend on it, keep returning the array of created records instead)

- [ ] **Step 6: Replace the account `<Select>` with a checkbox grid**

Replace the whole block (currently `apps/web/src/routes/queue/+page.svelte:518-534`):

```svelte
			<div class="grid gap-1.5">
				<Label for="newAccount">Account</Label>
				<Select
					type="single"
					bind:value={newAccount}
					items={data.accounts.map((a) => ({ value: a.id, label: `${a.personaName} · ${a.platform} · ${a.handle}` }))}
				>
					<SelectTrigger id="newAccount"><SelectValue placeholder="Choose an account" /></SelectTrigger>
					<SelectContent>
						{#each data.accounts as a (a.id)}
							<SelectItem value={a.id} label="{a.personaName} · {a.platform} · {a.handle}">
								{a.personaName} · {a.platform} · {a.handle}
							</SelectItem>
						{/each}
					</SelectContent>
				</Select>
			</div>
```

with:

```svelte
			<div class="grid gap-1.5">
				<Label>Accounts</Label>
				<p class="text-xs font-medium text-muted-foreground">
					Pick more than one to post the same message to each — one independent post per account,
					each with its own status and retry.
				</p>
				<div class="grid gap-2 sm:grid-cols-2">
					{#each data.accounts as a (a.id)}
						<label class="flex items-center gap-2">
							<input
								type="checkbox"
								checked={newAccountIds.includes(a.id)}
								onchange={() => toggleNewAccount(a.id)}
								class="size-4 rounded-sm border-2 border-border accent-primary"
							/>
							{a.personaName} · {a.platform} · {a.handle}
						</label>
					{/each}
				</div>
			</div>
```

(this matches the existing multi-relation checkbox pattern already used for `feeds.personas` in `apps/web/src/routes/feeds/+page.svelte` — no new component. The file's existing `import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '$lib/components/ui/select';` at the top stays untouched: it's still used by the status filter, persona filter, `timingMode` select, and `repeat` select elsewhere in this same file, none of which this task touches.)

- [ ] **Step 7: Show the length warning and disable submit when nothing's selected**

Right before the closing `<DialogFooter>` in the New Post form (after the existing "No image yet…" paragraph):

```svelte
			{#if newOverLimitPlatforms.length > 0}
				<p class="text-xs font-bold text-destructive">
					Too long for {newOverLimitPlatforms.join(', ')} — shorten it or deselect that account.
				</p>
			{/if}

			<DialogFooter>
				<Button type="submit" disabled={newAccountIds.length === 0}>Create</Button>
			</DialogFooter>
```

(replace the existing plain `<Button type="submit">Create</Button>` with the `disabled` version)

- [ ] **Step 8: Typecheck**

Run: `npm run check`
Expected: `0 ERRORS 0 WARNINGS`.

- [ ] **Step 9: Manual verification** (this codebase has no Svelte component tests — see Global Constraints)

1. Start the backend (`npm run backend`) and the web dev server (`npm run dev`).
2. Open `/queue`, click **New post**.
3. Confirm the dialog now shows a checkbox grid of accounts instead of a single dropdown, with the first account pre-checked.
4. Check two accounts on different platforms (e.g. an `x` account and a `linkedin` account). Type a body under 280 characters. Confirm no warning shows and **Create** is enabled.
5. Type a body over 280 characters with the `x` account still checked. Confirm the "Too long for x" warning appears.
6. Uncheck every account. Confirm **Create** is disabled.
7. Check two accounts, write a short body, click **Create**. Confirm the dialog closes and **two** new rows appear in the Queue table, both `approved`, one per account, with the same body.
8. Query PocketBase directly to confirm both new posts share one non-empty `cross_post_group` value and it differs from any other post's. Get a superuser token from `apps/worker/.env` (`PB_SUPERUSER_EMAIL`/`PB_SUPERUSER_PASSWORD`), then:
   ```bash
   set -a && . ./apps/worker/.env && set +a
   TOKEN=$(curl -s -X POST http://127.0.0.1:8095/api/collections/_superusers/auth-with-password \
     -H 'Content-Type: application/json' \
     -d "{\"identity\":\"$PB_SUPERUSER_EMAIL\",\"password\":\"$PB_SUPERUSER_PASSWORD\"}" \
     | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
   curl -s -H "Authorization: $TOKEN" "http://127.0.0.1:8095/api/collections/posts/records?sort=-created&perPage=5" \
     | python3 -c 'import sys,json; [print(p["id"], p["account"], p["cross_post_group"]) for p in json.load(sys.stdin)["items"]]'
   ```
9. Repeat with only **one** account checked. Confirm the created post's `cross_post_group` is `""`.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/routes/queue/+page.ts apps/web/src/routes/queue/+page.svelte
git commit -m "feat: cross-post to multiple accounts from one New Post dialog"
```

---

### Task 4: Show the cross-post relationship in the Edit dialog

**Files:**
- Modify: `apps/web/src/routes/queue/+page.svelte:494-498` (the existing `variantGroup` note in the Edit dialog)

**Interfaces:**
- Consumes: `PostRow.crossPostGroup` (produced by Task 3, Step 1).

- [ ] **Step 1: Add a sibling note next to the existing variant-group one**

Directly after the existing block:

```svelte
				{#if editing?.variantGroup}
					<p class="text-xs font-medium text-muted-foreground">
						Part of a batch of variants generated together ({editing.variantGroup}).
					</p>
				{/if}
```

add:

```svelte
				{#if editing?.crossPostGroup}
					<p class="text-xs font-medium text-muted-foreground">
						Cross-posted together with other accounts. Editing this post only changes this
						account's copy — open the others from the Queue table to keep them in sync.
					</p>
				{/if}
```

(deliberately does not try to count or list the sibling posts — Queue is paginated and filtered, so "N others" computed from `data.posts` could undercount without warning; a plain acknowledgement is honest, a wrong count is not)

- [ ] **Step 2: Typecheck**

Run: `npm run check`
Expected: `0 ERRORS 0 WARNINGS`.

- [ ] **Step 3: Manual verification**

1. Open one of the two posts created in Task 3's verification (Step 9.7) via **Edit & schedule**.
2. Confirm the new note appears.
3. Open a pre-existing, non-cross-posted post. Confirm the note does **not** appear.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/queue/+page.svelte
git commit -m "feat: note the cross-post relationship in the post edit dialog"
```

---

## Phase 1 self-review

**Spec coverage:** "select multiple accounts instead of the single select input" → Task 3. "one post cross-posted across [platforms] ... don't need to create individual posts for each platform" → Tasks 1 & 3 (fan-out at creation, one real `posts` record per platform so each keeps its own status/retry, which is what "don't need to manually create individual posts" actually requires — the alternative, one record that's somehow simultaneously on X and LinkedIn, doesn't fit how `posts.account`, `run_log`, and the scheduler's per-account timing windows are already modeled, and would have needed a much larger rewrite for no user-visible benefit over N linked records).

**Placeholder scan:** every step has real code, real commands, real expected output. No TBDs.

**Type consistency:** `cross_post_group` (Task 1) → `crossPostGroup` (Task 3, loader) → `PostRow.crossPostGroup` (Task 4) — checked, consistent through every task.

---

## Phase 2 & 3 — Video support (scoped, not yet broken into bite-sized tasks)

These depend on decisions Phase 1 doesn't make and are large enough to deserve their own planning pass once Phase 1 has shipped and the team has opinions on the open questions below. Scoping them now so the shape is clear.

### Phase 2: Manual media upload

**The gap this closes:** every image in this app today is AI-generated by `apps/worker/src/lib/images.ts` and written straight to `MEDIA_DIR`. There is currently **no way to attach a file the user already has** — not video, not even a plain image — to a hand-written post. The New Post dialog's own copy says so today: *"No image yet — add one with 'Generate image' from the row menu once the post exists."* A user's own video (or photo) needs a real upload path before it can be a video *post*.

**Shape of the work:**
- Add a real PocketBase `file` field (e.g. `posts.uploads`) — PocketBase already has working, unused file-upload storage (`backend/pb_data/storage`, empty today because nothing writes to it). Let PocketBase handle the multipart upload from the browser; don't build a custom upload endpoint.
- The worker runs as a separate local process on the same machine as PocketBase, so it can resolve an uploaded file straight to its path under `pb_data/storage` rather than needing a second copy step or an HTTP round-trip to itself.
- `posts.media` (the `string[]` the platform modules already read) gets the resolved absolute path appended, same as a generated image does today — the attach code in `x.ts`/`linkedin.ts` doesn't need to know or care whether a path came from `images.ts` or from a user upload.
- New Post dialog gets a file `<input type="file">` alongside (not instead of) the existing "generate an image later" flow.

**Open question to resolve before planning bite-sized tasks:** should the upload go through PocketBase's own file field (simplest, reuses infrastructure that already exists but is unused) or straight to `MEDIA_DIR` via a small worker-side upload endpoint (bypasses PocketBase's file-size defaults, more moving parts)? Recommendation: PocketBase's own file field — it is genuinely idle infrastructure and PocketBase's default file-size limit is configurable per field.

### Phase 3: Video in the existing platform modules (X, LinkedIn)

**What's already true, verified against the code:**
- `attachMediaScript` in `apps/worker/src/platforms/x.ts:254` uploads through a plain `<input type="file">` (`uploadFile('input[data-testid="fileInput"]', path)`) with no MIME/extension filtering — X's real composer accepts video through this exact input today, so the upload mechanism itself likely doesn't need to change.
- `MAX_MEDIA = 4` in `x.ts:23` is an **image** limit; X allows at most **one** video per post, never mixed with images. This needs a real rule change, not a bigger number: reject `>1` video, and reject a video mixed with any image.
- `MEDIA_POLL_ATTEMPTS = 30` (`x.ts:21`, ~1s each, so ~30s) polls for "ready" inside the ego-browser script. Real video processing on X commonly takes well past 30s.
- `SCRIPT_TIMEOUT_MS = 60_000` (`apps/worker/src/lib/ego.ts:36`) is the **hard ceiling** on every ego-browser call, image or text or video alike. `runEgo()` (`ego.ts`) already calls `execEgoBrowser(script, timeoutMs)`, which already accepts a timeout parameter — `runEgo` just hardcodes `SCRIPT_TIMEOUT_MS` instead of accepting an override. Giving video jobs a longer budget is a small, additive change to `runEgo`'s signature (an optional param defaulting to today's constant), not a blanket increase that would slow down failure detection on every other job.
- LinkedIn's media flow (`linkedin.ts:195-216`) goes through the same "Add media" sub-dialog for images; whether LinkedIn's video flow uses the same dialog or a different one, and what LinkedIn's real video-count limit is, is **not yet known** — the existing recon doc (`docs/linkedin-posting-recon.md`) covers images only.
- WhatsApp Status (`whatsapp.ts:324-332`) is explicitly **image-only today, one image max**, per its own recon doc — no video recon exists for it. Leave WhatsApp Status out of video scope entirely rather than guessing at an untested flow.

**Open questions to resolve before planning bite-sized tasks:** LinkedIn's actual video-upload UI (needs a short recon run, same as the original image recon) and the right poll/timeout budget for video specifically (needs one real test video upload to X to measure, rather than guessing a number).

---

## Phase 4 — YouTube — not planned, needs recon first

The user's example ("upload a new video to YouTube and X") assumes a YouTube platform module that **does not exist**. Checked directly: `apps/worker/src/platforms/index.ts`'s `modules` map only registers `x`, `linkedin`, `whatsapp` — calling `getPlatform('youtube_community')` throws `Platform module not implemented`. `youtube_community` is a schema enum value with no code behind it.

This project's own stated practice (`platforms/index.ts`'s comment) is that **every platform module is backed by its own live recon run** — `docs/x-posting-recon.md`, `docs/linkedin-posting-recon.md`, `docs/whatsapp-posting-recon.md` each document real, observed DOM selectors and flows before any code gets written against them. There is no such document for YouTube, and writing a bite-sized plan with fabricated selectors for YouTube Studio's upload flow would violate that practice — and this plan's own "No Placeholders" rule, since a step that says "click the upload button" without having verified the button's real selector is exactly the kind of placeholder the writing-plans process forbids.

`youtube_community` (the Community tab: text + one image, no video) is architecturally closer to the existing platforms and could get a real recon + module following the X/LinkedIn precedent relatively cheaply. **Actual YouTube video upload** (title, description, thumbnail, visibility, a processing wait that can run minutes) is a different, heavier flow and its own significant recon effort.

**Recommendation:** if YouTube matters for the cross-post use case specifically, the right first deliverable is a recon session against YouTube Studio's upload flow — using ego-browser directly, the same way the X/LinkedIn/WhatsApp recon docs were produced — before any implementation plan for it can be written. Happy to run that as a next step if you want to prioritize it; it's independent of Phases 1–3 above and doesn't block shipping cross-posting for the platforms already wired up.
