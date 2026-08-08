import { runEgo } from '../lib/ego';
import { resolve } from 'node:path';
import type { AccountRecord, PostRecord } from '../types';
import { normalizeHandle, type EgoPlatformModule, type ProgressReporter, type SessionStatusResult } from './types';

/**
 * X publishing over ego-browser, driven entirely by the recon in docs/x-posting-recon.md.
 * One resident task space holds four X accounts a click apart — the guard in `compose()`
 * below exists because a silently-failed switch would publish one brand's copy under
 * another brand's name, publicly, in the wrong voice (design doc §2.3). It runs three
 * times: before composing, immediately before the irreversible click, and against the
 * server's own permalink after the fact.
 */

export const X_TASK_SPACE = 'social-autopilot-x';

const HOME_URL = 'https://x.com/home';
const OPEN_TIMEOUT_S = 20;
const SWITCH_POLL_ATTEMPTS = 9; // ~1s each; recon observed switches take >1s, <10s
const TOAST_POLL_ATTEMPTS = 10;
const MEDIA_POLL_ATTEMPTS = 30; // ~1s each; a large image can take a while to process
const SWITCH_TARGET_ATTR = 'data-ego-switch-target';
const MAX_MEDIA = 4; // X's own per-post limit
const CLICK_SETTLE_S = 3;
const CLICK_ATTEMPTS = 3;

// X handles are [A-Za-z0-9_]+ only. Enforced before any handle is interpolated into a
// script string, so a corrupted PocketBase record can't inject browser-side JS.
const HANDLE_RE = /^[A-Za-z0-9_]+$/;

function assertValidHandle(handle: string) {
	if (!HANDLE_RE.test(normalizeHandle(handle))) {
		throw new Error(`Refusing to script an X account with an unexpected handle: ${JSON.stringify(handle)}`);
	}
}

function handleMatches(activeHandle: string | null, handle: string) {
	return activeHandle === `@${normalizeHandle(handle)}`;
}

/**
 * Compares intended body against what the composer read back. Deliberately whitespace-tolerant:
 * the point of the check is the recon trap where keystrokes land somewhere other than the editor
 * (e.g. the search box), and X's rich editor normalizes line endings and trailing spaces. Exact
 * equality would reject legitimate multi-line posts, which recon never exercised — only a
 * single-line post was verified end to end.
 */
function sameText(readBack: string | null, body: string) {
	const normalize = (value: string) =>
		value
			.replace(/\r\n?/g, '\n')
			.split('\n')
			.map((line) => line.trimEnd())
			.join('\n')
			.trim();
	return readBack !== null && normalize(readBack) === normalize(body);
}

// --- Browser-side snippets, run via js() -----------------------------------------------
//
// Self-contained on purpose (no references to outer scope) because js() takes a plain
// string with no closure/argument channel (ego-browser skill notes). They're embedded via
// JSON.stringify(...) below so quoting/escaping is never done by hand.

/**
 * Reads the active handle from the sidebar button (always present, no menu needed) plus
 * every OTHER account, scoped to the switcher popup if it happens to be open.
 *
 * Two traps this guards against (docs/x-posting-recon.md traps #1-#2):
 *  - the active row carries no data-testid/role/aria-checked anywhere in its ancestor
 *    chain, so it can only be read from the sidebar button, never the popup's UserCells;
 *  - an unscoped `UserCell` query also matches "who to follow" suggestions that carry a
 *    Follow button, so the popup container is found by walking up from
 *    AccountSwitcher_AddAccount_Button until an ancestor actually contains UserCell rows.
 */
const READ_SESSION_SNIPPET = `(() => {
	const active = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
	if (!active) return { activeHandle: null, otherHandles: [] };
	const activeMatch = (active.innerText || '').match(/@[A-Za-z0-9_]+/);
	const activeHandle = activeMatch ? activeMatch[0] : null;
	const anchor = document.querySelector('[data-testid="AccountSwitcher_AddAccount_Button"]');
	let container = anchor;
	const otherHandles = [];
	while (container) {
		const cells = container.querySelectorAll('button[data-testid="UserCell"]');
		if (cells.length > 0) {
			cells.forEach((cell) => {
				const m = (cell.innerText || '').match(/@[A-Za-z0-9_]+/);
				if (m) otherHandles.push(m[0]);
			});
			break;
		}
		container = container.parentElement;
	}
	return { activeHandle, otherHandles };
})()`;

const READ_EDITOR_TEXT_SNIPPET = `(() => {
	const el = document.querySelector('[data-testid="tweetTextarea_0"]');
	return el ? el.innerText : null;
})()`;

const INLINE_POST_BUTTON = '[data-testid="tweetButtonInline"]';
const MODAL_POST_BUTTON = '[data-testid="tweetButton"]';
const HAS_INLINE_POST_BUTTON_SNIPPET = `Boolean(document.querySelector('[data-testid="tweetButtonInline"]'))`;

const COMPOSER_IS_EMPTY_SNIPPET = `(() => {
	const el = document.querySelector('[data-testid="tweetTextarea_0"]');
	const box = document.querySelector('[data-testid="attachments"]');
	return (!el || el.innerText.trim() === '') && !box;
})()`;

const READ_TOAST_SNIPPET = `(() => {
	const toast = document.querySelector('[data-testid="toast"]');
	if (!toast) return null;
	const link = toast.querySelector('a');
	return { text: toast.innerText || '', href: link ? link.href : null };
})()`;

function tagSwitchTargetSnippet(handle: string) {
	// Same popup-scoping walk as READ_SESSION_SNIPPET, but tags the matching row instead of
	// reading it, so the outer script can click it with a real (trusted) click() call
	// rather than dispatching a synthetic one from inside js().
	return `(() => {
	const anchor = document.querySelector('[data-testid="AccountSwitcher_AddAccount_Button"]');
	let container = anchor;
	while (container) {
		const cells = container.querySelectorAll('button[data-testid="UserCell"]');
		if (cells.length > 0) {
			for (const cell of cells) {
				const m = (cell.innerText || '').match(/@[A-Za-z0-9_]+/);
				if (m && m[0] === '@${handle}') {
					cell.setAttribute('${SWITCH_TARGET_ATTR}', '1');
					return true;
				}
			}
			return false;
		}
		container = container.parentElement;
	}
	return false;
})()`;
}

// --- Node-side script builders ----------------------------------------------------------

function preamble() {
	return `await useOrCreateTaskSpace(${JSON.stringify(X_TASK_SPACE)});
	await openOrReuseTab(${JSON.stringify(HOME_URL)}, { wait: true, timeout: ${OPEN_TIMEOUT_S} });`;
}

/**
 * Task space only — deliberately NO openOrReuseTab.
 *
 * Verified 2026-08-08: a click issued from a script that begins with openOrReuseTab does not
 * register — the post is never submitted, and it surfaces only as a missing toast. The identical
 * click from a script without it works every time. Re-opening the tab appears to leave the page
 * briefly non-interactive. Scripts that act on an already-staged composer must use this.
 */
function attachedPreamble() {
	return `await useOrCreateTaskSpace(${JSON.stringify(X_TASK_SPACE)});`;
}

/** Opens the switcher (if anyone's logged in) and reads full session status. */
function sessionReadScript() {
	return `(async () => {
	${preamble()}
	const probe = await js(${JSON.stringify(READ_SESSION_SNIPPET)});
	if (!probe.activeHandle) {
		cliLog(JSON.stringify({ activeHandle: null, otherHandles: [] }));
		return;
	}
	await click('[data-testid="SideNav_AccountSwitcher_Button"]', { label: 'open account switcher' });
	await wait(1);
	const full = await js(${JSON.stringify(READ_SESSION_SNIPPET)});
	await pressKey('Escape');
	cliLog(JSON.stringify(full));
})();`;
}

/**
 * Scrolls the CURRENTLY active account (attachedPreamble — no tab re-open, no account switch)
 * and re-reads session status. Callers must switch to the target handle first; this only ever
 * scrolls whoever is active when it runs, which is what warm() below is for.
 */
function scrollAndReadScript() {
	return `(async () => {
	${attachedPreamble()}
	await scrollBy(600);
	await wait(1);
	cliLog(JSON.stringify(await js(${JSON.stringify(READ_SESSION_SNIPPET)})));
})();`;
}

/** Opens the switcher, clicks the row matching `handle`, then polls for the switch to land. */
function switchAccountScript(handle: string) {
	const tagSnippet = tagSwitchTargetSnippet(handle);
	return `(async () => {
	${preamble()}
	await click('[data-testid="SideNav_AccountSwitcher_Button"]', { label: 'open account switcher' });
	await wait(1);
	const tagged = await js(${JSON.stringify(tagSnippet)});
	if (!tagged) {
		await pressKey('Escape');
		cliLog(JSON.stringify({ activeHandle: null, otherHandles: [] }));
		return;
	}
	await click(${JSON.stringify(`[${SWITCH_TARGET_ATTR}="1"]`)}, { label: 'switch x account' });
	let result = { activeHandle: null, otherHandles: [] };
	for (let i = 0; i < ${SWITCH_POLL_ATTEMPTS}; i++) {
		await wait(1);
		result = await js(${JSON.stringify(READ_SESSION_SNIPPET)});
		if (result.activeHandle === '@${handle}') break;
	}
	cliLog(JSON.stringify(result));
})();`;
}

/** Types the post body with real keystrokes, then reads it back plus the active handle. */
function typeComposerScript(body: string) {
	return `(async () => {
	await useOrCreateTaskSpace(${JSON.stringify(X_TASK_SPACE)});
	// gotoAndWait, not openOrReuseTab: a real navigation is what clears the composer. A failed
	// run leaves its text and media staged, and typeText INSERTS at the cursor rather than
	// replacing — without this, run N+1 publishes a mangled splice of two different drafts
	// (observed 2026-08-08).
	await gotoAndWait(${JSON.stringify(HOME_URL)}, { timeout: ${OPEN_TIMEOUT_S} });
	await wait(2);
	await click('[data-testid="tweetTextarea_0"]', { label: 'focus x composer' });
	await typeText(${JSON.stringify(body)});
	const editorText = await js(${JSON.stringify(READ_EDITOR_TEXT_SNIPPET)});
	const session = await js(${JSON.stringify(READ_SESSION_SNIPPET)});
	cliLog(JSON.stringify({ activeHandle: session.activeHandle, editorText }));
})();`;
}

/**
 * Attachment state. Verified live 2026-08-08: after `uploadFile` into the hidden
 * `input[data-testid="fileInput"]`, X renders `[data-testid="attachments"]` containing one
 * `img` per file with a `blob:` src, and shows `[data-testid="progressBar-bar"]` while the
 * upload is still in flight. Both conditions are needed — the img appears before the upload
 * finishes, so counting images alone would let us click Post mid-upload.
 */
const READ_ATTACHMENTS_SNIPPET = `(() => {
	const box = document.querySelector('[data-testid="attachments"]');
	if (!box) return { ready: 0, uploading: false };
	return {
		ready: box.querySelectorAll('img[src^="blob:"]').length,
		uploading: Boolean(box.querySelector('[data-testid="progressBar-bar"]')),
	};
})()`;

/** Uploads each media path into the composer and waits for X to finish processing them. */
function attachMediaScript(paths: readonly string[]) {
	const uploads = paths
		.map((p) => `await uploadFile('input[data-testid="fileInput"]', ${JSON.stringify(p)});\n\tawait wait(1);`)
		.join('\n\t');
	return `(async () => {
	${preamble()}
	${uploads}
	let state = { ready: 0, uploading: true };
	for (let i = 0; i < ${MEDIA_POLL_ATTEMPTS}; i++) {
		state = await js(${JSON.stringify(READ_ATTACHMENTS_SNIPPET)});
		if (state.ready >= ${paths.length} && !state.uploading) break;
		await wait(1);
	}
	cliLog(JSON.stringify(state));
})();`;
}

/** Clicks Post, then polls the toast until the permalink shows up. */
function clickPostAndConfirmScript() {
	return `(async () => {
	${attachedPreamble()}
	// The composer needs a moment to settle before it will accept the click. Clicking ~1s after
	// the media-upload script exits reliably does nothing (verified 2026-08-08) — the identical
	// click succeeds once the page has had time. Hence the settle, and the retry below.
	await wait(${CLICK_SETTLE_S});
	let toast = null;
	let composerEmpty = false;
	for (let attempt = 0; attempt < ${CLICK_ATTEMPTS}; attempt++) {
		const inline = await js(${JSON.stringify(HAS_INLINE_POST_BUTTON_SNIPPET)});
		await click(inline ? ${JSON.stringify(INLINE_POST_BUTTON)} : ${JSON.stringify(MODAL_POST_BUTTON)}, { label: 'publish x post' });
		for (let i = 0; i < ${TOAST_POLL_ATTEMPTS}; i++) {
			await wait(1);
			toast = await js(${JSON.stringify(READ_TOAST_SNIPPET)});
			if (toast && toast.href) break;
		}
		if (toast && toast.href) break;
		// No toast. Only retry if the composer still holds the draft — an empty composer means
		// the post probably DID go out and we merely missed the toast, and clicking again there
		// would publish it twice.
		composerEmpty = await js(${JSON.stringify(COMPOSER_IS_EMPTY_SNIPPET)});
		if (composerEmpty) break;
		await wait(${CLICK_SETTLE_S});
	}
	cliLog(JSON.stringify({ toast: toast || null, composerEmpty }));
})();`;
}

// --- runEgo callers ----------------------------------------------------------------------

async function parseFirstLine<T>(script: string, fallback: T): Promise<T> {
	// The first JSON line, not simply the first line: runEgo merges stdout and stderr (cliLog
	// writes to stderr), so unrelated CLI diagnostics can precede our payload.
	for (const line of await runEgo(script)) {
		if (!line.startsWith('{') && !line.startsWith('[')) continue;
		try {
			return JSON.parse(line) as T;
		} catch {
			// not our payload — keep looking
		}
	}
	return fallback;
}

/**
 * Just the active handle, from the sidebar button. Used for guard #2, immediately before the
 * click: readSession() would open the switcher popup and Escape it, and a popup that failed to
 * close sits directly over the Post button. Nothing here navigates or opens anything.
 */
async function readActiveHandle(): Promise<string | null> {
	const script = `(async () => {
	${attachedPreamble()}
	const s = await js(${JSON.stringify(READ_SESSION_SNIPPET)});
	cliLog(JSON.stringify({ activeHandle: s.activeHandle }));
})();`;
	const { activeHandle } = await parseFirstLine<{ activeHandle: string | null }>(script, { activeHandle: null });
	return activeHandle;
}

async function readSession(): Promise<SessionStatusResult> {
	return parseFirstLine(sessionReadScript(), { activeHandle: null, otherHandles: [] });
}

/**
 * Switches to `handle` if it isn't already active, then scrolls to look human. Previously this
 * scrolled whichever account happened to already be active, regardless of which one was asked
 * for — with four accounts one click apart, "warm @kasa_africa" could silently warm @TheAvgTechDad
 * instead. Now it switches first, same as compose()'s guard #1.
 */
async function warm(handle: string): Promise<SessionStatusResult> {
	assertValidHandle(handle);
	const target = normalizeHandle(handle);
	let session = await readSession();
	if (!handleMatches(session.activeHandle, target)) {
		if (!session.otherHandles.includes(`@${target}`)) return session; // no live session anywhere; nothing to warm
		session = await switchAccount(target);
		if (!handleMatches(session.activeHandle, target)) return session; // switch failed; report what we have
	}
	return parseFirstLine(scrollAndReadScript(), session);
}

async function switchAccount(handle: string): Promise<SessionStatusResult> {
	return parseFirstLine(switchAccountScript(handle), { activeHandle: null, otherHandles: [] });
}

async function typeComposer(body: string): Promise<{ activeHandle: string | null; editorText: string | null }> {
	return parseFirstLine(typeComposerScript(body), { activeHandle: null, editorText: null });
}

async function attachMedia(paths: readonly string[]): Promise<{ ready: number; uploading: boolean }> {
	return parseFirstLine(attachMediaScript(paths), { ready: 0, uploading: true });
}

type ClickOutcome = { toast: { text?: string; href?: string | null } | null; composerEmpty: boolean };

async function clickPostAndConfirm(): Promise<ClickOutcome> {
	return parseFirstLine<ClickOutcome>(clickPostAndConfirmScript(), { toast: null, composerEmpty: false });
}

function extractHandleFromPermalink(href: string): string | null {
	// https://x.com/<handle>/status/<id>
	const match = href.match(/^https:\/\/x\.com\/([A-Za-z0-9_]+)\/status\/\d+/);
	return match ? `@${match[1]}` : null;
}

/** Guard #1 (design §2.3): read before composing, unconditionally. Switches if needed. */
async function ensureActiveAccount(account: AccountRecord, onProgress?: ProgressReporter): Promise<void> {
	assertValidHandle(account.handle);
	const handle = normalizeHandle(account.handle);
	let session = await readSession();
	if (handleMatches(session.activeHandle, handle)) return;
	if (!session.otherHandles.includes(`@${handle}`)) {
		throw new Error(`X account @${handle} has no live session (active: ${session.activeHandle ?? 'none'}).`);
	}
	await onProgress?.(`switching to @${handle}`);
	session = await switchAccount(handle);
	if (!handleMatches(session.activeHandle, handle)) {
		throw new Error(`Failed to switch X to @${handle}; still on ${session.activeHandle ?? 'none'}.`);
	}
}

async function compose(account: AccountRecord, post: PostRecord, onProgress?: ProgressReporter) {
	await onProgress?.('checking account session');
	// Guard #1 — nothing below runs, no compose script and no click, unless this passes.
	await ensureActiveAccount(account, onProgress);

	await onProgress?.('typing post text');
	const typed = await typeComposer(post.body);
	if (!sameText(typed.editorText, post.body)) {
		throw new Error(
			`X composer text does not match the intended post body after typing (read back ${JSON.stringify(
				(typed.editorText ?? '').slice(0, 80),
			)}).`,
		);
	}

	const media = (post.media ?? []).filter(Boolean).map((p) => resolve(p));
	if (media.length > MAX_MEDIA) {
		throw new Error(`X accepts at most ${MAX_MEDIA} images per post; this post has ${media.length}.`);
	}
	if (media.length) {
		await onProgress?.(`uploading ${media.length} image${media.length > 1 ? 's' : ''}`);
		const state = await attachMedia(media);
		if (state.ready < media.length || state.uploading) {
			throw new Error(
				`X did not finish attaching media (${state.ready}/${media.length} ready, uploading=${state.uploading}). Not posting a draft that is missing its image.`,
			);
		}
	}

	// Guard #2 — a FRESH read, not the handle from typeComposer above. Media upload can take
	// tens of seconds, and the whole point of this check is that it happens immediately before
	// the irreversible click with nothing slow in between.
	const beforeClick = await readActiveHandle();
	if (!handleMatches(beforeClick, account.handle)) {
		throw new Error(
			`Wrong X account immediately before posting: expected @${normalizeHandle(account.handle)}, got ${beforeClick ?? 'none'}.`,
		);
	}

	await onProgress?.('publishing');
	const outcome = await clickPostAndConfirm();
	const toast = outcome.toast;
	if (!toast || !toast.href) {
		throw new Error(
			outcome.composerEmpty
				? 'X showed no confirmation toast, but the composer emptied — the post MAY have gone out. Check the account before retrying, or this will publish twice.'
				: 'X did not confirm the post was submitted (no toast), and the draft is still in the composer.',
		);
	}

	// Guard #3 (design §2.3/§2.5): the toast's own permalink names the account that
	// actually posted — confirmed from the server's URL, not just the UI.
	const postedHandle = extractHandleFromPermalink(toast.href);
	if (!handleMatches(postedHandle, account.handle)) {
		throw new Error(
			`X posted under the wrong account: expected @${normalizeHandle(account.handle)}, permalink says ${postedHandle ?? 'unknown'} (${toast.href}). Investigate immediately.`,
		);
	}
	return { confirmed: true as const, postUrl: toast.href };
}

export const xPlatform: EgoPlatformModule = {
	platform: 'x',
	loginUrl: 'https://x.com/i/flow/login',
	taskSpace: X_TASK_SPACE,
	readSession,
	warm,
	compose,
};

// --- Exported for tests -------------------------------------------------------------------
//
// ponytail: readXSessionInPage duplicates READ_SESSION_SNIPPET's algorithm rather than
// sharing one implementation. js() takes a plain string with no importable function and no
// closures (ego-browser skill notes), so the browser copy can't just be a reference to this
// one. Kept in sync by hand; the regressions to watch for if it drifts are recon traps #1
// (active row has no stable hook) and #2 (unscoped UserCell also matches "who to follow").
// Upgrade path: generate READ_SESSION_SNIPPET from this function's source if a
// bundle-to-string build step is ever added.

export type MinimalElement = {
	innerText?: string;
	parentElement: MinimalElement | null;
	querySelectorAll(selector: string): MinimalElement[];
};
export type MinimalDocument = { querySelector(selector: string): MinimalElement | null };

export function readXSessionInPage(doc: MinimalDocument): SessionStatusResult {
	const active = doc.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
	if (!active) return { activeHandle: null, otherHandles: [] };
	const activeMatch = (active.innerText || '').match(/@[A-Za-z0-9_]+/);
	const activeHandle = activeMatch ? activeMatch[0] : null;
	const anchor = doc.querySelector('[data-testid="AccountSwitcher_AddAccount_Button"]');
	let container: MinimalElement | null = anchor;
	const otherHandles: string[] = [];
	while (container) {
		const cells = container.querySelectorAll('button[data-testid="UserCell"]');
		if (cells.length > 0) {
			for (const cell of cells) {
				const match = (cell.innerText || '').match(/@[A-Za-z0-9_]+/);
				if (match) otherHandles.push(match[0]);
			}
			break;
		}
		container = container.parentElement;
	}
	return { activeHandle, otherHandles };
}
