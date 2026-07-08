<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	let { class: className, children, ...restProps }: HTMLAttributes<HTMLDivElement> = $props();
</script>

<div
	class={cn(
		'overflow-hidden rounded-lg border-2 border-border bg-card text-card-foreground shadow-brutal',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
