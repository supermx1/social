<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	let { class: className, children, ...restProps }: HTMLAttributes<HTMLTableSectionElement> = $props();
</script>

<thead class={cn('border-b-2 border-border bg-foreground text-background', className)} {...restProps}>
	{@render children?.()}
</thead>
