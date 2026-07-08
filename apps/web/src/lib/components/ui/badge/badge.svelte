<script lang="ts" module>
	import type { HTMLAttributes } from 'svelte/elements';
	import { type VariantProps, tv } from 'tailwind-variants';
	import { cn } from '$lib/utils';

	export const badgeVariants = tv({
		base: 'inline-flex items-center gap-1.5 rounded-md border-2 border-border px-2.5 py-0.5 text-xs font-bold whitespace-nowrap',
		variants: {
			variant: {
				default: 'bg-primary text-primary-foreground',
				secondary: 'bg-secondary text-secondary-foreground',
				destructive: 'bg-destructive text-destructive-foreground',
				info: 'bg-info text-foreground',
				warning: 'bg-warning text-foreground',
				success: 'bg-success text-foreground',
				violet: 'bg-violet text-foreground',
				outline: 'bg-card text-card-foreground',
				muted: 'bg-muted text-muted-foreground border-muted-foreground/30'
			}
		},
		defaultVariants: { variant: 'default' }
	});

	export type BadgeVariant = VariantProps<typeof badgeVariants>['variant'];
	export type BadgeProps = HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant };
</script>

<script lang="ts">
	let { class: className, variant = 'default', children, ...restProps }: BadgeProps = $props();
</script>

<span class={cn(badgeVariants({ variant }), className)} {...restProps}>
	{@render children?.()}
</span>
