import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AccountRecord, PostRecord } from '../types';

/**
 * Covers lib/browser.ts's shared session pre-check, which sits in front of every platform's
 * compose() and is easy to miss: the per-platform tests call compose() directly and never
 * exercise it. A real bug hid there — WhatsApp reports 'self' as its only identity while the
 * account row is labelled by the operator, so handle comparison rejected every WhatsApp post
 * before it began.
 */

const readSession = vi.fn<() => Promise<{ activeHandle: string | null; otherHandles: string[] }>>();
const compose = vi.fn(async () => ({ confirmed: true as const }));

function fakeModule(over: Record<string, unknown> = {}) {
	return {
		platform: 'stub',
		loginUrl: 'https://example.test/',
		taskSpace: 'stub-space',
		readSession,
		warm: vi.fn(),
		compose,
		...over,
	};
}

let currentModule = fakeModule();

vi.mock('../lib/ego', () => ({ runEgo: vi.fn(), ensureBrowser: vi.fn(async () => {}) }));
vi.mock('../platforms', () => ({ getPlatform: () => currentModule }));

const { composePost } = await import('../lib/browser');

const post = { id: 'p1', body: 'hi', media: [] } as unknown as PostRecord;

describe('shared session pre-check', () => {
	beforeEach(() => {
		readSession.mockReset();
		compose.mockClear();
	});

	it('lets a single-identity platform post whenever anyone is logged in', async () => {
		currentModule = fakeModule({ singleIdentity: true });
		readSession.mockResolvedValue({ activeHandle: 'self', otherHandles: [] });
		const account = { handle: 'Kasa WhatsApp', platform: 'whatsapp' } as unknown as AccountRecord;

		await expect(composePost(account, post)).resolves.toEqual({ confirmed: true });
		expect(compose).toHaveBeenCalledTimes(1);
	});

	it('still blocks a single-identity platform when nobody is logged in', async () => {
		currentModule = fakeModule({ singleIdentity: true });
		readSession.mockResolvedValue({ activeHandle: null, otherHandles: [] });
		const account = { handle: 'Kasa WhatsApp', platform: 'whatsapp' } as unknown as AccountRecord;

		await expect(composePost(account, post)).rejects.toThrow('Session is not active.');
		expect(compose).not.toHaveBeenCalled();
	});

	// Multi-identity platforms must keep comparing handles — that check is what stops one brand's
	// copy going out under another's on X.
	it('still requires a matching handle on a multi-identity platform', async () => {
		currentModule = fakeModule();
		readSession.mockResolvedValue({ activeHandle: '@someoneElse', otherHandles: [] });
		const account = { handle: 'TheAvgTechDad', platform: 'x' } as unknown as AccountRecord;

		await expect(composePost(account, post)).rejects.toThrow('Session is not active.');
		expect(compose).not.toHaveBeenCalled();
	});

	it('proceeds on a multi-identity platform when the handle is present', async () => {
		currentModule = fakeModule();
		readSession.mockResolvedValue({ activeHandle: '@other', otherHandles: ['@TheAvgTechDad'] });
		const account = { handle: 'TheAvgTechDad', platform: 'x' } as unknown as AccountRecord;

		await expect(composePost(account, post)).resolves.toEqual({ confirmed: true });
	});
});
