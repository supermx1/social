import { pb } from '$lib/pb';

export const load = async () => {
	const personas = await pb.collection('personas').getFullList({ sort: 'name' });
	return {
		personas: personas.map((p) => ({ id: p.id, name: p.name }))
	};
};
