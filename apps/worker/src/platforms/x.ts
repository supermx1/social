import { runEgo } from '../lib/ego';
import type { AccountRecord, PostRecord } from '../types';
import type { EgoPlatformModule, SessionStatusResult } from './types';

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
const SWITCH_TARGET_ATTR = 'data-ego-switch-target';

// X handles are [A-Za-z0-9_]+ only. Enforced before any handle is interpolated into a
// script string, so a corrupted PocketBase record can't inject browser-side JS.
const HANDLE_RE = /^[A-Za-z0-9_]+$/;

function assertValidHandle(handle: string) {
	if (!HANDLE_RE.test(handle)) {
		throw new Error(`Refusing to script an X account with an unexpected handle: ${JSON.stringify(handle)}`);
	}
}

function handleMatches(activeHandle: string | null, handle: string) {
	return activeHandle === `@${handle}`;
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

/** Opens the switcher (if anyone's logged in) and reads full session status. */
function sessionReadScript(extraBeforeProbe = '') {
	return `(async () => {
	${preamble()}
	${extraBeforeProbe}
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

function warmScript() {
	return sessionReadScript('await scrollBy(600);\n\tawait wait(1);');
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
	${preamble()}
	await click('[data-testid="tweetTextarea_0"]', { label: 'focus x composer' });
	await typeText(${JSON.stringify(body)});
	const editorText = await js(${JSON.stringify(READ_EDITOR_TEXT_SNIPPET)});
	const session = await js(${JSON.stringify(READ_SESSION_SNIPPET)});
	cliLog(JSON.stringify({ activeHandle: session.activeHandle, editorText }));
})();`;
}

/** Clicks Post, then polls the toast until the permalink shows up. */
function clickPostAndConfirmScript() {
	return `(async () => {
	${preamble()}
	await click(${JSON.stringify('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]')}, { label: 'publish x post' });
	let toast = null;
	for (let i = 0; i < ${TOAST_POLL_ATTEMPTS}; i++) {
		await wait(1);
		toast = await js(${JSON.stringify(READ_TOAST_SNIPPET)});
		if (toast && toast.href) break;
	}
	cliLog(JSON.stringify(toast || {}));
})();`;
}

// --- runEgo callers ----------------------------------------------------------------------

async function parseFirstLine<T>(script: string, fallback: T): Promise<T> {
	const [line] = await runEgo(script);
	return line ? (JSON.parse(line) as T) : fallback;
}

async function readSession(): Promise<SessionStatusResult> {
	return parseFirstLine(sessionReadScript(), { activeHandle: null, otherHandles: [] });
}

async function warm(): Promise<SessionStatusResult> {
	return parseFirstLine(warmScript(), { activeHandle: null, otherHandles: [] });
}

async function switchAccount(handle: string): Promise<SessionStatusResult> {
	return parseFirstLine(switchAccountScript(handle), { activeHandle: null, otherHandles: [] });
}

async function typeComposer(body: string): Promise<{ activeHandle: string | null; editorText: string | null }> {
	return parseFirstLine(typeComposerScript(body), { activeHandle: null, editorText: null });
}

async function clickPostAndConfirm(): Promise<{ text?: string; href?: string | null } | null> {
	const result = await parseFirstLine<{ text?: string; href?: string | null }>(clickPostAndConfirmScript(), {});
	return result && Object.keys(result).length ? result : null;
}

function extractHandleFromPermalink(href: string): string | null {
	// https://x.com/<handle>/status/<id>
	const match = href.match(/^https:\/\/x\.com\/([A-Za-z0-9_]+)\/status\/\d+/);
	return match ? `@${match[1]}` : null;
}

/** Guard #1 (design §2.3): read before composing, unconditionally. Switches if needed. */
async function ensureActiveAccount(account: AccountRecord): Promise<void> {
	assertValidHandle(account.handle);
	let session = await readSession();
	if (handleMatches(session.activeHandle, account.handle)) return;
	if (!session.otherHandles.includes(`@${account.handle}`)) {
		throw new Error(
			`X account @${account.handle} has no live session (active: ${session.activeHandle ?? 'none'}).`,
		);
	}
	session = await switchAccount(account.handle);
	if (!handleMatches(session.activeHandle, account.handle)) {
		throw new Error(`Failed to switch X to @${account.handle}; still on ${session.activeHandle ?? 'none'}.`);
	}
}

async function compose(account: AccountRecord, post: PostRecord) {
	// Guard #1 — nothing below runs, no compose script and no click, unless this passes.
	await ensureActiveAccount(account);

	// Type first, then guard #2 — checked again, immediately before clickPostAndConfirm()
	// (the irreversible click) is ever called.
	const typed = await typeComposer(post.body);
	if (!sameText(typed.editorText, post.body)) {
		throw new Error(
			`X composer text does not match the intended post body after typing (read back ${JSON.stringify(
				(typed.editorText ?? '').slice(0, 80),
			)}).`,
		);
	}
	if (!handleMatches(typed.activeHandle, account.handle)) {
		throw new Error(
			`Wrong X account immediately before posting: expected @${account.handle}, got ${typed.activeHandle ?? 'none'}.`,
		);
	}

	const toast = await clickPostAndConfirm();
	if (!toast || !toast.href) {
		throw new Error('X did not confirm the post was submitted (no toast).');
	}

	// Guard #3 (design §2.3/§2.5): the toast's own permalink names the account that
	// actually posted — confirmed from the server's URL, not just the UI.
	const postedHandle = extractHandleFromPermalink(toast.href);
	if (!handleMatches(postedHandle, account.handle)) {
		throw new Error(
			`X posted under the wrong account: expected @${account.handle}, permalink says ${postedHandle ?? 'unknown'} (${toast.href}). Investigate immediately.`,
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
