// Run: node --test backend/pb_hooks/lib/scheduler.test.mjs
// (the directory form stopped resolving under Node 26 — it tries to require the dir as a module)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { chooseSchedulerAction, defaultTzMinutes, nextRepeatOccurrence } = createRequire(import.meta.url)('./scheduler.js');

const account = (over = {}) => ({
	active: true,
	sessionStatus: 'active',
	timezone: 'UTC',
	postingWindowStart: '00:00',
	postingWindowEnd: '23:59',
	maxPostsPerDay: 5,
	minGapMinutes: 60,
	...over,
});

const post = (over = {}) => ({
	id: 'p1',
	status: 'approved',
	timingMode: 'exact',
	scheduledFor: null,
	randomWindowStart: null,
	randomWindowEnd: null,
	topicExpiresAt: null,
	...over,
});

const now = new Date('2026-07-07T12:00:00Z');

test('expires a topical post past its expiry', () => {
	const a = chooseSchedulerAction({
		now,
		post: post({ topicExpiresAt: '2026-07-07T11:00:00Z' }),
		account: account(),
		publishedToday: 0,
		lastPostedAt: null,
	});
	assert.equal(a.type, 'expire');
});

test('does nothing when session is not active', () => {
	const a = chooseSchedulerAction({
		now,
		post: post({ scheduledFor: '2026-07-07T11:00:00Z' }),
		account: account({ sessionStatus: 'needs_reauth' }),
		publishedToday: 0,
		lastPostedAt: null,
	});
	assert.equal(a.type, 'none');
});

test('rolls a concrete time for a fresh random post', () => {
	const a = chooseSchedulerAction({
		now,
		post: post({
			timingMode: 'random',
			randomWindowStart: '2026-07-07T10:00:00Z',
			randomWindowEnd: '2026-07-07T14:00:00Z',
		}),
		account: account(),
		publishedToday: 0,
		lastPostedAt: null,
	});
	assert.equal(a.type, 'schedule');
	assert.ok(a.scheduledFor instanceof Date);
});

test('does not re-roll a random post already scheduled', () => {
	const a = chooseSchedulerAction({
		now,
		post: post({ status: 'scheduled', timingMode: 'random', scheduledFor: '2026-07-07T11:00:00Z' }),
		account: account(),
		publishedToday: 0,
		lastPostedAt: null,
	});
	assert.equal(a.type, 'enqueue'); // treated as a due exact-time post now
});

test('holds when not yet due', () => {
	const a = chooseSchedulerAction({
		now,
		post: post({ scheduledFor: '2026-07-07T13:00:00Z' }),
		account: account(),
		publishedToday: 0,
		lastPostedAt: null,
	});
	assert.equal(a.type, 'none');
});

test('holds outside the posting window', () => {
	const a = chooseSchedulerAction({
		now,
		post: post({ scheduledFor: '2026-07-07T11:00:00Z' }),
		account: account({ postingWindowStart: '13:00', postingWindowEnd: '14:00' }),
		publishedToday: 0,
		lastPostedAt: null,
	});
	assert.equal(a.type, 'none');
});

test('holds at the daily cap', () => {
	const a = chooseSchedulerAction({
		now,
		post: post({ scheduledFor: '2026-07-07T11:00:00Z' }),
		account: account({ maxPostsPerDay: 2 }),
		publishedToday: 2,
		lastPostedAt: null,
	});
	assert.equal(a.type, 'none');
});

test('holds inside the min-gap since last post', () => {
	const a = chooseSchedulerAction({
		now,
		post: post({ scheduledFor: '2026-07-07T11:00:00Z' }),
		account: account({ minGapMinutes: 120 }),
		publishedToday: 0,
		lastPostedAt: '2026-07-07T11:30:00Z', // 30 min ago < 120
	});
	assert.equal(a.type, 'none');
});

test('enqueues a due, in-window, under-cap post', () => {
	const a = chooseSchedulerAction({
		now,
		post: post({ scheduledFor: '2026-07-07T11:00:00Z' }),
		account: account(),
		publishedToday: 0,
		lastPostedAt: '2026-07-07T09:00:00Z', // 3h ago > gap
	});
	assert.equal(a.type, 'enqueue');
	assert.equal(a.postId, 'p1');
});

test('posting window is evaluated in the account timezone', () => {
	// 12:00Z = 08:00 in New York (EDT); a 09:00–17:00 NY window excludes it.
	const a = chooseSchedulerAction({
		now, // 2026-07-07T12:00:00Z
		post: post({ scheduledFor: '2026-07-07T11:00:00Z' }),
		account: account({ timezone: 'America/New_York', postingWindowStart: '09:00', postingWindowEnd: '17:00' }),
		publishedToday: 0,
		lastPostedAt: null,
	});
	assert.equal(a.type, 'none'); // 08:00 NY is before the window opens
});

test('defaultTzMinutes returns account-local minutes (DST-aware)', () => {
	const noon = new Date('2026-07-07T12:00:00Z');
	assert.equal(defaultTzMinutes(noon, 'Africa/Lagos'), 13 * 60); // UTC+1
	assert.equal(defaultTzMinutes(noon, 'America/New_York'), 8 * 60); // UTC-4 (EDT)
});

// --- nextRepeatOccurrence ------------------------------------------------

test('daily repeat advances by 24h, preserving time of day', () => {
	const next = nextRepeatOccurrence({
		repeat: 'daily',
		repeatUntil: null,
		previous: '2026-07-07T09:00:00Z',
		now: new Date('2026-07-07T09:30:00Z'),
	});
	assert.equal(next.toISOString(), '2026-07-08T09:00:00.000Z');
});

test('weekly repeat advances by 7 days', () => {
	const next = nextRepeatOccurrence({
		repeat: 'weekly',
		repeatUntil: null,
		previous: '2026-07-07T09:00:00Z',
		now: new Date('2026-07-07T09:30:00Z'),
	});
	assert.equal(next.toISOString(), '2026-07-14T09:00:00.000Z');
});

test('weekdays repeat advances by one day on a normal weekday', () => {
	// 2026-07-07 is a Tuesday
	const next = nextRepeatOccurrence({
		repeat: 'weekdays',
		repeatUntil: null,
		previous: '2026-07-07T09:00:00Z',
		now: new Date('2026-07-07T09:30:00Z'),
	});
	assert.equal(next.toISOString(), '2026-07-08T09:00:00.000Z'); // Wednesday
});

test('weekdays repeat rolls a Friday to Monday, never Sat/Sun', () => {
	// 2026-07-10 is a Friday
	const next = nextRepeatOccurrence({
		repeat: 'weekdays',
		repeatUntil: null,
		previous: '2026-07-10T09:00:00Z',
		now: new Date('2026-07-10T09:30:00Z'),
	});
	assert.equal(next.getUTCDay(), 1); // Monday
	assert.equal(next.toISOString(), '2026-07-13T09:00:00.000Z');
});

test('time of day is preserved across a missed-occurrence roll-forward', () => {
	const next = nextRepeatOccurrence({
		repeat: 'daily',
		repeatUntil: null,
		previous: '2026-07-01T09:00:00Z',
		now: new Date('2026-07-07T12:00:00Z'), // several days later
	});
	assert.equal(next.getUTCHours(), 9);
	assert.equal(next.getUTCMinutes(), 0);
});

test('missed occurrences roll forward to the future, not a backlog', () => {
	// A week of downtime: `previous` is a week stale relative to `now`.
	const next = nextRepeatOccurrence({
		repeat: 'daily',
		repeatUntil: null,
		previous: '2026-07-01T09:00:00Z',
		now: new Date('2026-07-07T15:00:00Z'),
	});
	// The single next future slot, not a burst of backdated occurrences.
	assert.equal(next.toISOString(), '2026-07-08T09:00:00.000Z');
	assert.ok(next.getTime() > new Date('2026-07-07T15:00:00Z').getTime());
});

test('repeat_until ends the chain once the next occurrence would be past it', () => {
	const next = nextRepeatOccurrence({
		repeat: 'daily',
		repeatUntil: '2026-07-07T23:59:59Z',
		previous: '2026-07-07T09:00:00Z',
		now: new Date('2026-07-07T10:00:00Z'),
	});
	assert.equal(next, null);
});

test('empty repeat returns null', () => {
	const next = nextRepeatOccurrence({
		repeat: '',
		repeatUntil: null,
		previous: '2026-07-07T09:00:00Z',
		now: new Date('2026-07-07T10:00:00Z'),
	});
	assert.equal(next, null);
});

test('unrecognised repeat value returns null', () => {
	const next = nextRepeatOccurrence({
		repeat: 'monthly',
		repeatUntil: null,
		previous: '2026-07-07T09:00:00Z',
		now: new Date('2026-07-07T10:00:00Z'),
	});
	assert.equal(next, null);
});

test('the roll-forward loop terminates instead of spinning on absurd input', () => {
	const next = nextRepeatOccurrence({
		repeat: 'daily',
		repeatUntil: null,
		previous: '1000-01-01T09:00:00Z', // absurdly far in the past
		now: new Date('2026-07-07T10:00:00Z'),
	});
	// Too many missed days to roll through under the safety cap — the chain
	// ends rather than looping forever or bursting out a huge backlog.
	assert.equal(next, null);
});

test('an unparseable previous occurrence ends the chain instead of yielding an invalid date', () => {
	const next = nextRepeatOccurrence({ repeat: 'daily', previous: 'not a date', now });
	assert.equal(next, null);
});

test('a previous occurrence on a weekend still lands on a weekday', () => {
	// Saturday. Reachable whenever a weekdays rule is set on a post that already went out at
	// the weekend, so it must not just add a day and stop on the Sunday.
	const next = nextRepeatOccurrence({
		repeat: 'weekdays',
		previous: '2026-08-08T09:00:00Z',
		now: new Date('2026-08-08T10:00:00Z'),
	});
	assert.equal(next.getUTCDay(), 1); // Monday
	assert.equal(next.toISOString(), '2026-08-10T09:00:00.000Z');
});
