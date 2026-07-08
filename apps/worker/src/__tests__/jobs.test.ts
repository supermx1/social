import { describe, expect, it } from 'vitest';
import { claimNextJob } from '../lib/jobs';

function fakePb() {
	const jobs: Record<string, any>[] = [
		{ id: 'j1', type: 'verify', payload: { accountId: 'a1' }, status: 'queued', attempts: 0 },
	];
	return {
		collection(name: string) {
			if (name !== 'jobs') throw new Error(`unexpected collection ${name}`);
			return {
				async getFirstListItem() {
					const job = jobs.find((j) => j.status === 'queued');
					if (!job) throw new Error('404');
					return { ...job };
				},
				async update(id: string, data: Record<string, unknown>) {
					const job = jobs.find((j) => j.id === id);
					if (!job) throw new Error('404');
					Object.assign(job, data);
					return { ...job };
				},
			};
		},
	};
}

describe('job queue', () => {
	it('claims one queued job once by moving it to running', async () => {
		const pb = fakePb();

		const first = await claimNextJob(pb);
		const second = await claimNextJob(pb);

		expect(first?.status).toBe('running');
		expect(first?.attempts).toBe(1);
		expect(second).toBeNull();
	});
});
