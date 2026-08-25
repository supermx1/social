<script lang="ts">
	import { goto } from '$app/navigation';
	import { pb } from '$lib/pb';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '$lib/components/ui/card';

	let error = $state('');
	let loading = $state(false);

	async function login(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		loading = true;
		const fd = new FormData(e.currentTarget as HTMLFormElement);
		try {
			// _superusers, not `users`: the operator is a PocketBase superuser so their token also
			// satisfies the superuser-only `env` collection that Settings edits.
			await pb
				.collection('_superusers')
				.authWithPassword(String(fd.get('email') ?? ''), String(fd.get('password') ?? ''));
			await goto('/');
		} catch {
			error = 'Invalid email or password.';
		} finally {
			loading = false;
		}
	}
</script>

<main class="grid min-h-svh place-items-center bg-background p-5">
	<Card class="w-full max-w-sm">
		<CardHeader>
			<p class="text-xs font-bold tracking-[0.2em] text-muted-foreground uppercase">
				Private Tailscale console
			</p>
			<CardTitle class="text-2xl">Social OS</CardTitle>
			<CardDescription>Sign in to review, approve, and schedule posts.</CardDescription>
		</CardHeader>
		<CardContent>
			<form onsubmit={login} class="grid gap-4">
				<div class="grid gap-1.5">
					<Label for="email">Email</Label>
					<Input id="email" name="email" type="email" autocomplete="username" required />
				</div>
				<div class="grid gap-1.5">
					<Label for="password">Password</Label>
					<Input
						id="password"
						name="password"
						type="password"
						autocomplete="current-password"
						required
					/>
				</div>

				{#if error}
					<p class="rounded-md border-2 border-border bg-destructive px-3 py-2 text-sm font-bold text-destructive-foreground">
						{error}
					</p>
				{/if}

				<Button type="submit" class="w-full" disabled={loading}>
					{loading ? 'Signing in…' : 'Sign in'}
				</Button>
			</form>
		</CardContent>
	</Card>
</main>
