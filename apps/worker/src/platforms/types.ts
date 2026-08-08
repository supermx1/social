import type { AccountRecord, PostRecord } from '../types';

/** One page read's worth of session status for every account on a platform (design §2.4). */
export type SessionStatusResult = {
	/** '@handle' of whichever account is active right now, or null if nobody is logged in. */
	activeHandle: string | null;
	/** '@handle' for every OTHER account with a live session (e.g. scoped switcher rows). */
	otherHandles: string[];
};

export type ComposeResult = { postUrl?: string; confirmed?: boolean };

/** Reports a human-readable progress line, e.g. "switching account". Never throws — see jobs.ts. */
export type ProgressReporter = (detail: string) => void | Promise<void>;

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
	/**
	 * Switches to `handle` if it isn't already active, then looks human (scroll, dwell).
	 * Takes a handle — not just "warm whatever's active" — because warming is meant to keep
	 * THIS account's session looking used; warming a different account by accident defeats
	 * the point (this was a real bug: the previous warm() ignored which account was asked for).
	 */
	warm(handle: string): Promise<SessionStatusResult>;
	/** Switch to `account` if needed (guarded), compose `post`, publish, confirm via the toast. */
	compose(account: AccountRecord, post: PostRecord, onProgress?: ProgressReporter): Promise<ComposeResult>;
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

/**
 * True when `handle` has a live session.
 *
 * Both sides are normalised rather than assuming X's '@' prefix: X reports handles as
 * '@TheAvgTechDad' while LinkedIn reports display names like 'Kasa' and
 * 'TechGFX Technologies Limited'. Comparing case-insensitively on the bare name works for both,
 * where building `'@' + handle` only ever worked for X.
 */
export function sessionHasHandle(session: SessionStatusResult, handle: string): boolean {
	const wanted = normalizeHandle(handle).toLowerCase();
	return [session.activeHandle, ...session.otherHandles]
		.filter((h): h is string => Boolean(h))
		.some((h) => normalizeHandle(h).toLowerCase() === wanted);
}
