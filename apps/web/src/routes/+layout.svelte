<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { goto } from '$app/navigation';
	import { pb } from '$lib/pb';
	import { TooltipProvider } from '$lib/components/ui/tooltip';
	import { Button } from '$lib/components/ui/button';
	import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
	import UsersIcon from '@lucide/svelte/icons/users';
	import AtSignIcon from '@lucide/svelte/icons/at-sign';
	import NewspaperIcon from '@lucide/svelte/icons/newspaper';
	import RssIcon from '@lucide/svelte/icons/rss';
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import LogOutIcon from '@lucide/svelte/icons/log-out';

	let { children, data } = $props();

	const nav = [
		['/', 'Dashboard', LayoutDashboardIcon],
		['/personas', 'Personas', UsersIcon],
		['/accounts', 'Accounts', AtSignIcon],
		['/topics', 'Topics', NewspaperIcon],
		['/feeds', 'Feeds', RssIcon],
		['/queue', 'Queue', ListChecksIcon],
		['/generate', 'Generate', SparklesIcon],
		['/activity', 'Activity', ActivityIcon],
		['/settings', 'Settings', SettingsIcon]
	] as const;

	function logout() {
		pb.authStore.clear();
		goto('/login');
	}

	// The app runs in a browser tab, so the tab is its window title — without this it reads
	// "127.0.0.1:8095", which is useless once a few tabs are open.
	const navLabel = $derived(nav.find(([href]) => href === data.pathname)?.[1]);
	const pageTitle = $derived(
		!navLabel || navLabel === 'Dashboard' ? 'Social Presence Autopilot' : `${navLabel} · Autopilot`
	);
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<link rel="icon" href={favicon} />
</svelte:head>

<TooltipProvider>
	{#if data.authed}
		<div class="flex min-h-svh flex-col md:flex-row">
			<aside
				class="flex shrink-0 flex-col gap-4 border-b-2 border-border bg-foreground p-4 text-background md:sticky md:top-0 md:h-svh md:w-64 md:self-start md:border-r-2 md:border-b-0 md:p-5"
			>
				<a href="/" class="flex flex-col leading-none">
					<span class="text-[0.65rem] font-bold tracking-[0.2em] text-primary uppercase"
						>Social Presence</span
					>
					<strong class="text-xl font-extrabold">Autopilot</strong>
				</a>

				<nav
					aria-label="Primary"
					class="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:mx-0 md:flex-1 md:flex-col md:overflow-visible md:px-0 md:pb-0"
				>
					{#each nav as [href, label, Icon] (href)}
						<a
							{href}
							class={[
								'flex shrink-0 items-center gap-2 rounded-md border-2 px-3 py-2 text-sm font-bold whitespace-nowrap transition-[transform,box-shadow]',
								data.pathname === href
									? 'border-border bg-primary text-primary-foreground shadow-brutal-sm'
									: 'border-transparent text-background/80 hover:border-border hover:bg-background/10'
							]}
						>
							<Icon class="size-4 shrink-0" />
							{label}
						</a>
					{/each}
				</nav>

				<Button variant="outline" size="sm" class="w-full md:w-auto" onclick={logout}>
					<LogOutIcon class="size-4" />
					Log out
				</Button>
			</aside>

			<main class="min-w-0 flex-1 p-4 md:p-10">
				<div class="mx-auto max-w-6xl space-y-6">
					{@render children()}
				</div>
			</main>
		</div>
	{:else}
		{@render children()}
	{/if}
</TooltipProvider>
