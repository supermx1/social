<script lang="ts">
	import { Select as SelectPrimitive } from 'bits-ui';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { cn } from '$lib/utils';

	let {
		ref = $bindable(null),
		class: className,
		sideOffset = 6,
		children,
		...restProps
	}: SelectPrimitive.ContentProps = $props();
</script>

<SelectPrimitive.Portal>
	<SelectPrimitive.Content
		bind:ref
		{sideOffset}
		class={cn(
			'z-50 max-h-72 min-w-[var(--bits-select-anchor-width)] overflow-hidden rounded-md border-2 border-border bg-popover text-popover-foreground shadow-brutal',
			className
		)}
		{...restProps}
	>
		<SelectPrimitive.ScrollUpButton class="flex items-center justify-center py-1">
			<ChevronUpIcon class="size-4" />
		</SelectPrimitive.ScrollUpButton>
		<SelectPrimitive.Viewport class="p-1">
			{@render children?.()}
		</SelectPrimitive.Viewport>
		<SelectPrimitive.ScrollDownButton class="flex items-center justify-center py-1">
			<ChevronDownIcon class="size-4" />
		</SelectPrimitive.ScrollDownButton>
	</SelectPrimitive.Content>
</SelectPrimitive.Portal>
