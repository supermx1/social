import type { Platform } from '../types';
import type { EgoPlatformModule } from './types';
import { xPlatform } from './x';
import { linkedinPlatform } from './linkedin';

// Both modules are backed by their own live recon run — docs/x-posting-recon.md and
// docs/linkedin-posting-recon.md. Nothing gets registered here on guessed selectors.
const modules = new Map<string, EgoPlatformModule>([
	[xPlatform.platform, xPlatform],
	[linkedinPlatform.platform, linkedinPlatform],
]);

export function getPlatform(platform: Platform): EgoPlatformModule {
	const module = modules.get(platform);
	if (!module) {
		throw new Error(
			`Platform module not implemented for ${platform}. Each platform needs its own ego-browser ` +
				'recon run before it can be wired up — see docs/x-posting-recon.md for the precedent.',
		);
	}
	return module;
}
