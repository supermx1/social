import { pb } from '$lib/pb';

const PER_PAGE = 30;

export const load = async ({ url }) => {
	const page = Math.max(1, Number(url.searchParams.get('page')) || 1);

	const [personas, topics] = await Promise.all([
		pb.collection('personas').getFullList({ sort: 'name' }),
		pb.collection('topics').getList(page, PER_PAGE, { sort: '-created', expand: 'personas,feed' })
	]);
	return {
		personas: personas.map((p) => ({ id: p.id, name: p.name })),
		topics: topics.items.map((t) => ({
			id: t.id,
			title: t.title,
			rawContent: t.raw_content,
			status: t.status,
			sourceType: t.source_type,
			sourceUrl: t.source_url,
			urgency: t.urgency,
			expiresAt: t.expires_at,
			personaNames: (t.expand?.personas ?? []).map((p: { name: string }) => p.name),
			feedName: t.expand?.feed?.name ?? '',
			relevanceScore: t.relevance_score,
			relevanceReason: t.relevance_reason
		})),
		page: topics.page,
		totalPages: topics.totalPages,
		totalItems: topics.totalItems
	};
};
