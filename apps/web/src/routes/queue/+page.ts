import { pb } from '$lib/pb';

export const load = async () => {
	const posts = await pb.collection('posts').getFullList({
		sort: '-created',
		expand: 'account.persona,topic'
	});
	return {
		posts: posts.map((p) => ({
			id: p.id,
			personaId: p.expand?.account?.expand?.persona?.id ?? '',
			personaName: p.expand?.account?.expand?.persona?.name ?? '',
			accountPlatform: p.expand?.account?.platform ?? '',
			topicTitle: p.expand?.topic?.title ?? '',
			kind: p.kind,
			status: p.status,
			body: p.body,
			timingMode: p.timing_mode,
			scheduledFor: p.scheduled_for,
			randomWindowStart: p.random_window_start,
			randomWindowEnd: p.random_window_end,
			postedAt: p.posted_at,
			postUrl: p.post_url,
			attempts: p.attempts,
			variantGroup: p.variant_group,
			errorMessage: p.error_message
		}))
	};
};
