import { describe, expect, it } from 'vitest';
import { dedupKey, extractMainText, isFresh, matchesKeywords, stripHtml } from '../lib/feeds';
import type { PersonaRecord } from '../types';

const persona = (keywords: string[]) => ({ id: 'p1', domain_keywords: keywords }) as unknown as PersonaRecord;

describe('feed ingestion gates', () => {
	it('dedups on guid first, else link stripped of query/UTM', () => {
		expect(dedupKey({ guid: 'abc', link: 'https://x.test/a?utm_source=rss' })).toBe('abc');
		expect(dedupKey({ link: 'https://x.test/a?utm_source=rss#frag' })).toBe('https://x.test/a');
		expect(dedupKey({ link: 'not a url' })).toBe('not a url');
	});

	it('freshness gate skips old items, passes undated ones', () => {
		const now = Date.parse('2026-07-07T12:00:00Z');
		expect(isFresh('2026-07-07T00:00:00Z', 24, now)).toBe(true);
		expect(isFresh('2026-07-01T00:00:00Z', 24, now)).toBe(false);
		expect(isFresh(undefined, 24, now)).toBe(true);
	});

	it('keyword pre-filter matches personas case-insensitively on title+summary', () => {
		const item = { title: 'New Smart Home hub', summary: 'A WiFi Router teardown' };
		expect(matchesKeywords(item, [persona(['smart home']), persona(['real estate'])])).toHaveLength(1);
		expect(matchesKeywords(item, [persona(['crypto'])])).toHaveLength(0);
	});

	it('strips html to plain text', () => {
		expect(stripHtml('<p>Hello&nbsp;<b>world</b> &amp; co</p>')).toBe('Hello world & co');
	});

	it('extracts <article> content over surrounding chrome', () => {
		const html = '<nav>Home</nav><article><p>Real story text.</p></article><footer>Copyright</footer>';
		expect(extractMainText(html)).toBe('Real story text.');
	});

	it('falls back to concatenated <p> tags when there is no <article>', () => {
		const html = '<div><p>First para.</p><p>Second para.</p></div>';
		expect(extractMainText(html)).toBe('First para.\n\nSecond para.');
	});

	it('falls back to the full stripped page when there is neither', () => {
		expect(extractMainText('<div>Just some text</div>')).toBe('Just some text');
	});
});
