import type { PlatformModule } from './types';
import type { Page } from 'playwright';

export const X_POST_BUTTON_SELECTOR = [
	'[data-testid="tweetButton"]:visible:not([disabled])',
	'[data-testid="tweetButtonInline"]:visible:not([disabled])',
].join(', ');

export function xTypingTimeoutMs(text: string, delayMs: number) {
	return Math.max(30_000, Math.ceil(text.length * (delayMs + 20)));
}

type XPostSubmission = {
	confirmed: true;
	postUrl?: string;
};

async function humanPause(min = 450, max = 1600) {
	await new Promise((resolve) => setTimeout(resolve, min + Math.random() * (max - min)));
}

export async function typeXPostBody(page: Page, body: string, delay = 25 + Math.random() * 80) {
	await page.keyboard.press('Escape').catch(() => {});
	const editor = page.locator('[data-testid="tweetTextarea_0"]:visible').first();
	await editor.waitFor({ timeout: 15000 });
	await editor.click();
	await page.keyboard.insertText(body);
}

export async function waitForXPostSubmitted(
	page: Page,
	timeout = 20_000,
): Promise<XPostSubmission> {
	let response;
	try {
		response = await page.waitForResponse(
			(candidate) => {
				const url = new URL(candidate.url());
				return (
					candidate.request().method() === 'POST' &&
					url.hostname === 'x.com' &&
					/^\/i\/api\/graphql\/[^/]+\/CreateTweet$/.test(url.pathname)
				);
			},
			{ timeout },
		);
	} catch {
		throw new Error('X did not confirm the post was submitted.');
	}

	if (!response.ok()) {
		throw new Error('X did not confirm the post was submitted.');
	}

	const payload = (await response.json().catch(() => undefined)) as
		| {
				data?: {
					create_tweet?: {
						tweet_results?: {
							result?: {
								rest_id?: string;
								core?: {
									user_results?: {
										result?: {
											core?: { screen_name?: string };
											legacy?: { screen_name?: string };
										};
									};
								};
							};
						};
					};
				};
				errors?: unknown[];
		  }
		| undefined;
	const tweet = payload?.data?.create_tweet?.tweet_results?.result;
	if (!tweet || payload?.errors?.length) {
		throw new Error('X did not confirm the post was submitted.');
	}

	const screenName =
		tweet.core?.user_results?.result?.core?.screen_name ??
		tweet.core?.user_results?.result?.legacy?.screen_name;
	return {
		confirmed: true,
		...(tweet.rest_id && screenName
			? { postUrl: `https://x.com/${screenName}/status/${tweet.rest_id}` }
			: {}),
	};
}

export const xPlatform: PlatformModule = {
	platform: 'x',
	loginUrl: 'https://x.com/i/flow/login',
	async checkSession(page) {
		await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
		await humanPause();
		return Boolean(
			await page
				.locator('[data-testid="SideNav_NewTweet_Button"], a[href="/compose/post"]')
				.first()
				.count(),
		);
	},
	async warm(page) {
		await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
		await humanPause();
		await page.mouse.wheel(0, 600);
		await humanPause();
	},
	async compose(page, post) {
		await page.goto('https://x.com/compose/post', { waitUntil: 'domcontentloaded' });
		await humanPause();
		await typeXPostBody(page, post.body);
		await humanPause(900, 2200);
		const submitted = waitForXPostSubmitted(page);
		try {
			await page.locator(X_POST_BUTTON_SELECTOR).first().click();
		} catch (error) {
			void submitted.catch(() => {});
			throw error;
		}
		const result = await submitted;
		await page.getByRole('button', { name: /^Got it$/ }).click({ timeout: 5000 }).catch(() => {});
		return result;
	},
};
