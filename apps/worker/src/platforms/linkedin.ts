import { runEgo } from '../lib/ego';
import { resolve } from 'node:path';
import type { AccountRecord, PostRecord } from '../types';
import { normalizeHandle, type EgoPlatformModule, type ProgressReporter, type SessionStatusResult } from './types';

/**
 * LinkedIn publishing over ego-browser, driven entirely by docs/linkedin-posting-recon.md.
 *
 * The key difference from X: the author identity is fixed by the composer URL BEFORE the composer
 * exists, so there is no switcher to click and no race to poll. `accounts.company_id` selects it —
 * a page id posts as that company, empty posts as the personal profile. The guard is therefore a
 * pure read-and-verify, and it checks two independent things (the id in the URL and the name the
 * composer renders) so a page id that silently fails to take cannot pass.
 */

export const LINKEDIN_TASK_SPACE = 'social-autopilot-linkedin';

const FEED_URL = 'https://www.linkedin.com/feed/';
const PERSONAL_SHARE_URL = 'https://www.linkedin.com/preload/sharebox/';
const OPEN_TIMEOUT_S = 40;
const COMPOSER_POLL_ATTEMPTS = 20;
const MEDIA_POLL_ATTEMPTS = 30;
const CONFIRM_POLL_ATTEMPTS = 20;
const MAX_MEDIA = 20; // LinkedIn's own per-post image limit

// Company page ids are digits only. Enforced before the id is interpolated into a script string
// or a URL, so a corrupted PocketBase record can't inject browser-side JS.
const COMPANY_ID_RE = /^\d+$/;

function assertValidCompanyId(companyId: string) {
	if (companyId && !COMPANY_ID_RE.test(companyId)) {
		throw new Error(`Refusing to script a LinkedIn company id that is not numeric: ${JSON.stringify(companyId)}`);
	}
}

/** The composer URL IS the author identity (recon: verified for Kasa, TechGFX and personal). */
export function composerUrl(companyId: string) {
	assertValidCompanyId(companyId);
	return companyId
		? `https://www.linkedin.com/company/${companyId}/admin/page-posts/published/?share=true`
		: PERSONAL_SHARE_URL;
}

/** Display names are compared loosely — LinkedIn renders them as typed, we store them by hand. */
function nameMatches(rendered: string | null, expected: string) {
	if (!rendered) return false;
	return normalizeHandle(rendered).toLowerCase() === normalizeHandle(expected).toLowerCase();
}

// --- Browser-side snippets, run via js() -----------------------------------------------
//
// Self-contained on purpose (no outer-scope references) because js() takes a plain string with
// no closure or argument channel.

/**
 * Reads the composer. Scoped to `aria-labelledby="share-to-linkedin-modal__header"` and NOT to a
 * bare `[role="dialog"]` — recon trap #1: LinkedIn keeps other dialogs mounted (parking on /feed/
 * leaves a messaging overlay whose text is just "This is a modal window."), so an unscoped match
 * reads the wrong element and could pass an author check by accident.
 */
const READ_COMPOSER_SNIPPET = `(() => {
	const dlg = document.querySelector('[role="dialog"][aria-labelledby="share-to-linkedin-modal__header"]');
	if (!dlg) return { open: false, author: null, editorText: null, postDisabled: null, media: 0, url: location.href };
	const idBtn = dlg.querySelector('.share-unified-settings-entry-button');
	const editor = dlg.querySelector('[role="textbox"]');
	const post = dlg.querySelector('.share-actions__primary-action');
	return {
		open: true,
		author: idBtn ? (idBtn.innerText || '').split('\\n')[0].trim() : null,
		editorText: editor ? editor.innerText : null,
		postDisabled: post ? Boolean(post.disabled) : null,
		media: dlg.querySelectorAll('img[src^="data:"], img[src^="blob:"]').length,
		url: location.href,
	};
})()`;

/** Session inventory: logged-in state plus every identity this login can publish as. */
const READ_SESSION_SNIPPET = `(() => {
	if (/\\/(login|uas|checkpoint)/.test(location.pathname)) return { loggedIn: false, personal: null, pages: [] };
	if (!document.querySelector('[data-testid="primary-nav"]')) return { loggedIn: false, personal: null, pages: [] };
	const pages = [];
	document.querySelectorAll('a[href*="/company/"]').forEach((a) => {
		const href = a.getAttribute('href') || '';
		const text = (a.innerText || '').trim();
		const m = href.match(/\\/company\\/(\\d+)\\/admin/);
		if (m && text && !/^Activity/.test(text)) pages.push({ id: m[1], name: text.split('\\n')[0].trim() });
	});
	const profile = document.querySelector('a[href*="/in/"]');
	return {
		loggedIn: true,
		personal: profile ? (profile.getAttribute('href') || '').replace(/.*\\/in\\//, '').replace(/\\/$/, '') : null,
		pages: pages,
	};
})()`;

/** Media sub-dialog state. The file input only exists once "Add media" has been clicked. */
const READ_MEDIA_SNIPPET = `(() => {
	const inputs = document.querySelectorAll('input[type="file"]');
	const selected = document.querySelectorAll('button[aria-label^="Select "]');
	return {
		fileInput: inputs.length > 0,
		selectedNames: Array.prototype.map.call(selected, function (b) { return b.getAttribute('aria-label').replace(/^Select /, ''); }),
	};
})()`;

// --- Node-side script builders ----------------------------------------------------------

function taskSpace() {
	return `await useOrCreateTaskSpace(${JSON.stringify(LINKEDIN_TASK_SPACE)});`;
}

function sessionReadScript() {
	return `(async () => {
	${taskSpace()}
	await openOrReuseTab(${JSON.stringify(FEED_URL)}, { wait: true, timeout: ${OPEN_TIMEOUT_S} });
	await wait(3);
	cliLog(JSON.stringify(await js(${JSON.stringify(READ_SESSION_SNIPPET)})));
})();`;
}

function warmScript() {
	return `(async () => {
	${taskSpace()}
	await openOrReuseTab(${JSON.stringify(FEED_URL)}, { wait: true, timeout: ${OPEN_TIMEOUT_S} });
	await wait(2);
	await scrollBy(600);
	await wait(2);
	cliLog(JSON.stringify(await js(${JSON.stringify(READ_SESSION_SNIPPET)})));
})();`;
}

/**
 * Navigates to the identity's composer URL and waits for the modal. gotoAndWait, not
 * openOrReuseTab: the URL is what selects the author, so this must be a real navigation.
 */
function openComposerScript(companyId: string) {
	return `(async () => {
	${taskSpace()}
	await gotoAndWait(${JSON.stringify(composerUrl(companyId))}, { timeout: ${OPEN_TIMEOUT_S} });
	let state = { open: false };
	for (let i = 0; i < ${COMPOSER_POLL_ATTEMPTS}; i++) {
		await wait(1);
		state = await js(${JSON.stringify(READ_COMPOSER_SNIPPET)});
		if (state.open) break;
	}
	cliLog(JSON.stringify(state));
})();`;
}

/**
 * Types the body. No clear-first step: recon confirmed re-opening ?share=true yields an empty
 * composer, unlike X where a stale draft persists and typeText would splice into it.
 */
function typeComposerScript(body: string) {
	return `(async () => {
	${taskSpace()}
	await click('[role="dialog"][aria-labelledby="share-to-linkedin-modal__header"] [role="textbox"]', { label: 'focus linkedin editor' });
	await typeText(${JSON.stringify(body)});
	await wait(2);
	cliLog(JSON.stringify(await js(${JSON.stringify(READ_COMPOSER_SNIPPET)})));
})();`;
}

/**
 * Two-step media flow (recon trap #3): "Add media" opens a sub-dialog and only then does the
 * file input exist; after uploading, "Next" returns to the composer with the image attached.
 */
function attachMediaScript(paths: readonly string[]) {
	const uploads = paths
		.map((p) => `await uploadFile('input[type="file"]', ${JSON.stringify(p)});\n\tawait wait(2);`)
		.join('\n\t');
	return `(async () => {
	${taskSpace()}
	await click('[aria-label="Add media"]', { label: 'open linkedin media picker' });
	await wait(3);
	${uploads}
	let media = { fileInput: false, selectedNames: [] };
	for (let i = 0; i < ${MEDIA_POLL_ATTEMPTS}; i++) {
		media = await js(${JSON.stringify(READ_MEDIA_SNIPPET)});
		if (media.selectedNames.length >= ${paths.length}) break;
		await wait(1);
	}
	const tagged = await js("(() => { const d = document.querySelector('[role=\\"dialog\\"]'); if (!d) return false; const b = Array.prototype.find.call(d.querySelectorAll('button'), function (x) { return (x.innerText || '').trim() === 'Next'; }); if (!b) return false; b.setAttribute('data-ego-next', '1'); return true; })()");
	if (tagged) { await click('[data-ego-next="1"]', { label: 'confirm linkedin media' }); await wait(4); }
	const composer = await js(${JSON.stringify(READ_COMPOSER_SNIPPET)});
	cliLog(JSON.stringify({ selectedNames: media.selectedNames, nextClicked: tagged, composer: composer }));
})();`;
}

/**
 * Clicks Post and waits for the composer to close.
 *
 * UNVERIFIED against a real publish. The previous Playwright implementation noted "LinkedIn gives
 * no reliable post URL after composing", and recon stopped short of publishing, so the composer
 * closing is treated as the confirmation and no permalink is claimed. If a permalink turns out to
 * be reachable, capture it here rather than inventing one — an unverified URL in posts.post_url is
 * worse than an empty one.
 */
function clickPostScript() {
	return `(async () => {
	${taskSpace()}
	await wait(2);
	await click('[role="dialog"][aria-labelledby="share-to-linkedin-modal__header"] .share-actions__primary-action', { label: 'publish linkedin post' });
	let state = { open: true };
	for (let i = 0; i < ${CONFIRM_POLL_ATTEMPTS}; i++) {
		await wait(1);
		state = await js(${JSON.stringify(READ_COMPOSER_SNIPPET)});
		if (!state.open) break;
	}
	cliLog(JSON.stringify({ composerClosed: !state.open, state: state }));
})();`;
}

// --- runEgo callers ----------------------------------------------------------------------

async function parseFirstLine<T>(script: string, fallback: T): Promise<T> {
	// The first JSON line, not simply the first: runEgo merges stdout and stderr (cliLog writes to
	// stderr), so unrelated CLI diagnostics can precede our payload.
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

type RawSession = { loggedIn: boolean; personal: string | null; pages: { id: string; name: string }[] };
type ComposerState = {
	open: boolean;
	author: string | null;
	editorText: string | null;
	postDisabled: boolean | null;
	media: number;
	url: string;
};

const EMPTY_SESSION: RawSession = { loggedIn: false, personal: null, pages: [] };

/**
 * Every identity this login can publish as. There is no single "active" identity on LinkedIn —
 * it is chosen per post by URL — so activeHandle stays null and everything lands in otherHandles.
 */
function toSessionStatus(raw: RawSession): SessionStatusResult {
	if (!raw.loggedIn) return { activeHandle: null, otherHandles: [] };
	const names = raw.pages.map((p) => p.name);
	if (raw.personal) names.push(raw.personal);
	return { activeHandle: null, otherHandles: names };
}

async function readSession(): Promise<SessionStatusResult> {
	return toSessionStatus(await parseFirstLine<RawSession>(sessionReadScript(), EMPTY_SESSION));
}

async function warm(_handle: string): Promise<SessionStatusResult> {
	// No switching: LinkedIn has one session and picks the identity per post, so warming is just
	// looking human on the feed. The handle is accepted for interface parity with X.
	return toSessionStatus(await parseFirstLine<RawSession>(warmScript(), EMPTY_SESSION));
}

const EMPTY_COMPOSER: ComposerState = {
	open: false,
	author: null,
	editorText: null,
	postDisabled: null,
	media: 0,
	url: '',
};

/** Guard: the composer must be open, as the right identity, by BOTH url id and rendered name. */
function assertIdentity(state: ComposerState, account: AccountRecord, when: string) {
	if (!state.open) throw new Error(`LinkedIn composer is not open (${when}).`);
	const companyId = account.company_id ?? '';
	if (companyId && !state.url.includes(`/company/${companyId}/`)) {
		throw new Error(
			`LinkedIn composer is not on company ${companyId} (${when}); url is ${state.url}. Refusing to post.`,
		);
	}
	if (!nameMatches(state.author, account.handle)) {
		throw new Error(
			`Wrong LinkedIn author ${when}: expected ${JSON.stringify(account.handle)}, composer shows ${JSON.stringify(state.author)}. Refusing to post.`,
		);
	}
}

async function compose(account: AccountRecord, post: PostRecord, onProgress?: ProgressReporter) {
	const companyId = account.company_id ?? '';
	assertValidCompanyId(companyId);

	await onProgress?.(companyId ? `opening composer as company ${companyId}` : 'opening personal composer');
	let state = await parseFirstLine<ComposerState>(openComposerScript(companyId), EMPTY_COMPOSER);
	// Guard #1 — before a single keystroke.
	assertIdentity(state, account, 'when the composer opened');

	await onProgress?.('typing post text');
	state = await parseFirstLine<ComposerState>(typeComposerScript(post.body), EMPTY_COMPOSER);
	if ((state.editorText ?? '').trim() !== post.body.trim()) {
		throw new Error(
			`LinkedIn composer text does not match the intended post body after typing (read back ${JSON.stringify(
				(state.editorText ?? '').slice(0, 80),
			)}).`,
		);
	}

	const media = (post.media ?? []).filter(Boolean).map((p) => resolve(p));
	if (media.length > MAX_MEDIA) {
		throw new Error(`LinkedIn accepts at most ${MAX_MEDIA} images per post; this post has ${media.length}.`);
	}
	if (media.length) {
		await onProgress?.(`uploading ${media.length} image${media.length > 1 ? 's' : ''}`);
		const result = await parseFirstLine<{
			selectedNames: string[];
			nextClicked: boolean;
			composer: ComposerState;
		}>(attachMediaScript(media), { selectedNames: [], nextClicked: false, composer: EMPTY_COMPOSER });
		if (result.selectedNames.length < media.length) {
			throw new Error(
				`LinkedIn did not accept all media (${result.selectedNames.length}/${media.length}). Not posting a draft that is missing its image.`,
			);
		}
		if (!result.nextClicked || result.composer.media < 1) {
			throw new Error('LinkedIn media was uploaded but never attached to the composer (the Next step failed).');
		}
		state = result.composer;
	}

	// Guard #2 — a fresh read immediately before the irreversible click. Media upload can take
	// tens of seconds, so the identity is re-confirmed rather than trusted from before it.
	await onProgress?.('publishing');
	assertIdentity(state, account, 'immediately before posting');

	const outcome = await parseFirstLine<{ composerClosed: boolean; state: ComposerState }>(clickPostScript(), {
		composerClosed: false,
		state: EMPTY_COMPOSER,
	});
	if (!outcome.composerClosed) {
		throw new Error('LinkedIn did not confirm the post — the composer is still open with the draft in it.');
	}

	// No postUrl: LinkedIn exposes no permalink at compose time (see clickPostScript). `confirmed`
	// alone satisfies hasPublishEvidence() in lib/worker.ts.
	return { confirmed: true as const };
}

export const linkedinPlatform: EgoPlatformModule = {
	platform: 'linkedin',
	loginUrl: 'https://www.linkedin.com/login',
	taskSpace: LINKEDIN_TASK_SPACE,
	readSession,
	warm,
	compose,
};

// --- Exported for tests -------------------------------------------------------------------

export { toSessionStatus, assertIdentity, nameMatches };
export type { ComposerState, RawSession };
