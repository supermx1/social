<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	let { class: className, children, ...restProps }: HTMLAttributes<HTMLDivElement> = $props();
</script>

<div class={cn('flex items-center gap-3 border-t-2 border-border p-5', className)} {...restProps}>
	{@render children?.()}
</div>
