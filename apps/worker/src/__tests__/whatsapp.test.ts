import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AccountRecord, PostRecord } from '../types';

const runEgo = vi.fn<(script: string) => Promise<string[]>>();

vi.mock('../lib/ego', () => ({
	runEgo: (...args: [string]) => runEgo(...args),
	ensureBrowser: vi.fn(async () => {}),
}));

const { whatsappPlatform } = await import('../platforms/whatsapp');

function line(value: unknown): string[] {
	return [JSON.stringify(value)];
}

const account = { id: 'acc-wa', handle: 'Kasa WhatsApp', platform: 'whatsapp' } as unknown as AccountRecord;

const post = {
	id: 'post1',
	body: 'Daily ad caption',
	media: ['/tmp/ad.png'],
} as unknown as PostRecord;

const LOGGED_IN = { loggedIn: true, qr: false };

function composer(over: Record<string, unknown> = {}) {
	return {
		captionPresent: true,
		captionText: post.body,
		sendPresent: true,
		sendEnabled: true,
		sendLabel: 'Send 1 selected',
		...over,
	};
}

describe('WhatsApp Status — media is mandatory', () => {
	beforeEach(() => runEgo.mockReset());

	// The text-only status composer is a different, unmapped flow. Refusing is the honest
	// behaviour; guessing its selectors is what the recon-first rule exists to prevent.
	it('refuses a post with no image rather than guessing the text-status flow', async () => {
		const textOnly = { id: 'p', body: 'just words', media: [] } as unknown as PostRecord;

		await expect(whatsappPlatform.compose(account, textOnly)).rejects.toThrow(/requires an image/);
		expect(runEgo).not.toHaveBeenCalled(); // never even opens the browser
	});

	it('refuses more than one image, since multi-image status is untested', async () => {
		const two = { id: 'p', body: 'x', media: ['/tmp/a.png', '/tmp/b.png'] } as unknown as PostRecord;

		await expect(whatsappPlatform.compose(account, two)).rejects.toThrow(/only supports one image/);
		expect(runEgo).not.toHaveBeenCalled();
	});
});

describe('WhatsApp Status — publishing', () => {
	beforeEach(() => runEgo.mockReset());

	it('opens, captions, and sends when everything is healthy', async () => {
		runEgo
			.mockResolvedValueOnce(line({ login: LOGGED_IN, opened: true, composer: composer({ captionText: '' }) }))
			.mockResolvedValueOnce(line(composer()))
			.mockResolvedValueOnce(
				line({ composerClosed: true, composer: composer({ captionPresent: false, sendPresent: false }) }),
			)
			.mockResolvedValueOnce(line({ found: true, imagePresent: true }));

		// No postUrl by design: a Status has no permalink and expires after 24h.
		await expect(whatsappPlatform.compose(account, post)).resolves.toEqual({ confirmed: true });
		expect(runEgo).toHaveBeenCalledTimes(4);
	});

	// Verified live and the reason this check exists: after a SUCCESSFUL post the my-status list
	// row still reads plain "My status" with no thumbnail, so the composer closing and the row
	// looking empty are both worthless as signals. Opening the status is the only real proof.
	it('fails when the status is not viewable afterwards, even though the composer closed', async () => {
		runEgo
			.mockResolvedValueOnce(line({ login: LOGGED_IN, opened: true, composer: composer({ captionText: '' }) }))
			.mockResolvedValueOnce(line(composer()))
			.mockResolvedValueOnce(
				line({ composerClosed: true, composer: composer({ captionPresent: false, sendPresent: false }) }),
			)
			.mockResolvedValueOnce(line({ found: false, imagePresent: false }));

		await expect(whatsappPlatform.compose(account, post)).rejects.toThrow(/not viewable under "My status"/);
	});

	// lib/worker.ts pattern-matches this exact string to flag the account for re-auth.
	it('reports a dead session with the message the worker matches on', async () => {
		runEgo.mockResolvedValueOnce(line({ login: { loggedIn: false, qr: true }, opened: false }));

		await expect(whatsappPlatform.compose(account, post)).rejects.toThrow('Session is not active.');
		expect(runEgo).toHaveBeenCalledTimes(1); // nothing typed, nothing sent
	});

	// WhatsApp Web allows one live tab; a second is parked on a screen where clicks do nothing.
	// That is a tab problem, not an auth problem, so it must NOT say 'Session is not active.' —
	// the worker matches that string and would flag the account for a re-auth that fixes nothing.
	it('names the one-tab conflict instead of blaming the session', async () => {
		runEgo.mockResolvedValueOnce(line({ login: { loggedIn: false, qr: false, conflict: true }, opened: false }));

		const err = await whatsappPlatform.compose(account, post).catch((e: Error) => e);
		expect((err as Error).message).toMatch(/live in another window/);
		expect((err as Error).message).not.toMatch(/Session is not active/);
	});

	it('fails when the composer never opened with the image attached', async () => {
		runEgo.mockResolvedValueOnce(line({ login: LOGGED_IN, opened: false, fileInput: false }));

		await expect(whatsappPlatform.compose(account, post)).rejects.toThrow(/composer did not open/);
		expect(runEgo).toHaveBeenCalledTimes(1);
	});

	it('refuses to send when the caption read back does not match the body', async () => {
		runEgo
			.mockResolvedValueOnce(line({ login: LOGGED_IN, opened: true, composer: composer({ captionText: '' }) }))
			.mockResolvedValueOnce(line(composer({ captionText: 'something else' })));

		await expect(whatsappPlatform.compose(account, post)).rejects.toThrow(/caption does not match/);
		expect(runEgo).toHaveBeenCalledTimes(2); // send script never runs
	});

	// Recon trap #1: Send is a <div>, so .disabled always reads falsy — aria-disabled is the
	// only real signal, and a disabled send means the media never finished attaching.
	it('refuses to send when the send control reports itself disabled', async () => {
		runEgo
			.mockResolvedValueOnce(line({ login: LOGGED_IN, opened: true, composer: composer({ captionText: '' }) }))
			.mockResolvedValueOnce(line(composer({ sendEnabled: false })));

		await expect(whatsappPlatform.compose(account, post)).rejects.toThrow(/send control is not enabled/);
		expect(runEgo).toHaveBeenCalledTimes(2);
	});

	it('fails when the composer is still open after clicking send', async () => {
		runEgo
			.mockResolvedValueOnce(line({ login: LOGGED_IN, opened: true, composer: composer({ captionText: '' }) }))
			.mockResolvedValueOnce(line(composer()))
			.mockResolvedValueOnce(line({ composerClosed: false, composer: composer() }));

		await expect(whatsappPlatform.compose(account, post)).rejects.toThrow(/did not confirm the status/);
	});

	// Recon trap #3: the send label encodes the attachment count, so matching the literal
	// "Send 1 selected" would break the moment that changes.
	it('matches the send control on its prefix, not the whole label', async () => {
		runEgo
			.mockResolvedValueOnce(line({ login: LOGGED_IN, opened: true, composer: composer({ captionText: '' }) }))
			.mockResolvedValueOnce(line(composer()))
			.mockResolvedValueOnce(
				line({ composerClosed: true, composer: composer({ captionPresent: false, sendPresent: false }) }),
			)
			.mockResolvedValueOnce(line({ found: true, imagePresent: true }));

		await whatsappPlatform.compose(account, post);

		expect(runEgo.mock.calls[2][0]).toContain('[aria-label^="Send "]');
	});
});

describe('WhatsApp session', () => {
	beforeEach(() => runEgo.mockReset());

	it('reports a live session as one identity', async () => {
		runEgo.mockResolvedValueOnce(line(LOGGED_IN));
		await expect(whatsappPlatform.readSession()).resolves.toEqual({ activeHandle: 'self', otherHandles: [] });
	});

	// The session behind a parked tab is alive — calling it dead would trigger a pointless re-auth.
	it('still counts as live when the tab is parked behind another window', async () => {
		runEgo.mockResolvedValueOnce(line({ loggedIn: false, qr: false, conflict: true }));
		await expect(whatsappPlatform.readSession()).resolves.toEqual({ activeHandle: 'self', otherHandles: [] });
	});

	it('reports nothing when the QR screen is showing', async () => {
		runEgo.mockResolvedValueOnce(line({ loggedIn: false, qr: true }));
		await expect(whatsappPlatform.readSession()).resolves.toEqual({ activeHandle: null, otherHandles: [] });
	});
});
