/**
 * PocketBase reports validation failures in two halves: a generic `message` ("Failed to
 * create record.") and a `data` map holding the reason, one entry per invalid field. Reading
 * only `.message` — which every catch block in this app used to do — throws away the only
 * part that says what actually went wrong, so a missing required relation and a duplicate
 * unique index produce the identical, useless sentence.
 */

function fieldDetails(value: unknown): string[] {
	if (!value || typeof value !== 'object') return [];
	return Object.entries(value as Record<string, unknown>)
		.map(([field, detail]) => {
			if (!detail || typeof detail !== 'object' || !('message' in detail)) return '';
			const message = String((detail as { message: unknown }).message ?? '').trim();
			return message ? `${field.replace(/_/g, ' ')}: ${message}` : '';
		})
		.filter(Boolean);
}

/** Human-readable text for anything thrown by the PocketBase SDK (or any other error). */
export function errorMessage(error: unknown, fallback = 'Something went wrong.'): string {
	if (typeof error === 'string') return error || fallback;
	if (!error || typeof error !== 'object') return fallback;

	const err = error as {
		message?: unknown;
		data?: unknown;
		response?: { data?: unknown; message?: unknown };
	};

	// ClientResponseError keeps the parsed body on `.response`; a plain fetch caller may have
	// unwrapped it to the top level already, so accept either shape.
	const details = fieldDetails(err.response?.data ?? err.data);
	const base = String(err.response?.message ?? err.message ?? '').trim() || fallback;

	return details.length > 0 ? `${base} ${details.join('; ')}` : base;
}
