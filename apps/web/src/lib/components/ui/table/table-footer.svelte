<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	let { class: className, children, ...restProps }: HTMLAttributes<HTMLTableSectionElement> = $props();
</script>

<tfoot class={cn('border-t-2 border-border bg-muted font-bold', className)} {...restProps}>
	{@render children?.()}
</tfoot>
