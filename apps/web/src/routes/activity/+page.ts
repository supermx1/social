import { pb } from '$lib/pb';

export const load = async () => {
	const [jobs, runLog] = await Promise.all([
		pb.collection('jobs').getList(1, 50, { sort: '-created' }),
		pb.collection('run_log').getList(1, 50, { sort: '-created' })
	]);
	return {
		jobs: jobs.items.map((j) => ({
			id: j.id,
			created: j.created,
			type: j.type,
			payload: j.payload,
			status: j.status,
			error: j.error
		})),
		runLog: runLog.items.map((r) => ({
			id: r.id,
			created: r.created,
			action: r.action,
			detail: r.detail,
			result: r.result
		}))
	};
};
