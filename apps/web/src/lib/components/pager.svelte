<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';

	let {
		page,
		totalPages,
		totalItems,
		onPrev,
		onNext
	}: {
		page: number;
		totalPages: number;
		totalItems: number;
		onPrev: () => void;
		onNext: () => void;
	} = $props();
</script>

{#if totalPages > 1}
	<div class="flex items-center justify-between border-t-2 border-border px-4 py-3">
		<p class="text-xs font-medium text-muted-foreground">
			Page {page} of {totalPages} · {totalItems} total
		</p>
		<div class="flex gap-2">
			<Button variant="outline" size="sm" disabled={page <= 1} onclick={onPrev}>
				<ChevronLeftIcon class="size-4" />
				Prev
			</Button>
			<Button variant="outline" size="sm" disabled={page >= totalPages} onclick={onNext}>
				Next
				<ChevronRightIcon class="size-4" />
			</Button>
		</div>
	</div>
{/if}
