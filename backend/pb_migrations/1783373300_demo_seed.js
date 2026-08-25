/// <reference path="../pb_data/types.d.ts" />
//
// A brand new install has an empty Personas/Accounts/Topics/Feeds/Queue — every screen in the
// app is a blank state, which is a bad first five minutes for someone who doesn't yet know
// what a "persona" or a "topic" is supposed to look like. This seeds one example of each, all
// named/prefixed so they're unmistakably placeholders, and all inert:
//   - the account is `active: false`, so the scheduler and keep-warm cron never touch it and it
//     never needs a real ego-browser session
//   - the feed is `active: false`, so it never actually polls until the operator opts in
//   - the persona's `image_style` is left blank, so nothing ever calls the image API for it
// A real user deletes these once they've seen the shape; a confused one has something to look
// at and copy instead of a form with no example to work from.

migrate(
	(app) => {
		const persona = new Record(app.findCollectionByNameOrId('personas'));
		persona.set('name', 'Example Persona (delete me)');
		persona.set('slug', 'example-persona');
		persona.set('mission', 'Shows what a persona looks like — replace with your own brand voice.');
		persona.set('audience', 'Whoever you are trying to reach.');
		persona.set('voice_tone', 'Plain, direct, a little dry.');
		persona.set('content_pillars', ['what we shipped', 'what we learned', 'what we think']);
		persona.set('active', true);
		app.save(persona);

		const account = new Record(app.findCollectionByNameOrId('accounts'));
		account.set('persona', persona.id);
		account.set('platform', 'x');
		account.set('handle', '@yourhandle');
		account.set('session_status', 'unknown');
		account.set('timezone', 'Europe/London');
		account.set('active', false); // never picked up by the scheduler until switched on
		app.save(account);

		const feed = new Record(app.findCollectionByNameOrId('feeds'));
		feed.set('name', 'Example feed (Hacker News front page)');
		feed.set('url', 'https://hnrss.org/frontpage');
		feed.set('personas', [persona.id]);
		feed.set('poll_interval_minutes', 180);
		feed.set('freshness_hours', 48);
		feed.set('active', false); // never actually polled until switched on
		app.save(feed);

		const topic = new Record(app.findCollectionByNameOrId('topics'));
		topic.set('title', 'Welcome — this is what a topic looks like');
		topic.set('source_type', 'manual');
		topic.set(
			'raw_content',
			'Topics feed the Generate screen. A real one usually comes from a feed poll; this one was typed in by hand.',
		);
		topic.set('personas', [persona.id]);
		topic.set('status', 'new');
		app.save(topic);

		const post = new Record(app.findCollectionByNameOrId('posts'));
		post.set('account', account.id);
		post.set('topic', topic.id);
		post.set('kind', 'evergreen');
		post.set('body', 'This is an example draft. Edit it, approve it, or delete it — nothing here posts on its own.');
		post.set('status', 'draft');
		app.save(post);
	},
	(app) => {
		try {
			app.delete(app.findFirstRecordByFilter('posts', "body ~ 'This is an example draft%'"));
		} catch (_) {}
		try {
			app.delete(app.findFirstRecordByFilter('topics', "title = 'Welcome — this is what a topic looks like'"));
		} catch (_) {}
		try {
			app.delete(app.findFirstRecordByFilter('feeds', "url = 'https://hnrss.org/frontpage'"));
		} catch (_) {}
		try {
			app.delete(app.findFirstRecordByFilter('accounts', "handle = '@yourhandle' && platform = 'x'"));
		} catch (_) {}
		try {
			app.delete(app.findFirstRecordByFilter('personas', "slug = 'example-persona'"));
		} catch (_) {}
	},
);
