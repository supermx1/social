/// <reference path="../pb_data/types.d.ts" />
//
// PocketBase crons — the scheduler and its sibling timers (PRD §7.5).
// Pure DB logic runs in-process here; anything needing a browser or the model
// is handed to the worker by creating a `jobs` record. Every cron body is
// wrapped in try/catch — a throwing cron would kill the tick.
//
// IMPORTANT: PocketBase runs each cron handler in its OWN isolated JSVM context, so a handler
// CANNOT see this file's top-level scope. Anything shared must be require()'d INSIDE the callback.
// Helpers previously defined at the top of this file were invisible at runtime and every cron
// died on its first helper call ("ReferenceError: toPbDate is not defined"), swallowed by the
// try/catch into a log line — which is what silently stopped feed polling for a month.
// Do not hoist these requires back to the top of the file.

/* ---------- scheduler: every minute (§7.5) ---------- */

cronAdd('scheduler', '* * * * *', () => {
	try {
		const scheduler = require(`${__hooks}/lib/scheduler.js`);
		const h = require(`${__hooks}/lib/helpers.js`);

		const state = $app.findFirstRecordByFilter('app_state', "id != ''");
		if (state && state.getBool('paused')) return;

		const posts = $app.findRecordsByFilter('posts', "status = 'approved' || status = 'scheduled'", '', 0, 0, {});

		for (const post of posts) {
			$app.expandRecord(post, ['account', 'topic'], null);
			const account = post.expandedOne('account');
			if (!account) continue;
			const topic = post.expandedOne('topic');

			const action = scheduler.chooseSchedulerAction({
				now: new Date(),
				tzMinutes: h.tzMinutes,
				post: {
					id: post.id,
					status: post.getString('status'),
					timingMode: post.getString('timing_mode'),
					scheduledFor: h.isoOrNull(post, 'scheduled_for'),
					randomWindowStart: h.isoOrNull(post, 'random_window_start'),
					randomWindowEnd: h.isoOrNull(post, 'random_window_end'),
					topicExpiresAt: topic ? h.isoOrNull(topic, 'expires_at') : null,
				},
				account: {
					active: account.getBool('active'),
					sessionStatus: account.getString('session_status'),
					timezone: account.getString('timezone'),
					postingWindowStart: account.getString('posting_window_start'),
					postingWindowEnd: account.getString('posting_window_end'),
					maxPostsPerDay: account.getInt('max_posts_per_day'),
					minGapMinutes: account.getInt('min_gap_minutes'),
				},
				publishedToday: h.publishedToday(account.id),
				lastPostedAt: h.lastPostedAt(account.id),
			});

			if (action.type === 'expire') {
				post.set('status', 'expired');
				$app.save(post);
			} else if (action.type === 'schedule') {
				post.set('status', 'scheduled');
				post.set('scheduled_for', h.toPbDate(action.scheduledFor));
				$app.save(post);
			} else if (action.type === 'enqueue' && !h.jobExists('post_now', 'postId', post.id)) {
				h.createJob('post_now', { postId: post.id });
			}
		}

		// Catch-up guard: scheduled posts >24h past due are skipped, never burst-posted (§7.5).
		const cutoff = h.toPbDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
		const stale = $app.findRecordsByFilter(
			'posts',
			"status = 'scheduled' && scheduled_for != '' && scheduled_for < {:c}",
			'',
			0,
			0,
			{ c: cutoff },
		);
		for (const post of stale) {
			post.set('status', 'skipped');
			$app.save(post);
		}

		// Repeat chains: a finished occurrence of a repeating post hands `repeat` on to a fresh
		// successor record and gives it up itself, so exactly one post in a chain is ever
		// repeatable — that is the whole idempotency guard, no "does a successor exist" query.
		// `skipped` is included deliberately: the catch-up guard above marks
		// overdue posts skipped, and a daily ad must not die permanently just
		// because one day was missed.
		const repeating = $app.findRecordsByFilter(
			'posts',
			"repeat != '' && (status = 'posted' || status = 'skipped')",
			'',
			0,
			0,
			{},
		);
		for (const post of repeating) {
			try {
				const previous =
					h.isoOrNull(post, 'scheduled_for') || h.isoOrNull(post, 'posted_at') || h.isoOrNull(post, 'updated');
				const repeat = post.getString('repeat');
				const repeatUntil = h.isoOrNull(post, 'repeat_until');
				const next = scheduler.nextRepeatOccurrence({ repeat, repeatUntil, previous, now: new Date() });

				// Clear `repeat` on the finished post FIRST, and only then create the successor.
				// The other order is a trap: if the successor saves but this one fails, the post
				// keeps its `repeat` and spawns another successor on the NEXT tick, and every
				// duplicate carries `repeat` too — one stuck save becomes a post a minute, all of
				// them scheduled and all of them real. Failing this way round can only ever end a
				// chain early, which the operator can see and fix; the other way silently floods.
				post.set('repeat', '');
				$app.save(post);

				if (next) {
					const successor = new Record($app.findCollectionByNameOrId('posts'));
					successor.set('account', post.get('account'));
					successor.set('topic', post.get('topic'));
					successor.set('kind', post.getString('kind'));
					successor.set('body', post.getString('body'));
					successor.set('media', post.get('media'));
					successor.set('timing_mode', post.getString('timing_mode'));
					successor.set('repeat', repeat);
					// Round-tripped through toPbDate rather than copied with getString(): this is a
					// date field, and its string form is not the format the setter expects back.
					successor.set('repeat_until', repeatUntil ? h.toPbDate(repeatUntil) : '');
					successor.set('repeat_of', post.getString('repeat_of') || post.id);
					successor.set('status', 'approved');
					successor.set('scheduled_for', h.toPbDate(next));
					successor.set('attempts', 0);
					$app.save(successor);
				}
			} catch (err) {
				console.error('scheduler cron (repeat pass):', err);
			}
		}
	} catch (err) {
		console.error('scheduler cron:', err);
	}
});

/* ---------- keep-warm: every 30 min, fires per account every ~12–18h ---------- */

cronAdd('keepwarm', '*/30 * * * *', () => {
	try {
		const h = require(`${__hooks}/lib/helpers.js`);
		const accounts = $app.findRecordsByFilter('accounts', "active = true && session_status = 'active'", '', 0, 0, {});
		const now = Date.now();
		for (const a of accounts) {
			const last = h.isoOrNull(a, 'last_warmed_at');
			// ponytail: fixed 12h + 0–6h jitter, re-rolled each tick; make per-account if it ever matters
			const threshold = (12 + Math.random() * 6) * 3600 * 1000;
			if (last && now - new Date(last).getTime() < threshold) continue;
			if (!h.jobExists('warm', 'accountId', a.id)) h.createJob('warm', { accountId: a.id });
		}
	} catch (err) {
		console.error('keepwarm cron:', err);
	}
});

/* ---------- feed poll: every 15 min, per feed interval (§7.4.2) ---------- */

cronAdd('feedpoll', '*/15 * * * *', () => {
	try {
		const h = require(`${__hooks}/lib/helpers.js`);
		const feeds = $app.findRecordsByFilter('feeds', 'active = true', '', 0, 0, {});
		const now = Date.now();
		for (const f of feeds) {
			const interval = (f.getInt('poll_interval_minutes') || 180) * 60000;
			const last = h.isoOrNull(f, 'last_polled_at');
			if (last && now - new Date(last).getTime() < interval) continue;
			if (!h.jobExists('feed_poll', 'feedId', f.id)) h.createJob('feed_poll', { feedId: f.id });
		}
	} catch (err) {
		console.error('feedpoll cron:', err);
	}
});

/* ---------- topic TTL: daily, dismiss stale `new` topics (§7.4) ---------- */

cronAdd('topicttl', '0 3 * * *', () => {
	try {
		const h = require(`${__hooks}/lib/helpers.js`);
		const days = Number(h.envGet('TOPIC_INBOX_TTL_DAYS', '7')) || 7;
		const cutoff = h.toPbDate(new Date(Date.now() - days * 86400000));
		const stale = $app.findRecordsByFilter('topics', "status = 'new' && created < {:c}", '', 0, 0, { c: cutoff });
		for (const t of stale) {
			t.set('status', 'dismissed');
			$app.save(t);
		}
	} catch (err) {
		console.error('topicttl cron:', err);
	}
});
