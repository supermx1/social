<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page as pageStore } from '$app/state';
	import { pb } from '$lib/pb';
import { errorMessage } from '$lib/errors';
	import { subscribeToCollectionChanges } from '$lib/realtime';
	import { textValue, numberValue, idsValue } from '$lib/forms';
	import { statusVariant } from '$lib/status';
	import { onMount } from 'svelte';
	import PageHeader from '$lib/components/page-header.svelte';
	import Pager from '$lib/components/pager.svelte';
	import DateTimePicker from '$lib/components/date-time-picker.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
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
		DropdownMenuItem
	} from '$lib/components/ui/dropdown-menu';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import XIcon from '@lucide/svelte/icons/x';

	let { data } = $props();
	type TopicRow = (typeof data.topics)[number];

	let error = $state('');

	onMount(() => subscribeToCollectionChanges(pb, ['topics', 'personas', 'feeds'], invalidateAll));

	// Create dialog
	let dialogOpen = $state(false);
	let newUrgency = $state('normal');
	let newExpiresAt = $state('');

	function openCreate() {
		newUrgency = 'normal';
		newExpiresAt = '';
		dialogOpen = true;
	}

	async function create(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		const form = e.currentTarget as HTMLFormElement;
		const fd = new FormData(form);
		try {
			await pb.collection('topics').create({
				title: textValue(fd, 'title'),
				source_url: textValue(fd, 'sourceUrl'),
				raw_content: textValue(fd, 'rawContent'),
				urgency: textValue(fd, 'urgency', 'normal'),
				expires_at: newExpiresAt || null,
				personas: idsValue(fd, 'personaId'),
				source_type: 'manual',
				status: 'new'
			});
			dialogOpen = false;
			await invalidateAll();
		} catch (err) {
			error = errorMessage(err);
		}
	}

	// Generate-drafts dialog
	let generateDialogOpen = $state(false);
	let generateFor = $state<TopicRow | null>(null);
	let generatePlatform = $state('x');
	// Preselected rather than left blank: the persona Select had no default, so submitting the
	// dialog untouched queued a job with personaId "" and the worker failed with the baffling
	// "No active x account for persona ." — an error naming a persona that isn't there.
	let generatePersonaId = $state('');

	function openGenerate(topic: TopicRow) {
		generateFor = topic;
		generatePlatform = 'x';
		generatePersonaId = data.personas[0]?.id ?? '';
		generateDialogOpen = true;
	}

	async function generate(e: SubmitEvent) {
		e.preventDefault();
		if (!generateFor) return;
		error = '';
		const fd = new FormData(e.currentTarget as HTMLFormElement);
		try {
			await pb.collection('jobs').create({
				type: 'generate',
				payload: {
						personaId: generatePersonaId,
					platform: textValue(fd, 'platform'),
					n: numberValue(fd, 'n', 3),
					topicId: generateFor.id
				},
				status: 'queued',
				attempts: 0
			});
			generateDialogOpen = false;
			generateFor = null;
			await invalidateAll();
		} catch (err) {
			error = errorMessage(err);
		}
	}

	async function dismiss(id: string) {
		error = '';
		try {
			await pb.collection('topics').update(id, { status: 'dismissed' });
			await invalidateAll();
		} catch (err) {
			error = errorMessage(err);
		}
	}

	async function remove(id: string) {
		if (!confirm('Delete this topic? This cannot be undone.')) return;
		error = '';
		try {
			await pb.collection('topics').delete(id);
			await invalidateAll();
		} catch (err) {
			error = errorMessage(err);
		}
	}

	function goToPage(n: number) {
		const params = new URLSearchParams(pageStore.url.searchParams);
		params.set('page', String(n));
		goto(`?${params}`, { keepFocus: true, noScroll: true });
	}
</script>

<PageHeader
	title="Topics"
	description="Real-world signals that seed topical posts — nothing here ever auto-publishes."
>
	{#snippet actions()}
		<Button onclick={openCreate}>
			<PlusIcon class="size-4" />
			New topic
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
		{#if data.topics.length === 0}
			<p class="p-5 text-sm font-medium text-muted-foreground">No topics yet — add the first signal.</p>
		{:else}
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Title</TableHead>
						<TableHead>Urgency</TableHead>
						<TableHead>Personas</TableHead>
						<TableHead>Source</TableHead>
						<TableHead>Status</TableHead>
						<TableHead class="w-12"></TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#each data.topics as topic (topic.id)}
						<TableRow>
							<TableCell class="max-w-sm">
								<p class="font-semibold">{topic.title}</p>
								<p class="truncate text-xs text-muted-foreground">{topic.rawContent}</p>
							</TableCell>
							<TableCell><Badge variant={statusVariant(topic.urgency)}>{topic.urgency}</Badge></TableCell>
							<TableCell>
								<div class="flex flex-wrap gap-1">
									{#each topic.personaNames as name (name)}
										<Badge variant="outline">{name}</Badge>
									{:else}
										<span class="text-muted-foreground">—</span>
									{/each}
								</div>
							</TableCell>
							<TableCell class="text-muted-foreground">{topic.feedName || 'manual'}</TableCell>
							<TableCell><Badge variant={statusVariant(topic.status)}>{topic.status}</Badge></TableCell>
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
										<DropdownMenuItem onclick={() => openGenerate(topic)}>
											<SparklesIcon class="size-4" />
											Generate drafts
										</DropdownMenuItem>
										<DropdownMenuItem onclick={() => dismiss(topic.id)}>
											<XIcon class="size-4" />
											Dismiss
										</DropdownMenuItem>
										<DropdownMenuItem variant="destructive" onclick={() => remove(topic.id)}>
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
				onPrev={() => goToPage(data.page - 1)}
				onNext={() => goToPage(data.page + 1)}
			/>
		{/if}
	</CardContent>
</Card>

<Dialog bind:open={dialogOpen}>
	<DialogContent class="sm:max-w-2xl">
		<form onsubmit={create} class="grid gap-4">
			<DialogHeader>
				<DialogTitle>New topic</DialogTitle>
				<DialogDescription>
					A grounded, real-world signal — this only ever produces drafts.
				</DialogDescription>
			</DialogHeader>

			<div class="grid gap-1.5">
				<Label for="title">Title</Label>
				<Input id="title" name="title" required placeholder="What's happening" />
			</div>

			<div class="grid gap-1.5">
				<Label for="sourceUrl">Source URL</Label>
				<Input id="sourceUrl" name="sourceUrl" type="url" placeholder="https://..." />
			</div>

			<div class="grid gap-1.5">
				<Label for="rawContent">Facts</Label>
				<Textarea
					id="rawContent"
					name="rawContent"
					required
					placeholder="The grounding text every draft will be based on"
				/>
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="grid gap-1.5">
					<Label for="urgency">Urgency</Label>
					<Select type="single" name="urgency" bind:value={newUrgency}>
						<SelectTrigger id="urgency"><SelectValue placeholder="Urgency" /></SelectTrigger>
						<SelectContent>
							<SelectItem value="low" label="low">low</SelectItem>
							<SelectItem value="normal" label="normal">normal</SelectItem>
							<SelectItem value="high" label="high">high</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div class="grid gap-1.5">
					<Label for="expiresAt">Expires at</Label>
					<DateTimePicker bind:value={newExpiresAt} placeholder="No expiry" />
				</div>
			</div>

			<div class="grid gap-1.5">
				<p class="text-sm font-bold">Relevant personas</p>
				<div class="flex flex-wrap gap-3">
					{#each data.personas as persona (persona.id)}
						<label class="flex items-center gap-2">
							<input
								type="checkbox"
								name="personaId"
								value={persona.id}
								class="size-4 rounded-sm border-2 border-border accent-primary"
							/>
							<span class="text-sm font-medium">{persona.name}</span>
						</label>
					{/each}
				</div>
			</div>

			<DialogFooter>
				<Button type="submit">Create topic</Button>
			</DialogFooter>
		</form>
	</DialogContent>
</Dialog>

<Dialog bind:open={generateDialogOpen}>
	<DialogContent>
		{#key generateFor?.id ?? 'none'}
			<form onsubmit={generate} class="grid gap-4">
				<DialogHeader>
					<DialogTitle>Generate drafts{generateFor ? ` for ${generateFor.title}` : ''}</DialogTitle>
					<DialogDescription>Queues a worker job that creates draft variants only.</DialogDescription>
				</DialogHeader>

				<div class="grid gap-1.5">
					<Label for="generatePersonaId">Persona</Label>
					<Select
						type="single"
						name="personaId"
						bind:value={generatePersonaId}
						items={data.personas.map((p) => ({ value: p.id, label: p.name }))}
					>
						<SelectTrigger id="generatePersonaId"><SelectValue placeholder="Persona" /></SelectTrigger>
						<SelectContent>
							{#each data.personas as persona (persona.id)}
								<SelectItem value={persona.id} label={persona.name}>{persona.name}</SelectItem>
							{/each}
						</SelectContent>
					</Select>
				</div>

				<div class="grid gap-1.5">
					<Label for="generatePlatform">Platform</Label>
					<Select type="single" name="platform" bind:value={generatePlatform}>
						<SelectTrigger id="generatePlatform"><SelectValue placeholder="Platform" /></SelectTrigger>
						<SelectContent>
							<SelectItem value="x" label="x">x</SelectItem>
							<SelectItem value="linkedin" label="linkedin">linkedin</SelectItem>
							<SelectItem value="facebook_page" label="facebook_page">facebook_page</SelectItem>
							<SelectItem value="youtube_community" label="youtube_community">youtube_community</SelectItem>
						</SelectContent>
					</Select>
				</div>

				<div class="grid gap-1.5">
					<Label for="generateN">Variants</Label>
					<Input id="generateN" name="n" type="number" min="1" max="5" value="3" />
				</div>

				<DialogFooter>
					<Button type="submit">Generate drafts</Button>
				</DialogFooter>
			</form>
		{/key}
	</DialogContent>
</Dialog>
