<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { pb } from '$lib/pb';
	import { subscribeToCollectionChanges } from '$lib/realtime';
	import { onMount } from 'svelte';
	import PageHeader from '$lib/components/page-header.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
	import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '$lib/components/ui/table';
	import { statusVariant } from '$lib/status';

	let { data } = $props();

	onMount(() => subscribeToCollectionChanges(pb, ['jobs', 'run_log'], invalidateAll));

	function formatDate(iso: string) {
		const d = new Date(iso);
		return Number.isNaN(d.getTime())
			? iso
			: d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}
</script>

<PageHeader title="Activity" description="Worker visibility — recent jobs and run history." />

<div class="grid gap-4 lg:grid-cols-2">
	<Card>
		<CardHeader>
			<CardTitle>Jobs</CardTitle>
		</CardHeader>
		<CardContent class="p-0">
			{#if data.jobs.length === 0}
				<p class="p-5 text-sm font-medium text-muted-foreground">No jobs queued yet.</p>
			{:else}
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Type</TableHead>
							<TableHead>Detail</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>When</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{#each data.jobs as job (job.id)}
							<TableRow>
								<TableCell class="font-semibold">{job.type}</TableCell>
								<TableCell class="max-w-xs truncate text-muted-foreground">
									{job.error || JSON.stringify(job.payload)}
								</TableCell>
								<TableCell><Badge variant={statusVariant(job.status)}>{job.status}</Badge></TableCell>
								<TableCell class="text-muted-foreground">{formatDate(job.created)}</TableCell>
							</TableRow>
						{/each}
					</TableBody>
				</Table>
			{/if}
		</CardContent>
	</Card>

	<Card>
		<CardHeader>
			<CardTitle>Run log</CardTitle>
		</CardHeader>
		<CardContent class="p-0">
			{#if data.runLog.length === 0}
				<p class="p-5 text-sm font-medium text-muted-foreground">No worker runs logged yet.</p>
			{:else}
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Action</TableHead>
							<TableHead>Detail</TableHead>
							<TableHead>Result</TableHead>
							<TableHead>When</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{#each data.runLog as item (item.id)}
							<TableRow>
								<TableCell class="font-semibold">{item.action}</TableCell>
								<TableCell class="max-w-xs truncate text-muted-foreground">{item.detail}</TableCell>
								<TableCell><Badge variant={statusVariant(item.result)}>{item.result}</Badge></TableCell>
								<TableCell class="text-muted-foreground">{formatDate(item.created)}</TableCell>
							</TableRow>
						{/each}
					</TableBody>
				</Table>
			{/if}
		</CardContent>
	</Card>
</div>
