import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attachImages, draftImage, hasPublishEvidence, publishPost } from '../lib/worker';
import type { AccountRecord, PersonaRecord, PostRecord } from '../types';

vi.mock('../lib/images', () => ({
	generateImage: vi.fn(async () => {
		throw new Error('Workers AI image request failed: 503');
	}),
	// ponytail: distinct class identity is all instanceof needs — no real behaviour to mock.
	NoImageStyleError: class NoImageStyleError extends Error {},
}));

const composePost = vi.fn();
vi.mock('../lib/browser', () => ({
	composePost: (...args: unknown[]) => composePost(...args),
	loginStart: vi.fn(),
	verifySession: vi.fn(),
	warmSession: vi.fn(),
}));

// publishPost reads/writes the module-level `pb`, not an injectable client (unlike draftImage /
// attachImages below) — so this mock, not fakeClient(), is what a publishPost test needs.
const postUpdate = vi.fn(async () => ({}));
const runLogCreate = vi.fn(async () => ({}));
vi.mock('../lib/pb', () => ({
	pb: {
		collection: (name: string) => {
			if (name === 'posts') return { update: postUpdate };
			if (name === 'run_log') return { create: runLogCreate };
			if (name === 'accounts') return { update: vi.fn(async () => ({})) };
			throw new Error(`unexpected collection ${name}`);
		},
		// attachImages (exercised below) calls the real SDK's pb.filter — a pure string
		// template, no network — regardless of which client it was given, so the mock needs it too.
		filter: (raw: string, params: Record<string, unknown>) =>
			raw.replace(/\{:(\w+)\}/g, (_, key) => JSON.stringify(params[key])),
	},
	config: {},
}));

describe('publish evidence', () => {
	it('requires either a post URL or explicit platform confirmation', () => {
		expect(hasPublishEvidence({ postUrl: 'https://x.com/me/status/1' })).toBe(true);
		expect(hasPublishEvidence({ confirmed: true })).toBe(true);
		expect(hasPublishEvidence({ postUrl: '' })).toBe(false);
		expect(hasPublishEvidence({})).toBe(false);
	});
});

function fakeClient(post: PostRecord, persona: PersonaRecord, account: AccountRecord) {
	return {
		collection(name: string) {
			if (name === 'posts')
				return {
					async getList() {
						return { items: [post] };
					},
					async update(id: string, data: Record<string, unknown>) {
						if (id !== post.id) throw new Error('unexpected post id');
						Object.assign(post, data);
						return { ...post };
					},
				};
			if (name === 'personas')
				return {
					async getOne(id: string) {
						if (id !== persona.id) throw new Error('unexpected persona id');
						return persona;
					},
				};
			if (name === 'accounts')
				return {
					async getFirstListItem() {
						return account;
					},
				};
			throw new Error(`unexpected collection ${name}`);
		},
	};
}

describe('image generation (non-fatal, design doc §4.3)', () => {
	it('a failing generateImage still leaves the text draft written, with the error recorded', async () => {
		const post = {
			id: 'post1',
			account: 'acc1',
			body: 'draft text',
			status: 'draft',
			media: [],
			error_message: '',
			attempts: 0,
		} as unknown as PostRecord;
		const persona = { id: 'persona1', image_style: 'warm illustration' } as unknown as PersonaRecord;
		const account = { id: 'acc1', persona: 'persona1', platform: 'x', active: true } as unknown as AccountRecord;
		const client = fakeClient(post, persona, account);

		await attachImages({ personaId: 'persona1', platform: 'x', n: 1 }, client);

		expect(post.status).toBe('draft');
		expect(post.body).toBe('draft text');
		expect(post.error_message).toContain('Workers AI image request failed');
		expect(post.media).toEqual([]);
	});

	it('draftImage alone also records a genuine failure without throwing', async () => {
		const post = {
			id: 'post1',
			account: 'acc1',
			body: 'draft text',
			status: 'draft',
			media: [],
			error_message: '',
			attempts: 0,
		} as unknown as PostRecord;
		const persona = { id: 'persona1', image_style: 'warm illustration' } as unknown as PersonaRecord;
		const client = {
			collection(name: string) {
				if (name !== 'posts') throw new Error(`unexpected collection ${name}`);
				return {
					async update(id: string, data: Record<string, unknown>) {
						Object.assign(post, data);
						return { ...post };
					},
				};
			},
		};

		await expect(draftImage(post, persona, client)).resolves.toBeUndefined();
		expect(post.error_message).toContain('Workers AI image request failed');
	});
});

describe('publishPost — double-publish guard', () => {
	beforeEach(() => {
		composePost.mockReset();
		postUpdate.mockClear();
		runLogCreate.mockClear();
	});

	const account = { id: 'acc1', platform: 'whatsapp', handle: 'Kasa WhatsApp' } as unknown as AccountRecord;

	// The bug this covers: the scheduler enqueues a post_now job when a post comes due, and
	// "Post now" in the queue creates another directly. Nothing downstream re-checks the post's
	// status, so a second job for an already-posted post republished it for real on WhatsApp.
	it('skips a post that already published, without touching the browser', async () => {
		const post = { id: 'p1', status: 'posted', attempts: 0 } as unknown as PostRecord;

		await publishPost(post, account);

		expect(composePost).not.toHaveBeenCalled();
		expect(postUpdate).not.toHaveBeenCalled();
		expect(runLogCreate).toHaveBeenCalledWith(
			expect.objectContaining({ post: 'p1', detail: expect.stringContaining('already posted') }),
		);
	});

	it('still publishes a post stuck in "posting" from a worker that died mid-run', async () => {
		const post = { id: 'p2', status: 'posting', attempts: 0 } as unknown as PostRecord;
		composePost.mockResolvedValue({ confirmed: true });

		await publishPost(post, account);

		expect(composePost).toHaveBeenCalledTimes(1);
		expect(postUpdate).toHaveBeenCalledWith('p2', expect.objectContaining({ status: 'posted' }));
	});
});

describe('publishPost — a failed publish is a failed job', () => {
	beforeEach(() => {
		composePost.mockReset();
		postUpdate.mockClear();
		runLogCreate.mockClear();
	});

	const account = { id: 'acc1', platform: 'x', handle: '@TheAvgTechDad' } as unknown as AccountRecord;

	// Swallowing the error reported a failed publish as a successful job: the Activity log read
	// "done" while nothing had been posted, and there was no error anywhere to point at.
	it('rethrows so the job is marked error, and records the failure in run_log', async () => {
		const post = { id: 'p3', status: 'approved', attempts: 0 } as unknown as PostRecord;
		composePost.mockRejectedValue(new Error('X composer never opened'));

		await expect(publishPost(post, account)).rejects.toThrow('X composer never opened');

		expect(postUpdate).toHaveBeenCalledWith(
			'p3',
			expect.objectContaining({ status: 'approved', attempts: 1, error_message: 'X composer never opened' }),
		);
		expect(runLogCreate).toHaveBeenCalledWith(
			expect.objectContaining({ result: 'fail', detail: expect.stringContaining('never opened') }),
		);
	});

	it('marks the post terminally errored on the third failure', async () => {
		const post = { id: 'p4', status: 'approved', attempts: 2 } as unknown as PostRecord;
		composePost.mockRejectedValue(new Error('still broken'));

		await expect(publishPost(post, account)).rejects.toThrow('still broken');
		expect(postUpdate).toHaveBeenCalledWith('p4', expect.objectContaining({ status: 'error', attempts: 3 }));
	});
});
