import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AccountRecord, PostRecord } from '../types';

const runEgo = vi.fn<(script: string) => Promise<string[]>>();

vi.mock('../lib/ego', () => ({
	runEgo: (...args: [string]) => runEgo(...args),
	ensureBrowser: vi.fn(async () => {}),
}));

const { linkedinPlatform, composerUrl, toSessionStatus } = await import('../platforms/linkedin');

function line(value: unknown): string[] {
	return [JSON.stringify(value)];
}

const KASA = {
	id: 'acc-kasa',
	handle: 'Kasa',
	platform: 'linkedin',
	company_id: '107591805',
} as unknown as AccountRecord;

const PERSONAL = {
	id: 'acc-me',
	handle: 'chukwuemeka-anyakora',
	platform: 'linkedin',
	company_id: '',
} as unknown as AccountRecord;

const post = { id: 'post1', body: 'hello from linkedin' } as unknown as PostRecord;

/** A composer state as READ_COMPOSER_SNIPPET reports it. */
function composer(over: Partial<Record<string, unknown>> = {}) {
	return {
		open: true,
		author: 'Kasa',
		editorText: post.body,
		postDisabled: false,
		media: 0,
		url: 'https://www.linkedin.com/company/107591805/admin/page-posts/published/?share=true',
		...over,
	};
}

describe('LinkedIn composer URL is the author identity (recon: the whole safety model)', () => {
	it('builds the company admin share URL when a company id is set', () => {
		expect(composerUrl('107591805')).toBe(
			'https://www.linkedin.com/company/107591805/admin/page-posts/published/?share=true',
		);
	});

	it('falls back to the personal sharebox when no company id is set', () => {
		expect(composerUrl('')).toBe('https://www.linkedin.com/preload/sharebox/');
	});

	// The id is interpolated straight into a URL and a script string, so a non-numeric value
	// must be refused rather than scripted.
	it('refuses a non-numeric company id', () => {
		expect(() => composerUrl('107591805"; alert(1); //')).toThrow(/not numeric/);
	});
});

describe('LinkedIn identity guard', () => {
	beforeEach(() => {
		runEgo.mockReset();
	});

	it('refuses to type when the composer never opened', async () => {
		runEgo.mockResolvedValueOnce(line(composer({ open: false, author: null })));

		await expect(linkedinPlatform.compose(KASA, post)).rejects.toThrow(/composer is not open/);
		expect(runEgo).toHaveBeenCalledTimes(1); // nothing typed, nothing clicked
	});

	// Two independent checks: the id in the URL and the name the composer renders. A page id that
	// silently fails to take would still land on some composer, so the name alone is not enough.
	it('refuses when the URL is not the expected company, even if a composer is open', async () => {
		runEgo.mockResolvedValueOnce(
			line(
				composer({
					author: 'Kasa',
					url: 'https://www.linkedin.com/company/112229576/admin/page-posts/published/?share=true',
				}),
			),
		);

		await expect(linkedinPlatform.compose(KASA, post)).rejects.toThrow(/not on company 107591805/);
		expect(runEgo).toHaveBeenCalledTimes(1);
	});

	it('refuses when the rendered author is a different identity', async () => {
		runEgo.mockResolvedValueOnce(line(composer({ author: 'TechGFX Technologies Limited' })));

		await expect(linkedinPlatform.compose(KASA, post)).rejects.toThrow(/Wrong LinkedIn author/);
		expect(runEgo).toHaveBeenCalledTimes(1);
	});

	it('refuses to publish when the text read back does not match the body', async () => {
		runEgo
			.mockResolvedValueOnce(line(composer({ editorText: '' })))
			.mockResolvedValueOnce(line(composer({ editorText: 'something else entirely' })));

		await expect(linkedinPlatform.compose(KASA, post)).rejects.toThrow(/does not match the intended post body/);
		expect(runEgo).toHaveBeenCalledTimes(2); // no click
	});

	it('publishes and reports confirmation when every guard passes', async () => {
		runEgo
			.mockResolvedValueOnce(line(composer({ editorText: '' }))) // open
			.mockResolvedValueOnce(line(composer())) // typed
			.mockResolvedValueOnce(line({ composerClosed: true, state: composer({ open: false }) }));

		await expect(linkedinPlatform.compose(KASA, post)).resolves.toEqual({ confirmed: true });
		expect(runEgo).toHaveBeenCalledTimes(3);
	});

	// LinkedIn exposes no permalink at compose time, so the composer closing IS the confirmation.
	// If it stays open the draft is still sitting there and the post did not go out.
	it('fails when the composer is still open after clicking Post', async () => {
		runEgo
			.mockResolvedValueOnce(line(composer({ editorText: '' })))
			.mockResolvedValueOnce(line(composer()))
			.mockResolvedValueOnce(line({ composerClosed: false, state: composer() }));

		await expect(linkedinPlatform.compose(KASA, post)).rejects.toThrow(/did not confirm the post/);
	});

	it('posts as the personal profile when no company id is set', async () => {
		const mine = composer({ author: 'chukwuemeka-anyakora', url: 'https://www.linkedin.com/preload/sharebox/' });
		runEgo
			.mockResolvedValueOnce(line({ ...mine, editorText: '' }))
			.mockResolvedValueOnce(line(mine))
			.mockResolvedValueOnce(line({ composerClosed: true, state: { ...mine, open: false } }));

		await expect(linkedinPlatform.compose(PERSONAL, post)).resolves.toEqual({ confirmed: true });
		// No company id, so the URL check is skipped and only the rendered name is enforced.
		expect(runEgo.mock.calls[0][0]).toContain('preload/sharebox');
	});
});

describe('LinkedIn media (recon trap #3: two-step flow)', () => {
	beforeEach(() => {
		runEgo.mockReset();
	});

	const withImage = {
		id: 'post2',
		body: 'hello from linkedin',
		media: ['/tmp/pic.png'],
	} as unknown as PostRecord;

	it('attaches media, then re-checks identity before publishing', async () => {
		runEgo
			.mockResolvedValueOnce(line(composer({ editorText: '' })))
			.mockResolvedValueOnce(line(composer()))
			.mockResolvedValueOnce(
				line({ selectedNames: ['pic.png'], nextClicked: true, composer: composer({ media: 1 }) }),
			)
			.mockResolvedValueOnce(line({ composerClosed: true, state: composer({ open: false }) }));

		await expect(linkedinPlatform.compose(KASA, withImage)).resolves.toEqual({ confirmed: true });
		expect(runEgo.mock.calls[2][0]).toContain('Add media');
		expect(runEgo.mock.calls[2][0]).toContain('uploadFile');
	});

	// Uploading is not the same as attaching — "Next" is what carries the image into the post.
	it('refuses to publish when the media never made it back to the composer', async () => {
		runEgo
			.mockResolvedValueOnce(line(composer({ editorText: '' })))
			.mockResolvedValueOnce(line(composer()))
			.mockResolvedValueOnce(
				line({ selectedNames: ['pic.png'], nextClicked: false, composer: composer({ media: 0 }) }),
			);

		await expect(linkedinPlatform.compose(KASA, withImage)).rejects.toThrow(/never attached to the composer/);
		expect(runEgo).toHaveBeenCalledTimes(3); // click script never runs
	});

	it('refuses to publish when LinkedIn did not accept the file at all', async () => {
		runEgo
			.mockResolvedValueOnce(line(composer({ editorText: '' })))
			.mockResolvedValueOnce(line(composer()))
			.mockResolvedValueOnce(line({ selectedNames: [], nextClicked: true, composer: composer() }));

		await expect(linkedinPlatform.compose(KASA, withImage)).rejects.toThrow(/did not accept all media/);
	});
});

describe('LinkedIn session inventory', () => {
	it('reports every identity this one login can publish as', () => {
		expect(
			toSessionStatus({
				loggedIn: true,
				personal: 'chukwuemeka-anyakora',
				pages: [
					{ id: '107591805', name: 'Kasa' },
					{ id: '112229576', name: 'TechGFX Technologies Limited' },
				],
			}),
		).toEqual({
			// No single "active" identity on LinkedIn — it is chosen per post by URL.
			activeHandle: null,
			otherHandles: ['Kasa', 'TechGFX Technologies Limited', 'chukwuemeka-anyakora'],
		});
	});

	it('reports nothing when logged out', () => {
		expect(toSessionStatus({ loggedIn: false, personal: null, pages: [] })).toEqual({
			activeHandle: null,
			otherHandles: [],
		});
	});
});
