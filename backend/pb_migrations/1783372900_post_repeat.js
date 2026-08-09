/// <reference path="../pb_data/types.d.ts" />
//
// posts.repeat, posts.repeat_until, posts.repeat_of — recurring post scheduling.
//
// A post can repeat on a fixed schedule (daily, weekly, weekdays). The root post is the
// template; subsequent posts are copies created by the scheduler and linked back via
// repeat_of. repeat_until is optional — empty = repeat forever. Empty repeat = one-off post
// (the default, matching existing behavior).

migrate(
	(app) => {
		const posts = app.findCollectionByNameOrId('posts');
		posts.fields.add(new Field({ type: 'select', name: 'repeat', maxSelect: 1, values: ['daily', 'weekly', 'weekdays'] }));
		posts.fields.add(new Field({ type: 'date', name: 'repeat_until' }));
		posts.fields.add(new Field({ type: 'relation', name: 'repeat_of', collectionId: app.findCollectionByNameOrId('posts').id, maxSelect: 1 }));
		app.save(posts);
	},
	(app) => {
		const posts = app.findCollectionByNameOrId('posts');
		posts.fields.removeByName('repeat');
		posts.fields.removeByName('repeat_until');
		posts.fields.removeByName('repeat_of');
		app.save(posts);
	},
);
