<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { pb } from '$lib/pb';
	import { errorMessage } from '$lib/errors';
	import PageHeader from '$lib/components/page-header.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '$lib/components/ui/select';
	import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '$lib/components/ui/card';

	let { data } = $props();

	// Presentation only. A key missing from here still renders, under "Other" — a future
	// migration that adds an env key must not have to remember to edit this file too.
	// `open: true` is reserved for the one group someone MUST fill in to get any value out of
	// the app; everything else already has a working seeded default (see seed_env.js), so it
	// stays collapsed rather than dumping 25 fields on a screen at once.
	const GROUPS: { title: string; description: string; keys: string[]; open?: boolean }[] = [
		{
			title: 'Model & provider',
			description:
				'Any OpenAI-compatible endpoint works: Workers AI, Groq, OpenAI, OpenRouter, Ollama, LM Studio. Leave LLM_BASE_URL blank to derive the Workers AI endpoint from CF_ACCOUNT_ID.',
			keys: ['LLM_BASE_URL', 'LLM_API_KEY', 'GEN_MODEL', 'GEN_MAX_TOKENS', 'CF_ACCOUNT_ID', 'CF_API_TOKEN'],
			open: true
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
			keys: ['DEFAULT_TIMEZONE', 'DEFAULT_MAX_POSTS_PER_DAY', 'DEFAULT_MIN_GAP_MINUTES', 'HEADLESS', 'STEALTH']
		},
		{
			title: 'Feeds & relevance',
			description: 'How aggressively feed items become topics, and topics become drafts.',
			keys: [
				'RELEVANCE_GATE',
				'RELEVANCE_MIN',
				'RELEVANCE_AUTODRAFT',
				'FEED_DEFAULT_POLL_MINUTES',
				'FEED_DEFAULT_FRESHNESS_HOURS',
				'TOPIC_INBOX_TTL_DAYS'
			]
		}
	];

	// How each key should be edited. Anything not listed here falls back to a masked password
	// field for *_TOKEN/*_API_KEY, or plain text otherwise — most of this app's settings ARE
	// genuinely free text (paths, model ids, provider URLs), so this only covers the keys that
	// have a real fixed shape: true/false, a number, or a closed set of values. Forcing someone
	// to type "true" correctly into a text box is a UX bug, not a feature.
	//
	// 'datalist' is a *suggestion*, not a closed set (plain <select> would be wrong for
	// LLM_BASE_URL/GEN_MODEL — any OpenAI-compatible value is valid, including ones not listed
	// here) — the point is to give someone who doesn't know this space a start, not to fence
	// them in. The model ids are a static, hand-picked list, not a live price feed: they're
	// solid known-good picks at the time of writing, favoring cheap-and-fast over frontier
	// quality since that's the right default for a high-volume social-posting worker. Update
	// the array below if a provider's lineup moves on.
	type FieldKind =
		| { kind: 'boolean' }
		| { kind: 'number'; min?: number; max?: number }
		| { kind: 'select'; options: string[] }
		| { kind: 'datalist'; options: string[]; placeholder?: string };

	// Native <input list> + <datalist>, not a searchable combobox component — Intl already knows
	// every IANA zone name, so there's nothing to build here beyond asking it.
	const timezones = Intl.supportedValuesOf('timeZone');

	const RECOMMENDED_BASE_URLS = [
		'https://api.groq.com/openai/v1', // Groq — cheapest fast-inference tier, great default
		'https://openrouter.ai/api/v1', // OpenRouter — one key, many providers, several free tiers
		'https://api.openai.com/v1',
		'http://localhost:11434/v1', // Ollama — local, free, needs a capable Mac
		'http://127.0.0.1:1234/v1' // LM Studio — local, free
	];

	const RECOMMENDED_MODELS = [
		'@cf/zai-org/glm-4.7-flash', // Workers AI — this app's own seeded default: cheap, fast, good enough
		'@cf/meta/llama-3.3-70b-instruct-fp8-fast', // Workers AI — heavier, still cheap
		'llama-3.3-70b-versatile', // Groq
		'llama-3.1-8b-instant', // Groq — fastest/cheapest, fine for short social copy
		'gpt-4o-mini', // OpenAI — cheap tier
		'meta-llama/llama-3.3-70b-instruct' // OpenRouter
	];

	const FIELD_KIND: Record<string, FieldKind> = {
		HEADLESS: { kind: 'boolean' },
		STEALTH: { kind: 'boolean' },
		RELEVANCE_GATE: { kind: 'boolean' },
		IMAGE_QUALITY: { kind: 'select', options: ['low', 'medium', 'high', 'auto'] },
		DEFAULT_TIMEZONE: { kind: 'datalist', options: timezones, placeholder: 'Europe/London' },
		LLM_BASE_URL: {
			kind: 'datalist',
			options: RECOMMENDED_BASE_URLS,
			placeholder: 'blank = derive Workers AI from CF_ACCOUNT_ID'
		},
		GEN_MODEL: { kind: 'datalist', options: RECOMMENDED_MODELS },
		DEFAULT_MAX_POSTS_PER_DAY: { kind: 'number', min: 0 },
		DEFAULT_MIN_GAP_MINUTES: { kind: 'number', min: 0 },
		RELEVANCE_MIN: { kind: 'number', min: 0, max: 100 },
		RELEVANCE_AUTODRAFT: { kind: 'number', min: 0, max: 100 },
		FEED_DEFAULT_POLL_MINUTES: { kind: 'number', min: 1 },
		FEED_DEFAULT_FRESHNESS_HOURS: { kind: 'number', min: 1 },
		TOPIC_INBOX_TTL_DAYS: { kind: 'number', min: 1 },
		GEN_MAX_TOKENS: { kind: 'number', min: 1 }
	};

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
	const other = $derived(data.env.map((r) => r.key).filter((k) => !GROUPS.some((g) => g.keys.includes(k))));

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

{#snippet field(key: string)}
	{@const kind = FIELD_KIND[key]}
	<div class="grid gap-1.5">
		<Label for={key} class="font-mono text-xs">{key}</Label>
		{#if kind?.kind === 'boolean'}
			<div class="flex h-10 items-center">
				<Switch
					id={key}
					checked={values[key] === 'true'}
					onCheckedChange={(v: boolean) => (values[key] = v ? 'true' : 'false')}
				/>
			</div>
		{:else if kind?.kind === 'select'}
			<Select type="single" bind:value={values[key]}>
				<SelectTrigger id={key}><SelectValue placeholder="Choose…" /></SelectTrigger>
				<SelectContent>
					{#each kind.options as option (option)}
						<SelectItem value={option} label={option}>{option}</SelectItem>
					{/each}
				</SelectContent>
			</Select>
		{:else if kind?.kind === 'datalist'}
			<Input id={key} list="{key}-options" bind:value={values[key]} placeholder={kind.placeholder} />
			<datalist id="{key}-options">
				{#each kind.options as option (option)}
					<option value={option}></option>
				{/each}
			</datalist>
		{:else if kind?.kind === 'number'}
			<Input id={key} type="number" min={kind.min} max={kind.max} bind:value={values[key]} />
		{:else}
			<Input id={key} type={isSecret(key) ? 'password' : 'text'} bind:value={values[key]} />
		{/if}
	</div>
{/snippet}

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
				<CardContent>
					{#if group.open}
						<div class="grid gap-4 sm:grid-cols-2">
							{#each group.keys as key (key)}{@render field(key)}{/each}
						</div>
					{:else}
						<details>
							<summary class="cursor-pointer text-sm font-bold select-none">
								Show {group.keys.length} setting{group.keys.length === 1 ? '' : 's'}
							</summary>
							<div class="grid gap-4 pt-4 sm:grid-cols-2">
								{#each group.keys as key (key)}{@render field(key)}{/each}
							</div>
						</details>
					{/if}
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
			<CardContent>
				<details>
					<summary class="cursor-pointer text-sm font-bold select-none">
						Show {other.length} setting{other.length === 1 ? '' : 's'}
					</summary>
					<div class="grid gap-4 pt-4 sm:grid-cols-2">
						{#each other as key (key)}{@render field(key)}{/each}
					</div>
				</details>
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
