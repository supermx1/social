import PocketBase from 'pocketbase';
import { browser, dev } from '$app/environment';

export const pb = new PocketBase(
	dev ? 'http://127.0.0.1:8095' : browser ? window.location.origin : 'http://127.0.0.1:8095'
);
