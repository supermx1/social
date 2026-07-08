import type { Platform } from '../types';
import type { PlatformModule } from './types';
import { xPlatform } from './x';
import { linkedinPlatform } from './linkedin';

const modules = new Map<string, PlatformModule>([
	[xPlatform.platform, xPlatform],
	[linkedinPlatform.platform, linkedinPlatform],
]);

export function getPlatform(platform: Platform) {
	const module = modules.get(platform);
	if (!module) throw new Error(`Platform module not implemented for ${platform}. Phase 0 ships x first.`);
	return module;
}
