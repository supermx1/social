<script lang="ts">
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: DialogPrimitive.DescriptionProps = $props();
</script>

<DialogPrimitive.Description bind:ref class={cn('text-sm font-medium text-muted-foreground', className)} {...restProps}>
	{@render children?.()}
</DialogPrimitive.Description>
