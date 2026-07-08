import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import {
	LINKEDIN_POST_BUTTON_SELECTOR,
	LINKEDIN_START_POST_SELECTOR,
	getLinkedInPostButton,
	linkedinConfirmationSnippet,
	linkedinTypingTimeoutMs,
	waitForLinkedInPostSubmitted,
	waitForLinkedInPostVisible,
} from '../platforms/linkedin';

describe('LinkedIn composer selectors', () => {
	let browser: Browser;

	beforeAll(async () => {
		browser = await chromium.launch({ headless: true });
	});

	afterAll(async () => {
		await browser.close();
	});

	async function selectorCount(html: string) {
		const page = await browser.newPage();
		try {
			await page.setContent(html);
			return await page.locator(LINKEDIN_START_POST_SELECTOR).count();
		} finally {
			await page.close();
		}
	}

	it('matches both legacy and current start-post controls', async () => {
		const legacy = '<button class="share-box-feed-entry__trigger">Start a post</button>';
		const current =
			'<a href="/preload/sharebox/"><div aria-label="Start a post"><p>Start a post</p></div></a>';

		await expect(selectorCount(legacy)).resolves.toBe(1);
		await expect(selectorCount(current)).resolves.toBe(1);
	});

	it('targets the visible Post button when hidden duplicates exist first', async () => {
		const page = await browser.newPage();
		try {
			await page.setContent(`
				<button style="display: none">Post</button>
				<button style="visibility: hidden">Post</button>
				<button class="share-actions__primary-action">Post</button>
			`);

			await expect(page.locator('button:has-text("Post")').first().isVisible()).resolves.toBe(false);
			await expect(page.locator(LINKEDIN_POST_BUTTON_SELECTOR).first().isVisible()).resolves.toBe(
				true,
			);
		} finally {
			await page.close();
		}
	});

	it('does not treat the audience button as the LinkedIn submit button', async () => {
		const page = await browser.newPage();
		try {
			await page.setContent(`
				<button>Post to Anyone</button>
				<button><span>Post</span></button>
			`);

			await expect(getLinkedInPostButton(page).textContent()).resolves.toBe('Post');
		} finally {
			await page.close();
		}
	});

	it('allows enough time to type long LinkedIn posts with humanized delays', () => {
		expect(linkedinTypingTimeoutMs('short post', 105)).toBe(30_000);
		expect(linkedinTypingTimeoutMs('x'.repeat(900), 105)).toBeGreaterThan(30_000);
	});

	it('does not report publish success while the visible Post button remains open', async () => {
		const page = await browser.newPage();
		try {
			await page.setContent('<button class="share-actions__primary-action">Post</button>');

			await expect(waitForLinkedInPostSubmitted(page, 100)).rejects.toThrow(
				/LinkedIn did not confirm/,
			);
		} finally {
			await page.close();
		}
	});

	it('uses a stable body snippet to confirm LinkedIn feed visibility', async () => {
		expect(linkedinConfirmationSnippet('\n#HashOnly\n\nActual post opening sentence goes here.')).toBe(
			'Actual post opening sentence goes here.',
		);
		expect(linkedinConfirmationSnippet('x'.repeat(120))).toHaveLength(80);
	});

	it('does not confirm a LinkedIn post until the body appears on the page', async () => {
		const page = await browser.newPage();
		try {
			await page.setContent('<main>No matching post yet</main>');

			await expect(waitForLinkedInPostVisible(page, 'A body that is absent', 100)).rejects.toThrow(
				/LinkedIn did not show/,
			);
		} finally {
			await page.close();
		}
	});
});
