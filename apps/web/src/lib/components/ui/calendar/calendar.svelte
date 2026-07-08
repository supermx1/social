<script lang="ts">
	import { Calendar as CalendarPrimitive } from 'bits-ui';
	import type { DateValue } from '@internationalized/date';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { cn } from '$lib/utils';
	import { buttonVariants } from '$lib/components/ui/button';

	// Single-date mode, minimal prop surface — bits-ui's full RootProps is a
	// discriminated union (single/multiple) that TS can't Omit<> over without
	// blowing up; this app has exactly one call site (date-time-picker), so a
	// hand-rolled prop shape sidesteps that instead of fighting the union.
	let {
		value = $bindable<DateValue | undefined>(undefined),
		onValueChange,
		class: className,
		weekdayFormat = 'short'
	}: {
		value?: DateValue;
		onValueChange?: (value: DateValue | undefined) => void;
		class?: string;
		weekdayFormat?: 'narrow' | 'short' | 'long';
	} = $props();
</script>

<CalendarPrimitive.Root
	bind:value
	type="single"
	{onValueChange}
	{weekdayFormat}
	class={cn('rounded-lg border-2 border-border bg-card p-3 shadow-brutal', className)}
>
	{#snippet children({ months, weekdays })}
		<CalendarPrimitive.Header class="flex items-center justify-between pb-3">
			<CalendarPrimitive.PrevButton
				class={cn(buttonVariants({ variant: 'outline', size: 'icon' }), 'size-8 shadow-brutal-sm')}
			>
				<ChevronLeftIcon class="size-4" />
			</CalendarPrimitive.PrevButton>
			<CalendarPrimitive.Heading class="text-sm font-extrabold" />
			<CalendarPrimitive.NextButton
				class={cn(buttonVariants({ variant: 'outline', size: 'icon' }), 'size-8 shadow-brutal-sm')}
			>
				<ChevronRightIcon class="size-4" />
			</CalendarPrimitive.NextButton>
		</CalendarPrimitive.Header>
		<div class="flex flex-col gap-4 sm:flex-row">
			{#each months as month (month.value)}
				<CalendarPrimitive.Grid class="w-full border-collapse space-y-1 select-none">
					<CalendarPrimitive.GridHead>
						<CalendarPrimitive.GridRow class="flex">
							{#each weekdays as day (day)}
								<CalendarPrimitive.HeadCell
									class="w-9 text-[0.7rem] font-extrabold text-muted-foreground uppercase"
								>
									{day.slice(0, 2)}
								</CalendarPrimitive.HeadCell>
							{/each}
						</CalendarPrimitive.GridRow>
					</CalendarPrimitive.GridHead>
					<CalendarPrimitive.GridBody>
						{#each month.weeks as weekDates (weekDates)}
							<CalendarPrimitive.GridRow class="mt-1 flex w-full">
								{#each weekDates as date (date)}
									<CalendarPrimitive.Cell
										{date}
										month={month.value}
										class="relative size-9 p-0 text-center text-sm"
									>
										<CalendarPrimitive.Day
											class="inline-flex size-9 items-center justify-center rounded-md border-2 border-transparent text-sm font-semibold transition-[transform,box-shadow] hover:border-border data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[outside-month]:text-muted-foreground data-[selected]:border-border data-[selected]:bg-primary data-[selected]:text-primary-foreground data-[selected]:shadow-brutal-sm data-[today]:font-extrabold data-[today]:underline"
										/>
									</CalendarPrimitive.Cell>
								{/each}
							</CalendarPrimitive.GridRow>
						{/each}
					</CalendarPrimitive.GridBody>
				</CalendarPrimitive.Grid>
			{/each}
		</div>
	{/snippet}
</CalendarPrimitive.Root>
