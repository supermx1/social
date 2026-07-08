<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: DropdownMenuPrimitive.GroupHeadingProps = $props();
</script>

<DropdownMenuPrimitive.GroupHeading
	bind:ref
	class={cn('px-2 py-1.5 text-xs font-extrabold tracking-wide uppercase text-muted-foreground', className)}
	{...restProps}
>
	{@render children?.()}
</DropdownMenuPrimitive.GroupHeading>
