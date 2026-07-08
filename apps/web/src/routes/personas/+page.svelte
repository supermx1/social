<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { pb } from '$lib/pb';
	import { subscribeToCollectionChanges } from '$lib/realtime';
	import { textValue, listValue, boolValue } from '$lib/forms';
	import { onMount } from 'svelte';
	import PageHeader from '$lib/components/page-header.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
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
		DropdownMenuItem
	} from '$lib/components/ui/dropdown-menu';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import TrashIcon from '@lucide/svelte/icons/trash-2';

	let { data } = $props();
	type PersonaRow = (typeof data.personas)[number];

	let error = $state('');
	let dialogOpen = $state(false);
	let editing = $state<PersonaRow | null>(null);

	onMount(() => subscribeToCollectionChanges(pb, ['personas'], invalidateAll));

	function openCreate() {
		editing = null;
		dialogOpen = true;
	}

	function openEdit(persona: PersonaRow) {
		editing = persona;
		dialogOpen = true;
	}

	function personaBody(fd: FormData) {
		return {
			name: textValue(fd, 'name'),
			mission: textValue(fd, 'mission'),
			audience: textValue(fd, 'audience'),
			voice_tone: textValue(fd, 'voiceTone'),
			guardrails: textValue(fd, 'guardrails'),
			content_pillars: listValue(fd, 'contentPillars'),
			domain_keywords: listValue(fd, 'domainKeywords'),
			example_posts: listValue(fd, 'examplePosts'),
			default_hashtags: listValue(fd, 'defaultHashtags'),
			active: boolValue(fd, 'active')
		};
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		const fd = new FormData(e.currentTarget as HTMLFormElement);
		try {
			if (editing) {
				await pb.collection('personas').update(editing.id, personaBody(fd));
			} else {
				await pb.collection('personas').create({ ...personaBody(fd), slug: textValue(fd, 'slug') });
			}
			dialogOpen = false;
			await invalidateAll();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		}
	}

	async function toggleActive(persona: PersonaRow, active: boolean) {
		try {
			await pb.collection('personas').update(persona.id, { active });
			await invalidateAll();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		}
	}

	async function remove(id: string) {
		if (!confirm('Delete this persona? This also removes its accounts and posts.')) return;
		error = '';
		try {
			await pb.collection('personas').delete(id);
			await invalidateAll();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		}
	}
</script>

<PageHeader title="Personas" description="Brand identity and voice, one brief per brand.">
	{#snippet actions()}
		<Button onclick={openCreate}>
			<PlusIcon class="size-4" />
			New persona
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
		{#if data.personas.length === 0}
			<p class="p-5 text-sm font-medium text-muted-foreground">No personas yet — create the first one.</p>
		{:else}
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Name</TableHead>
						<TableHead>Slug</TableHead>
						<TableHead>Content pillars</TableHead>
						<TableHead>Active</TableHead>
						<TableHead class="w-12"></TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#each data.personas as persona (persona.id)}
						<TableRow>
							<TableCell class="font-semibold">{persona.name}</TableCell>
							<TableCell class="text-muted-foreground">{persona.slug}</TableCell>
							<TableCell>
								<div class="flex flex-wrap gap-1">
									{#each persona.contentPillars.slice(0, 3) as pillar (pillar)}
										<Badge variant="outline">{pillar}</Badge>
									{:else}
										<span class="text-muted-foreground">—</span>
									{/each}
									{#if persona.contentPillars.length > 3}
										<Badge variant="muted">+{persona.contentPillars.length - 3}</Badge>
									{/if}
								</div>
							</TableCell>
							<TableCell>
								<Switch
									checked={persona.active}
									onCheckedChange={(v) => toggleActive(persona, v)}
								/>
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
										<DropdownMenuItem onclick={() => openEdit(persona)}>
											<PencilIcon class="size-4" />
											Edit
										</DropdownMenuItem>
										<DropdownMenuItem variant="destructive" onclick={() => remove(persona.id)}>
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
					<DialogTitle>{editing ? `Edit ${editing.name}` : 'New persona'}</DialogTitle>
					<DialogDescription>
						The brand brief every generated post is grounded in.
					</DialogDescription>
				</DialogHeader>

				<div class="grid gap-4 sm:grid-cols-2">
					<div class="grid gap-1.5">
						<Label for="name">Name</Label>
						<Input id="name" name="name" required placeholder="TheAverageTechDad" value={editing?.name ?? ''} />
					</div>
					<div class="grid gap-1.5">
						<Label for="slug">Slug</Label>
						{#if editing}
							<Input id="slug" value={editing.slug} disabled />
						{:else}
							<Input id="slug" name="slug" required placeholder="techdad" />
						{/if}
					</div>
				</div>

				<div class="grid gap-1.5">
					<Label for="mission">Mission</Label>
					<Textarea id="mission" name="mission" value={editing?.mission ?? ''} />
				</div>
				<div class="grid gap-1.5">
					<Label for="audience">Audience</Label>
					<Textarea id="audience" name="audience" value={editing?.audience ?? ''} />
				</div>
				<div class="grid gap-1.5">
					<Label for="voiceTone">Voice tone</Label>
					<Textarea id="voiceTone" name="voiceTone" value={editing?.voiceTone ?? ''} />
				</div>
				<div class="grid gap-1.5">
					<Label for="guardrails">Guardrails</Label>
					<Textarea id="guardrails" name="guardrails" value={editing?.guardrails ?? ''} />
				</div>

				<div class="grid gap-4 sm:grid-cols-2">
					<div class="grid gap-1.5">
						<Label for="contentPillars">Content pillars <span class="font-normal text-muted-foreground">(one per line)</span></Label>
						<Textarea id="contentPillars" name="contentPillars" value={(editing?.contentPillars ?? []).join('\n')} />
					</div>
					<div class="grid gap-1.5">
						<Label for="domainKeywords">Domain keywords <span class="font-normal text-muted-foreground">(one per line)</span></Label>
						<Textarea id="domainKeywords" name="domainKeywords" value={(editing?.domainKeywords ?? []).join('\n')} />
					</div>
					<div class="grid gap-1.5">
						<Label for="examplePosts">Example posts <span class="font-normal text-muted-foreground">(one per line)</span></Label>
						<Textarea id="examplePosts" name="examplePosts" value={(editing?.examplePosts ?? []).join('\n')} />
					</div>
					<div class="grid gap-1.5">
						<Label for="defaultHashtags">Default hashtags <span class="font-normal text-muted-foreground">(one per line)</span></Label>
						<Textarea id="defaultHashtags" name="defaultHashtags" value={(editing?.defaultHashtags ?? []).join('\n')} />
					</div>
				</div>

				<label class="flex items-center gap-2">
					<Switch name="active" checked={editing?.active ?? true} />
					<span class="text-sm font-bold">Active</span>
				</label>

				<DialogFooter>
					<Button type="submit">{editing ? 'Save changes' : 'Create persona'}</Button>
				</DialogFooter>
			</form>
		{/key}
	</DialogContent>
</Dialog>
