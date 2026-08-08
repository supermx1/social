// Shared cron helpers.
//
// These live in a module rather than at the top of main.pb.js because PocketBase executes each
// cron/hook handler in its OWN isolated JSVM context — a handler cannot see the enclosing file's
// top-level scope. Defining these beside the crons made every one of them die on the first helper
// call with "ReferenceError: <name> is not defined", swallowed by each cron's own try/catch into a
// log line. That is what silently stopped feed polling (observed: last_polled_at frozen at
// 2026-07-07, zero topics ever created).
//
// Every handler must therefore `require()` this INSIDE its callback, not at file top level.
//
// `$app`, `Record` and `DateTime` are JSVM globals and remain available inside required modules.

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

module.exports = {
	tzMinutes,
	isoOrNull,
	toPbDate,
	envGet,
	payloadOf,
	jobExists,
	createJob,
	publishedToday,
	lastPostedAt,
};
