import type { PlatformModule } from './types';
import type { Page } from 'playwright';

export const LINKEDIN_START_POST_SELECTOR = [
	'button.share-box-feed-entry__trigger',
	'button:has-text("Start a post")',
	'a[href*="/sharebox/"]:has([aria-label="Start a post"])',
].join(', ');

export const LINKEDIN_POST_BUTTON_SELECTOR = 'button.share-actions__primary-action:visible';

export function linkedinTypingTimeoutMs(text: string, delayMs: number) {
	return Math.max(30_000, Math.ceil(text.length * (delayMs + 20)));
}

export function getLinkedInPostButton(page: Page) {
	return page
		.getByRole('button', { name: /^Post$/ })
		.or(page.locator('button.share-actions__primary-action:visible'))
		.first();
}

export async function waitForLinkedInPostSubmitted(page: Page, timeout = 20_000) {
	try {
		await getLinkedInPostButton(page).waitFor({ state: 'hidden', timeout });
	} catch {
		throw new Error('LinkedIn did not confirm the post was submitted.');
	}
}

export function linkedinConfirmationSnippet(body: string) {
	const line =
		body
			.split(/\r?\n/)
			.map((part) => part.trim())
			.find((part) => part && !part.startsWith('#')) ?? body.trim();
	return line.slice(0, 80);
}

export async function waitForLinkedInPostVisible(page: Page, body: string, timeout = 20_000) {
	const snippet = linkedinConfirmationSnippet(body);
	try {
		await page.getByText(snippet, { exact: false }).first().waitFor({ state: 'visible', timeout });
	} catch {
		throw new Error('LinkedIn did not show the submitted post in the feed.');
	}
}

async function humanPause(min = 450, max = 1600) {
	await new Promise((resolve) => setTimeout(resolve, min + Math.random() * (max - min)));
}

export const linkedinPlatform: PlatformModule = {
	platform: 'linkedin',
	loginUrl: 'https://www.linkedin.com/login',
	async checkSession(page) {
		await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
		await humanPause();
		// Logged out redirects to /login or /uas/*; logged in shows the primary nav.
		if (/\/(login|uas|checkpoint)/.test(page.url())) return false;
		return Boolean(await page.locator('[data-testid="primary-nav"]').count());
	},
	async warm(page) {
		await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
		await humanPause();
		await page.mouse.wheel(0, 600);
		await humanPause();
	},
	async compose(page, post) {
		await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
		await humanPause();
		await page.locator(LINKEDIN_START_POST_SELECTOR).first().click();
		const editor = page.locator('.share-creation-state .ql-editor, div[role="textbox"].ql-editor').first();
		await editor.waitFor({ timeout: 15000 });
		await editor.click();
		const delay = 25 + Math.random() * 80;
		await editor.pressSequentially(post.body, {
			delay,
			timeout: linkedinTypingTimeoutMs(post.body, delay),
		});
		await humanPause(900, 2200);
		await getLinkedInPostButton(page).click();
		await waitForLinkedInPostSubmitted(page);
		await humanPause(1800, 3600);
		await waitForLinkedInPostVisible(page, post.body);
		return { confirmed: true }; // LinkedIn gives no reliable post URL after composing.
	},
};
