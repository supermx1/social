import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import { config } from './pb';
import { getPlatform } from '../platforms';
import type { AccountRecord, PostRecord } from '../types';

let stealthApplied = false;

let chain = Promise.resolve();

export function enqueueBrowserTask<T>(task: () => Promise<T>) {
	const next = chain.then(task, task);
	chain = next.then(
		() => undefined,
		() => undefined,
	);
	return next;
}

export async function withAccountBrowser<T>(
	account: AccountRecord,
	headless: boolean,
	run: (page: import('playwright').Page) => Promise<T>,
) {
	return enqueueBrowserTask(async () => {
		if (!stealthApplied && config.STEALTH !== 'false') {
			chromium.use(stealth());
			stealthApplied = true;
		}
		const context = await chromium.launchPersistentContext(account.profile_dir, { headless });
		try {
			const page = context.pages()[0] ?? (await context.newPage());
			return await run(page);
		} finally {
			await context.close().catch(() => {}); // user may have closed the window already
		}
	});
}

const headless = () => config.HEADLESS !== 'false';

export async function loginStart(account: AccountRecord) {
	const module = getPlatform(account.platform);
	return withAccountBrowser(account, false, async (page) => {
		await page.goto(module.loginUrl, { waitUntil: 'domcontentloaded' });
		// Manual login: hold the window open until the operator logs in and closes it.
		// Cookies persist in profile_dir as they are set, so closing saves the session.
		await page.waitForEvent('close', { timeout: 0 });
	});
}

export async function verifySession(account: AccountRecord) {
	const module = getPlatform(account.platform);
	return withAccountBrowser(account, headless(), async (page) => {
		const active = await module.checkSession(page);
		if (!active) await debugScreenshot(page, account.id);
		return active;
	});
}

export async function warmSession(account: AccountRecord) {
	const module = getPlatform(account.platform);
	return withAccountBrowser(account, headless(), async (page) => {
		await module.warm(page);
		return module.checkSession(page);
	});
}

// ponytail: no screenshot/inspector library needed — Playwright's own page.screenshot()/content() do this.
async function debugScreenshot(page: import('playwright').Page, accountId: string) {
	try {
		const fs = await import('node:fs/promises');
		await fs.mkdir('./data/debug', { recursive: true });
		const base = `./data/debug/${accountId}-${Date.now()}`;
		await page.screenshot({ path: `${base}.png` });
		await fs.writeFile(`${base}.html`, await page.content());
		return `${base}.png`;
	} catch {
		return null;
	}
}

export async function composePost(account: AccountRecord, post: PostRecord) {
	const module = getPlatform(account.platform);
	return withAccountBrowser(account, headless(), async (page) => {
		const active = await module.checkSession(page);
		if (!active) throw new Error('Session is not active.');
		try {
			return await module.compose(page, post);
		} catch (error) {
			const shot = await debugScreenshot(page, account.id);
			if (shot && error instanceof Error) error.message += ` (screenshot: ${shot})`;
			throw error;
		}
	});
}
