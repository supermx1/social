/// <reference path="../pb_data/types.d.ts" />
//
// design doc: docs/superpowers/specs/2026-08-08-ego-browser-cloudflare-ai-design.md §4
//
// Images move from Workers AI to the OpenAI Images API. Text and image generation shared one
// Workers AI neuron budget, and images exhausted the daily free allocation in about a dozen
// generations — after which text generation failed too (measured 2026-08-08, §3.1). Splitting the
// providers means a batch of images can never starve the drafting the product depends on.
// Text stays on Workers AI, so CF_ACCOUNT_ID / CF_API_TOKEN are kept.

const ENV_ADDITIONS = {
	OPENAI_API_KEY: '',
	IMAGE_QUALITY: 'medium', // low | medium | high | auto
	// 3:2 landscape, because a square gets side-cropped in the X timeline and wastes the focal
	// point. Chosen at 1,038,336px — marginally FEWER pixels than 1024x1024's 1,048,576 — because
	// gpt-image-2 bills in output tokens, so pixels are cost. 1536x1024 would be ~1.5x the spend.
	// Both edges are multiples of 16, as the API requires.
	IMAGE_SIZE: '1248x832',
};

const IMAGE_MODEL_NEW = 'gpt-image-2';
const IMAGE_MODEL_OLD = '@cf/leonardo/lucid-origin';

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
		for (const key in ENV_ADDITIONS) setEnvValue(app, key, ENV_ADDITIONS[key]);
		setEnvValue(app, 'IMAGE_MODEL', IMAGE_MODEL_NEW);
	},
	(app) => {
		for (const key in ENV_ADDITIONS) {
			try {
				app.delete(app.findFirstRecordByFilter('env', 'key = {:k}', { k: key }));
			} catch (_) {
				// already gone
			}
		}
		setEnvValue(app, 'IMAGE_MODEL', IMAGE_MODEL_OLD);
	},
);
