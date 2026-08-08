import { pb } from '$lib/pb';

const PER_PAGE = 50;

export const load = async ({ url }) => {
	const jobsPage = Math.max(1, Number(url.searchParams.get('jobsPage')) || 1);
	const runPage = Math.max(1, Number(url.searchParams.get('runPage')) || 1);

	const [jobs, runLog] = await Promise.all([
		pb.collection('jobs').getList(jobsPage, PER_PAGE, { sort: '-created' }),
		pb.collection('run_log').getList(runPage, PER_PAGE, { sort: '-created' })
	]);
	return {
		jobs: jobs.items.map((j) => ({
			id: j.id,
			created: j.created,
			type: j.type,
			payload: j.payload,
			status: j.status,
			error: j.error,
			detail: j.detail
		})),
		jobsPage: jobs.page,
		jobsTotalPages: jobs.totalPages,
		jobsTotalItems: jobs.totalItems,
		runLog: runLog.items.map((r) => ({
			id: r.id,
			created: r.created,
			action: r.action,
			detail: r.detail,
			result: r.result
		})),
		runPage: runLog.page,
		runTotalPages: runLog.totalPages,
		runTotalItems: runLog.totalItems
	};
};
