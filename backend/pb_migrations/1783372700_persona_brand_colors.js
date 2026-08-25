/// <reference path="../pb_data/types.d.ts" />
//
// personas.brand_colors — the brand's actual palette, as hex values.
//
// Separate from image_style on purpose. image_style is prose describing mood and composition, and
// burying "#7C5CFF" in a paragraph both hides it from the operator and lets the model dilute it.
// The concrete failure this fixes: Kasa's generated imagery came back with no brand colour at all,
// because the palette written into image_style had been invented rather than taken from the brand
// (kasa.africa's own tokens are a purple --primary, not the greens that were guessed).
//
// A dedicated field is also the discoverable place to put brand details, which is what was asked
// for. Empty is fine — image generation simply doesn't constrain colour.

migrate(
	(app) => {
		const personas = app.findCollectionByNameOrId('personas');
		personas.fields.add(new Field({ type: 'text', name: 'brand_colors' }));
		app.save(personas);
	},
	(app) => {
		const personas = app.findCollectionByNameOrId('personas');
		personas.fields.removeByName('brand_colors');
		app.save(personas);
	},
);
