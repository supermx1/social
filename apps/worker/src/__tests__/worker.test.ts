import { describe, expect, it, vi } from 'vitest';
import { attachImages, draftImage, hasPublishEvidence } from '../lib/worker';
import type { AccountRecord, PersonaRecord, PostRecord } from '../types';

vi.mock('../lib/images', () => ({
	generateImage: vi.fn(async () => {
		throw new Error('Workers AI image request failed: 503');
	}),
	// ponytail: distinct class identity is all instanceof needs — no real behaviour to mock.
	NoImageStyleError: class NoImageStyleError extends Error {},
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
