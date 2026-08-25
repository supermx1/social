/// <reference path="../pb_data/types.d.ts" />
//
// First-run account creation, so a packaged copy of the app never sends its owner to the
// PocketBase dashboard just to get started.
//
// The app's operator IS a PocketBase superuser rather than a `users` record: superusers
// bypass collection rules, which is what lets the Settings page edit the superuser-only
// `env` collection directly from the browser with no proxy endpoint in between.
//
// The launcher creates a separate superuser for the worker before this ever runs, which is
// why "is this a fresh install?" cannot just be "are there zero superusers" — it is "are
// there zero superusers that aren't the worker's".
//
// IMPORTANT: like cronAdd, each routerAdd handler runs in its OWN isolated JSVM context and
// cannot see this file's top-level scope. Everything a handler needs is require()'d or
// declared INSIDE the handler. See the note at the top of main.pb.js.

routerAdd('GET', '/api/setup-state', (e) => {
	const WORKER_EMAIL = 'worker@socialos.local';
	const humans = $app.findRecordsByFilter('_superusers', 'email != {:w}', '', 1, 0, { w: WORKER_EMAIL });
	return e.json(200, { needsSetup: humans.length === 0 });
});

routerAdd('POST', '/api/bootstrap', (e) => {
	const WORKER_EMAIL = 'worker@socialos.local';
	const MIN_PASSWORD = 10; // PocketBase's own superuser minimum

	const body = new DynamicModel({ email: '', password: '' });
	e.bindBody(body);

	const email = (body.email || '').trim();
	const password = body.password || '';

	if (!email || !password) throw new BadRequestError('Email and password are required.');
	if (password.length < MIN_PASSWORD) {
		throw new BadRequestError(`Password must be at least ${MIN_PASSWORD} characters.`);
	}

	// The whole security of this route. Once one human superuser exists the app is set up and
	// this becomes permanently unavailable — otherwise anything that can reach localhost could
	// mint itself an admin account at any time, which is strictly worse than no login at all.
	const humans = $app.findRecordsByFilter('_superusers', 'email != {:w}', '', 1, 0, { w: WORKER_EMAIL });
	if (humans.length > 0) throw new BadRequestError('This app has already been set up.');

	if (email === WORKER_EMAIL) throw new BadRequestError(`${WORKER_EMAIL} is reserved for the worker.`);

	const record = new Record($app.findCollectionByNameOrId('_superusers'));
	record.set('email', email);
	record.setPassword(password);
	$app.save(record);

	return e.json(200, { ok: true });
});
