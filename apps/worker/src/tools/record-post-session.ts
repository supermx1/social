import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { authSuperuser, pb } from '../lib/pb';
import { getPlatform } from '../platforms';
import type { AccountRecord } from '../types';

function usage() {
	console.error('Usage: npm run record -- <accountId> [url]');
	console.error('Example: npm run record -- 8nz7ctct4uwersi');
	process.exit(1);
}

const accountId = process.argv[2];
const overrideUrl = process.argv[3];
if (!accountId) usage();

await authSuperuser();

const account = await pb.collection('accounts').getOne<AccountRecord>(accountId);
const platform = getPlatform(account.platform);
const started = Date.now();
const outputDir = resolve(`./data/recordings/${account.id}-${started}`);
await mkdir(outputDir, { recursive: true });

chromium.use(stealth());

// ponytail: accounts.profile_dir was dropped (no more per-account Playwright profiles — publishing
// moved to ego-browser, design doc §1-2). This standalone recon tool still needs *a* persistent
// context dir; a fresh one scoped to this recording run is fine, it doesn't need to be stable.
const profileDir = `${outputDir}/profile`;
const context = await chromium.launchPersistentContext(profileDir, {
	headless: false,
	recordVideo: { dir: outputDir, size: { width: 1280, height: 720 } },
	viewport: { width: 1280, height: 720 },
});

await context.tracing.start({
	screenshots: true,
	snapshots: true,
	sources: true,
});

const page = context.pages()[0] ?? (await context.newPage());
const startUrl =
	overrideUrl ?? (account.platform === 'x' ? 'https://x.com/compose/post' : 'https://www.linkedin.com/feed/');

console.log(`Recording ${account.platform} account ${account.id}`);
console.log(`Profile dir: ${profileDir}`);
console.log(`Output dir: ${outputDir}`);
console.log('Make a normal manual post in the browser window, then close the browser window.');
console.log('Note: Playwright traces may contain page content from the recorded session. Keep them local.');

await page.goto(startUrl, { waitUntil: 'domcontentloaded' });

await Promise.race([
	page.waitForEvent('close').then(() => undefined),
	new Promise<void>((resolveInterrupt) => process.once('SIGINT', resolveInterrupt)),
]);

try {
	await context.tracing.stop({ path: `${outputDir}/trace.zip` });
} catch {
	// The context may already be closed by the user; videos still flush to outputDir.
}

await context.close().catch(() => {});

console.log(`Saved recording for ${platform.platform} to ${outputDir}`);
