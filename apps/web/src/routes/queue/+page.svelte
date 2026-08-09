<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page as pageStore } from '$app/state';
	import { pb } from '$lib/pb';
	import { subscribeToCollectionChanges } from '$lib/realtime';
	import { onMount } from 'svelte';
	import PageHeader from '$lib/components/page-header.svelte';
	import Pager from '$lib/components/pager.svelte';
	import DateTimePicker from '$lib/components/date-time-picker.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '$lib/components/ui/table';
	import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '$lib/components/ui/select';
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogDescription,
		DialogFooter
	} from '$lib/components/ui/dialog';
	import {
		DropdownMenu,
		DropdownMenuTrigger,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuSeparator
	} from '$lib/components/ui/dropdown-menu';
	import { Tooltip, TooltipTrigger, TooltipContent } from '$lib/components/ui/tooltip';
	import { statusVariant } from '$lib/status';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import SendIcon from '@lucide/svelte/icons/send';
	import CheckIcon from '@lucide/svelte/icons/check';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import ImageIcon from '@lucide/svelte/icons/image';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';

	let { data } = $props();
	type PostRow = (typeof data.posts)[number];

	let error = $state('');

	onMount(() => subscribeToCollectionChanges(pb, ['posts', 'accounts', 'personas', 'topics'], invalidateAll));

	// Filtering and pagination both happen server-side (queue/+page.ts) — this page can hold
	// thousands of posts once evergreen batches and feed-driven drafts pile up, so "load
	// everything, filter in the browser" stops being honest past a few dozen rows.
	let statusFilter = $derived(data.statusFilter);
	let personaFilter = $derived(data.personaFilter);

	function applyFilters(next: { status?: string; persona?: string; page?: number }) {
		const params = new URLSearchParams(pageStore.url.searchParams);
		if (next.status !== undefined) params.set('status', next.status);
		if (next.persona !== undefined) params.set('persona', next.persona);
		params.set('page', String(next.page ?? 1)); // any filter change resets to page 1
		goto(`?${params}`, { keepFocus: true, noScroll: true });
	}

	// Jobs still in flight for posts on THIS page, keyed by postId, for the live "posting…"
	// detail next to the status badge (design doc: job status should show its current phase,
	// not just "running", while ego-browser works through switch/type/upload/publish).
	let liveJobDetail = $state<Record<string, string>>({});
	async function refreshLiveJobs() {
		const postIds = new Set(data.posts.filter((p) => p.status === 'posting').map((p) => p.id));
		if (postIds.size === 0) {
			liveJobDetail = {};
			return;
		}
		// Bounded by definition: global browser concurrency is 1, so there is at most a
		// handful of queued/running post_now jobs at any time — a plain getFullList is safe.
		const jobs = await pb.collection('jobs').getFullList<{
			payload: { postId?: string };
			detail?: string;
		}>({
			filter: "type = 'post_now' && (status = 'queued' || status = 'running')"
		});
		const next: Record<string, string> = {};
		for (const j of jobs) {
			if (j.payload.postId && postIds.has(j.payload.postId)) next[j.payload.postId] = j.detail || 'working…';
		}
		liveJobDetail = next;
	}
	onMount(() => {
		refreshLiveJobs();
		const unsub = subscribeToCollectionChanges(pb, ['jobs'], refreshLiveJobs);
		return unsub;
	});

	const statusOptions = ['draft', 'approved', 'scheduled', 'posting', 'posted', 'error', 'expired', 'skipped'];

	// Edit & schedule dialog
	let dialogOpen = $state(false);
	let editing = $state<PostRow | null>(null);
	let editBody = $state('');
	let editTimingMode = $state<'exact' | 'random'>('exact');
	let editScheduledFor = $state('');
	let editRandomStart = $state('');
	let editRandomEnd = $state('');
	let editRepeat = $state('');
	let editRepeatUntil = $state('');

	// --- New post ---------------------------------------------------------------------------
	// Until now every post came from Generate or Topics, so there was no way to put a specific
	// message in the queue by hand — which is exactly what a standing ad needs, since its copy is
	// written once and never regenerated.
	let newOpen = $state(false);
	let newAccount = $state('');
	let newBody = $state('');
	let newScheduledFor = $state('');
	let newRepeat = $state('');
	let newRepeatUntil = $state('');

	function openNew() {
		newAccount = data.accounts[0]?.id ?? '';
		newBody = '';
		newScheduledFor = '';
		newRepeat = '';
		newRepeatUntil = '';
		newOpen = true;
	}

	async function createPost(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		try {
			const created = await pb.collection('posts').create({
				account: newAccount,
				// 'evergreen', not 'topical': there is no topic behind a hand-written post, and a
				// topical post with no topic gets expired by the scheduler on its first tick.
				kind: 'evergreen',
				body: newBody,
				media: [],
				// 'approved' skips the review step the generator's drafts need — this copy was
				// written by hand in this dialog, so there is nothing left to review.
				status: 'approved',
				timing_mode: 'exact',
				scheduled_for: newScheduledFor || null,
				repeat: newRepeat,
				repeat_until: newRepeat ? newRepeatUntil || null : null,
				attempts: 0
			});
			newOpen = false;
			await invalidateAll();
			return created;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not create the post.';
		}
	}

	function openEdit(post: PostRow) {
		editing = post;
		editBody = post.body;
		editTimingMode = (post.timingMode as 'exact' | 'random') || 'exact';
		editScheduledFor = post.scheduledFor ?? '';
		editRandomStart = post.randomWindowStart ?? '';
		editRandomEnd = post.randomWindowEnd ?? '';
		editRepeat = post.repeat ?? '';
		editRepeatUntil = post.repeatUntil ?? '';
		dialogOpen = true;
	}

	async function run(fn: () => Promise<unknown>) {
		error = '';
		try {
			await fn();
			await invalidateAll();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		}
	}

	async function saveEdit(e: SubmitEvent) {
		e.preventDefault();
		if (!editing) return;
		const payload: Record<string, unknown> = {
			body: editBody,
			timing_mode: editTimingMode,
			repeat: editRepeat,
			repeat_until: editRepeat ? editRepeatUntil || null : null
		};
		if (editTimingMode === 'exact') {
			payload.scheduled_for = editScheduledFor || null;
		} else {
			payload.random_window_start = editRandomStart || null;
			payload.random_window_end = editRandomEnd || null;
		}
		await run(() => pb.collection('posts').update(editing!.id, payload));
		dialogOpen = false;
	}

	const approve = (id: string) => run(() => pb.collection('posts').update(id, { status: 'approved' }));

	function remove(id: string) {
		if (!confirm('Delete this post permanently?')) return;
		run(() => pb.collection('posts').delete(id));
	}

	const postNow = (id: string) =>
		run(() =>
			pb.collection('jobs').create({ type: 'post_now', payload: { postId: id }, status: 'queued', attempts: 0 })
		);

	const regenerateImage = (id: string) =>
		run(() =>
			pb
				.collection('jobs')
				.create({ type: 'generate_image', payload: { postId: id }, status: 'queued', attempts: 0 })
		);

	function formatDate(iso: string | null | undefined) {
		if (!iso) return null;
		const d = new Date(iso);
		return Number.isNaN(d.getTime())
			? null
			: d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}

	function timingLabel(post: PostRow) {
		if (post.timingMode === 'random') {
			const s = formatDate(post.randomWindowStart);
			const e = formatDate(post.randomWindowEnd);
			return s && e ? `Random: ${s} – ${e}` : 'Random window not set';
		}
		return formatDate(post.scheduledFor) ?? 'Not scheduled';
	}

	const repeatLabels: Record<string, string> = { daily: 'Daily', weekdays: 'Weekdays', weekly: 'Weekly' };

	function repeatUntilLabel(post: PostRow) {
		return post.repeatUntil ? `Repeats until ${formatDate(post.repeatUntil)}` : 'Repeats indefinitely';
	}
</script>

<PageHeader title="Queue" description="Edit, approve, schedule, or force-publish content.">
	{#snippet actions()}
		<Button onclick={openNew} disabled={data.accounts.length === 0}>
			<PlusIcon class="size-4" />
			New post
		</Button>
		<Select
			type="single"
			value={statusFilter}
			onValueChange={(v) => applyFilters({ status: v })}
			items={[{ value: 'all', label: 'All statuses' }, ...statusOptions.map((s) => ({ value: s, label: s }))]}
		>
			<SelectTrigger class="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
			<SelectContent>
				<SelectItem value="all" label="All statuses">All statuses</SelectItem>
				{#each statusOptions as s (s)}
					<SelectItem value={s} label={s}>{s}</SelectItem>
				{/each}
			</SelectContent>
		</Select>
		<Select
			type="single"
			value={personaFilter}
			onValueChange={(v) => applyFilters({ persona: v })}
			items={[
				{ value: 'all', label: 'All personas' },
				...data.personas.map((p) => ({ value: p.id, label: p.name }))
			]}
		>
			<SelectTrigger class="w-44"><SelectValue placeholder="Persona" /></SelectTrigger>
			<SelectContent>
				<SelectItem value="all" label="All personas">All personas</SelectItem>
				{#each data.personas as p (p.id)}
					<SelectItem value={p.id} label={p.name}>{p.name}</SelectItem>
				{/each}
			</SelectContent>
		</Select>
	{/snippet}
</PageHeader>

{#if error}
	<p class="rounded-md border-2 border-border bg-destructive px-3 py-2 text-sm font-bold text-destructive-foreground">
		{error}
	</p>
{/if}

<Card>
	<CardContent class="p-0">
		{#if data.posts.length === 0}
			<p class="p-5 text-sm font-medium text-muted-foreground">
				No posts match these filters. Use Generate or Topics to create drafts.
			</p>
		{:else}
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Persona / Platform</TableHead>
						<TableHead>Kind</TableHead>
						<TableHead>Timing</TableHead>
						<TableHead>Status</TableHead>
						<TableHead class="w-12"></TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#each data.posts as post (post.id)}
						<TableRow>
							<TableCell>
								<div class="font-semibold">{post.personaName}</div>
								<div class="text-muted-foreground">
									{post.accountPlatform}{post.topicTitle ? ` · ${post.topicTitle}` : ''}
								</div>
							</TableCell>
							<TableCell><Badge variant="outline">{post.kind}</Badge></TableCell>
							<TableCell class="text-muted-foreground">
								{timingLabel(post)}
								{#if post.repeat}
									<Tooltip>
										<TooltipTrigger class="ml-1.5 cursor-default border-0 bg-transparent p-0 align-middle">
											<Badge variant="muted">{repeatLabels[post.repeat] ?? post.repeat}</Badge>
										</TooltipTrigger>
										<TooltipContent>{repeatUntilLabel(post)}</TooltipContent>
									</Tooltip>
								{/if}
							</TableCell>
							<TableCell>
								{#if post.status === 'error' && post.errorMessage}
									<Tooltip>
										<TooltipTrigger class="cursor-default border-0 bg-transparent p-0">
											<Badge variant={statusVariant(post.status)}>{post.status}</Badge>
										</TooltipTrigger>
										<TooltipContent>{post.errorMessage}</TooltipContent>
									</Tooltip>
								{:else}
									<Badge variant={statusVariant(post.status)}>{post.status}</Badge>
								{/if}
								{#if post.status === 'posting' && liveJobDetail[post.id]}
									<div class="mt-0.5 text-xs font-medium text-muted-foreground">{liveJobDetail[post.id]}</div>
								{/if}
							</TableCell>
							<TableCell>
								<DropdownMenu>
									<DropdownMenuTrigger>
										{#snippet child({ props })}
											<Button {...props} variant="ghost" size="icon">
												<EllipsisIcon class="size-4" />
											</Button>
										{/snippet}
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuItem onclick={() => openEdit(post)}>
											<PencilIcon class="size-4" />
											Edit & schedule
										</DropdownMenuItem>
										{#if post.status === 'draft'}
											<DropdownMenuItem onclick={() => approve(post.id)}>
												<CheckIcon class="size-4" />
												Approve
											</DropdownMenuItem>
										{/if}
										{#if post.status === 'approved' || post.status === 'scheduled'}
											<DropdownMenuItem onclick={() => postNow(post.id)}>
												<SendIcon class="size-4" />
												Post now
											</DropdownMenuItem>
										{/if}
										<DropdownMenuItem onclick={() => regenerateImage(post.id)}>
											<RefreshCwIcon class="size-4" />
											Regenerate image
										</DropdownMenuItem>
										<DropdownMenuSeparator />
										<DropdownMenuItem variant="destructive" onclick={() => remove(post.id)}>
											<TrashIcon class="size-4" />
											Delete
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</TableCell>
						</TableRow>
					{/each}
				</TableBody>
			</Table>
			<Pager
				page={data.page}
				totalPages={data.totalPages}
				totalItems={data.totalItems}
				onPrev={() => applyFilters({ page: data.page - 1 })}
				onNext={() => applyFilters({ page: data.page + 1 })}
			/>
		{/if}
	</CardContent>
</Card>

<Dialog bind:open={dialogOpen}>
	<DialogContent class="sm:max-w-xl">
		{#key editing?.id ?? 'none'}
			<form onsubmit={saveEdit} class="grid gap-4">
				<DialogHeader>
					<DialogTitle>Edit post</DialogTitle>
					<DialogDescription>
						{editing?.personaName} on {editing?.accountPlatform}
						{editing?.topicTitle ? `· ${editing.topicTitle}` : ''}
					</DialogDescription>
				</DialogHeader>

				<div class="grid gap-1.5">
					<Label for="body">Body</Label>
					<Textarea id="body" bind:value={editBody} rows={6} />
				</div>

				<div class="grid gap-1.5">
					<Label>Image</Label>
					{#if editing?.media?.length}
						<ul class="grid gap-1 text-xs font-medium text-muted-foreground">
							{#each editing.media as path (path)}
								<li class="flex items-center gap-1.5 truncate">
									<ImageIcon class="size-3.5 shrink-0" />
									{path}
								</li>
							{/each}
						</ul>
					{:else}
						<p class="text-xs font-medium text-muted-foreground">No image for this post.</p>
					{/if}
					<Button type="button" variant="outline" size="sm" onclick={() => editing && regenerateImage(editing.id)}>
						<RefreshCwIcon class="size-4" />
						Regenerate image
					</Button>
				</div>

				<div class="grid gap-1.5">
					<Label for="timingMode">Timing</Label>
					<Select
						type="single"
						bind:value={editTimingMode}
						items={[
							{ value: 'exact', label: 'Exact time' },
							{ value: 'random', label: 'Random window' }
						]}
					>
						<SelectTrigger id="timingMode"><SelectValue /></SelectTrigger>
						<SelectContent>
							<SelectItem value="exact" label="Exact time">Exact time</SelectItem>
							<SelectItem value="random" label="Random window">Random window</SelectItem>
						</SelectContent>
					</Select>
				</div>

				{#if editTimingMode === 'exact'}
					<div class="grid gap-1.5">
						<Label>Publish at</Label>
						<DateTimePicker bind:value={editScheduledFor} placeholder="Pick a date & time" />
					</div>
				{:else}
					<div class="grid gap-4 sm:grid-cols-2">
						<div class="grid gap-1.5">
							<Label>Window start</Label>
							<DateTimePicker bind:value={editRandomStart} placeholder="Earliest" />
						</div>
						<div class="grid gap-1.5">
							<Label>Window end</Label>
							<DateTimePicker bind:value={editRandomEnd} placeholder="Latest" />
						</div>
					</div>
				{/if}

				<div class="grid gap-1.5">
					<Label for="repeat">Repeats</Label>
					<Select
						type="single"
						bind:value={editRepeat}
						items={[
							{ value: '', label: 'One-off' },
							{ value: 'daily', label: 'Daily' },
							{ value: 'weekdays', label: 'Weekdays' },
							{ value: 'weekly', label: 'Weekly' }
						]}
					>
						<SelectTrigger id="repeat"><SelectValue placeholder="One-off" /></SelectTrigger>
						<SelectContent>
							<SelectItem value="" label="One-off">One-off</SelectItem>
							<SelectItem value="daily" label="Daily">Daily</SelectItem>
							<SelectItem value="weekdays" label="Weekdays">Weekdays</SelectItem>
							<SelectItem value="weekly" label="Weekly">Weekly</SelectItem>
						</SelectContent>
					</Select>
				</div>

				{#if editRepeat}
					<div class="grid gap-1.5">
						<Label>Until</Label>
						<DateTimePicker bind:value={editRepeatUntil} placeholder="Repeats forever" />
					</div>
				{/if}

				{#if editing?.variantGroup}
					<p class="text-xs font-medium text-muted-foreground">
						Part of a batch of variants generated together ({editing.variantGroup}).
					</p>
				{/if}

				<DialogFooter>
					<Button type="submit">Save changes</Button>
				</DialogFooter>
			</form>
		{/key}
	</DialogContent>
</Dialog>

<Dialog bind:open={newOpen}>
	<DialogContent class="max-w-2xl">
		<form onsubmit={createPost} class="grid gap-4">
			<DialogHeader>
				<DialogTitle>New post</DialogTitle>
				<DialogDescription>
					Write a message by hand instead of generating one. Set it to repeat for a standing ad.
				</DialogDescription>
			</DialogHeader>

			<div class="grid gap-1.5">
				<Label for="newAccount">Account</Label>
				<Select
					type="single"
					bind:value={newAccount}
					items={data.accounts.map((a) => ({ value: a.id, label: `${a.personaName} · ${a.platform} · ${a.handle}` }))}
				>
					<SelectTrigger id="newAccount"><SelectValue placeholder="Choose an account" /></SelectTrigger>
					<SelectContent>
						{#each data.accounts as a (a.id)}
							<SelectItem value={a.id} label="{a.personaName} · {a.platform} · {a.handle}">
								{a.personaName} · {a.platform} · {a.handle}
							</SelectItem>
						{/each}
					</SelectContent>
				</Select>
			</div>

			<div class="grid gap-1.5">
				<Label for="newBody">Message</Label>
				<Textarea id="newBody" bind:value={newBody} rows={6} required />
			</div>

			<div class="grid gap-1.5">
				<Label>Scheduled for</Label>
				<DateTimePicker bind:value={newScheduledFor} placeholder="Next posting window" />
			</div>

			<div class="grid gap-1.5">
				<Label for="newRepeat">Repeats</Label>
				<Select
					type="single"
					bind:value={newRepeat}
					items={[
						{ value: '', label: 'One-off' },
						{ value: 'daily', label: 'Daily' },
						{ value: 'weekdays', label: 'Weekdays' },
						{ value: 'weekly', label: 'Weekly' }
					]}
				>
					<SelectTrigger id="newRepeat"><SelectValue placeholder="One-off" /></SelectTrigger>
					<SelectContent>
						<SelectItem value="" label="One-off">One-off</SelectItem>
						<SelectItem value="daily" label="Daily">Daily</SelectItem>
						<SelectItem value="weekdays" label="Weekdays">Weekdays</SelectItem>
						<SelectItem value="weekly" label="Weekly">Weekly</SelectItem>
					</SelectContent>
				</Select>
			</div>

			{#if newRepeat}
				<div class="grid gap-1.5">
					<Label>Until</Label>
					<DateTimePicker bind:value={newRepeatUntil} placeholder="Repeats forever" />
				</div>
			{/if}

			<p class="text-xs font-medium text-muted-foreground">
				No image yet — add one with “Generate image” from the row menu once the post exists. WhatsApp
				Status will not publish without one.
			</p>

			<DialogFooter>
				<Button type="submit">Create</Button>
			</DialogFooter>
		</form>
	</DialogContent>
</Dialog>
