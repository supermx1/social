import { pb } from '$lib/pb';

const PER_PAGE = 50;

export const load = async ({ url }) => {
	const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
	const status = url.searchParams.get('status') || 'all';
	const personaId = url.searchParams.get('persona') || 'all';

	// Fetched independently of the paginated posts below, not derived from whatever page happens
	// to be loaded — a persona with zero posts (or one that's only on page 3) still needs to show
	// up as a filter option.
	const [personas, accounts] = await Promise.all([
		pb.collection('personas').getFullList({ sort: 'name' }),
		pb.collection('accounts').getFullList({ sort: 'created' })
	]);

	const filters: string[] = [];
	if (status !== 'all') filters.push(pb.filter('status = {:status}', { status }));
	if (personaId !== 'all') {
		// posts has no direct persona field — filter by the set of accounts that belong to it.
		// PocketBase can't filter two relation hops (account.persona) directly, so resolve the
		// account ids here instead.
		const accountIds = accounts.filter((a) => a.persona === personaId).map((a) => a.id);
		filters.push(
			accountIds.length
				? '(' + accountIds.map((id) => pb.filter('account = {:id}', { id })).join(' || ') + ')'
				: 'account = "__none__"' // persona has no accounts yet — force zero results, not everything
		);
	}

	const result = await pb.collection('posts').getList(page, PER_PAGE, {
		filter: filters.join(' && '),
		sort: '-created',
		expand: 'account.persona,topic'
	});

	return {
		posts: result.items.map((p) => ({
			id: p.id,
			personaId: p.expand?.account?.expand?.persona?.id ?? '',
			personaName: p.expand?.account?.expand?.persona?.name ?? '',
			accountPlatform: p.expand?.account?.platform ?? '',
			topicTitle: p.expand?.topic?.title ?? '',
			kind: p.kind,
			status: p.status,
			body: p.body,
			media: p.media ?? [],
			timingMode: p.timing_mode,
			scheduledFor: p.scheduled_for,
			randomWindowStart: p.random_window_start,
			randomWindowEnd: p.random_window_end,
			postedAt: p.posted_at,
			postUrl: p.post_url,
			attempts: p.attempts,
			variantGroup: p.variant_group,
			errorMessage: p.error_message,
			repeat: p.repeat,
			repeatUntil: p.repeat_until,
			repeatOf: p.repeat_of
		})),
		page: result.page,
		totalPages: result.totalPages,
		totalItems: result.totalItems,
		statusFilter: status,
		personaFilter: personaId,
		personas: personas.map((p) => ({ id: p.id, name: p.name })),
		// For the New post composer. Only active accounts: a post aimed at a disabled account
		// would sit in the queue forever, since the scheduler skips it on every tick.
		accounts: accounts
			.filter((a) => a.active)
			.map((a) => ({
				id: a.id,
				platform: a.platform as string,
				handle: a.handle as string,
				personaName: personas.find((p) => p.id === a.persona)?.name ?? ''
			}))
	};
};
