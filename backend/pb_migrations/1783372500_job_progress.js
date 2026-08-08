/// <reference path="../pb_data/types.d.ts" />
//
// Adds jobs.detail: a live progress line the worker updates mid-run (e.g. "switching account",
// "uploading image") so the Activity/Queue UI can show what an in-flight job is doing rather than
// just "running" for its whole duration — publishing a post with an image is a multi-step,
// multi-second ego-browser sequence, and "running" alone gives no sense of progress or where a
// stall is stuck.

migrate(
	(app) => {
		const jobs = app.findCollectionByNameOrId('jobs');
		jobs.fields.add(new Field({ type: 'text', name: 'detail' }));
		app.save(jobs);
	},
	(app) => {
		const jobs = app.findCollectionByNameOrId('jobs');
		jobs.fields.removeByName('detail');
		app.save(jobs);
	},
);
