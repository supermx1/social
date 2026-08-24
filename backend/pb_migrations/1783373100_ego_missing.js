/// <reference path="../pb_data/types.d.ts" />
//
// Adds app_state.ego_missing: the worker sets this when ego lite isn't installed, so the
// dashboard can say so up front instead of letting the operator find out when their first
// publish fails. Lives on app_state because the dashboard already subscribes to that
// collection, so the banner appears and clears without any extra plumbing.

migrate(
	(app) => {
		const state = app.findCollectionByNameOrId('app_state');
		state.fields.add(new Field({ type: 'bool', name: 'ego_missing' }));
		app.save(state);
	},
	(app) => {
		const state = app.findCollectionByNameOrId('app_state');
		state.fields.removeByName('ego_missing');
		app.save(state);
	},
);
