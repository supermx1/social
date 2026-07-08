import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	compilerOptions: { runes: true },
	kit: {
		// Static SPA served by PocketBase from pb_public (PRD §7.8).
		adapter: adapter({
			pages: '../../backend/pb_public',
			assets: '../../backend/pb_public',
			fallback: 'index.html'
		})
	}
};

export default config;
