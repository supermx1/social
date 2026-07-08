import { redirect } from '@sveltejs/kit';
import { pb } from '$lib/pb';

export const ssr = false;
export const prerender = false;

export const load = ({ url }) => {
	if (!pb.authStore.isValid && url.pathname !== '/login') {
		throw redirect(307, '/login');
	}
	if (pb.authStore.isValid && url.pathname === '/login') {
		throw redirect(307, '/');
	}
	return { authed: pb.authStore.isValid, pathname: url.pathname };
};
