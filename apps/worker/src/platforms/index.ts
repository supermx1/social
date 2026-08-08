import type { Platform } from '../types';
import type { EgoPlatformModule } from './types';
import { xPlatform } from './x';

// LinkedIn is intentionally NOT registered here. linkedin.ts still holds the old
// Playwright-era selectors and has never had a recon run against a live session (design
// doc §2.6) — porting it on guessed selectors would reintroduce exactly the brittleness
// the X recon disproved. It stays on disk untouched until it gets its own recon.
const modules = new Map<string, EgoPlatformModule>([[xPlatform.platform, xPlatform]]);

export function getPlatform(platform: Platform): EgoPlatformModule {
	if (platform === 'linkedin') {
		throw new Error(
			'LinkedIn needs its own ego-browser recon run before use (see docs/x-posting-recon.md ' +
				'for the X precedent). linkedin.ts is not wired up.',
		);
	}
	const module = modules.get(platform);
	if (!module) throw new Error(`Platform module not implemented for ${platform}. Phase 0 ships x first.`);
	return module;
}
