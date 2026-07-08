<script lang="ts">
	import type { HTMLTextareaAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	let {
		class: className,
		value = $bindable(),
		ref = $bindable(null),
		...restProps
	}: HTMLTextareaAttributes & { ref?: HTMLTextAreaElement | null } = $props();
</script>

<textarea
	bind:this={ref}
	class={cn(
		'flex min-h-20 w-full rounded-md border-2 border-border bg-input px-3 py-2 text-sm font-medium shadow-brutal-sm transition-[transform,box-shadow] placeholder:text-muted-foreground focus-visible:translate-x-0.5 focus-visible:translate-y-0.5 focus-visible:shadow-none focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
		className
	)}
	bind:value
	{...restProps}
></textarea>
