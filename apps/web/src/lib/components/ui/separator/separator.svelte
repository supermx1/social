<script lang="ts">
	import { Separator as SeparatorPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils';

	let {
		ref = $bindable(null),
		class: className,
		orientation = 'horizontal',
		...restProps
	}: SeparatorPrimitive.RootProps = $props();
</script>

<SeparatorPrimitive.Root
	bind:ref
	{orientation}
	class={cn(
		'shrink-0 bg-border',
		orientation === 'horizontal' ? 'h-0.5 w-full' : 'h-full w-0.5',
		className
	)}
	{...restProps}
/>
