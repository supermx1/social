<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { pb } from '$lib/pb';
	import { subscribeToCollectionChanges } from '$lib/realtime';
	import { textValue, numberValue } from '$lib/forms';
	import { onMount } from 'svelte';
	import PageHeader from '$lib/components/page-header.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
	import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '$lib/components/ui/select';

	let { data } = $props();
	let error = $state('');
	let done = $state(false);

	onMount(() => subscribeToCollectionChanges(pb, ['personas'], invalidateAll));

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		done = false;
		const form = e.currentTarget as HTMLFormElement;
		const fd = new FormData(form);
		try {
			await pb.collection('jobs').create({
				type: 'generate',
				payload: {
					personaId: textValue(fd, 'personaId'),
					platform: textValue(fd, 'platform'),
					pillar: textValue(fd, 'pillar'),
					n: numberValue(fd, 'n', 3)
				},
				status: 'queued',
				attempts: 0
			});
			done = true;
			await invalidateAll();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		}
	}
</script>

<PageHeader
	title="Generate"
	description="Evergreen Mode A — creates draft variants only, grounded in the persona brief."
/>

{#if error}
	<p class="rounded-md border-2 border-border bg-destructive px-3 py-2 text-sm font-bold text-destructive-foreground">
		{error}
	</p>
{/if}

{#if done}
	<Badge variant="success" class="w-fit text-sm">Generation job queued.</Badge>
{/if}

<Card>
	<CardHeader>
		<CardTitle>New batch</CardTitle>
	</CardHeader>
	<CardContent>
		<form onsubmit={submit} class="grid gap-4 sm:grid-cols-2">
			<div class="grid gap-1.5">
				<Label for="personaId">Persona</Label>
				<Select type="single" name="personaId" items={data.personas.map((p) => ({ value: p.id, label: p.name }))}>
					<SelectTrigger id="personaId"><SelectValue placeholder="Persona" /></SelectTrigger>
					<SelectContent>
						{#if data.personas.length === 0}
							<SelectItem value="" label="No personas yet" disabled>No personas yet</SelectItem>
						{:else}
							{#each data.personas as persona (persona.id)}
								<SelectItem value={persona.id} label={persona.name}>{persona.name}</SelectItem>
							{/each}
						{/if}
					</SelectContent>
				</Select>
			</div>

			<div class="grid gap-1.5">
				<Label for="platform">Platform</Label>
				<Select type="single" name="platform">
					<SelectTrigger id="platform"><SelectValue placeholder="Platform" /></SelectTrigger>
					<SelectContent>
						<SelectItem value="x" label="x">x</SelectItem>
						<SelectItem value="linkedin" label="linkedin">linkedin</SelectItem>
						<SelectItem value="facebook_page" label="facebook_page">facebook_page</SelectItem>
						<SelectItem value="youtube_community" label="youtube_community">youtube_community</SelectItem>
					</SelectContent>
				</Select>
			</div>

			<div class="grid gap-1.5">
				<Label for="pillar">Pillar</Label>
				<Input id="pillar" name="pillar" placeholder="build in public" />
			</div>

			<div class="grid gap-1.5">
				<Label for="n">Variants</Label>
				<Input id="n" name="n" type="number" min="1" max="5" value="3" />
			</div>

			<div class="sm:col-span-2">
				<Button type="submit">Queue generation job</Button>
			</div>
		</form>
	</CardContent>
</Card>
