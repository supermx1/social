import { ensureBrowser, runEgo } from './ego';
import { getPlatform } from '../platforms';
import { sessionHasHandle } from '../platforms/types';
import type { EgoPlatformModule, ProgressReporter, SessionStatusResult } from '../platforms/types';
import type { AccountRecord, PostRecord } from '../types';

let chain = Promise.resolve();

// PRESERVED VERBATIM (design doc §2.2) — a plain promise chain, no browser-driver
// dependency at all. This is what enforces global concurrency 1 (PRD §3.5): only one
// browser task runs at a time, queued strictly behind whatever came before it.
export function enqueueBrowserTask<T>(task: () => Promise<T>) {
	const next = chain.then(task, task);
	chain = next.then(
		() => undefined,
		() => undefined,
	);
	return next;
}

export async function loginStart(account: AccountRecord) {
	const module = getPlatform(account.platform);
	return enqueueBrowserTask(async () => {
		await ensureBrowser();
		// ponytail: ego-browser sessions persist login on disk and are shared across every
		// account on the machine (design §2.1/§2.4) — there's no per-account "open a fresh
		// browser" step left to do. All this can do is hand the shared task space to the
		// operator so they can log in by hand (never type credentials — hard product rule)
		// and return immediately; the caller (lib/worker.ts) re-checks session status right
		// after via verifyAndRecord. Upgrade path if this proves too eager to be useful:
		// block here on waitForAgentControl() until the operator hands control back, once
		// that flow has actually been exercised (recon flagged it as untested).
		await runEgo(`(async () => {
	await useOrCreateTaskSpace(${JSON.stringify(module.taskSpace)});
	await openOrReuseTab(${JSON.stringify(module.loginUrl)}, { wait: true, timeout: 20 });
	await handOffTaskSpace();
	cliLog('handed-off');
})();`);
	});
}

/**
 * Whether `account` has a live session, per its platform.
 *
 * Single-identity platforms (WhatsApp) cannot report a handle to compare against — the account's
 * label is chosen by the operator and matches nothing in the page — so for those the question is
 * only whether anyone is logged in. Comparing handles there rejected every post before it started.
 */
function hasLiveSession(module: EgoPlatformModule, session: SessionStatusResult, account: AccountRecord) {
	if (module.singleIdentity) return session.activeHandle !== null;
	return sessionHasHandle(session, account.handle);
}

export async function verifySession(account: AccountRecord) {
	const module = getPlatform(account.platform);
	return enqueueBrowserTask(async () => {
		await ensureBrowser();
		const session = await module.readSession();
		return hasLiveSession(module, session, account);
	});
}

export async function warmSession(account: AccountRecord) {
	const module = getPlatform(account.platform);
	return enqueueBrowserTask(async () => {
		await ensureBrowser();
		const session = await module.warm(account.handle);
		return hasLiveSession(module, session, account);
	});
}

export async function composePost(account: AccountRecord, post: PostRecord, onProgress?: ProgressReporter) {
	const module = getPlatform(account.platform);
	return enqueueBrowserTask(async () => {
		await ensureBrowser();
		// Preserves the pre-check instinct from the old Playwright compose flow: fail fast
		// with the exact 'Session is not active.' message lib/worker.ts pattern-matches to
		// trigger markNeedsReauth, before doing anything else. module.compose() below does
		// its own guard reads too (design §2.3 wants the check run twice, independently) —
		// the extra runEgo round trip here is cheap at this job volume.
		const active = await module.readSession();
		if (!hasLiveSession(module, active, account)) throw new Error('Session is not active.');
		return module.compose(account, post, onProgress);
	});
}
