import { describe, expect, it } from 'vitest';
import { hasPublishEvidence } from '../lib/worker';

describe('publish evidence', () => {
	it('requires either a post URL or explicit platform confirmation', () => {
		expect(hasPublishEvidence({ postUrl: 'https://x.com/me/status/1' })).toBe(true);
		expect(hasPublishEvidence({ confirmed: true })).toBe(true);
		expect(hasPublishEvidence({ postUrl: '' })).toBe(false);
		expect(hasPublishEvidence({})).toBe(false);
	});
});
