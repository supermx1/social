<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		description,
		actions
	}: { title: string; description?: string; actions?: Snippet } = $props();
</script>

<header class="flex flex-wrap items-end justify-between gap-4 border-b-2 border-border pb-5">
	<div class="space-y-1">
		<h1 class="text-2xl font-extrabold tracking-tight md:text-3xl">{title}</h1>
		{#if description}
			<p class="text-sm font-medium text-muted-foreground">{description}</p>
		{/if}
	</div>
	{#if actions}
		<div class="flex flex-wrap items-center gap-2">
			{@render actions()}
		</div>
	{/if}
</header>
