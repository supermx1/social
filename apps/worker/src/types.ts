/**
 * Enum unions + record shapes for the PocketBase collections the worker touches.
 * PB record ids are strings; date fields are ISO strings ('' when unset).
 */

export type Platform =
	| 'linkedin'
	| 'x'
	| 'facebook_page'
	| 'youtube_community'
	| 'instagram'
	| 'threads';

export type SessionStatus = 'active' | 'needs_reauth' | 'unknown' | 'disabled';

export type SourceType = 'manual' | 'rss' | 'web_search';
export type Urgency = 'low' | 'normal' | 'high';
export type TopicStatus = 'new' | 'drafted' | 'dismissed';

export type PostKind = 'evergreen' | 'topical';
export type PostStatus =
	| 'draft'
	| 'approved'
	| 'scheduled'
	| 'posting'
	| 'posted'
	| 'error'
	| 'expired'
	| 'skipped';
export type TimingMode = 'exact' | 'random';

export type JobType =
	| 'login_start'
	| 'login_confirm'
	| 'generate'
	| 'post_now'
	| 'warm'
	| 'verify'
	| 'feed_poll';
export type JobStatus = 'queued' | 'running' | 'done' | 'error';

export type RunAction = 'warm' | 'verify' | 'post' | 'generate' | 'feed_poll';
export type RunResult = 'ok' | 'fail';

export type Link = { label: string; url: string };

/** Type-specific args for a queued worker job (PRD §5.3 / §6.8). */
export type JobPayload =
	| { accountId: string } // login_start | login_confirm | warm | verify
	| { postId: string } // post_now
	| { feedId: string } // feed_poll
	| {
			// generate
			personaId: string;
			platform: Platform;
			n: number;
			topicId?: string; // set for topical (Mode B); omit for evergreen (Mode A)
			pillar?: string; // set for evergreen
	  };

type Base = { id: string; created: string; updated: string };

export type AccountRecord = Base & {
	persona: string;
	platform: Platform;
	handle: string;
	profile_dir: string;
	session_status: SessionStatus;
	last_verified_at: string;
	last_warmed_at: string;
	timezone: string;
	posting_window_start: string;
	posting_window_end: string;
	max_posts_per_day: number;
	min_gap_minutes: number;
	active: boolean;
};

export type PersonaRecord = Base & {
	name: string;
	slug: string;
	mission: string;
	audience: string;
	voice_tone: string;
	guardrails: string;
	content_pillars: string[];
	domain_keywords: string[];
	example_posts: string[];
	links: Link[];
	default_hashtags: string[];
	active: boolean;
};

export type TopicRecord = Base & {
	title: string;
	source_type: SourceType;
	source_url: string;
	raw_content: string;
	personas: string[];
	urgency: Urgency;
	expires_at: string;
	status: TopicStatus;
	feed: string;
	published_at: string;
	relevance_score: number;
	relevance_reason: string;
	dedup_key: string;
};

export type PostRecord = Base & {
	account: string;
	topic: string;
	kind: PostKind;
	body: string;
	media: string[];
	status: PostStatus;
	timing_mode: TimingMode;
	scheduled_for: string;
	random_window_start: string;
	random_window_end: string;
	posted_at: string;
	post_url: string;
	attempts: number;
	error_message: string;
	variant_group: string;
};

export type JobRecord = Base & {
	type: JobType;
	payload: JobPayload;
	status: JobStatus;
	error: string;
	attempts: number;
};
