/// <reference path="../pb_data/types.d.ts" />
//
// design doc: docs/linkedin-posting-recon.md
//
// accounts.company_id — which LinkedIn identity to post as.
//
// On LinkedIn a single login can publish as the personal profile OR as any company page it
// administers, and the identity is chosen by the composer URL, not by a control in the page:
//   company_id set   -> https://www.linkedin.com/company/<id>/admin/page-posts/published/?share=true
//   company_id empty -> https://www.linkedin.com/preload/sharebox/   (personal profile)
//
// So "Kasa on LinkedIn" and "TechGFX on LinkedIn" are two separate account rows sharing one
// browser session, distinguished only by this field. `handle` cannot express it — it holds the
// display name the guard checks the composer against ("Kasa"), not the numeric page id.

migrate(
	(app) => {
		const accounts = app.findCollectionByNameOrId('accounts');
		accounts.fields.add(new Field({ type: 'text', name: 'company_id' }));
		app.save(accounts);
	},
	(app) => {
		const accounts = app.findCollectionByNameOrId('accounts');
		accounts.fields.removeByName('company_id');
		app.save(accounts);
	},
);
