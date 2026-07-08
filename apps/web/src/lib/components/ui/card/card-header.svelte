<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	let { class: className, children, ...restProps }: HTMLAttributes<HTMLDivElement> = $props();
</script>

<div
	class={cn('flex flex-col gap-1.5 border-b-2 border-border p-5', className)}
	{...restProps}
>
	{@render children?.()}
</div>
