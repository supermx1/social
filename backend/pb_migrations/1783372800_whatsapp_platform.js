/// <reference path="../pb_data/types.d.ts" />
//
// design doc: docs/whatsapp-posting-recon.md
//
// accounts.platform is a constrained select, so 'whatsapp' has to be added to its allowed values
// before a WhatsApp account row can exist at all.
//
// WhatsApp is a Status post, not a feed post: it expires after 24h and has no permalink, so
// posts.post_url stays empty for it. That is expected, not a gap.

const ADDED = 'whatsapp';

function setPlatformValues(app, values) {
	const accounts = app.findCollectionByNameOrId('accounts');
	const field = accounts.fields.getByName('platform');
	field.values = values;
	app.save(accounts);
}

migrate(
	(app) => {
		const accounts = app.findCollectionByNameOrId('accounts');
		const current = accounts.fields.getByName('platform').values;
		if (current.indexOf(ADDED) === -1) setPlatformValues(app, current.concat([ADDED]));
	},
	(app) => {
		const accounts = app.findCollectionByNameOrId('accounts');
		const current = accounts.fields.getByName('platform').values;
		setPlatformValues(
			app,
			current.filter(function (v) {
				return v !== ADDED;
			}),
		);
	},
);
