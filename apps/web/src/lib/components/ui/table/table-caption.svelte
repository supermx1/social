<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	let { class: className, children, ...restProps }: HTMLAttributes<HTMLElement> = $props();
</script>

<caption class={cn('mt-3 text-sm font-medium text-muted-foreground', className)} {...restProps}>
	{@render children?.()}
</caption>
