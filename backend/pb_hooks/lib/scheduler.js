// Port of the original apps/worker scheduler decision logic. Ids are strings;
// date inputs may be a Date or an ISO string.
//
// Timezone note: PocketBase's goja JSVM has NO Intl and its toLocaleString
// ignores the timeZone option, so account-local posting windows can't be
// computed the usual way. `tzMinutes(date, tz)` (minutes-since-midnight in tz)
// is therefore injectable: Node/tests use the Intl default below; main.pb.js
// injects a DateTime-based version for goja (see there). DST-correct both ways.

function toDate(value) {
	if (value === null || value === undefined || value === "") return null;
	return value instanceof Date ? value : new Date(value);
}

function defaultTzMinutes(date, timezone) {
	if (typeof Intl === "undefined" || !Intl.DateTimeFormat) {
		throw new Error("scheduler: no Intl available — caller must pass input.tzMinutes");
	}
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone: timezone || "UTC",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).formatToParts(date);
	let h = 0,
		m = 0;
	for (const p of parts) {
		if (p.type === "hour") h = Number(p.value) % 24;
		if (p.type === "minute") m = Number(p.value);
	}
	return h * 60 + m;
}

function hhmmToMinutes(value) {
	const parts = String(value || "").split(":");
	return Number(parts[0] || 0) * 60 + Number(parts[1] || 0);
}

function withinPostingWindow(date, account, tzMinutes) {
	const current = (tzMinutes || defaultTzMinutes)(toDate(date), account.timezone);
	return current >= hhmmToMinutes(account.postingWindowStart) && current <= hhmmToMinutes(account.postingWindowEnd);
}

function rollRandomWithin(post, account, tzMinutes, random) {
	random = random || Math.random;
	const startDate = toDate(post.randomWindowStart);
	const start = startDate.getTime();
	const end = toDate(post.randomWindowEnd).getTime();
	const rolled = new Date(start + Math.floor((end - start) * random()));
	return withinPostingWindow(rolled, account, tzMinutes) ? rolled : startDate;
}

function chooseSchedulerAction(input) {
	const now = toDate(input.now);
	const post = input.post;
	const account = input.account;
	const tzMinutes = input.tzMinutes || defaultTzMinutes;
	const lastPostedAt = toDate(input.lastPostedAt);
	const topicExpiresAt = toDate(post.topicExpiresAt);
	const scheduledFor = toDate(post.scheduledFor);

	if (topicExpiresAt && now > topicExpiresAt) {
		return { type: "expire", postId: post.id };
	}
	if (!account.active || account.sessionStatus !== "active") {
		return { type: "none", reason: "account-inactive-or-session-not-active" };
	}
	if (post.timingMode === "random" && post.status !== "scheduled") {
		if (!toDate(post.randomWindowStart) || !toDate(post.randomWindowEnd)) {
			return { type: "none", reason: "missing-random-window" };
		}
		return { type: "schedule", postId: post.id, scheduledFor: rollRandomWithin(post, account, tzMinutes) };
	}
	if (!scheduledFor || now < scheduledFor) {
		return { type: "none", reason: "not-due" };
	}
	if (!withinPostingWindow(now, account, tzMinutes)) {
		return { type: "none", reason: "outside-window" };
	}
	if (input.publishedToday >= account.maxPostsPerDay) {
		return { type: "none", reason: "daily-cap" };
	}
	if (lastPostedAt && (now.getTime() - lastPostedAt.getTime()) / 60000 < account.minGapMinutes) {
		return { type: "none", reason: "min-gap" };
	}
	return { type: "enqueue", postId: post.id };
}

// --- repeat chains -----------------------------------------------------
//
// A repeating post is a CHAIN, not a cron: when a repeating post reaches a
// terminal state, the caller creates the next occurrence as a new post and
// clears `repeat` on the finished one, so each post spawns at most one
// successor. `nextRepeatOccurrence` only decides WHEN that successor lands
// (or that the chain should end) — it does no I/O.

const MAX_REPEAT_ITERATIONS = 10000; // safety valve: never spin forever on a bad input

function addDays(date, days) {
	return new Date(date.getTime() + days * 86400000);
}

function isWeekend(date) {
	const day = date.getUTCDay();
	return day === 0 || day === 6;
}

function advanceRepeat(date, repeat) {
	if (repeat === "weekly") return addDays(date, 7);
	if (repeat === "weekdays") {
		let next = addDays(date, 1);
		while (isWeekend(next)) next = addDays(next, 1);
		return next;
	}
	return addDays(date, 1); // daily
}

// Next occurrence for a repeating post, or null if the chain should end.
// `previous` is the previous occurrence's intended time (its time-of-day is
// preserved in the result); `now` is the current time. Rolls forward past
// any missed occurrences (paused app, downtime, ...) so a backlog never
// bursts out as a pile of backdated posts — the loop is capped so a bad
// input can never spin forever. UTC-based arithmetic only: no `Intl` under
// goja (see the timezone note at the top of this file).
function nextRepeatOccurrence(input) {
	const repeat = input.repeat;
	if (repeat !== "daily" && repeat !== "weekly" && repeat !== "weekdays") return null;

	// isNaN, not just null: toDate("") gives null but toDate("not a date") gives an Invalid Date,
	// whose comparisons are all false — it would sail past the roll-forward loop and the
	// repeatUntil check and be handed to the caller as a real occurrence to save.
	const previous = toDate(input.previous);
	if (!previous || isNaN(previous.getTime())) return null;

	const now = toDate(input.now) || new Date();
	const repeatUntil = toDate(input.repeatUntil);

	let next = advanceRepeat(previous, repeat);
	let iterations = 0;
	while (next.getTime() <= now.getTime()) {
		if (iterations++ >= MAX_REPEAT_ITERATIONS) return null;
		next = advanceRepeat(next, repeat);
	}

	if (repeatUntil && next.getTime() > repeatUntil.getTime()) return null;

	return next;
}

module.exports = {
	chooseSchedulerAction,
	rollRandomWithin,
	withinPostingWindow,
	defaultTzMinutes,
	nextRepeatOccurrence,
};
