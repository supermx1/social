<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { pb } from '$lib/pb';
import { errorMessage } from '$lib/errors';
	import PageHeader from '$lib/components/page-header.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '$lib/components/ui/card';

	let { data } = $props();

	// Presentation only. A key missing from here still renders, under "Other" — a future
	// migration that adds an env key must not have to remember to edit this file too.
	const GROUPS: { title: string; description: string; keys: string[] }[] = [
		{
			title: 'Model & provider',
			description:
				'Any OpenAI-compatible endpoint works: Workers AI, Groq, OpenAI, OpenRouter, Ollama, LM Studio. Leave LLM_BASE_URL blank to derive the Workers AI endpoint from CF_ACCOUNT_ID.',
			keys: ['LLM_BASE_URL', 'LLM_API_KEY', 'GEN_MODEL', 'GEN_MAX_TOKENS', 'CF_ACCOUNT_ID', 'CF_API_TOKEN']
		},
		{
			title: 'Images',
			description: 'Leave a persona’s image style empty to skip images for that persona entirely.',
			keys: ['IMAGE_MODEL', 'IMAGE_SIZE', 'IMAGE_QUALITY', 'OPENAI_API_KEY']
		},
		{
			title: 'Notifications',
			description: 'Optional. Where the worker sends failure alerts.',
			keys: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID']
		},
		{
			title: 'Storage',
			description: 'Absolute paths are safest — a relative path resolves against the worker’s working directory.',
			keys: ['MEDIA_DIR', 'PROFILES_DIR']
		},
		{
			title: 'Posting defaults',
			description: 'Applied to new accounts. Per-account settings override these.',
			keys: [
				'DEFAULT_TIMEZONE',
				'DEFAULT_MAX_POSTS_PER_DAY',
				'DEFAULT_MIN_GAP_MINUTES',
				'HEADLESS',
				'STEALTH'
			]
		},
		{
			title: 'Feeds & relevance',
			description: 'How aggressively feed items become topics, and topics become drafts.',
			keys: [
				'RELEVANCE_GATE',
				'RELEVANCE_MODEL',
				'RELEVANCE_MIN',
				'RELEVANCE_AUTODRAFT',
				'FEED_DEFAULT_POLL_MINUTES',
				'FEED_DEFAULT_FRESHNESS_HOURS',
				'TOPIC_INBOX_TTL_DAYS'
			]
		},
		{ title: 'Network', description: 'Egress routing for browser sessions.', keys: ['EGRESS_MODE', 'HOME_NETWORK_CIDR'] }
	];

	// ponytail: masks by name rather than by a per-key schema — every secret this app holds is
	// already a *_TOKEN or *_API_KEY, and a new one that isn't will simply render in the clear.
	const isSecret = (key: string) => /_TOKEN$|_API_KEY$/.test(key);

	// Editable copy of the loaded rows. Resynced whenever `data` changes, which on this page
	// only happens via the invalidateAll() after a save — so a save settles the form back onto
	// what the database actually holds rather than onto what was typed.
	let values = $state<Record<string, string>>({});
	$effect(() => {
		values = Object.fromEntries(data.env.map((row) => [row.key, row.value]));
	});

	let saving = $state(false);
	let error = $state('');
	let saved = $state(0);

	const byKey = $derived(new Map(data.env.map((row) => [row.key, row])));
	const grouped = $derived(GROUPS.map((g) => ({ ...g, keys: g.keys.filter((k) => byKey.has(k)) })));
	const other = $derived(
		data.env.map((r) => r.key).filter((k) => !GROUPS.some((g) => g.keys.includes(k)))
	);

	async function save() {
		error = '';
		saving = true;
		try {
			// Only changed rows — a blind write of all 25 would churn `updated` on every save and
			// make the audit trail useless for working out what someone actually touched.
			const changed = data.env.filter((row) => values[row.key] !== row.value);
			for (const row of changed) {
				await pb.collection('env').update(row.id, { value: values[row.key] });
			}
			saved = changed.length;
			await invalidateAll();
		} catch (err) {
			error = errorMessage(err);
		} finally {
			saving = false;
		}
	}
</script>

<PageHeader title="Settings" description="Runtime configuration for the worker">
	{#snippet actions()}
		<Button onclick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
	{/snippet}
</PageHeader>

{#if error}
	<p class="rounded-md border-2 border-border bg-destructive px-3 py-2 text-sm font-bold text-destructive-foreground">
		{error}
	</p>
{/if}

{#if saved > 0}
	<p class="rounded-md border-2 border-border bg-primary px-3 py-2 text-sm font-bold text-primary-foreground">
		Saved {saved} change{saved === 1 ? '' : 's'}. The worker reads these once at startup — restart it to
		pick them up.
	</p>
{/if}

<div class="grid gap-4">
	{#each grouped as group (group.title)}
		{#if group.keys.length > 0}
			<Card>
				<CardHeader>
					<CardTitle>{group.title}</CardTitle>
					<CardDescription>{group.description}</CardDescription>
				</CardHeader>
				<CardContent class="grid gap-4 sm:grid-cols-2">
					{#each group.keys as key (key)}
						<div class="grid gap-1.5">
							<Label for={key} class="font-mono text-xs">{key}</Label>
							<Input id={key} type={isSecret(key) ? 'password' : 'text'} bind:value={values[key]} />
						</div>
					{/each}
				</CardContent>
			</Card>
		{/if}
	{/each}

	{#if other.length > 0}
		<Card>
			<CardHeader>
				<CardTitle>Other</CardTitle>
				<CardDescription>Keys this screen doesn’t group yet.</CardDescription>
			</CardHeader>
			<CardContent class="grid gap-4 sm:grid-cols-2">
				{#each other as key (key)}
					<div class="grid gap-1.5">
						<Label for={key} class="font-mono text-xs">{key}</Label>
						<Input id={key} type={isSecret(key) ? 'password' : 'text'} bind:value={values[key]} />
					</div>
				{/each}
			</CardContent>
		</Card>
	{/if}

	<Card>
		<CardHeader>
			<CardTitle>Advanced</CardTitle>
			<CardDescription>
				Everything above is stored in a local PocketBase database that ships inside this app. You
				almost never need it directly, but it's there for schema changes, backups and raw record
				edits — sign in with the same email and password you use here.
			</CardDescription>
		</CardHeader>
		<CardContent>
			<Button href="{pb.baseURL}/_/" target="_blank" rel="noreferrer" variant="secondary">
				Open PocketBase admin
			</Button>
		</CardContent>
	</Card>
</div>
