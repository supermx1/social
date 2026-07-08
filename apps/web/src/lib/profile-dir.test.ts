import { describe, expect, it } from 'vitest';
import { allocateProfileDir } from './profile-dir';

describe('account profile allocation', () => {
	it('allocates deterministic per-account profile dirs from persona slug and platform', () => {
		expect(allocateProfileDir('/profiles', 'techdad', 'x')).toBe('/profiles/techdad-x');
	});

	it('sanitizes path parts so profile dirs cannot escape PROFILES_DIR', () => {
		expect(allocateProfileDir('/profiles', '../Kasa Brand', 'linkedin')).toBe(
			'/profiles/kasa-brand-linkedin'
		);
	});
});
