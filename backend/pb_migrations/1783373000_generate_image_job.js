/// <reference path="../pb_data/types.d.ts" />
//
// jobs.type — add 'generate_image'.
//
// The worker has handled this job type since images were added, the JobType union declares it,
// and the queue's "Generate image" row action creates one — but jobs.type is a constrained select
// that was never widened, so PocketBase rejected every such job with
// `validation_invalid_value: Invalid value generate_image`. The action has therefore never worked;
// it surfaced only when a WhatsApp Status (which refuses to publish without media) needed one.

const ADDED = 'generate_image';

function setTypeValues(app, values) {
	const jobs = app.findCollectionByNameOrId('jobs');
	const field = jobs.fields.getByName('type');
	field.values = values;
	app.save(jobs);
}

migrate(
	(app) => {
		const jobs = app.findCollectionByNameOrId('jobs');
		const current = jobs.fields.getByName('type').values;
		if (current.indexOf(ADDED) === -1) setTypeValues(app, current.concat([ADDED]));
	},
	(app) => {
		const jobs = app.findCollectionByNameOrId('jobs');
		const current = jobs.fields.getByName('type').values;
		setTypeValues(
			app,
			current.filter(function (v) {
				return v !== ADDED;
			}),
		);
	},
);
