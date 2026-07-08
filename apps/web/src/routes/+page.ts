import { pb } from '$lib/pb';

export const load = async () => {
	const [accounts, posts, jobs] = await Promise.all([
		pb.collection('accounts').getFullList({ sort: 'created', expand: 'persona' }),
		pb.collection('posts').getFullList(),
		pb.collection('jobs').getList(1, 10, { sort: '-created' })
	]);

	let state = null;
	try {
		state = await pb.collection('app_state').getFirstListItem('');
	} catch {
		state = null;
	}

	const counts = new Map<string, number>();
	for (const post of posts) {
		counts.set(post.status, (counts.get(post.status) ?? 0) + 1);
	}

	return {
		accounts: accounts.map((a) => ({
			personaName: a.expand?.persona?.name ?? '',
			platform: a.platform,
			handle: a.handle,
			sessionStatus: a.session_status
		})),
		postCounts: [...counts].map(([status, count]) => ({ status, count })),
		recentJobs: jobs.items.map((j) => ({
			type: j.type,
			payload: j.payload,
			status: j.status,
			error: j.error
		})),
		state: state ? { id: state.id, paused: state.paused } : null
	};
};
