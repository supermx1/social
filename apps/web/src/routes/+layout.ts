import { redirect } from '@sveltejs/kit';
import { pb } from '$lib/pb';

export const ssr = false;
export const prerender = false;

const PUBLIC_ROUTES = ['/login', '/setup'];

export const load = async ({ url, fetch }) => {
	// A fresh install has no account yet, so /setup has to come before the login redirect —
	// otherwise the first thing a new user sees is a sign-in form for an account that doesn't
	// exist and that they have no way to create.
	let needsSetup = false;
	try {
		const res = await fetch(`${pb.baseURL}/api/setup-state`);
		needsSetup = res.ok && (await res.json()).needsSetup === true;
	} catch {
		// Backend not up yet — fall through to the normal auth redirect rather than
		// stranding an existing install on the setup screen.
	}

	if (needsSetup && url.pathname !== '/setup') throw redirect(307, '/setup');
	if (!needsSetup && url.pathname === '/setup') throw redirect(307, '/');

	if (!pb.authStore.isValid && !PUBLIC_ROUTES.includes(url.pathname)) {
		throw redirect(307, '/login');
	}
	if (pb.authStore.isValid && url.pathname === '/login') {
		throw redirect(307, '/');
	}

	return { authed: pb.authStore.isValid, pathname: url.pathname };
};
