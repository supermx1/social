/// <reference path="../pb_data/types.d.ts" />
//
// EGRESS_MODE and HOME_NETWORK_CIDR were seeded in 1783372100_seed_env.js but nothing in
// apps/worker ever reads either key (grep confirms it) — they were placeholders for network
// egress routing that was never built. Every seeded key is a free-text field on the Settings
// page with no explanation of what a "correct" value looks like, so an unused one is pure
// confusion: the operator has to guess whether it matters instead of it just not being there.

const DEAD_KEYS = { EGRESS_MODE: 'tailscale_exit', HOME_NETWORK_CIDR: '' };

migrate(
	(app) => {
		for (const key in DEAD_KEYS) {
			try {
				app.delete(app.findFirstRecordByFilter('env', 'key = {:k}', { k: key }));
			} catch (_) {
				// already gone
			}
		}
	},
	(app) => {
		const col = app.findCollectionByNameOrId('env');
		for (const key in DEAD_KEYS) {
			try {
				app.findFirstRecordByFilter('env', 'key = {:k}', { k: key });
				continue;
			} catch (_) {
				const rec = new Record(col);
				rec.set('key', key);
				rec.set('value', DEAD_KEYS[key]);
				app.save(rec);
			}
		}
	},
);
