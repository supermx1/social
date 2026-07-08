<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	let { class: className, children, ...restProps }: HTMLAttributes<HTMLTableCellElement> = $props();
</script>

<th
	class={cn(
		'h-11 px-4 text-left align-middle text-xs font-extrabold tracking-wide uppercase [&:has([role=checkbox])]:pr-0',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</th>
