import { runEgo } from '../lib/ego';
import { resolve } from 'node:path';
import type { AccountRecord, PostRecord } from '../types';
import type { EgoPlatformModule, ProgressReporter, SessionStatusResult } from './types';

/**
 * WhatsApp Status posting over ego-browser, driven by docs/whatsapp-posting-recon.md.
 *
 * Two things make this simpler than X and LinkedIn, and one makes it stricter.
 *
 * Simpler: there is no identity to get wrong. One session, one account, no switcher and no
 * company-vs-personal choice — so the whole "published under the wrong brand" class of bug does
 * not exist and there is no author guard to run. And a Status has no permalink, so post_url stays
 * empty; that is correct, not a gap.
 *
 * Stricter: a Status expires after 24h and is not editable, and the only path that has ever been
 * exercised is image + caption. A text-only status uses a completely different, unmapped composer,
 * so it is refused rather than guessed at.
 */

export const WHATSAPP_TASK_SPACE = 'social-autopilot-whatsapp';

const WEB_URL = 'https://web.whatsapp.com/';
const OPEN_TIMEOUT_S = 60; // WhatsApp Web is slow to boot and decrypt
const READY_POLL_ATTEMPTS = 25;
const MEDIA_POLL_ATTEMPTS = 30;
const SEND_POLL_ATTEMPTS = 25;

/** The one identity this session can post as. WhatsApp exposes no handle to read back. */
const SELF = 'self';

// --- Browser-side snippets ---------------------------------------------------------------
//
// Every probe below is deliberately narrow. The Status tab lists contacts' names and their status
// previews (recon trap #4), so a broad query would pull private data into worker logs. Nothing
// here reads `[data-testid="status-row-cell"]` or any chat list content.

const READ_LOGIN_SNIPPET = `(() => {
	var qr = document.querySelector('canvas[aria-label*="scan"], [data-testid="qrcode"]');
	var chats = document.querySelector('button[aria-label="Chats"]');
	// WhatsApp Web permits exactly ONE live tab. A second one is parked on a "this is open in
	// another window" screen that has neither chats nor a QR code, so without this flag it reads as
	// a plain dead session and the poll below just spins out. Matched on body text rather than a
	// selector: this screen has never been through recon, and a guessed selector that silently
	// misses is exactly the failure mode being fixed here.
	var conflict = !chats && !qr && /open in another window|Use here|open in another tab/i.test(document.body.innerText);
	return { loggedIn: Boolean(chats) && !qr, qr: Boolean(qr), conflict: conflict };
})()`;

/** Composer readiness: the caption box and the send control, nothing else. */
const READ_COMPOSER_SNIPPET = `(() => {
	var caption = document.querySelector('[data-testid="media-caption-input-container"]');
	var send = document.querySelector('[aria-label^="Send "]');
	return {
		captionPresent: Boolean(caption),
		captionText: caption ? caption.innerText : null,
		sendPresent: Boolean(send),
		// recon trap #1: Send is a <div>, so .disabled is always undefined — aria-disabled is
		// the only attribute that reflects the real state.
		sendEnabled: send ? send.getAttribute('aria-disabled') === 'false' : false,
		sendLabel: send ? send.getAttribute('aria-label') : null,
	};
})()`;

/**
 * The STATUS file input specifically.
 *
 * WhatsApp Web also keeps a generic chat-attachment input mounted (`accept="*"`), and a bare
 * `input[type="file"]` query can return that one instead — which is what happened live: the
 * upload went to the wrong input, silently did nothing, and the run failed much later with a
 * misleading "composer did not open". The status input declares image/video types, so match on
 * that rather than on position.
 */
const READ_FILE_INPUT_SNIPPET = `(() => {
	var inputs = document.querySelectorAll('input[type="file"]');
	for (var i = 0; i < inputs.length; i++) {
		var a = inputs[i].accept || '';
		if (a.indexOf('image/') !== -1) {
			inputs[i].setAttribute('data-ego-status-input', '1');
			return { present: true, accept: a };
		}
	}
	return { present: false, accept: null };
})()`;

/** Whether our own just-posted status is actually viewable — the real publish confirmation. */
const READ_MY_STATUS_SNIPPET = `(() => {
	var player = document.querySelector('[data-testid="status-player-uie"]');
	var img = document.querySelector('[data-testid="status-image"], [data-testid="status-image-thumbnail"]');
	return {
		playerOpen: Boolean(player),
		imagePresent: Boolean(img),
		text: document.body.innerText.slice(0, 4000),
	};
})()`;

// --- Script builders ----------------------------------------------------------------------

function taskSpace() {
	return `await useOrCreateTaskSpace(${JSON.stringify(WHATSAPP_TASK_SPACE)});`;
}

/**
 * Leaves at most one WhatsApp tab open before we touch it.
 *
 * WhatsApp Web allows a single live tab per browser: open a second and one of them is demoted to
 * an "open in another window" screen where clicks land on nothing. openOrReuseTab reuses A tab,
 * not necessarily the live one, so duplicates have to go first.
 *
 * ponytail: only closes duplicates inside our own task space — that is the whole blast radius we
 * own. A WhatsApp tab in the operator's own ego-browser window is still a conflict, and it is
 * reported (login.conflict) rather than closed behind their back.
 */
function dedupeTabsScript() {
	return `const _tabs = await listTabs();
	const _wa = _tabs.filter((t) => String(t.url || '').indexOf('web.whatsapp.com') !== -1);
	for (let i = 1; i < _wa.length; i++) await closeTab(_wa[i]);`;
}

function sessionReadScript() {
	return `(async () => {
	${taskSpace()}
	${dedupeTabsScript()}
	await openOrReuseTab(${JSON.stringify(WEB_URL)}, { wait: true, timeout: ${OPEN_TIMEOUT_S} });
	let state = { loggedIn: false, qr: false, conflict: false };
	for (let i = 0; i < ${READY_POLL_ATTEMPTS}; i++) {
		await wait(1);
		state = await js(${JSON.stringify(READ_LOGIN_SNIPPET)});
		if (state.loggedIn || state.qr || state.conflict) break;
	}
	cliLog(JSON.stringify(state));
})();`;
}

/**
 * Opens the image-status composer and attaches the media.
 *
 * Three clicks in sequence, because the file input does not exist until "Photos & videos" is
 * chosen (recon trap #2) — querying for it earlier returns nothing and reads as "no upload path".
 */
function openComposerScript(path: string) {
	return `(async () => {
	${taskSpace()}
	// openOrReuseTab, NOT gotoAndWait. WhatsApp Web is a long-lived SPA: a full reload takes it
	// through a slow boot during which clicks are accepted by the DOM but do nothing, which showed
	// up as "stuck at: status tab" — the Status click silently lost, then 25s of polling for a
	// panel that was never going to open. Reusing the warm tab is both faster and reliable.
	${dedupeTabsScript()}
	await openOrReuseTab(${JSON.stringify(WEB_URL)}, { wait: true, timeout: ${OPEN_TIMEOUT_S} });
	await pressKey('Escape');
	let login = { loggedIn: false, qr: false, conflict: false };
	for (let i = 0; i < ${READY_POLL_ATTEMPTS}; i++) {
		await wait(1);
		login = await js(${JSON.stringify(READ_LOGIN_SNIPPET)});
		if (login.loggedIn || login.qr || login.conflict) break;
	}
	if (!login.loggedIn) { cliLog(JSON.stringify({ login: login, opened: false })); return; }

	// Each panel is clicked only once its own control has actually appeared. Fixed waits failed
	// live: 2s after opening Status was not enough for "Add Status" to mount, and the run died
	// on a selector that was in fact perfectly correct.
	const waitFor = async (selector) => {
		for (let i = 0; i < ${Math.ceil(READY_POLL_ATTEMPTS / 2)}; i++) {
			if (await js('Boolean(document.querySelector(' + JSON.stringify(selector) + '))')) return true;
			await wait(1);
		}
		return false;
	};

	// Click, then confirm the next panel actually appeared; retry the click once if it didn't.
	// A lost first click is the observed failure mode here, not a wrong selector.
	const clickUntil = async (target, expect, label) => {
		for (let attempt = 0; attempt < 2; attempt++) {
			await click(target, { label: label });
			if (await waitFor(expect)) return true;
		}
		return false;
	};

	if (!await clickUntil('button[aria-label="Status"]', 'button[aria-label="Add Status"]', 'open whatsapp status')) {
		cliLog(JSON.stringify({ login: login, opened: false, stuckAt: 'status tab' })); return;
	}
	if (!await clickUntil('button[aria-label="Add Status"]', 'button[aria-label="Photos & videos"]', 'add status')) {
		cliLog(JSON.stringify({ login: login, opened: false, stuckAt: 'add status menu' })); return;
	}
	await click('button[aria-label="Photos & videos"]', { label: 'choose photo status' });

	let file = { present: false, accept: null };
	for (let i = 0; i < ${MEDIA_POLL_ATTEMPTS}; i++) {
		file = await js(${JSON.stringify(READ_FILE_INPUT_SNIPPET)});
		if (file.present) break;
		await wait(1);
	}
	if (!file.present) { cliLog(JSON.stringify({ login: login, opened: false, fileInput: false })); return; }

	await uploadFile('[data-ego-status-input="1"]', ${JSON.stringify(path)});
	let composer = { captionPresent: false };
	for (let i = 0; i < ${MEDIA_POLL_ATTEMPTS}; i++) {
		await wait(1);
		composer = await js(${JSON.stringify(READ_COMPOSER_SNIPPET)});
		if (composer.captionPresent) break;
	}
	cliLog(JSON.stringify({ login: login, opened: composer.captionPresent, composer: composer }));
})();`;
}

/** Types the caption into the contenteditable and reads it back. */
function typeCaptionScript(caption: string) {
	return `(async () => {
	${taskSpace()}
	await click('[data-testid="media-caption-input-container"]', { label: 'focus whatsapp caption' });
	await typeText(${JSON.stringify(caption)});
	await wait(2);
	cliLog(JSON.stringify(await js(${JSON.stringify(READ_COMPOSER_SNIPPET)})));
})();`;
}

/**
 * Sends the status.
 *
 * Matches on the `Send ` prefix rather than the literal "Send 1 selected" — the label encodes the
 * attachment count (recon trap #3), so the exact string only holds for a single image.
 */
function sendScript() {
	return `(async () => {
	${taskSpace()}
	await wait(2);
	await click('[aria-label^="Send "]', { label: 'publish whatsapp status' });
	let composer = { captionPresent: true, sendPresent: true };
	for (let i = 0; i < ${SEND_POLL_ATTEMPTS}; i++) {
		await wait(1);
		composer = await js(${JSON.stringify(READ_COMPOSER_SNIPPET)});
		if (!composer.captionPresent && !composer.sendPresent) break;
	}
	cliLog(JSON.stringify({ composerClosed: !composer.captionPresent && !composer.sendPresent, composer: composer }));
})();`;
}

/**
 * Reads our own status back to prove it actually published.
 *
 * A closed composer is not proof — verified live, and the `my-status` LIST ROW is not proof
 * either: after a successful post it still reads plain "My status" with no thumbnail and no
 * child elements, which looks exactly like having posted nothing. Opening it is what shows the
 * truth — the status player mounts `status-image` and renders the caption.
 */
function confirmPublishedScript(caption: string) {
	return `(async () => {
	${taskSpace()}
	await pressKey('Escape');
	await wait(1);
	await click('button[aria-label="Status"]', { label: 'reopen status' });
	for (let i = 0; i < ${READY_POLL_ATTEMPTS}; i++) {
		if (await js('Boolean(document.querySelector(\\'[data-testid="my-status"]\\'))')) break;
		await wait(1);
	}
	await click('[data-testid="my-status"]', { label: 'open my status' });
	let seen = { playerOpen: false, imagePresent: false, text: '' };
	let found = false;
	for (let i = 0; i < ${SEND_POLL_ATTEMPTS}; i++) {
		await wait(1);
		seen = await js(${JSON.stringify(READ_MY_STATUS_SNIPPET)});
		if (seen.imagePresent && seen.text.indexOf(${JSON.stringify(caption)}) !== -1) { found = true; break; }
	}
	await pressKey('Escape');
	cliLog(JSON.stringify({ found: found, imagePresent: seen.imagePresent }));
})();`;
}

// --- runEgo callers -------------------------------------------------------------------------

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

type LoginState = { loggedIn: boolean; qr: boolean; conflict?: boolean };
type ComposerState = {
	captionPresent: boolean;
	captionText: string | null;
	sendPresent: boolean;
	sendEnabled: boolean;
	sendLabel: string | null;
};

const EMPTY_COMPOSER: ComposerState = {
	captionPresent: false,
	captionText: null,
	sendPresent: false,
	sendEnabled: false,
	sendLabel: null,
};

/**
 * One identity, so this only answers "is the session alive". `SELF` is reported as the available
 * handle so sessionHasHandle() in lib/browser.ts passes for whatever label the account row uses —
 * there is no second identity it could be confused with.
 */
async function readSession(): Promise<SessionStatusResult> {
	const state = await parseFirstLine<LoginState>(sessionReadScript(), { loggedIn: false, qr: false });
	// A tab parked behind another live window still has a perfectly good session — reporting it as
	// dead here would flag the account for re-auth and send the operator to scan a QR code for a
	// problem a tab close fixes. compose() raises the accurate error instead.
	const live = state.loggedIn || state.conflict === true;
	return live ? { activeHandle: SELF, otherHandles: [] } : { activeHandle: null, otherHandles: [] };
}

async function warm(_handle: string): Promise<SessionStatusResult> {
	// ponytail: no warming. WhatsApp Web is a persistent socket to the phone, not a feed with a
	// session to keep alive by scrolling, and there is no engagement surface worth simulating.
	return readSession();
}

async function compose(account: AccountRecord, post: PostRecord, onProgress?: ProgressReporter) {
	const media = (post.media ?? []).filter(Boolean).map((p) => resolve(p));
	if (media.length === 0) {
		throw new Error(
			'WhatsApp Status requires an image: the text-only status composer is a different, unmapped flow (docs/whatsapp-posting-recon.md). Attach media or use another platform.',
		);
	}
	if (media.length > 1) {
		throw new Error(
			`WhatsApp Status posting only supports one image; this post has ${media.length}. Multi-image status is untested.`,
		);
	}

	await onProgress?.('opening whatsapp status composer');
	const opened = await parseFirstLine<{
		login: LoginState;
		opened: boolean;
		stuckAt?: string;
		fileInput?: boolean;
	}>(openComposerScript(media[0]), { login: { loggedIn: false, qr: false }, opened: false });
	if (opened.login.conflict) {
		// Deliberately NOT 'Session is not active.' — the session is fine, so flagging the account
		// for re-auth would send the operator off to scan a QR code that will not fix anything.
		throw new Error(
			'WhatsApp Web is live in another window, so this tab is inert. Close every other WhatsApp Web tab (only one can be active at a time) and retry.',
		);
	}
	if (!opened.login.loggedIn) {
		// Matches the exact string lib/worker.ts pattern-matches to flag the account for re-auth.
		throw new Error('Session is not active.');
	}
	if (!opened.opened) {
		// Name the step that failed — "did not open" alone sent debugging down the wrong path once.
		const where = opened.stuckAt ?? (opened.fileInput === false ? 'status file input' : 'caption box');
		throw new Error(`WhatsApp status composer did not open with the image attached (stuck at: ${where}).`);
	}

	await onProgress?.('typing caption');
	const typed = await parseFirstLine<ComposerState>(typeCaptionScript(post.body), EMPTY_COMPOSER);
	if ((typed.captionText ?? '').trim() !== post.body.trim()) {
		throw new Error(
			`WhatsApp caption does not match the intended post body after typing (read back ${JSON.stringify(
				(typed.captionText ?? '').slice(0, 80),
			)}).`,
		);
	}
	if (!typed.sendEnabled) {
		throw new Error(`WhatsApp send control is not enabled (label ${JSON.stringify(typed.sendLabel)}).`);
	}

	await onProgress?.('publishing status');
	const sent = await parseFirstLine<{ composerClosed: boolean; composer: ComposerState }>(sendScript(), {
		composerClosed: false,
		composer: EMPTY_COMPOSER,
	});
	if (!sent.composerClosed) {
		throw new Error('WhatsApp did not confirm the status — the composer is still open with the caption in it.');
	}

	// The composer closing is only the cue to go looking; it closes on cancel too. Open our own
	// status and require the image AND the caption to actually be there.
	await onProgress?.('confirming the status published');
	const confirmed = await parseFirstLine<{ found: boolean; imagePresent: boolean }>(
		confirmPublishedScript(post.body),
		{ found: false, imagePresent: false },
	);
	if (!confirmed.found) {
		throw new Error(
			'WhatsApp closed the composer but the status is not viewable under "My status". It may not have published — check the phone before retrying, or this will post twice.',
		);
	}

	// No postUrl: a Status has no permalink and expires after 24h (recon). `confirmed` alone
	// satisfies hasPublishEvidence() in lib/worker.ts.
	return { confirmed: true as const };
}

export const whatsappPlatform: EgoPlatformModule = {
	platform: 'whatsapp',
	loginUrl: WEB_URL,
	taskSpace: WHATSAPP_TASK_SPACE,
	// One account per session, and WhatsApp exposes no handle to compare an account label against.
	// Without this the shared pre-check in lib/browser.ts compares 'self' to whatever the row is
	// called and refuses every post before compose() runs.
	singleIdentity: true,
	readSession,
	warm,
	compose,
};
