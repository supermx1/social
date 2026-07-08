<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { pb } from '$lib/pb';
	import { subscribeToCollectionChanges } from '$lib/realtime';
	import { onMount } from 'svelte';
	import PageHeader from '$lib/components/page-header.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
	import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '$lib/components/ui/table';
	import { statusVariant } from '$lib/status';
	import AtSignIcon from '@lucide/svelte/icons/at-sign';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import ActivityIcon from '@lucide/svelte/icons/activity';

	let { data } = $props();
	const needsReauth = $derived(data.accounts.filter((account) => account.sessionStatus === 'needs_reauth'));
	let error = $state('');
	let toggling = $state(false);

	onMount(() => subscribeToCollectionChanges(pb, ['accounts', 'posts', 'jobs', 'app_state'], invalidateAll));

	async function togglePause() {
		error = '';
		toggling = true;
		try {
			if (data.state) {
				await pb.collection('app_state').update(data.state.id, { paused: !data.state.paused });
			} else {
				await pb.collection('app_state').create({ paused: true });
			}
			await invalidateAll();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			toggling = false;
		}
	}
</script>

<PageHeader title="Dashboard" description="Phase 0 command center">
	{#snippet actions()}
		<Button
			variant={data.state?.paused ? 'default' : 'destructive'}
			onclick={togglePause}
			disabled={toggling}
		>
			{data.state?.paused ? 'Resume posting' : 'Pause posting'}
		</Button>
	{/snippet}
</PageHeader>

{#if error}
	<p class="rounded-md border-2 border-border bg-destructive px-3 py-2 text-sm font-bold text-destructive-foreground">
		{error}
	</p>
{/if}

<div class="grid gap-4 sm:grid-cols-3">
	<Card>
		<CardContent class="flex items-center justify-between">
			<div>
				<p class="text-xs font-bold text-muted-foreground uppercase">Accounts</p>
				<p class="text-3xl font-extrabold">{data.accounts.length}</p>
			</div>
			<AtSignIcon class="size-8 text-muted-foreground" />
		</CardContent>
	</Card>
	<Card>
		<CardContent class="flex items-center justify-between">
			<div>
				<p class="text-xs font-bold text-muted-foreground uppercase">Needs re-auth</p>
				<p class="text-3xl font-extrabold">{needsReauth.length}</p>
			</div>
			<TriangleAlertIcon class="size-8 {needsReauth.length > 0 ? 'text-destructive' : 'text-muted-foreground'}" />
		</CardContent>
	</Card>
	<Card>
		<CardContent class="flex items-center justify-between">
			<div>
				<p class="text-xs font-bold text-muted-foreground uppercase">Global state</p>
				<p class="text-3xl font-extrabold">{data.state?.paused ? 'Paused' : 'Running'}</p>
			</div>
			<ActivityIcon class="size-8 text-muted-foreground" />
		</CardContent>
	</Card>
</div>

<div class="grid gap-4 lg:grid-cols-2">
	<Card>
		<CardHeader>
			<CardTitle>Accounts</CardTitle>
		</CardHeader>
		<CardContent class="p-0">
			{#if data.accounts.length === 0}
				<p class="p-5 text-sm font-medium text-muted-foreground">
					Create a persona and account to start the vertical slice.
				</p>
			{:else}
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Persona</TableHead>
							<TableHead>Platform</TableHead>
							<TableHead>Session</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{#each data.accounts as account (account.personaName + account.platform)}
							<TableRow>
								<TableCell class="font-semibold">{account.personaName}</TableCell>
								<TableCell class="text-muted-foreground">{account.platform} · {account.handle}</TableCell>
								<TableCell><Badge variant={statusVariant(account.sessionStatus)}>{account.sessionStatus}</Badge></TableCell>
							</TableRow>
						{/each}
					</TableBody>
				</Table>
			{/if}
		</CardContent>
	</Card>

	<Card>
		<CardHeader>
			<CardTitle>Content queue</CardTitle>
		</CardHeader>
		<CardContent class="p-0">
			{#if data.postCounts.length === 0}
				<p class="p-5 text-sm font-medium text-muted-foreground">No posts yet.</p>
			{:else}
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Status</TableHead>
							<TableHead class="text-right">Count</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{#each data.postCounts as item (item.status)}
							<TableRow>
								<TableCell><Badge variant={statusVariant(item.status)}>{item.status}</Badge></TableCell>
								<TableCell class="text-right font-bold">{item.count}</TableCell>
							</TableRow>
						{/each}
					</TableBody>
				</Table>
			{/if}
		</CardContent>
	</Card>
</div>

<Card>
	<CardHeader>
		<CardTitle>Recent worker jobs</CardTitle>
	</CardHeader>
	<CardContent class="p-0">
		{#if data.recentJobs.length === 0}
			<p class="p-5 text-sm font-medium text-muted-foreground">No jobs queued yet.</p>
		{:else}
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Type</TableHead>
						<TableHead>Detail</TableHead>
						<TableHead>Status</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#each data.recentJobs as job, i (i)}
						<TableRow>
							<TableCell class="font-semibold">{job.type}</TableCell>
							<TableCell class="max-w-xs truncate text-muted-foreground">
								{job.error || JSON.stringify(job.payload)}
							</TableCell>
							<TableCell><Badge variant={statusVariant(job.status)}>{job.status}</Badge></TableCell>
						</TableRow>
					{/each}
				</TableBody>
			</Table>
		{/if}
	</CardContent>
</Card>
