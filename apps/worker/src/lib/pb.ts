import PocketBase from 'pocketbase';

// Bootstrap credentials only (PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD) — PRD §9.
try {
	process.loadEnvFile(); // apps/worker/.env, optional
} catch {
	// no .env — rely on the process environment
}

export const pb = new PocketBase(process.env.PB_URL ?? 'http://127.0.0.1:8095');
pb.autoCancellation(false);

export async function authSuperuser() {
	const email = process.env.PB_SUPERUSER_EMAIL;
	const password = process.env.PB_SUPERUSER_PASSWORD;
	if (!email || !password) throw new Error('PB_SUPERUSER_EMAIL and PB_SUPERUSER_PASSWORD are required.');
	await pb.collection('_superusers').authWithPassword(email, password);
}

/** Runtime config from the superuser-only `env` collection (CF_API_TOKEN, GEN_MODEL, MEDIA_DIR, ...). */
export const config: Record<string, string> = {};

/** Loaded once at startup (PRD §6.9). Restart the worker after editing `env` in the dashboard. */
export async function loadEnv() {
	const rows = await pb.collection('env').getFullList<{ key: string; value: string }>();
	for (const row of rows) config[row.key] = row.value;
	return config;
}
