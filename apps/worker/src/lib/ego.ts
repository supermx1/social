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

const EGO_LITE_BUNDLE_ID = 'com.citrolabs.ego.lite';
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
			'ego-browser',
			['nodejs'],
			{ timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
			(error, stdout, stderr) => {
				if (error) {
					reject(new Error(`ego-browser script failed: ${(stderr || error.message).trim()}`));
					return;
				}
				resolve(stdout);
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
