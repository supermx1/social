import { pb } from './pb';
import { alertTelegram } from './alerts';
import { composePost, loginStart, verifySession, warmSession } from './browser';
import { generateDrafts } from './generator';
import { pollFeed } from './feeds';
import { generateImage, NoImageStyleError } from './images';
import { claimNextJob, completeJob, failJob } from './jobs';
import type { PBLike } from './jobs';
import type { AccountRecord, JobRecord, PersonaRecord, Platform, PostRecord } from '../types';

function getAccount(id: string) {
	return pb.collection('accounts').getOne<AccountRecord>(id);
}

/**
 * Generates (or regenerates) one post's image and writes the path to posts.media.
 * Non-fatal by design (design doc §4.3): a genuine failure is recorded on the post's
 * error_message so the operator sees it in the Queue, but never thrown — the caller (a
 * text-draft job or the dedicated generate_image job) must not fail because of this.
 * An empty persona.image_style (NoImageStyleError) is the documented "no images for this
 * persona" outcome, not a failure, so it is swallowed silently.
 */
export async function draftImage(post: PostRecord, persona: PersonaRecord, client: PBLike = pb) {
	try {
		const path = await generateImage({ persona, body: post.body });
		await client.collection('posts').update(post.id, { media: [path] });
	} catch (error) {
		if (error instanceof NoImageStyleError) return;
		await client.collection('posts').update(post.id, {
			error_message: error instanceof Error ? error.message : String(error),
		});
	}
}

/**
 * Attaches one generated image to each draft just created by generateDrafts for this payload.
 * ponytail: lib/generator.ts (owned elsewhere) doesn't return the posts it creates, so the newest
 * `n` drafts for the resolved account are re-queried rather than threading a return value through
 * a module this task doesn't touch.
 */
export async function attachImages(
	payload: { personaId: string; platform: Platform; n: number },
	client: PBLike = pb,
) {
	// ponytail: client is typed via PBLike (collection(): any) so tests can pass a plain fake —
	// generic type args don't type-check against an `any`-returning call, so annotate instead.
	const persona: PersonaRecord = await client.collection('personas').getOne(payload.personaId);
	const account: AccountRecord = await client
		.collection('accounts')
		.getFirstListItem(
			pb.filter('persona = {:persona} && platform = {:platform} && active = true', {
				persona: payload.personaId,
				platform: payload.platform,
			}),
		);
	const { items }: { items: PostRecord[] } = await client.collection('posts').getList(1, payload.n, {
		filter: pb.filter('account = {:account} && status = "draft"', { account: account.id }),
		sort: '-created',
	});
	for (const post of items) {
		await draftImage(post, persona, client);
	}
}

export function hasPublishEvidence(result: { postUrl?: string; confirmed?: boolean }) {
	return Boolean(result.postUrl || result.confirmed);
}

async function verifyAndRecord(account: AccountRecord) {
	const active = await verifySession(account);
	await pb.collection('accounts').update(account.id, {
		session_status: active ? 'active' : 'needs_reauth',
		last_verified_at: active ? new Date().toISOString() : account.last_verified_at,
	});
	if (!active) await markNeedsReauth(account);
}

async function markNeedsReauth(account: AccountRecord) {
	await pb.collection('accounts').update(account.id, { session_status: 'needs_reauth' });
	await alertTelegram(`Re-auth needed for ${account.platform} ${account.handle || account.id}.`);
}

async function publishPost(post: PostRecord, account: AccountRecord) {
	try {
		await pb.collection('posts').update(post.id, { status: 'posting' });
		const result = await composePost(account, post);
		if (!hasPublishEvidence(result)) {
			throw new Error(`${account.platform} did not provide publish confirmation.`);
		}
		await pb.collection('posts').update(post.id, {
			status: 'posted',
			posted_at: new Date().toISOString(),
			post_url: result.postUrl ?? '',
			error_message: '',
		});
		await pb
			.collection('run_log')
			.create({ account: account.id, post: post.id, action: 'post', result: 'ok', detail: 'posted' });
	} catch (error) {
		const attempts = post.attempts + 1;
		const terminal = attempts >= 3;
		await pb.collection('posts').update(post.id, {
			status: terminal ? 'error' : 'approved',
			attempts,
			error_message: error instanceof Error ? error.message : String(error),
		});
		if (error instanceof Error && error.message.includes('Session is not active')) {
			await markNeedsReauth(account);
		}
		if (terminal) {
			await alertTelegram(`Post failed after retries for ${account.platform} ${account.handle}: ${error}`);
		}
	}
}

async function executeJob(job: JobRecord) {
	const payload = job.payload;
	switch (job.type) {
		case 'login_start': {
			if (!('accountId' in payload)) throw new Error('accountId missing');
			const account = await getAccount(payload.accountId);
			await loginStart(account); // returns when the operator closes the login window
			await verifyAndRecord(account); // then confirm the session automatically
			break;
		}
		case 'login_confirm':
		case 'verify': {
			if (!('accountId' in payload)) throw new Error('accountId missing');
			await verifyAndRecord(await getAccount(payload.accountId));
			break;
		}
		case 'warm': {
			if (!('accountId' in payload)) throw new Error('accountId missing');
			const account = await getAccount(payload.accountId);
			const active = await warmSession(account);
			await pb.collection('accounts').update(account.id, {
				session_status: active ? 'active' : 'needs_reauth',
				last_warmed_at: new Date().toISOString(),
			});
			if (!active) await markNeedsReauth(account);
			break;
		}
		case 'generate':
			if (!('personaId' in payload)) throw new Error('generate payload missing personaId');
			await generateDrafts(payload);
			if (payload.withImages) await attachImages(payload);
			break;
		case 'post_now': {
			if (!('postId' in payload)) throw new Error('postId missing');
			const post = await pb.collection('posts').getOne<PostRecord>(payload.postId);
			const account = await getAccount(post.account);
			await publishPost(post, account);
			break;
		}
		case 'generate_image': {
			if (!('postId' in payload)) throw new Error('postId missing');
			const post = await pb.collection('posts').getOne<PostRecord>(payload.postId);
			const account = await getAccount(post.account);
			const persona = await pb.collection('personas').getOne<PersonaRecord>(account.persona);
			await draftImage(post, persona);
			break;
		}
		case 'feed_poll':
			if (!('feedId' in payload)) throw new Error('feedId missing');
			// ponytail: auto_draft (PRD §7.4.2) not wired yet — add a generate job here when a feed needs it
			await pollFeed(payload.feedId);
			break;
	}
}

export async function processOneJob() {
	const job = await claimNextJob();
	if (!job) return false;
	try {
		await executeJob(job);
		await completeJob(job.id);
	} catch (error) {
		await failJob(job.id, error);
	}
	return true;
}
