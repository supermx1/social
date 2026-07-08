export function textValue(data: FormData, key: string, fallback = '') {
	return String(data.get(key) ?? fallback).trim();
}

export function numberValue(data: FormData, key: string, fallback: number) {
	const value = Number(data.get(key));
	return Number.isFinite(value) ? value : fallback;
}

export function boolValue(data: FormData, key: string) {
	return data.get(key) === 'on' || data.get(key) === 'true';
}

export function listValue(data: FormData, key: string) {
	return textValue(data, key)
		.split(/\n|,/)
		.map((item) => item.trim())
		.filter(Boolean);
}

export function idsValue(data: FormData, key: string) {
	return data
		.getAll(key)
		.map((value) => String(value))
		.filter(Boolean);
}

export function dateValue(data: FormData, key: string) {
	const raw = textValue(data, key);
	return raw ? new Date(raw).toISOString() : '';
}
