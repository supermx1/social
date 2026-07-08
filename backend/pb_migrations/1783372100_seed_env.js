/// <reference path="../pb_data/types.d.ts" />
//
// Seed the `env` collection (superuser-only runtime config, PRD §6.9/§9) with
// the known keys so the operator just fills values in the dashboard. Secrets
// start blank; non-secret defaults are pre-filled.

const DEFAULTS = {
	MEDIA_DIR: './data/media',
	LLM_BASE_URL: 'http://127.0.0.1:1234/v1',
	GEN_MODEL: '',
	TELEGRAM_BOT_TOKEN: '',
	TELEGRAM_CHAT_ID: '',
	PROFILES_DIR: './data/profiles',
	HEADLESS: 'true',
	STEALTH: 'true',
	DEFAULT_TIMEZONE: 'Europe/London',
	DEFAULT_MAX_POSTS_PER_DAY: '2',
	DEFAULT_MIN_GAP_MINUTES: '120',
	EGRESS_MODE: 'tailscale_exit',
	HOME_NETWORK_CIDR: '',
	RELEVANCE_GATE: 'true',
	RELEVANCE_MODEL: '',
	RELEVANCE_MIN: '60',
	RELEVANCE_AUTODRAFT: '80',
	FEED_DEFAULT_POLL_MINUTES: '180',
	FEED_DEFAULT_FRESHNESS_HOURS: '48',
	TOPIC_INBOX_TTL_DAYS: '7',
};

migrate(
	(app) => {
		const col = app.findCollectionByNameOrId('env');
		for (const key in DEFAULTS) {
			const rec = new Record(col);
			rec.set('key', key);
			rec.set('value', DEFAULTS[key]);
			app.save(rec);
		}
	},
	(app) => {
		for (const key in DEFAULTS) {
			try {
				app.delete(app.findFirstRecordByFilter('env', 'key = {:k}', { k: key }));
			} catch (_) {
				// already gone
			}
		}
	},
);
