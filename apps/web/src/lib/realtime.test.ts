import { describe, expect, it, vi } from 'vitest';
import { subscribeToCollectionChanges } from './realtime';

describe('PocketBase realtime subscriptions', () => {
	it('subscribes to wildcard collection changes and cleans them up', async () => {
		const callbacks: Record<string, () => void> = {};
		const unsubscribers: Record<string, ReturnType<typeof vi.fn<() => void>>> = {};
		const client = {
			collection: vi.fn((name: string) => ({
				subscribe: vi.fn((topic: string, callback: () => void) => {
					callbacks[`${name}:${topic}`] = callback;
					unsubscribers[name] = vi.fn<() => void>();
					return Promise.resolve(unsubscribers[name]);
				})
			}))
		};
		const onChange = vi.fn();

		const cleanup = subscribeToCollectionChanges(client, ['jobs', 'posts'], onChange);
		await Promise.resolve();

		expect(client.collection).toHaveBeenCalledWith('jobs');
		expect(client.collection).toHaveBeenCalledWith('posts');
		expect(Object.keys(callbacks)).toEqual(['jobs:*', 'posts:*']);

		callbacks['jobs:*']();

		expect(onChange).toHaveBeenCalledTimes(1);

		cleanup();

		expect(unsubscribers.jobs).toHaveBeenCalledTimes(1);
		expect(unsubscribers.posts).toHaveBeenCalledTimes(1);
	});
});
