<script lang="ts" module>
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
	import { type VariantProps, tv } from 'tailwind-variants';
	import { cn } from '$lib/utils';

	export const buttonVariants = tv({
		base: 'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border-2 border-border text-sm font-bold transition-[transform,box-shadow] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
		variants: {
			variant: {
				default: 'bg-primary text-primary-foreground shadow-brutal hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-brutal-sm active:translate-x-1 active:translate-y-1 active:shadow-none',
				secondary:
					'bg-secondary text-secondary-foreground shadow-brutal hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-brutal-sm active:translate-x-1 active:translate-y-1 active:shadow-none',
				destructive:
					'bg-destructive text-destructive-foreground shadow-brutal hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-brutal-sm active:translate-x-1 active:translate-y-1 active:shadow-none',
				outline:
					'bg-card text-card-foreground shadow-brutal hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-brutal-sm active:translate-x-1 active:translate-y-1 active:shadow-none',
				ghost: 'border-transparent hover:bg-muted',
				link: 'border-transparent underline-offset-4 hover:underline'
			},
			size: {
				default: 'h-10 px-4 py-2',
				sm: 'h-8 px-3 text-xs',
				lg: 'h-12 px-6',
				icon: 'size-10 p-0'
			}
		},
		defaultVariants: { variant: 'default', size: 'default' }
	});

	export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
	export type ButtonSize = VariantProps<typeof buttonVariants>['size'];

	export type ButtonProps = Omit<HTMLButtonAttributes, 'type'> &
		Omit<HTMLAnchorAttributes, 'type' | 'href'> & {
			variant?: ButtonVariant;
			size?: ButtonSize;
			ref?: HTMLButtonElement | HTMLAnchorElement | null;
			type?: HTMLButtonAttributes['type'];
			href?: HTMLAnchorAttributes['href'];
		};
</script>

<script lang="ts">
	let {
		class: className,
		variant = 'default',
		size = 'default',
		ref = $bindable(null),
		href,
		type = 'button',
		children,
		...restProps
	}: ButtonProps = $props();
</script>

{#if href}
	<a
		bind:this={ref}
		class={cn(buttonVariants({ variant, size }), className)}
		{href}
		{...restProps as HTMLAnchorAttributes}
	>
		{@render children?.()}
	</a>
{:else}
	<button
		bind:this={ref}
		class={cn(buttonVariants({ variant, size }), className)}
		{type}
		{...restProps as HTMLButtonAttributes}
	>
		{@render children?.()}
	</button>
{/if}
