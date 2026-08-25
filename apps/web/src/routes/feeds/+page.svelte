<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { pb } from '$lib/pb';
import { errorMessage } from '$lib/errors';
	import { subscribeToCollectionChanges } from '$lib/realtime';
	import { textValue, numberValue, boolValue, idsValue } from '$lib/forms';
	import { onMount } from 'svelte';
	import PageHeader from '$lib/components/page-header.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Badge } from '$lib/components/ui/badge';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '$lib/components/ui/table';
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
	import PlusIcon from '@lucide/svelte/icons/plus';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import RssIcon from '@lucide/svelte/icons/rss';

	let { data } = $props();
	type FeedRow = (typeof data.feeds)[number];

	let error = $state('');
	let dialogOpen = $state(false);
	let editing = $state<FeedRow | null>(null);

	onMount(() => subscribeToCollectionChanges(pb, ['feeds', 'personas'], invalidateAll));

	function openCreate() {
		editing = null;
		dialogOpen = true;
	}

	function openEdit(feed: FeedRow) {
		editing = feed;
		dialogOpen = true;
	}

	function feedBody(fd: FormData) {
		return {
			name: textValue(fd, 'name'),
			url: textValue(fd, 'url'),
			poll_interval_minutes: numberValue(fd, 'pollIntervalMinutes', 180),
			freshness_hours: numberValue(fd, 'freshnessHours', 48),
			max_items_per_poll: numberValue(fd, 'maxItemsPerPoll', 10),
			auto_draft: boolValue(fd, 'autoDraft'),
			personas: idsValue(fd, 'personaId')
		};
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		const fd = new FormData(e.currentTarget as HTMLFormElement);
		try {
			if (editing) {
				await pb.collection('feeds').update(editing.id, feedBody(fd));
			} else {
				await pb.collection('feeds').create({ ...feedBody(fd), active: true });
			}
			dialogOpen = false;
			await invalidateAll();
		} catch (err) {
			error = errorMessage(err);
		}
	}

	async function poll(id: string) {
		error = '';
		try {
			await pb.collection('jobs').create({
				type: 'feed_poll',
				payload: { feedId: id },
				status: 'queued',
				attempts: 0
			});
			await invalidateAll();
		} catch (err) {
			error = errorMessage(err);
		}
	}

	async function toggleActive(feed: FeedRow, active: boolean) {
		error = '';
		try {
			await pb.collection('feeds').update(feed.id, { active });
			await invalidateAll();
		} catch (err) {
			error = errorMessage(err);
		}
	}

	async function remove(id: string) {
		if (!confirm('Delete this feed? This stops future polling for it.')) return;
		error = '';
		try {
			await pb.collection('feeds').delete(id);
			await invalidateAll();
		} catch (err) {
			error = errorMessage(err);
		}
	}
</script>

<PageHeader title="Feeds" description="RSS/Atom sources that seed the Topics inbox — never auto-publishes.">
	{#snippet actions()}
		<Button onclick={openCreate}>
			<PlusIcon class="size-4" />
			New feed
		</Button>
	{/snippet}
</PageHeader>

{#if error}
	<p class="rounded-md border-2 border-border bg-destructive px-3 py-2 text-sm font-bold text-destructive-foreground">
		{error}
	</p>
{/if}

<Card>
	<CardContent class="p-0">
		{#if data.feeds.length === 0}
			<p class="p-5 text-sm font-medium text-muted-foreground">No feeds yet — create the first one.</p>
		{:else}
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Name</TableHead>
						<TableHead>Personas</TableHead>
						<TableHead>Poll interval</TableHead>
						<TableHead>Active</TableHead>
						<TableHead>Last error</TableHead>
						<TableHead class="w-12"></TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#each data.feeds as feed (feed.id)}
						<TableRow>
							<TableCell>
								<div class="font-semibold">{feed.name}</div>
								<div class="max-w-xs truncate text-xs font-medium text-muted-foreground">{feed.url}</div>
							</TableCell>
							<TableCell>
								<div class="flex flex-wrap gap-1">
									{#each feed.personaNames as name (name)}
										<Badge variant="outline">{name}</Badge>
									{:else}
										<span class="text-muted-foreground">—</span>
									{/each}
								</div>
							</TableCell>
							<TableCell class="text-muted-foreground">{feed.pollIntervalMinutes} min</TableCell>
							<TableCell>
								<Switch
									checked={feed.active}
									onCheckedChange={(v) => toggleActive(feed, v)}
								/>
							</TableCell>
							<TableCell class="max-w-xs">
								{#if feed.lastError}
									<Badge variant="destructive" class="block truncate">{feed.lastError}</Badge>
								{:else}
									<span class="text-muted-foreground">—</span>
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
										<DropdownMenuItem onclick={() => openEdit(feed)}>
											<PencilIcon class="size-4" />
											Edit
										</DropdownMenuItem>
										<DropdownMenuItem onclick={() => poll(feed.id)}>
											<RssIcon class="size-4" />
											Poll now
										</DropdownMenuItem>
										<DropdownMenuSeparator />
										<DropdownMenuItem variant="destructive" onclick={() => remove(feed.id)}>
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
	<DialogContent class="sm:max-w-2xl">
		{#key editing?.id ?? 'new'}
			<form onsubmit={submit} class="grid gap-4">
				<DialogHeader>
					<DialogTitle>{editing ? `Edit ${editing.name}` : 'New feed'}</DialogTitle>
					<DialogDescription>
						RSS/Atom source polled on a schedule to seed the Topics inbox.
					</DialogDescription>
				</DialogHeader>

				<div class="grid gap-4 sm:grid-cols-2">
					<div class="grid gap-1.5">
						<Label for="name">Name</Label>
						<Input id="name" name="name" required placeholder="TechCrunch" value={editing?.name ?? ''} />
					</div>
					<div class="grid gap-1.5">
						<Label for="url">URL</Label>
						<Input id="url" name="url" type="url" required placeholder="https://example.com/feed.xml" value={editing?.url ?? ''} />
					</div>
				</div>

				<div class="grid gap-4 sm:grid-cols-3">
					<div class="grid gap-1.5">
						<Label for="pollIntervalMinutes">Poll interval (min)</Label>
						<Input id="pollIntervalMinutes" name="pollIntervalMinutes" type="number" min="1" value={editing?.pollIntervalMinutes ?? 180} />
					</div>
					<div class="grid gap-1.5">
						<Label for="freshnessHours">Freshness (hours)</Label>
						<Input id="freshnessHours" name="freshnessHours" type="number" min="1" value={editing?.freshnessHours ?? 48} />
					</div>
					<div class="grid gap-1.5">
						<Label for="maxItemsPerPoll">Max items</Label>
						<Input id="maxItemsPerPoll" name="maxItemsPerPoll" type="number" min="1" value={editing?.maxItemsPerPoll ?? 10} />
					</div>
				</div>

				<div class="grid gap-1.5">
					<Label>Personas</Label>
					<div class="grid gap-2 sm:grid-cols-2">
						{#each data.personas as persona (persona.id)}
							<label class="flex items-center gap-2">
								<input
									type="checkbox"
									name="personaId"
									value={persona.id}
									checked={editing?.personaIds?.includes(persona.id) ?? false}
									class="size-4 rounded-sm border-2 border-border accent-primary"
								/>
								<span class="text-sm font-medium">{persona.name}</span>
							</label>
						{/each}
					</div>
				</div>

				<label class="flex items-center gap-2">
					<Switch name="autoDraft" checked={editing?.autoDraft ?? false} />
					<span class="text-sm font-bold">Auto-draft high-relevance items</span>
				</label>

				<DialogFooter>
					<Button type="submit">{editing ? 'Save changes' : 'Create feed'}</Button>
				</DialogFooter>
			</form>
		{/key}
	</DialogContent>
</Dialog>
