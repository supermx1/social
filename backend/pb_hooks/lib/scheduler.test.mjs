// Run: node --test backend/pb_hooks/lib/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { chooseSchedulerAction, defaultTzMinutes } = createRequire(import.meta.url)('./scheduler.js');

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
