function slugPart(value: string) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

export function allocateProfileDir(baseDir: string, personaSlug: string, platform: string) {
	return `${baseDir}/${slugPart(personaSlug)}-${platform}`;
}
