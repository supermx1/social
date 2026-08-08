/// <reference path="../pb_data/types.d.ts" />
//
// design doc: docs/superpowers/specs/2026-08-08-ego-browser-cloudflare-ai-design.md §3
//
// LLM_BASE_URL is blanked so generator.ts derives the Workers AI endpoint from CF_ACCOUNT_ID.
// It was seeded with the LM Studio address, which won over the derivation and meant a Cloudflare
// model id got sent to a local server that wasn't running. Blank now means "derive"; set it
// explicitly to point at LM Studio or any other OpenAI-compatible server instead.
//
// The account id deliberately is NOT seeded here — it lives only in CF_ACCOUNT_ID, so it stays
// out of git.

const LM_STUDIO = 'http://127.0.0.1:1234/v1';

function setEnvValue(app, key, value) {
	let rec;
	try {
		rec = app.findFirstRecordByFilter('env', 'key = {:k}', { k: key });
	} catch (_) {
		rec = new Record(app.findCollectionByNameOrId('env'));
		rec.set('key', key);
	}
	rec.set('value', value);
	app.save(rec);
}

migrate(
	(app) => {
		setEnvValue(app, 'LLM_BASE_URL', '');
	},
	(app) => {
		setEnvValue(app, 'LLM_BASE_URL', LM_STUDIO);
	},
);
