import { pb } from '$lib/pb';

export const load = async () => {
	const [personas, feeds] = await Promise.all([
		pb.collection('personas').getFullList({ sort: 'name' }),
		pb.collection('feeds').getFullList({ sort: 'name', expand: 'personas' })
	]);
	return {
		personas: personas.map((p) => ({ id: p.id, name: p.name })),
		feeds: feeds.map((f) => ({
			id: f.id,
			name: f.name,
			url: f.url,
			lastError: f.last_error,
			personaIds: f.personas ?? [],
			personaNames: (f.expand?.personas ?? []).map((p: { name: string }) => p.name),
			pollIntervalMinutes: f.poll_interval_minutes,
			freshnessHours: f.freshness_hours,
			maxItemsPerPoll: f.max_items_per_poll,
			autoDraft: f.auto_draft,
			lastPolledAt: f.last_polled_at,
			active: f.active
		}))
	};
};
