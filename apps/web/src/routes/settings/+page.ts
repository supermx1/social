import { pb } from '$lib/pb';

export const load = async () => {
	// `env` is superuser-only, which works here because the operator IS a superuser
	// (see backend/pb_hooks/bootstrap.pb.js) — no proxy endpoint needed.
	const rows = await pb.collection('env').getFullList<{ id: string; key: string; value: string }>({
		sort: 'key'
	});
	return { env: rows.map((r) => ({ id: r.id, key: r.key, value: r.value ?? '' })) };
};
