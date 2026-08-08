<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { pb } from '$lib/pb';
	import { subscribeToCollectionChanges } from '$lib/realtime';
	import { onMount } from 'svelte';
	import PageHeader from '$lib/components/page-header.svelte';
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
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';

	let { data } = $props();
	type PostRow = (typeof data.posts)[number];

	let error = $state('');

	onMount(() => subscribeToCollectionChanges(pb, ['posts', 'accounts', 'personas', 'topics'], invalidateAll));

	// Filters — the full list is already loaded, so filtering is client-side.
	let statusFilter = $state('all');
	let personaFilter = $state('all');
	const personaOptions = $derived(
		[...new Map(data.posts.map((p) => [p.personaId, p.personaName])).entries()]
			.filter(([id]) => id)
			.map(([id, name]) => ({ id, name }))
	);
	const filteredPosts = $derived(
		data.posts.filter(
			(p) =>
				(statusFilter === 'all' || p.status === statusFilter) &&
				(personaFilter === 'all' || p.personaId === personaFilter)
		)
	);
	const statusOptions = ['draft', 'approved', 'scheduled', 'posting', 'posted', 'error', 'expired', 'skipped'];

	// Edit & schedule dialog
	let dialogOpen = $state(false);
	let editing = $state<PostRow | null>(null);
	let editBody = $state('');
	let editTimingMode = $state<'exact' | 'random'>('exact');
	let editScheduledFor = $state('');
	let editRandomStart = $state('');
	let editRandomEnd = $state('');

	function openEdit(post: PostRow) {
		editing = post;
		editBody = post.body;
		editTimingMode = (post.timingMode as 'exact' | 'random') || 'exact';
		editScheduledFor = post.scheduledFor ?? '';
		editRandomStart = post.randomWindowStart ?? '';
		editRandomEnd = post.randomWindowEnd ?? '';
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
		const payload: Record<string, unknown> = { body: editBody, timing_mode: editTimingMode };
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
</script>

<PageHeader title="Queue" description="Edit, approve, schedule, or force-publish content.">
	{#snippet actions()}
		<Select
			type="single"
			bind:value={statusFilter}
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
			bind:value={personaFilter}
			items={[
				{ value: 'all', label: 'All personas' },
				...personaOptions.map((p) => ({ value: p.id, label: p.name }))
			]}
		>
			<SelectTrigger class="w-44"><SelectValue placeholder="Persona" /></SelectTrigger>
			<SelectContent>
				<SelectItem value="all" label="All personas">All personas</SelectItem>
				{#each personaOptions as p (p.id)}
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
		{#if filteredPosts.length === 0}
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
					{#each filteredPosts as post (post.id)}
						<TableRow>
							<TableCell>
								<div class="font-semibold">{post.personaName}</div>
								<div class="text-muted-foreground">
									{post.accountPlatform}{post.topicTitle ? ` · ${post.topicTitle}` : ''}
								</div>
							</TableCell>
							<TableCell><Badge variant="outline">{post.kind}</Badge></TableCell>
							<TableCell class="text-muted-foreground">{timingLabel(post)}</TableCell>
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
