/// <reference path="../pb_data/types.d.ts" />
//
// generator.ts reads config.LLM_API_KEY and config.GEN_MAX_TOKENS, but neither was ever
// seeded into `env`. loadEnv() only copies rows that exist, so both were permanently
// undefined and there was no way to set them — the Settings page renders the rows the
// collection actually has, so a key with no row is a key the operator cannot configure.
//
// LLM_API_KEY matters most: it is the bearer token for any non-Cloudflare OpenAI-compatible
// provider (Groq, OpenAI, OpenRouter, Together), so without it "point it at any provider"
// only really worked for Workers AI, which gets its credential from CF_API_TOKEN instead.

const DEFAULTS = {
	LLM_API_KEY: '',
	GEN_MAX_TOKENS: '',
};

migrate(
	(app) => {
		const col = app.findCollectionByNameOrId('env');
		for (const key in DEFAULTS) {
			try {
				app.findFirstRecordByFilter('env', 'key = {:k}', { k: key });
				continue; // already present, leave whatever value is there alone
			} catch (_) {
				const rec = new Record(col);
				rec.set('key', key);
				rec.set('value', DEFAULTS[key]);
				app.save(rec);
			}
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
