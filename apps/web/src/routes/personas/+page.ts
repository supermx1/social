import { pb } from '$lib/pb';

export const load = async () => {
	const personas = await pb.collection('personas').getFullList({ sort: 'name' });
	return {
		personas: personas.map((p) => ({
			id: p.id,
			name: p.name,
			slug: p.slug,
			mission: p.mission,
			audience: p.audience,
			voiceTone: p.voice_tone,
			imageStyle: p.image_style,
			brandColors: p.brand_colors ?? '',
			guardrails: p.guardrails,
			contentPillars: p.content_pillars ?? [],
			domainKeywords: p.domain_keywords ?? [],
			examplePosts: p.example_posts ?? [],
			defaultHashtags: p.default_hashtags ?? [],
			active: p.active
		}))
	};
};
