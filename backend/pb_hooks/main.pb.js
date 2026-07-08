/// <reference path="../pb_data/types.d.ts" />
//
// PocketBase crons — the scheduler and its sibling timers (PRD §7.5).
// Pure DB logic runs in-process here; anything needing a browser or the model
// is handed to the worker by creating a `jobs` record. Every cron body is
// wrapped in try/catch — a throwing cron would kill the tick.

const scheduler = require(`${__hooks}/lib/scheduler.js`);

/* ---------- helpers ---------- */

// Minutes-since-midnight of `date` in an IANA `timezone`, for goja (no Intl).
// Parses the UTC wall-clock string AS the target zone via PocketBase's Go-backed
// DateTime to recover the zone's current offset (DST-correct), then applies it.
function tzMinutes(date, timezone) {
	if (!timezone) return date.getUTCHours() * 60 + date.getUTCMinutes();
	const wall = date.toISOString().slice(0, 19).replace('T', ' '); // "YYYY-MM-DD HH:MM:SS"
	const zoneInstant = Date.parse(new DateTime(wall, timezone).string().replace(' ', 'T'));
	const local = new Date(date.getTime() + (date.getTime() - zoneInstant));
	return local.getUTCHours() * 60 + local.getUTCMinutes();
}

// PB DateTime -> ISO string ("2026-07-07T12:00:00.000Z") or null when empty.
function isoOrNull(record, field) {
	const v = record.get(field);
	if (!v) return null;
	const s = typeof v === 'string' ? v : v.string ? v.string() : String(v);
	return s ? s.replace(' ', 'T') : null;
}

// JS Date | ISO string -> PB date literal ("2026-07-07 12:00:00.000Z").
function toPbDate(d) {
	return (d instanceof Date ? d : new Date(d)).toISOString().replace('T', ' ');
}

// Superuser-only runtime config (§6.9).
function envGet(key, fallback) {
	try {
		return $app.findFirstRecordByFilter('env', 'key = {:k}', { k: key }).getString('value') || fallback;
	} catch (_) {
		return fallback;
	}
}

function payloadOf(record) {
	try {
		return JSON.parse(record.getString('payload') || '{}');
	} catch (_) {
		return {};
	}
}

// True if a queued/running job of `type` already targets this entity — prevents
// double-enqueue across ticks while the worker is mid-job.
function jobExists(type, idKey, idVal) {
	try {
		const rows = $app.findRecordsByFilter(
			'jobs',
			"type = {:t} && (status = 'queued' || status = 'running')",
			'',
			0,
			0,
			{ t: type },
		);
		return rows.some((r) => String(payloadOf(r)[idKey]) === String(idVal));
	} catch (_) {
		return false;
	}
}

function createJob(type, payload) {
	const job = new Record($app.findCollectionByNameOrId('jobs'));
	job.set('type', type);
	job.set('payload', payload);
	job.set('status', 'queued');
	job.set('attempts', 0);
	$app.save(job);
}

function publishedToday(accountId) {
	const start = new Date();
	start.setHours(0, 0, 0, 0); // host-local day, matches the original worker.ts
	try {
		return $app.findRecordsByFilter(
			'posts',
			"account = {:a} && status = 'posted' && posted_at >= {:s}",
			'',
			0,
			0,
			{ a: accountId, s: toPbDate(start) },
		).length;
	} catch (_) {
		return 0;
	}
}

function lastPostedAt(accountId) {
	try {
		const rows = $app.findRecordsByFilter(
			'posts',
			"account = {:a} && status = 'posted' && posted_at != ''",
			'-posted_at',
			1,
			0,
			{ a: accountId },
		);
		return rows.length ? isoOrNull(rows[0], 'posted_at') : null;
	} catch (_) {
		return null;
	}
}

/* ---------- scheduler: every minute (§7.5) ---------- */

cronAdd('scheduler', '* * * * *', () => {
	try {
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
				tzMinutes: tzMinutes,
				post: {
					id: post.id,
					status: post.getString('status'),
					timingMode: post.getString('timing_mode'),
					scheduledFor: isoOrNull(post, 'scheduled_for'),
					randomWindowStart: isoOrNull(post, 'random_window_start'),
					randomWindowEnd: isoOrNull(post, 'random_window_end'),
					topicExpiresAt: topic ? isoOrNull(topic, 'expires_at') : null,
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
				publishedToday: publishedToday(account.id),
				lastPostedAt: lastPostedAt(account.id),
			});

			if (action.type === 'expire') {
				post.set('status', 'expired');
				$app.save(post);
			} else if (action.type === 'schedule') {
				post.set('status', 'scheduled');
				post.set('scheduled_for', toPbDate(action.scheduledFor));
				$app.save(post);
			} else if (action.type === 'enqueue' && !jobExists('post_now', 'postId', post.id)) {
				createJob('post_now', { postId: post.id });
			}
		}

		// Catch-up guard: scheduled posts >24h past due are skipped, never burst-posted (§7.5).
		const cutoff = toPbDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
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
	} catch (err) {
		console.error('scheduler cron:', err);
	}
});

/* ---------- keep-warm: every 30 min, fires per account every ~12–18h ---------- */

cronAdd('keepwarm', '*/30 * * * *', () => {
	try {
		const accounts = $app.findRecordsByFilter('accounts', "active = true && session_status = 'active'", '', 0, 0, {});
		const now = Date.now();
		for (const a of accounts) {
			const last = isoOrNull(a, 'last_warmed_at');
			// ponytail: fixed 12h + 0–6h jitter, re-rolled each tick; make per-account if it ever matters
			const threshold = (12 + Math.random() * 6) * 3600 * 1000;
			if (last && now - new Date(last).getTime() < threshold) continue;
			if (!jobExists('warm', 'accountId', a.id)) createJob('warm', { accountId: a.id });
		}
	} catch (err) {
		console.error('keepwarm cron:', err);
	}
});

/* ---------- feed poll: every 15 min, per feed interval (§7.4.2) ---------- */

cronAdd('feedpoll', '*/15 * * * *', () => {
	try {
		const feeds = $app.findRecordsByFilter('feeds', 'active = true', '', 0, 0, {});
		const now = Date.now();
		for (const f of feeds) {
			const interval = (f.getInt('poll_interval_minutes') || 180) * 60000;
			const last = isoOrNull(f, 'last_polled_at');
			if (last && now - new Date(last).getTime() < interval) continue;
			if (!jobExists('feed_poll', 'feedId', f.id)) createJob('feed_poll', { feedId: f.id });
		}
	} catch (err) {
		console.error('feedpoll cron:', err);
	}
});

/* ---------- topic TTL: daily, dismiss stale `new` topics (§7.4) ---------- */

cronAdd('topicttl', '0 3 * * *', () => {
	try {
		const days = Number(envGet('TOPIC_INBOX_TTL_DAYS', '7')) || 7;
		const cutoff = toPbDate(new Date(Date.now() - days * 86400000));
		const stale = $app.findRecordsByFilter('topics', "status = 'new' && created < {:c}", '', 0, 0, { c: cutoff });
		for (const t of stale) {
			t.set('status', 'dismissed');
			$app.save(t);
		}
	} catch (err) {
		console.error('topicttl cron:', err);
	}
});
