import { egoInstalled } from './lib/ego';
import { authSuperuser, loadEnv, pb } from './lib/pb';
import { processOneJob } from './lib/worker';

await authSuperuser();
await loadEnv();

// Publishing needs ego lite, which is a separate install the operator has to do themselves.
// Mirror its presence onto app_state so the dashboard can prompt for it; only written on
// change, so installing it mid-session clears the banner within one tick.
let lastEgoMissing: boolean | null = null;
async function syncEgoState() {
	const missing = !egoInstalled();
	if (missing === lastEgoMissing) return;
	try {
		const state = await pb.collection('app_state').getFirstListItem('');
		await pb.collection('app_state').update(state.id, { ego_missing: missing });
		lastEgoMissing = missing;
	} catch (error) {
		console.error('Could not record ego lite install state:', error);
	}
}

let draining = false;
async function drainJobs() {
	if (draining) return; // global concurrency 1
	draining = true;
	try {
		while (await processOneJob()) {
			// Drain the queue one job at a time.
		}
	} catch (error) {
		console.error('Job loop error:', error);
	} finally {
		draining = false;
	}
}

setInterval(() => {
	void syncEgoState();
	void drainJobs();
}, 5000);
void syncEgoState();
void drainJobs();

console.log('Social OS worker started.');
