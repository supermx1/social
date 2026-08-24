/**
 * Thin wrapper around the `ego-browser` CLI (design doc §2.1-2.2). Every browser
 * interaction — for X publishing specifically — goes through `runEgo`, which pipes a
 * Node.js script to `ego-browser nodejs` on stdin and reads back whatever the script
 * passed to `cliLog(...)`, one value per line.
 *
 * ego lite (bundle id com.citrolabs.ego.lite) hosts the actual browser service; the CLI
 * is just a client to it. `ensureBrowser()` launches the app if it's not already running
 * and waits until the CLI can talk to it.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const EGO_LITE_BUNDLE_ID = 'com.citrolabs.ego.lite';
export const EGO_DOWNLOAD_URL = 'https://lite.ego.app/download';

// ego installs a version-managed CLI here and points ~/.local/bin/ego-browser at it. Resolve
// that real path instead of trusting PATH: a GUI-launched .app is given launchd's minimal PATH
// (/usr/bin:/bin:/usr/sbin:/sbin), which does NOT include ~/.local/bin, so `execFile('ego-browser')`
// fails with ENOENT on machines where ego lite is installed and works fine from a terminal.
const EGO_CLI_PATH = join(homedir(), '.local/share/ego/active_version_dir/Helpers/ego-browser');

/** True when ego lite is installed. A bare stat — cheap enough to call on every worker tick. */
export function egoInstalled(): boolean {
	return existsSync(EGO_CLI_PATH);
}

// ponytail: falls back to PATH so a non-standard install still works when run from a shell.
const egoCli = () => (egoInstalled() ? EGO_CLI_PATH : 'ego-browser');
const READY_PROBE_SCRIPT = "cliLog('ego-browser ready')";
const READY_PROBE_LINE = 'ego-browser ready';
const READY_TIMEOUT_MS = 20_000;
const READY_POLL_MS = 500;
const SCRIPT_TIMEOUT_MS = 60_000;

// `open -b` is idempotent (design §2.1) and ego-browser stays resident once launched, so
// this only needs to succeed once per worker process.
let ready = false;

function execEgoBrowser(script: string, timeoutMs: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = execFile(
			egoCli(),
			['nodejs'],
			{ timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
			(error, stdout, stderr) => {
				if (error) {
					reject(new Error(`ego-browser script failed: ${(stderr || error.message).trim()}`));
					return;
				}
				// cliLog() writes to STDERR, not stdout (verified 2026-08-08 — reading stdout alone
				// returns nothing and every call looks like an empty result). Both streams are
				// merged because the CLI may also emit diagnostics; callers pick the line they want.
				resolve(`${stdout}\n${stderr}`);
			},
		);
		// If the child dies before we finish writing (bad CLI, timeout kill), stdin emits EPIPE.
		// Unhandled, that 'error' event takes the whole worker process down; the execFile
		// callback above already reports the real failure.
		child.stdin?.on('error', () => {});
		child.stdin?.write(script);
		child.stdin?.end();
	});
}

/**
 * Runs a heredoc-style ego-browser script and returns every `cliLog(...)` line it printed,
 * in order, with surrounding whitespace stripped and empty lines dropped. A non-zero exit
 * or an uncaught throw inside the script rejects the promise with stderr attached.
 */
export async function runEgo(script: string): Promise<string[]> {
	const stdout = await execEgoBrowser(script, SCRIPT_TIMEOUT_MS);
	return stdout
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

/**
 * Launches ego lite if it isn't running, then polls a trivial script until the CLI answers.
 * Safe to call at the top of every job — cheap no-op after the first successful call.
 */
export async function ensureBrowser(): Promise<void> {
	if (ready) return;
	// Checked before `open -b`, which reports a missing install the same way it reports a
	// failed launch — the operator needs to be told to install it, not that it wouldn't start.
	if (!egoInstalled()) {
		throw new Error(`ego lite is not installed. Download it from ${EGO_DOWNLOAD_URL}`);
	}
	await new Promise<void>((resolve, reject) => {
		execFile('open', ['-b', EGO_LITE_BUNDLE_ID], (error) => {
			if (error) reject(new Error(`Could not launch ego lite: ${error.message}`));
			else resolve();
		});
	});

	const deadline = Date.now() + READY_TIMEOUT_MS;
	let lastError: unknown;
	while (Date.now() < deadline) {
		try {
			const [line] = await runEgo(READY_PROBE_SCRIPT);
			if (line === READY_PROBE_LINE) {
				ready = true;
				return;
			}
		} catch (error) {
			lastError = error;
		}
		await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
	}
	const detail = lastError instanceof Error ? ` Last error: ${lastError.message}` : '';
	throw new Error(`ego-browser did not become ready in time.${detail}`);
}
