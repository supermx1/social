import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import {
	typeXPostBody,
	waitForXPostSubmitted,
	X_POST_BUTTON_SELECTOR,
	xTypingTimeoutMs,
} from '../platforms/x';

describe('X composer helpers', () => {
	let browser: Browser;

	beforeAll(async () => {
		browser = await chromium.launch({ headless: true });
	});

	afterAll(async () => {
		await browser.close();
	});

	it('targets only visible enabled Post buttons', async () => {
		const page = await browser.newPage();
		try {
			await page.setContent(`
				<button data-testid="tweetButton" disabled>Post</button>
				<button data-testid="tweetButton" style="display:none">Post</button>
				<button data-testid="tweetButton">Post</button>
			`);

			await expect(page.locator(X_POST_BUTTON_SELECTOR).count()).resolves.toBe(1);
			await expect(page.locator(X_POST_BUTTON_SELECTOR).first().isEnabled()).resolves.toBe(true);
		} finally {
			await page.close();
		}
	});

	it('types into the visible editor after an audience menu has been opened', async () => {
		const page = await browser.newPage();
		try {
			await page.setContent(`
				<div role="menu">Choose audience</div>
				<div data-testid="tweetTextarea_0" role="textbox" contenteditable="true"></div>
			`);

			await typeXPostBody(page, 'hello from x', 0);

			await expect(page.locator('[data-testid="tweetTextarea_0"]').innerText()).resolves.toBe(
				'hello from x',
			);
		} finally {
			await page.close();
		}
	});

	it('clicks the X editor before typing so Draft receives the text', async () => {
		const page = await browser.newPage();
		try {
			await page.setContent(`
				<div data-testid="tweetTextarea_0" role="textbox" contenteditable="true" tabindex="0"></div>
				<script>
					const editor = document.querySelector('[data-testid="tweetTextarea_0"]');
					editor.addEventListener('focus', () => {
						if (!editor.dataset.clicked) editor.blur();
					});
					editor.addEventListener('click', () => {
						editor.dataset.clicked = 'true';
						editor.focus();
					});
				</script>
			`);

			await typeXPostBody(page, 'hello from x', 0);

			await expect(page.locator('[data-testid="tweetTextarea_0"]').innerText()).resolves.toBe(
				'hello from x',
			);
			await expect(
				page.locator('[data-testid="tweetTextarea_0"]').getAttribute('data-clicked'),
			).resolves.toBe('true');
		} finally {
			await page.close();
		}
	});

	it('confirms X posts from the CreateTweet response even when the page stays on home', async () => {
		const page = await browser.newPage();
		try {
			await page.route('https://x.com/i/api/graphql/*/CreateTweet', async (route) => {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					headers: { 'access-control-allow-origin': '*' },
					body: JSON.stringify({
						data: {
							create_tweet: {
								tweet_results: {
									result: {
										rest_id: '12345',
										core: {
											user_results: {
												result: { core: { screen_name: 'kasa_africa' } },
											},
										},
									},
								},
							},
						},
					}),
				});
			});

			const submitted = waitForXPostSubmitted(page, 1000);
			await page.evaluate(() =>
				fetch('https://x.com/i/api/graphql/test/CreateTweet', { method: 'POST' }),
			);

			await expect(submitted).resolves.toEqual({
				confirmed: true,
				postUrl: 'https://x.com/kasa_africa/status/12345',
			});
		} finally {
			await page.close();
		}
	});

	it('does not confirm X posts when CreateTweet returns GraphQL errors', async () => {
		const page = await browser.newPage();
		try {
			await page.route('https://x.com/i/api/graphql/*/CreateTweet', async (route) => {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					headers: { 'access-control-allow-origin': '*' },
					body: JSON.stringify({ errors: [{ message: 'duplicate content' }] }),
				});
			});

			const submitted = waitForXPostSubmitted(page, 1000);
			await page.evaluate(() =>
				fetch('https://x.com/i/api/graphql/test/CreateTweet', { method: 'POST' }),
			);

			await expect(submitted).rejects.toThrow(/X did not confirm/);
		} finally {
			await page.close();
		}
	});

	it('allows enough time to type long X posts with humanized delays', () => {
		expect(xTypingTimeoutMs('short post', 105)).toBe(30_000);
		expect(xTypingTimeoutMs('x'.repeat(900), 105)).toBeGreaterThan(30_000);
	});
});
