<script lang="ts">
	import { Select as SelectPrimitive } from 'bits-ui';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { cn } from '$lib/utils';

	let {
		ref = $bindable(null),
		class: className,
		value,
		label,
		children: childrenProp,
		...restProps
	}: SelectPrimitive.ItemProps = $props();
</script>

<SelectPrimitive.Item
	bind:ref
	{value}
	{label}
	class={cn(
		'relative flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm font-medium outline-none select-none data-[highlighted]:bg-primary data-[highlighted]:text-primary-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
		className
	)}
	{...restProps}
>
	{#snippet children(itemSnippetProps)}
		{#if itemSnippetProps.selected}
			<CheckIcon class="size-4 shrink-0" />
		{:else}
			<span class="size-4 shrink-0"></span>
		{/if}
		{#if childrenProp}
			{@render childrenProp(itemSnippetProps)}
		{:else}
			{label ?? value}
		{/if}
	{/snippet}
</SelectPrimitive.Item>
