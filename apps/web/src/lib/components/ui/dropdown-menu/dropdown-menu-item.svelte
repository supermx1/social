<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils';

	let {
		ref = $bindable(null),
		class: className,
		variant = 'default',
		children,
		...restProps
	}: DropdownMenuPrimitive.ItemProps & { variant?: 'default' | 'destructive' } = $props();
</script>

<DropdownMenuPrimitive.Item
	bind:ref
	data-variant={variant}
	class={cn(
		'relative flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm font-semibold outline-none select-none data-[highlighted]:bg-primary data-[highlighted]:text-primary-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:data-[highlighted]:bg-destructive data-[variant=destructive]:data-[highlighted]:text-destructive-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</DropdownMenuPrimitive.Item>
