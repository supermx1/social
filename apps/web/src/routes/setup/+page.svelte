<script lang="ts">
	import { goto } from '$app/navigation';
	import { pb } from '$lib/pb';
import { errorMessage } from '$lib/errors';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '$lib/components/ui/card';

	const MIN_PASSWORD = 10;

	let error = $state('');
	let loading = $state(false);

	async function createAccount(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		const fd = new FormData(e.currentTarget as HTMLFormElement);
		const email = String(fd.get('email') ?? '');
		const password = String(fd.get('password') ?? '');

		if (password !== String(fd.get('confirm') ?? '')) {
			error = "Those passwords don't match.";
			return;
		}
		if (password.length < MIN_PASSWORD) {
			error = `Password must be at least ${MIN_PASSWORD} characters.`;
			return;
		}

		loading = true;
		try {
			const res = await fetch(`${pb.baseURL}/api/bootstrap`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password })
			});
			// Hand the whole body to errorMessage, not just `.message` — if $app.save() rejected the
			// record, the reason is in `data` and nowhere else.
			if (!res.ok) throw new Error(errorMessage(await res.json(), 'Could not create the account.'));

			// Sign straight in — making someone type the password they just chose, twice, on the
			// very next screen is the kind of thing that makes an app feel like paperwork.
			await pb.collection('_superusers').authWithPassword(email, password);
			await goto('/settings');
		} catch (err) {
			error = errorMessage(err);
		} finally {
			loading = false;
		}
	}
</script>

<main class="grid min-h-svh place-items-center bg-background p-5">
	<Card class="w-full max-w-md">
		<CardHeader>
			<p class="text-xs font-bold tracking-[0.2em] text-muted-foreground uppercase">First run</p>
			<CardTitle class="text-2xl">Create your account</CardTitle>
			<CardDescription>
				This is the only account. It stays on this Mac — nothing is sent anywhere, and there's no
				password reset, so use your password manager.
			</CardDescription>
		</CardHeader>
		<CardContent>
			<form onsubmit={createAccount} class="grid gap-4">
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
						autocomplete="new-password"
						minlength={MIN_PASSWORD}
						required
					/>
					<p class="text-xs text-muted-foreground">At least {MIN_PASSWORD} characters.</p>
				</div>
				<div class="grid gap-1.5">
					<Label for="confirm">Confirm password</Label>
					<Input id="confirm" name="confirm" type="password" autocomplete="new-password" required />
				</div>

				{#if error}
					<p
						class="rounded-md border-2 border-border bg-destructive px-3 py-2 text-sm font-bold text-destructive-foreground"
					>
						{error}
					</p>
				{/if}

				<Button type="submit" disabled={loading}>
					{loading ? 'Creating…' : 'Create account'}
				</Button>
			</form>
		</CardContent>
	</Card>
</main>
