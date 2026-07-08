/// <reference path="../pb_data/types.d.ts" />
migrate(
	(app) => {
		const rule = '@request.auth.id != ""';
		const rules = { listRule: rule, viewRule: rule, createRule: rule, updateRule: rule, deleteRule: rule };
		const autodates = [
			{ type: "autodate", name: "created", onCreate: true },
			{ type: "autodate", name: "updated", onCreate: true, onUpdate: true },
		];

		app.save(
			new Collection(
				Object.assign({}, rules, {
					type: "base",
					name: "personas",
					indexes: ["CREATE UNIQUE INDEX idx_personas_slug ON personas (slug)"],
					fields: [
						{ type: "text", name: "name", required: true },
						{ type: "text", name: "slug", required: true },
						{ type: "text", name: "mission" },
						{ type: "text", name: "audience" },
						{ type: "text", name: "voice_tone" },
						{ type: "text", name: "guardrails" },
						{ type: "json", name: "content_pillars" },
						{ type: "json", name: "domain_keywords" },
						{ type: "json", name: "example_posts" },
						{ type: "json", name: "links" },
						{ type: "json", name: "default_hashtags" },
						{ type: "bool", name: "active" },
					].concat(autodates),
				}),
			),
		);
		const personasId = app.findCollectionByNameOrId("personas").id;

		app.save(
			new Collection(
				Object.assign({}, rules, {
					type: "base",
					name: "accounts",
					indexes: ["CREATE UNIQUE INDEX idx_accounts_profile_dir ON accounts (profile_dir)"],
					fields: [
						{ type: "relation", name: "persona", required: true, collectionId: personasId, maxSelect: 1, cascadeDelete: true },
						{ type: "select", name: "platform", required: true, maxSelect: 1, values: ["linkedin", "x", "facebook_page", "youtube_community", "instagram", "threads"] },
						{ type: "text", name: "handle" },
						{ type: "text", name: "profile_dir", required: true },
						{ type: "select", name: "session_status", maxSelect: 1, values: ["active", "needs_reauth", "unknown", "disabled"] },
						{ type: "date", name: "last_verified_at" },
						{ type: "date", name: "last_warmed_at" },
						{ type: "text", name: "timezone" },
						{ type: "text", name: "posting_window_start" },
						{ type: "text", name: "posting_window_end" },
						{ type: "number", name: "max_posts_per_day" },
						{ type: "number", name: "min_gap_minutes" },
						{ type: "bool", name: "active" },
					].concat(autodates),
				}),
			),
		);

		app.save(
			new Collection(
				Object.assign({}, rules, {
					type: "base",
					name: "feeds",
					fields: [
						{ type: "text", name: "name", required: true },
						{ type: "url", name: "url", required: true },
						{ type: "relation", name: "personas", collectionId: personasId, maxSelect: 999 },
						{ type: "number", name: "poll_interval_minutes" },
						{ type: "number", name: "freshness_hours" },
						{ type: "number", name: "max_items_per_poll" },
						{ type: "bool", name: "auto_draft" },
						{ type: "date", name: "last_polled_at" },
						{ type: "text", name: "last_error" },
						{ type: "bool", name: "active" },
					].concat(autodates),
				}),
			),
		);

		app.save(
			new Collection(
				Object.assign({}, rules, {
					type: "base",
					name: "topics",
					// dedup_key deliberately NOT unique: empty values would collide; dedup is checked in code
					indexes: ["CREATE INDEX idx_topics_dedup_key ON topics (dedup_key)"],
					fields: [
						{ type: "text", name: "title", required: true },
						{ type: "select", name: "source_type", maxSelect: 1, values: ["manual", "rss", "web_search"] },
						{ type: "url", name: "source_url" },
						{ type: "text", name: "raw_content", required: true },
						{ type: "relation", name: "personas", collectionId: personasId, maxSelect: 999 },
						{ type: "select", name: "urgency", maxSelect: 1, values: ["low", "normal", "high"] },
						{ type: "date", name: "expires_at" },
						{ type: "select", name: "status", maxSelect: 1, values: ["new", "drafted", "dismissed"] },
						{ type: "relation", name: "feed", collectionId: app.findCollectionByNameOrId("feeds").id, maxSelect: 1 },
						{ type: "date", name: "published_at" },
						{ type: "number", name: "relevance_score" },
						{ type: "text", name: "relevance_reason" },
						{ type: "text", name: "dedup_key" },
					].concat(autodates),
				}),
			),
		);

		app.save(
			new Collection(
				Object.assign({}, rules, {
					type: "base",
					name: "posts",
					indexes: ["CREATE INDEX idx_posts_status ON posts (status)", "CREATE INDEX idx_posts_account ON posts (account)"],
					fields: [
						{ type: "relation", name: "account", required: true, collectionId: app.findCollectionByNameOrId("accounts").id, maxSelect: 1, cascadeDelete: true },
						{ type: "relation", name: "topic", collectionId: app.findCollectionByNameOrId("topics").id, maxSelect: 1 },
						{ type: "select", name: "kind", maxSelect: 1, values: ["evergreen", "topical"] },
						{ type: "text", name: "body" },
						{ type: "json", name: "media" },
						{ type: "select", name: "status", maxSelect: 1, values: ["draft", "approved", "scheduled", "posting", "posted", "error", "expired", "skipped"] },
						{ type: "select", name: "timing_mode", maxSelect: 1, values: ["exact", "random"] },
						{ type: "date", name: "scheduled_for" },
						{ type: "date", name: "random_window_start" },
						{ type: "date", name: "random_window_end" },
						{ type: "date", name: "posted_at" },
						{ type: "url", name: "post_url" },
						{ type: "number", name: "attempts" },
						{ type: "text", name: "error_message" },
						{ type: "text", name: "variant_group" },
					].concat(autodates),
				}),
			),
		);

		app.save(
			new Collection(
				Object.assign({}, rules, {
					type: "base",
					name: "jobs",
					fields: [
						{ type: "select", name: "type", required: true, maxSelect: 1, values: ["login_start", "login_confirm", "generate", "post_now", "warm", "verify", "feed_poll"] },
						{ type: "json", name: "payload" },
						{ type: "select", name: "status", maxSelect: 1, values: ["queued", "running", "done", "error"] },
						{ type: "text", name: "error" },
						{ type: "number", name: "attempts" },
					].concat(autodates),
				}),
			),
		);

		app.save(
			new Collection(
				Object.assign({}, rules, {
					type: "base",
					name: "run_log",
					fields: [
						{ type: "relation", name: "account", collectionId: app.findCollectionByNameOrId("accounts").id, maxSelect: 1 },
						{ type: "relation", name: "post", collectionId: app.findCollectionByNameOrId("posts").id, maxSelect: 1 },
						{ type: "select", name: "action", maxSelect: 1, values: ["warm", "verify", "post", "generate", "feed_poll"] },
						{ type: "select", name: "result", maxSelect: 1, values: ["ok", "fail"] },
						{ type: "text", name: "detail" },
					].concat(autodates),
				}),
			),
		);

		app.save(
			new Collection(
				Object.assign({}, rules, {
					type: "base",
					name: "app_state",
					fields: [{ type: "bool", name: "paused" }].concat(autodates),
				}),
			),
		);

		// env is superuser-only: all rules stay null
		app.save(
			new Collection({
				type: "base",
				name: "env",
				indexes: ["CREATE UNIQUE INDEX idx_env_key ON env (key)"],
				fields: [
					{ type: "text", name: "key", required: true },
					{ type: "text", name: "value" },
				].concat(autodates),
			}),
		);

		const state = new Record(app.findCollectionByNameOrId("app_state"));
		state.set("paused", false);
		app.save(state);
	},
	(app) => {
		for (const name of ["run_log", "posts", "topics", "feeds", "accounts", "personas", "jobs", "app_state", "env"]) {
			app.delete(app.findCollectionByNameOrId(name));
		}
	},
);
