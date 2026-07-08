<script lang="ts">
	import { CalendarDate, getLocalTimeZone, type DateValue } from '@internationalized/date';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover';
	import { Calendar } from '$lib/components/ui/calendar';
	import { Input } from '$lib/components/ui/input';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import { cn } from '$lib/utils';

	// Bindable value is an ISO datetime string ('' when unset) — the shape every
	// PocketBase date field uses in this app.
	let { value = $bindable(''), placeholder = 'Pick a date & time', class: className }: {
		value?: string;
		placeholder?: string;
		class?: string;
	} = $props();

	const tz = getLocalTimeZone();

	function toCalendarDate(iso: string): DateValue | undefined {
		if (!iso) return undefined;
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return undefined;
		return new CalendarDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
	}

	function toTimeString(iso: string): string {
		if (!iso) return '12:00';
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return '12:00';
		return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
	}

	let calendarValue = $state(toCalendarDate(value));
	let timeValue = $state(toTimeString(value));

	function commit() {
		if (!calendarValue) {
			value = '';
			return;
		}
		const [hh, mm] = timeValue.split(':').map(Number);
		const d = new Date(
			calendarValue.year,
			calendarValue.month - 1,
			calendarValue.day,
			hh || 0,
			mm || 0
		);
		value = d.toISOString();
	}

	function onCalendarChange(v: DateValue | undefined) {
		calendarValue = v;
		commit();
	}

	const display = $derived(
		value && !Number.isNaN(new Date(value).getTime())
			? new Date(value).toLocaleString(undefined, {
					dateStyle: 'medium',
					timeStyle: 'short'
				})
			: placeholder
	);
</script>

<Popover>
	<PopoverTrigger
		class={cn(
			buttonVariants({ variant: 'outline' }),
			'w-full justify-start font-medium',
			!value && 'text-muted-foreground',
			className
		)}
	>
		<CalendarIcon class="size-4" />
		{display}
	</PopoverTrigger>
	<PopoverContent class="w-auto space-y-3">
		<Calendar value={calendarValue} onValueChange={onCalendarChange} />
		<div class="flex items-center gap-2 border-t-2 border-border pt-3">
			<Input
				type="time"
				bind:value={timeValue}
				onchange={commit}
				class="w-full"
			/>
			<Button
				type="button"
				variant="secondary"
				size="sm"
				onclick={() => {
					value = '';
					calendarValue = undefined;
				}}
			>
				Clear
			</Button>
		</div>
	</PopoverContent>
</Popover>
