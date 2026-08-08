import { pb } from './pb';
import type { JobRecord } from '../types';

/** Just enough of the PocketBase client for these helpers — lets tests pass a plain fake object. */
export type PBLike = { collection(name: string): any };

// ponytail: single worker process, so this optimistic claim (no compare-and-swap) is race-free — PRD §6.8.
export async function claimNextJob(client: PBLike = pb): Promise<JobRecord | null> {
	let job: JobRecord;
	try {
		job = await client.collection('jobs').getFirstListItem("status = 'queued'", { sort: '+created' });
	} catch {
		return null; // 404 — queue empty
	}
	return client.collection('jobs').update(job.id, { status: 'running', attempts: job.attempts + 1 });
}

export async function completeJob(id: string, client: PBLike = pb) {
	await client.collection('jobs').update(id, { status: 'done' });
}

export async function failJob(id: string, error: unknown, client: PBLike = pb) {
	await client
		.collection('jobs')
		.update(id, { status: 'error', error: error instanceof Error ? error.message : String(error) });
}

/**
 * Records a live progress line on a running job (e.g. "switching account") so the UI can show
 * what a multi-step job is doing instead of just "running" for its whole duration. Never throws:
 * a progress update is a nicety, not part of the job's correctness, and must not turn a working
 * publish into a failed one just because this PATCH raced a realtime unsubscribe or similar.
 */
export async function reportProgress(id: string, detail: string, client: PBLike = pb) {
	try {
		await client.collection('jobs').update(id, { detail });
	} catch {
		// best-effort — see doc comment
	}
}
