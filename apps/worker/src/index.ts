import { authSuperuser, loadEnv } from './lib/pb';
import { processOneJob } from './lib/worker';

await authSuperuser();
await loadEnv();

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

setInterval(() => void drainJobs(), 5000);
void drainJobs();

console.log('Social Presence Autopilot worker started.');
