/// <reference path="../pb_data/types.d.ts" />
//
// design doc: docs/superpowers/specs/2026-08-08-ego-browser-cloudflare-ai-design.md §5
// - accounts.profile_dir dropped: no per-account browser profiles any more — ego-browser is one
//   resident service (§2.1), not a Playwright profile per account.
// - personas.image_style added: empty means that persona generates no images (§4.1).
// - env: CF_ACCOUNT_ID / CF_API_TOKEN (Workers AI credentials, shared by text + image gen) and
//   IMAGE_MODEL added; PROFILES_DIR retired. MEDIA_DIR is untouched.

const ENV_ADDITIONS = {
	CF_ACCOUNT_ID: '',
	CF_API_TOKEN: '',
	// Verified against the live Workers AI API 2026-08-08 — see the design doc §4.3.
	// NOT flux-1-schnell: its safety filter rejected a "plain blue circle on a white background"
	// prompt as NSFW on 3 of 4 attempts. lucid-origin returned a usable image on every attempt.
	IMAGE_MODEL: '@cf/leonardo/lucid-origin',
};

migrate(
	(app) => {
		const accounts = app.findCollectionByNameOrId('accounts');
		accounts.fields.removeByName('profile_dir');
		accounts.indexes = accounts.indexes.filter((idx) => !idx.includes('idx_accounts_profile_dir'));
		app.save(accounts);

		const personas = app.findCollectionByNameOrId('personas');
		personas.fields.add(new Field({ type: 'text', name: 'image_style' }));
		app.save(personas);

		const env = app.findCollectionByNameOrId('env');
		for (const key in ENV_ADDITIONS) {
			const rec = new Record(env);
			rec.set('key', key);
			rec.set('value', ENV_ADDITIONS[key]);
			app.save(rec);
		}
		try {
			app.delete(app.findFirstRecordByFilter('env', 'key = {:k}', { k: 'PROFILES_DIR' }));
		} catch (_) {
			// already gone
		}
	},
	(app) => {
		const accounts = app.findCollectionByNameOrId('accounts');
		accounts.fields.add(new Field({ type: 'text', name: 'profile_dir', required: true }));
		accounts.indexes.push('CREATE UNIQUE INDEX idx_accounts_profile_dir ON accounts (profile_dir)');
		app.save(accounts);

		const personas = app.findCollectionByNameOrId('personas');
		personas.fields.removeByName('image_style');
		app.save(personas);

		for (const key in ENV_ADDITIONS) {
			try {
				app.delete(app.findFirstRecordByFilter('env', 'key = {:k}', { k: key }));
			} catch (_) {
				// already gone
			}
		}
		const rec = new Record(app.findCollectionByNameOrId('env'));
		rec.set('key', 'PROFILES_DIR');
		rec.set('value', './data/profiles');
		app.save(rec);
	},
);
