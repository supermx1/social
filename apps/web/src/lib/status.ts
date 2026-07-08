import type { BadgeVariant } from '$lib/components/ui/badge';

/** Shared status-string -> badge color mapping, so every table/card agrees. */
const STATUS_VARIANTS: Record<string, BadgeVariant> = {
	// accounts.session_status
	active: 'success',
	needs_reauth: 'destructive',
	unknown: 'muted',
	disabled: 'muted',
	// posts.status
	draft: 'muted',
	approved: 'info',
	scheduled: 'violet',
	posting: 'warning',
	posted: 'success',
	error: 'destructive',
	expired: 'muted',
	skipped: 'muted',
	// topics.status
	new: 'info',
	drafted: 'violet',
	dismissed: 'muted',
	// jobs.status
	queued: 'muted',
	running: 'warning',
	done: 'success',
	// topics.urgency
	low: 'muted',
	normal: 'info',
	high: 'destructive',
	// run_log.result
	ok: 'success',
	fail: 'destructive'
};

export function statusVariant(status: string): BadgeVariant {
	return STATUS_VARIANTS[status] ?? 'outline';
}
