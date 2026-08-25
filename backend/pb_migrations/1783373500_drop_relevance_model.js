/// <reference path="../pb_data/types.d.ts" />
//
// RELEVANCE_MODEL was seeded and shown on Settings, but generator.ts's resolveModel() always
// returns config.GEN_MODEL unconditionally — relevanceScore() in feeds.ts calls chatCompletion,
// which calls resolveModel(), same as content generation. There is no code path that ever reads
// RELEVANCE_MODEL. Same class of problem as 1783373400_drop_dead_env.js: a free-text setting
// with no effect is worse than no setting at all.

const KEY = 'RELEVANCE_MODEL';

migrate(
	(app) => {
		try {
			app.delete(app.findFirstRecordByFilter('env', 'key = {:k}', { k: KEY }));
		} catch (_) {
			// already gone
		}
	},
	(app) => {
		try {
			app.findFirstRecordByFilter('env', 'key = {:k}', { k: KEY });
		} catch (_) {
			const rec = new Record(app.findCollectionByNameOrId('env'));
			rec.set('key', KEY);
			rec.set('value', '');
			app.save(rec);
		}
	},
);
