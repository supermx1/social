<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { pb } from '$lib/pb';
	import { subscribeToCollectionChanges } from '$lib/realtime';
	import { textValue, numberValue, boolValue } from '$lib/forms';
	import { statusVariant } from '$lib/status';
	import { onMount } from 'svelte';
	import PageHeader from '$lib/components/page-header.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Badge } from '$lib/components/ui/badge';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '$lib/components/ui/table';
	import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '$lib/components/ui/select';
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogDescription,
		DialogFooter
	} from '$lib/components/ui/dialog';
	import {
		DropdownMenu,
		DropdownMenuTrigger,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuSeparator
	} from '$lib/components/ui/dropdown-menu';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import LogInIcon from '@lucide/svelte/icons/log-in';
	import CheckIcon from '@lucide/svelte/icons/check';
	import FlameIcon from '@lucide/svelte/icons/flame';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';

	let { data } = $props();
	type AccountRow = (typeof data.accounts)[number];

	let error = $state('');
	let notice = $state('');
	let dialogOpen = $state(false);
	let editing = $state<AccountRow | null>(null);
	let personaValue = $state('');
	let platformValue = $state('');

	onMount(() => subscribeToCollectionChanges(pb, ['accounts', 'personas'], invalidateAll));

	function openCreate() {
		editing = null;
		personaValue = '';
		platformValue = '';
		dialogOpen = true;
	}

	function openEdit(account: AccountRow) {
		editing = account;
		dialogOpen = true;
	}

	async function create(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		const form = e.currentTarget as HTMLFormElement;
		const fd = new FormData(form);
		const personaId = textValue(fd, 'personaId');
		const platform = textValue(fd, 'platform');
		try {
			await pb.collection('accounts').create({
				persona: personaId,
				platform,
				handle: textValue(fd, 'handle'),
				timezone: textValue(fd, 'timezone', 'Europe/London'),
				posting_window_start: textValue(fd, 'postingWindowStart', '09:00'),
				posting_window_end: textValue(fd, 'postingWindowEnd', '17:00'),
				max_posts_per_day: numberValue(fd, 'maxPostsPerDay', 2),
				min_gap_minutes: numberValue(fd, 'minGapMinutes', 120),
				session_status: 'unknown',
				active: true
			});
			dialogOpen = false;
			await invalidateAll();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		}
	}

	async function update(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		const fd = new FormData(e.currentTarget as HTMLFormElement);
		try {
			await pb.collection('accounts').update(textValue(fd, 'id'), {
				handle: textValue(fd, 'handle'),
				timezone: textValue(fd, 'timezone'),
				posting_window_start: textValue(fd, 'postingWindowStart'),
				posting_window_end: textValue(fd, 'postingWindowEnd'),
				max_posts_per_day: numberValue(fd, 'maxPostsPerDay', 2),
				min_gap_minutes: numberValue(fd, 'minGapMinutes', 120),
				active: boolValue(fd, 'active')
			});
			dialogOpen = false;
			await invalidateAll();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		}
	}

	const jobNotices: Record<string, string> = {
		login_start: 'Log-in job queued — the worker will open a browser window. Log in there, then close the window; the session verifies automatically.',
		login_confirm: 'Verifying session…',
		warm: 'Warm-up job queued.',
		verify: 'Verify job queued.'
	};

	async function job(accountId: string, type: string) {
		error = '';
		notice = '';
		try {
			await pb.collection('jobs').create({
				type,
				payload: { accountId },
				status: 'queued',
				attempts: 0
			});
			notice = jobNotices[type] ?? 'Job queued.';
			await invalidateAll();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		}
	}

	async function toggleActive(account: AccountRow, active: boolean) {
		error = '';
		try {
			await pb.collection('accounts').update(account.id, { active });
			await invalidateAll();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		}
	}
</script>

<PageHeader title="Accounts" description="One account per persona and platform, posted via the shared ego-browser session — no stored credentials.">
	{#snippet actions()}
		<Button onclick={openCreate}>
			<PlusIcon class="size-4" />
			New account
		</Button>
	{/snippet}
</PageHeader>

{#if error}
	<p class="rounded-md border-2 border-border bg-destructive px-3 py-2 text-sm font-bold text-destructive-foreground">
		{error}
	</p>
{/if}

{#if notice}
	<p class="rounded-md border-2 border-border bg-muted px-3 py-2 text-sm font-medium text-muted-foreground">
		{notice}
	</p>
{/if}

<Card>
	<CardContent class="p-0">
		{#if data.accounts.length === 0}
			<p class="p-5 text-sm font-medium text-muted-foreground">No accounts yet — create the first one.</p>
		{:else}
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Persona</TableHead>
						<TableHead>Session</TableHead>
						<TableHead>Active</TableHead>
						<TableHead class="w-12"></TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#each data.accounts as account (account.id)}
						<TableRow>
							<TableCell>
								<div class="font-semibold">{account.personaName}</div>
								<div class="text-xs font-medium text-muted-foreground">{account.platform} · {account.handle}</div>
							</TableCell>
							<TableCell><Badge variant={statusVariant(account.sessionStatus)}>{account.sessionStatus}</Badge></TableCell>
							<TableCell>
								<Switch
									checked={account.active}
									onCheckedChange={(v) => toggleActive(account, v)}
								/>
							</TableCell>
							<TableCell>
								<DropdownMenu>
									<DropdownMenuTrigger>
										{#snippet child({ props })}
											<Button {...props} variant="ghost" size="icon">
												<EllipsisIcon class="size-4" />
											</Button>
										{/snippet}
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuItem onclick={() => openEdit(account)}>
											<PencilIcon class="size-4" />
											Edit rules
										</DropdownMenuItem>
										<DropdownMenuSeparator />
										<DropdownMenuItem onclick={() => job(account.id, 'login_start')}>
											<LogInIcon class="size-4" />
											Log in
										</DropdownMenuItem>
										<DropdownMenuItem onclick={() => job(account.id, 'login_confirm')}>
											<CheckIcon class="size-4" />
											I'm logged in
										</DropdownMenuItem>
										<DropdownMenuItem onclick={() => job(account.id, 'warm')}>
											<FlameIcon class="size-4" />
											Warm now
										</DropdownMenuItem>
										<DropdownMenuItem onclick={() => job(account.id, 'verify')}>
											<ShieldCheckIcon class="size-4" />
											Verify now
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</TableCell>
						</TableRow>
					{/each}
				</TableBody>
			</Table>
		{/if}
	</CardContent>
</Card>

<Dialog bind:open={dialogOpen}>
	<DialogContent class="sm:max-w-2xl">
		{#key editing?.id ?? 'new'}
			{#if editing}
				<form onsubmit={update} class="grid gap-4">
					<input type="hidden" name="id" value={editing.id} />
					<DialogHeader>
						<DialogTitle>Edit {editing.personaName} rules</DialogTitle>
						<DialogDescription>
							{editing.personaName} · {editing.platform}
						</DialogDescription>
					</DialogHeader>

					<div class="grid gap-4 sm:grid-cols-2">
						<div class="grid gap-1.5">
							<Label for="handle">Handle</Label>
							<Input id="handle" name="handle" placeholder="@handle" value={editing.handle} />
						</div>
						<div class="grid gap-1.5">
							<Label for="timezone">Timezone</Label>
							<Input id="timezone" name="timezone" value={editing.timezone} />
						</div>
					</div>

					<div class="grid gap-4 sm:grid-cols-2">
						<div class="grid gap-1.5">
							<Label for="postingWindowStart">Window start</Label>
							<Input id="postingWindowStart" name="postingWindowStart" type="time" value={editing.postingWindowStart} />
						</div>
						<div class="grid gap-1.5">
							<Label for="postingWindowEnd">Window end</Label>
							<Input id="postingWindowEnd" name="postingWindowEnd" type="time" value={editing.postingWindowEnd} />
						</div>
					</div>

					<div class="grid gap-4 sm:grid-cols-2">
						<div class="grid gap-1.5">
							<Label for="maxPostsPerDay">Max/day</Label>
							<Input id="maxPostsPerDay" name="maxPostsPerDay" type="number" min="1" value={editing.maxPostsPerDay} />
						</div>
						<div class="grid gap-1.5">
							<Label for="minGapMinutes">Min gap (minutes)</Label>
							<Input id="minGapMinutes" name="minGapMinutes" type="number" min="30" value={editing.minGapMinutes} />
						</div>
					</div>

					<label class="flex items-center gap-2">
						<Switch name="active" checked={editing.active} />
						<span class="text-sm font-bold">Active</span>
					</label>

					<DialogFooter>
						<Button type="submit">Save changes</Button>
					</DialogFooter>
				</form>
			{:else}
				<form onsubmit={create} class="grid gap-4">
					<DialogHeader>
						<DialogTitle>New account</DialogTitle>
						<DialogDescription>
							Adds an account to post as, for this persona and platform.
						</DialogDescription>
					</DialogHeader>

					<div class="grid gap-4 sm:grid-cols-2">
						<div class="grid gap-1.5">
							<Label for="personaId">Persona</Label>
							<Select type="single" name="personaId" bind:value={personaValue} items={data.personas.map((p) => ({ value: p.id, label: p.name }))}>
								<SelectTrigger id="personaId"><SelectValue placeholder="Choose persona" /></SelectTrigger>
								<SelectContent>
									{#each data.personas as persona (persona.id)}
										<SelectItem value={persona.id} label={persona.name}>{persona.name}</SelectItem>
									{/each}
								</SelectContent>
							</Select>
						</div>
						<div class="grid gap-1.5">
							<Label for="platform">Platform</Label>
							<Select type="single" name="platform" bind:value={platformValue}>
								<SelectTrigger id="platform"><SelectValue placeholder="Choose platform" /></SelectTrigger>
								<SelectContent>
									{#each data.platforms as platform (platform)}
										<SelectItem value={platform} label={platform}>{platform}</SelectItem>
									{/each}
								</SelectContent>
							</Select>
						</div>
					</div>

					<div class="grid gap-4 sm:grid-cols-2">
						<div class="grid gap-1.5">
							<Label for="handle">Handle</Label>
							<Input id="handle" name="handle" placeholder="@handle" />
						</div>
						<div class="grid gap-1.5">
							<Label for="timezone">Timezone</Label>
							<Input id="timezone" name="timezone" value="Europe/London" />
						</div>
					</div>

					<div class="grid gap-4 sm:grid-cols-2">
						<div class="grid gap-1.5">
							<Label for="postingWindowStart">Window start</Label>
							<Input id="postingWindowStart" name="postingWindowStart" type="time" value="09:00" />
						</div>
						<div class="grid gap-1.5">
							<Label for="postingWindowEnd">Window end</Label>
							<Input id="postingWindowEnd" name="postingWindowEnd" type="time" value="17:00" />
						</div>
					</div>

					<div class="grid gap-4 sm:grid-cols-2">
						<div class="grid gap-1.5">
							<Label for="maxPostsPerDay">Max/day</Label>
							<Input id="maxPostsPerDay" name="maxPostsPerDay" type="number" min="1" value="2" />
						</div>
						<div class="grid gap-1.5">
							<Label for="minGapMinutes">Min gap (minutes)</Label>
							<Input id="minGapMinutes" name="minGapMinutes" type="number" min="30" value="120" />
						</div>
					</div>

					<DialogFooter>
						<Button type="submit">Create account</Button>
					</DialogFooter>
				</form>
			{/if}
		{/key}
	</DialogContent>
</Dialog>
