import type { Page } from 'playwright';
import type { AccountRecord, PostRecord } from '../types';

/**
 * Playwright-era shape, unchanged from before this migration. Kept under its original name
 * so `linkedin.ts` — untouched, pending its own recon run before it's safe to wire up
 * (design doc §2.6) — still type-checks exactly as it did. Do not build new platforms
 * against this; see `EgoPlatformModule` below, which is what `x.ts` implements.
 *
 * ponytail: a union of this with EgoPlatformModule under the `PlatformModule` name was
 * tried and reverted — TypeScript won't distribute contextual parameter types across a
 * union for object-literal methods, so linkedin.ts's untouched `compose(page, post)` came
 * back as implicit-`any` under strict mode. Two separate named types avoids that entirely.
 */
export type PlatformModule = {
	platform: string;
	loginUrl: string;
	checkSession(page: Page): Promise<boolean>;
	warm(page: Page): Promise<void>;
	compose(page: Page, post: PostRecord): Promise<{ postUrl?: string; confirmed?: boolean }>;
};

/** One page read's worth of session status for every account on a platform (design §2.4). */
export type SessionStatusResult = {
	/** '@handle' of whichever account is active right now, or null if nobody is logged in. */
	activeHandle: string | null;
	/** '@handle' for every OTHER account with a live session (e.g. scoped switcher rows). */
	otherHandles: string[];
};

export type ComposeResult = { postUrl?: string; confirmed?: boolean };

/**
 * ego-browser-driven platform module. No `Page` — every method drives the shared,
 * resident browser session via `runEgo` (lib/ego.ts) and reports back what it read.
 */
export type EgoPlatformModule = {
	platform: string;
	loginUrl: string;
	/** ego-browser task space this platform's scripts run in; reused across jobs. */
	taskSpace: string;
	/** One page read: who's active, plus every other account with a live session. */
	readSession(): Promise<SessionStatusResult>;
	/** Look human (scroll, dwell) and report session status the same way readSession does. */
	warm(): Promise<SessionStatusResult>;
	/** Switch to `account` if needed (guarded), compose `post`, publish, confirm via the toast. */
	compose(account: AccountRecord, post: PostRecord): Promise<ComposeResult>;
};

/**
 * Accounts are meant to store the bare handle, but the UI accepts a pasted '@kasa_africa' and
 * that is what is actually in the database. Normalising in one place keeps both forms working —
 * without it every comparison builds '@@kasa_africa' and nothing ever matches, which presents as
 * a dead session rather than as a bug.
 */
export function normalizeHandle(handle: string): string {
	return handle.trim().replace(/^@+/, '');
}

/** True when `handle` (with or without a leading '@') has a live session. */
export function sessionHasHandle(session: SessionStatusResult, handle: string): boolean {
	const wanted = `@${normalizeHandle(handle)}`;
	return session.activeHandle === wanted || session.otherHandles.includes(wanted);
}
