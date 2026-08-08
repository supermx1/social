import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AccountRecord, PostRecord } from '../types';
import type { MinimalDocument, MinimalElement } from '../platforms/x';

const runEgo = vi.fn<(script: string) => Promise<string[]>>();

vi.mock('../lib/ego', () => ({
	runEgo: (...args: [string]) => runEgo(...args),
	ensureBrowser: vi.fn(async () => {}),
}));

const { xPlatform, readXSessionInPage } = await import('../platforms/x');

function line(value: unknown): string[] {
	return [JSON.stringify(value)];
}

const account = { id: 'acc1', handle: 'TheAvgTechDad', platform: 'x' } as unknown as AccountRecord;
const post = { id: 'post1', body: 'hello from the guard test' } as unknown as PostRecord;

describe('X compose — the account guard (design doc §2.3)', () => {
	beforeEach(() => {
		runEgo.mockReset();
	});

	it('throws before any compose or click when the target handle has no live session at all', async () => {
		runEgo.mockResolvedValueOnce(line({ activeHandle: '@someoneElse', otherHandles: [] }));

		await expect(xPlatform.compose(account, post)).rejects.toThrow(/no live session/);
		expect(runEgo).toHaveBeenCalledTimes(1); // session read only — never the type/click scripts
	});

	it('throws before any compose or click when a switch is attempted but never lands', async () => {
		runEgo
			.mockResolvedValueOnce(line({ activeHandle: '@someoneElse', otherHandles: ['@TheAvgTechDad'] }))
			.mockResolvedValueOnce(line({ activeHandle: '@stillWrong', otherHandles: [] }));

		await expect(xPlatform.compose(account, post)).rejects.toThrow(/failed to switch/i);
		expect(runEgo).toHaveBeenCalledTimes(2); // session read + switch attempt — no type/click
	});

	it('throws immediately before the click when the handle drifts after typing', async () => {
		runEgo
			.mockResolvedValueOnce(line({ activeHandle: '@TheAvgTechDad', otherHandles: [] }))
			.mockResolvedValueOnce(line({ activeHandle: '@TheAvgTechDad', editorText: post.body }))
			.mockResolvedValueOnce(line({ activeHandle: '@drifted', otherHandles: [] })); // guard #2 fresh read

		await expect(xPlatform.compose(account, post)).rejects.toThrow(/wrong x account immediately before posting/i);
		expect(runEgo).toHaveBeenCalledTimes(3); // session read + type + guard #2 — click never runs
	});

	it('throws when the toast permalink names a different account than the one we posted as', async () => {
		runEgo
			.mockResolvedValueOnce(line({ activeHandle: '@TheAvgTechDad', otherHandles: [] }))
			.mockResolvedValueOnce(line({ activeHandle: '@TheAvgTechDad', editorText: post.body }))
			.mockResolvedValueOnce(line({ activeHandle: '@TheAvgTechDad', otherHandles: [] })) // guard #2 fresh read
			.mockResolvedValueOnce(
				line({ toast: { text: 'Your post was sent. | View', href: 'https://x.com/wrongHandle/status/999' }, composerEmpty: true }),
			);

		await expect(xPlatform.compose(account, post)).rejects.toThrow(/posted under the wrong account/i);
		expect(runEgo).toHaveBeenCalledTimes(4);
	});

	it('confirms and returns the permalink when every guard passes', async () => {
		runEgo
			.mockResolvedValueOnce(line({ activeHandle: '@TheAvgTechDad', otherHandles: [] }))
			.mockResolvedValueOnce(line({ activeHandle: '@TheAvgTechDad', editorText: post.body }))
			.mockResolvedValueOnce(line({ activeHandle: '@TheAvgTechDad', otherHandles: [] })) // guard #2 fresh read
			.mockResolvedValueOnce(
				line({
					toast: { text: 'Your post was sent. | View', href: 'https://x.com/TheAvgTechDad/status/2086129413763006973' },
					composerEmpty: true,
				}),
			);

		await expect(xPlatform.compose(account, post)).resolves.toEqual({
			confirmed: true,
			postUrl: 'https://x.com/TheAvgTechDad/status/2086129413763006973',
		});
		expect(runEgo).toHaveBeenCalledTimes(4);
	});

	// The readback check exists to catch keystrokes landing outside the editor (recon trap), not to
	// police whitespace. X's rich editor normalizes line endings and trailing spaces, and only a
	// single-line post was ever verified live — exact equality would reject real multi-line posts.
	it('accepts a multi-line body whose readback differs only in trailing whitespace', async () => {
		const multiline = { id: 'post2', body: 'first line\n\nthird line' } as unknown as PostRecord;
		runEgo
			.mockResolvedValueOnce(line({ activeHandle: '@TheAvgTechDad', otherHandles: [] }))
			.mockResolvedValueOnce(
				line({ activeHandle: '@TheAvgTechDad', editorText: 'first line  \r\n\r\nthird line\n' }),
			)
			.mockResolvedValueOnce(line({ activeHandle: '@TheAvgTechDad', otherHandles: [] })) // guard #2 fresh read
			.mockResolvedValueOnce(
				line({ toast: { text: 'Your post was sent. | View', href: 'https://x.com/TheAvgTechDad/status/123' }, composerEmpty: true }),
			);

		await expect(xPlatform.compose(account, multiline)).resolves.toEqual({
			confirmed: true,
			postUrl: 'https://x.com/TheAvgTechDad/status/123',
		});
	});

	it('still rejects a readback that is genuinely different text', async () => {
		runEgo
			.mockResolvedValueOnce(line({ activeHandle: '@TheAvgTechDad', otherHandles: [] }))
			.mockResolvedValueOnce(line({ activeHandle: '@TheAvgTechDad', editorText: '' }));

		await expect(xPlatform.compose(account, post)).rejects.toThrow(/does not match the intended post body/);
		expect(runEgo).toHaveBeenCalledTimes(2); // click script never runs
	});

	it('switches accounts first when the target is logged in but not active, then posts', async () => {
		runEgo
			.mockResolvedValueOnce(line({ activeHandle: '@super__mx', otherHandles: ['@TheAvgTechDad'] }))
			.mockResolvedValueOnce(line({ activeHandle: '@TheAvgTechDad', otherHandles: ['@super__mx'] }))
			.mockResolvedValueOnce(line({ activeHandle: '@TheAvgTechDad', editorText: post.body }))
			.mockResolvedValueOnce(line({ activeHandle: '@TheAvgTechDad', otherHandles: [] })) // guard #2 fresh read
			.mockResolvedValueOnce(
				line({ toast: { text: 'Your post was sent. | View', href: 'https://x.com/TheAvgTechDad/status/1' }, composerEmpty: true }),
			);

		await expect(xPlatform.compose(account, post)).resolves.toEqual({
			confirmed: true,
			postUrl: 'https://x.com/TheAvgTechDad/status/1',
		});
		// session read + switch + type + guard #2 + click
		expect(runEgo).toHaveBeenCalledTimes(5);
	});

	// Media upload can take tens of seconds, so guard #2 must be a fresh read taken AFTER it —
	// not the handle captured before the upload started.
	it('attaches media before posting and re-checks the handle after the upload', async () => {
		const withImage = {
			id: 'post3',
			body: 'a post with a picture',
			media: ['/tmp/one.png'],
		} as unknown as PostRecord;
		runEgo
			.mockResolvedValueOnce(line({ activeHandle: '@TheAvgTechDad', otherHandles: [] }))
			.mockResolvedValueOnce(line({ activeHandle: '@TheAvgTechDad', editorText: withImage.body }))
			.mockResolvedValueOnce(line({ ready: 1, uploading: false })) // attachMedia
			.mockResolvedValueOnce(line({ activeHandle: '@TheAvgTechDad', otherHandles: [] })) // guard #2
			.mockResolvedValueOnce(
				line({ toast: { text: 'Your post was sent. | View', href: 'https://x.com/TheAvgTechDad/status/7' }, composerEmpty: true }),
			);

		await expect(xPlatform.compose(account, withImage)).resolves.toEqual({
			confirmed: true,
			postUrl: 'https://x.com/TheAvgTechDad/status/7',
		});
		expect(runEgo).toHaveBeenCalledTimes(5);
		expect(runEgo.mock.calls[2][0]).toContain('uploadFile');
	});

	it('refuses to post when the image never finishes uploading', async () => {
		const withImage = {
			id: 'post4',
			body: 'a post with a picture',
			media: ['/tmp/one.png'],
		} as unknown as PostRecord;
		runEgo
			.mockResolvedValueOnce(line({ activeHandle: '@TheAvgTechDad', otherHandles: [] }))
			.mockResolvedValueOnce(line({ activeHandle: '@TheAvgTechDad', editorText: withImage.body }))
			.mockResolvedValueOnce(line({ ready: 0, uploading: true }));

		await expect(xPlatform.compose(account, withImage)).rejects.toThrow(/did not finish attaching media/);
		expect(runEgo).toHaveBeenCalledTimes(3); // click script never runs
	});

	// onProgress is what the Activity/Queue UI shows while a multi-step publish is in flight
	// (a post with media can take 20-30s of real time) — regressions here are invisible in the
	// final result, only in what the operator sees change during the run.
	it('reports progress phases in order, including the switch and the media upload', async () => {
		const withImage = { id: 'post5', body: 'switch and upload', media: ['/tmp/one.png'] } as unknown as PostRecord;
		runEgo
			.mockResolvedValueOnce(line({ activeHandle: '@super__mx', otherHandles: ['@TheAvgTechDad'] })) // ensureActiveAccount read
			.mockResolvedValueOnce(line({ activeHandle: '@TheAvgTechDad', otherHandles: ['@super__mx'] })) // switch
			.mockResolvedValueOnce(line({ activeHandle: '@TheAvgTechDad', editorText: withImage.body })) // type
			.mockResolvedValueOnce(line({ ready: 1, uploading: false })) // attachMedia
			.mockResolvedValueOnce(line({ activeHandle: '@TheAvgTechDad', otherHandles: [] })) // guard #2
			.mockResolvedValueOnce(
				line({ toast: { text: 'Your post was sent. | View', href: 'https://x.com/TheAvgTechDad/status/9' }, composerEmpty: true }),
			);

		const seen: string[] = [];
		await xPlatform.compose(account, withImage, (detail) => {
			seen.push(detail);
		});

		expect(seen).toEqual([
			'checking account session',
			'switching to @TheAvgTechDad',
			'typing post text',
			'uploading 1 image',
			'publishing',
		]);
	});

	it('does not report a switch when the target account is already active', async () => {
		runEgo
			.mockResolvedValueOnce(line({ activeHandle: '@TheAvgTechDad', otherHandles: [] }))
			.mockResolvedValueOnce(line({ activeHandle: '@TheAvgTechDad', editorText: post.body }))
			.mockResolvedValueOnce(line({ activeHandle: '@TheAvgTechDad', otherHandles: [] }))
			.mockResolvedValueOnce(
				line({ toast: { text: 'Your post was sent. | View', href: 'https://x.com/TheAvgTechDad/status/9' }, composerEmpty: true }),
			);

		const seen: string[] = [];
		await xPlatform.compose(account, post, (detail) => {
			seen.push(detail);
		});

		expect(seen).toEqual(['checking account session', 'typing post text', 'publishing']);
	});
});

describe('X warm — targets the requested account, not whatever is active (real bug fixed 2026-08-08)', () => {
	beforeEach(() => {
		runEgo.mockReset();
	});

	it('switches to the requested handle before scrolling, when a different account is active', async () => {
		runEgo
			.mockResolvedValueOnce(line({ activeHandle: '@super__mx', otherHandles: ['@TheAvgTechDad'] })) // readSession
			.mockResolvedValueOnce(line({ activeHandle: '@TheAvgTechDad', otherHandles: ['@super__mx'] })) // switchAccount
			.mockResolvedValueOnce(line({ activeHandle: '@TheAvgTechDad', otherHandles: [] })); // scroll + reread

		const result = await xPlatform.warm('TheAvgTechDad');

		expect(result.activeHandle).toBe('@TheAvgTechDad');
		expect(runEgo).toHaveBeenCalledTimes(3);
		expect(runEgo.mock.calls[1][0]).toContain('switch x account');
		expect(runEgo.mock.calls[2][0]).toContain('scrollBy');
	});

	it('scrolls directly, without switching, when the requested handle is already active', async () => {
		runEgo
			.mockResolvedValueOnce(line({ activeHandle: '@TheAvgTechDad', otherHandles: [] })) // readSession
			.mockResolvedValueOnce(line({ activeHandle: '@TheAvgTechDad', otherHandles: [] })); // scroll + reread

		const result = await xPlatform.warm('TheAvgTechDad');

		expect(result.activeHandle).toBe('@TheAvgTechDad');
		expect(runEgo).toHaveBeenCalledTimes(2); // no switch script call
	});
});

// --- Fake DOM for the scoping algorithm (recon traps #1-#2) --------------------------------

function makeElement(innerText: string, cells: MinimalElement[] = []): MinimalElement {
	const el: MinimalElement = {
		innerText,
		parentElement: null,
		querySelectorAll: (selector) => (selector === 'button[data-testid="UserCell"]' ? cells : []),
	};
	return el;
}

/**
 * Builds a fake document shaped like the real one from docs/x-posting-recon.md: a sidebar
 * button carrying the active handle (no data-testid/role anywhere marks it — trap #2), a
 * switcher popup a few ancestors above AccountSwitcher_AddAccount_Button containing the
 * real UserCell rows, and a "who to follow" UserCell *outside* that popup carrying a
 * different handle (trap #1) sitting even further up the tree.
 */
function fakeDom(activeHandle: string, popupHandles: string[], strayHandle: string): MinimalDocument {
	const strayCell = makeElement(`Suggested for you\n@${strayHandle}\nFollow`);
	const popupCells = popupHandles.map((h) => makeElement(`Display Name\n@${h}`));

	const farAncestor = makeElement('', [strayCell]); // reachable only if the walk goes too far up
	const popupContainer = makeElement('', popupCells);
	popupContainer.parentElement = farAncestor;

	const addAccountAnchor = makeElement('');
	addAccountAnchor.parentElement = popupContainer;

	const activeButton = makeElement(`Display Name\n@${activeHandle}`);

	return {
		querySelector(selector: string) {
			if (selector === '[data-testid="SideNav_AccountSwitcher_Button"]') return activeButton;
			if (selector === '[data-testid="AccountSwitcher_AddAccount_Button"]') return addAccountAnchor;
			return null;
		},
	};
}

describe('X session scoping (recon traps #1-#2)', () => {
	it('reads the active handle from the sidebar button, which carries no data-testid marker of its own', () => {
		const doc = fakeDom('TheAvgTechDad', ['super__mx', 'usepowershare'], 'missowaa');
		expect(readXSessionInPage(doc).activeHandle).toBe('@TheAvgTechDad');
	});

	it('scopes UserCell rows to the switcher popup and excludes a match outside it', () => {
		const doc = fakeDom('TheAvgTechDad', ['super__mx', 'usepowershare'], 'missowaa');
		const session = readXSessionInPage(doc);
		expect(session.otherHandles).toEqual(['@super__mx', '@usepowershare']);
		expect(session.otherHandles).not.toContain('@missowaa');
	});

	it('reports a logged-out page as no active handle and no other accounts', () => {
		const doc: MinimalDocument = { querySelector: () => null };
		expect(readXSessionInPage(doc)).toEqual({ activeHandle: null, otherHandles: [] });
	});
});
