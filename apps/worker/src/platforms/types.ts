import type { Page } from 'playwright';
import type { PostRecord } from '../types';

export type PlatformModule = {
	platform: string;
	loginUrl: string;
	checkSession(page: Page): Promise<boolean>;
	warm(page: Page): Promise<void>;
	compose(page: Page, post: PostRecord): Promise<{ postUrl?: string; confirmed?: boolean }>;
};
