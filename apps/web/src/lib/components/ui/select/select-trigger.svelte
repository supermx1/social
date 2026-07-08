<script lang="ts">
	import { Select as SelectPrimitive } from 'bits-ui';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { cn } from '$lib/utils';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: SelectPrimitive.TriggerProps = $props();
</script>

<SelectPrimitive.Trigger
	bind:ref
	class={cn(
		'flex h-10 w-full items-center justify-between gap-2 rounded-md border-2 border-border bg-input px-3 py-2 text-sm font-medium shadow-brutal-sm transition-[transform,box-shadow] data-[placeholder]:text-muted-foreground focus-visible:translate-x-0.5 focus-visible:translate-y-0.5 focus-visible:shadow-none focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:opacity-70',
		className
	)}
	{...restProps}
>
	{@render children?.()}
	<ChevronDownIcon />
</SelectPrimitive.Trigger>
