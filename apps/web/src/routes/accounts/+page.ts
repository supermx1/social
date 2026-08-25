import { pb } from '$lib/pb';

const platforms = ['x', 'linkedin', 'whatsapp', 'facebook_page', 'youtube_community'];

export const load = async () => {
	const [personas, accounts] = await Promise.all([
		pb.collection('personas').getFullList({ sort: 'name' }),
		pb.collection('accounts').getFullList({ sort: 'created', expand: 'persona' })
	]);
	return {
		platforms,
		personas: personas.map((p) => ({ id: p.id, name: p.name, slug: p.slug })),
		accounts: accounts.map((a) => ({
			id: a.id,
			personaName: a.expand?.persona?.name ?? '',
			personaSlug: a.expand?.persona?.slug ?? '',
			platform: a.platform,
			sessionStatus: a.session_status,
			handle: a.handle,
			companyId: a.company_id ?? '',
			timezone: a.timezone,
			postingWindowStart: a.posting_window_start,
			postingWindowEnd: a.posting_window_end,
			maxPostsPerDay: a.max_posts_per_day,
			minGapMinutes: a.min_gap_minutes,
			active: a.active
		}))
	};
};
