<script lang="ts">
	import { Switch as SwitchPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils';

	let {
		ref = $bindable(null),
		checked = $bindable(false),
		class: className,
		...restProps
	}: SwitchPrimitive.RootProps = $props();
</script>

<SwitchPrimitive.Root
	bind:ref
	bind:checked
	class={cn(
		'peer inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-border transition-colors data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted disabled:cursor-not-allowed disabled:opacity-50',
		className
	)}
	{...restProps}
>
	<SwitchPrimitive.Thumb
		class="pointer-events-none block size-4 translate-x-0.5 rounded-full border-2 border-border bg-card transition-transform data-[state=checked]:translate-x-[22px]"
	/>
</SwitchPrimitive.Root>
