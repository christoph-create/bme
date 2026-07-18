# Message Templates & Collections — implementation plan

Combines two asks into one feature:
- our own backlog item: "save frequently-used payloads for quick re-publishing, independent of any particular broker or topic"
- external feature request: "Saved Message Templates and Collections" (name/description, edit, group into collections)

**Out of scope for this pass:** import/export of collections (explicitly deferred by the user).

Terminology: the codebase already has a `FavoriteMessage` concept (model, migration, repo, two unused Tauri commands) which is exactly "message template" under a different name. Rather than introduce a parallel `MessageTemplate` type, this plan **keeps the existing `favorite`/`Favorite*` naming** and extends it — renaming is pure churn with no behavioral upside. If that naming reads wrong once the feature is user-facing, a rename is a mechanical follow-up, not a redesign.

Frontend visual/UX design (layout, where buttons live, modal vs. inline editing, etc.) is deliberately **not** decided in this document — that's a separate discussion. What's decided here is the data model, service/API surface, and which components need new inputs/outputs to make that later design possible.

## Current state (as of this plan)

Already built, but never wired to any UI — pure unused plumbing:
- `core::models::{FavoriteMessage, NewFavoriteMessage}` — `id, connection_id: Option<Uuid>, topic, payload, qos, retain, created_at`. **No `name` or `description`.**
- `core::storage::favorites_repo::SqliteFavoritesRepository` — `create`, `get`, `list`, `list_by_connection`, `delete`. **No `update`.**
- Migration `0002_favorite_messages.sql`.
- Tauri commands `list_favorites`, `save_favorite` (note: inconsistent naming vs. `create_connection`). No `get_favorite`, `update_favorite`, or `delete_favorite` commands exist, even though the repo already supports get/delete.
- `FavoritesService.list()` / `.save()` on the Angular side, with a matching model file. Not injected into any component.

Also relevant: `PublishPanel` (`src/app/pages/broker-workspace/publish-panel/`) currently has **no retain control at all** — `publish()` hardcodes `retain: false`. Templates carry a `retain` flag, so this gap has to close before templates can round-trip faithfully through the live publish form.

## Step 1 — Complete favorite-message CRUD (backend + service layer)

Backend (`core/`):
- Add `name: Option<String>` and `description: Option<String>` to `FavoriteMessage` and `NewFavoriteMessage`.
- Add `UpdateFavoriteMessage { name, description, connection_id, topic, payload, qos, retain }`.
- Migration `0003_favorite_message_name_and_description.sql`: `ALTER TABLE favorite_messages ADD COLUMN name TEXT;` / `ADD COLUMN description TEXT;`.
- `FavoritesRepository`: add `update(&self, id, UpdateFavoriteMessage) -> Result<Option<FavoriteMessage>, StorageError>`, following the same "return `None` on unknown id" convention as `ConnectionsRepository::update` (see `core/src/storage/connections_repo.rs`).
- Unit tests for update (round-trip + unknown id), and for name/description persisting through create/get/list.

Tauri layer (`src-tauri/`):
- Add `get_favorite`, `update_favorite`, `delete_favorite` commands (repo support already exists for get/delete; only the command wrappers are missing).
- Rename `save_favorite` → `create_favorite` for consistency with `create_connection`/`update_connection`/`delete_connection`. Safe because nothing calls it yet.
- Register all four in `invoke_handler!`, `build.rs`'s command manifest, and `capabilities/default.json`.
- IPC-level tests in `src-tauri/src/lib.rs::tests`, mirroring the connection ones added for `update_connection`.

Frontend (`src/app/core/`):
- Extend `FavoriteMessage`/`NewFavoriteMessage` models with `name`/`description`; add `UpdateFavoriteMessage`.
- `FavoritesService`: rename `save` → `create`, add `get`, `update`, `delete`.
- Service spec coverage for the new/renamed methods.

No UI changes yet — this step just makes the backend capable of everything the feature needs.

## Step 2 — Collections

Backend:
- New table `favorite_collections`: `id, name, description, created_at`. New migration `0004_favorite_collections.sql`, which also adds `collection_id BLOB REFERENCES favorite_collections(id) ON DELETE SET NULL` to `favorite_messages`.
  - Deleting a collection detaches its templates (`SET NULL`) rather than deleting them — losing a folder shouldn't lose the messages in it.
  - A template belongs to **at most one** collection (simple FK, not a join table). Nothing in the request asks for a template to live in multiple collections; add a join table later only if that need shows up.
- `core::models`: `FavoriteCollection { id, name, description, created_at }`, `NewFavoriteCollection { name, description }`, `UpdateFavoriteCollection { name, description }`.
- New `core/src/storage/favorite_collections_repo.rs` — `FavoriteCollectionsRepository` trait + `SqliteFavoriteCollectionsRepository`, CRUD following the exact shape of `connections_repo.rs`.
- `FavoriteMessage`/`NewFavoriteMessage`/`UpdateFavoriteMessage` gain `collection_id: Option<Uuid>`.
- `FavoritesRepository`: add `list_by_collection(collection_id: Uuid)`, mirroring `list_by_connection`.
- Register new module in `core/src/storage/mod.rs` and the new migration in the `MIGRATIONS` list.

Tauri layer:
- `list_favorite_collections`, `create_favorite_collection`, `get_favorite_collection`, `update_favorite_collection`, `delete_favorite_collection`. Same registration checklist as step 1 (invoke_handler, build.rs, capabilities).

Frontend:
- `FavoriteCollection` model, `FavoriteCollectionsService` (list/create/get/update/delete).
- Extend `FavoriteMessage`/`NewFavoriteMessage`/`UpdateFavoriteMessage` TS interfaces with `collection_id`.

Still no UI — this step finishes the data model.

## Step 3 — Retain toggle in the publish panel (frontend)

Prerequisite fix, independent of templates: `PublishPanel` needs a real retain control before a template's `retain` flag means anything when loaded into it.
- Add a `retain` form control (checkbox, next to the QoS selector) to `publish-panel.ts`/`.html`.
- Pass the live value into `mqttService.publish(...)` instead of the hardcoded `false`.
- Update `publish-panel.spec.ts`.

This is a small, self-contained, shippable change.

## Step 4 — "Save as template" from the publish panel

- Add a save action to `PublishPanel` that calls `FavoritesService.create(...)` with the current `topic`/`payload`/`qos`/`retain` plus a name (and optional description) captured from the user.
- Decision: saved templates default to `connection_id: null` (broker-independent), matching "independent of any particular broker or topic" from the original ask — even when saved from a specific broker's workspace. `connection_id` stays in the model for a possible future "scope to this broker" option, but nothing sets it yet.
- Exact interaction (inline field vs. a small dialog for name/description) is a frontend-design decision, deferred — this step just needs the service call wired to *some* trigger so it's testable.

## Step 5 — Template library page (frontend)

- New route (name/path TBD in the design discussion) listing all favorite messages, grouped/filterable by collection.
- Actions: create a template directly (not just via "save from publish"), edit (name/description/topic/payload/qos/retain), delete, create/rename/delete collections, move a template between collections.
- Layout, navigation entry point, and interaction details: **deferred to the later frontend design discussion**, per your note.

## Step 6 — Load a template back into the publish panel

- `PublishPanel` needs a way to receive a full draft (topic + payload + format + qos + retain), not just the `topic` input it has today (used for tree-click prefill). Likely an additional `input()` or a method invoked by the parent, mirroring the existing `topic` effect in `publish-panel.ts`.
- Navigation flow from the template library (which has no fixed broker) to a specific broker's workspace with the template preloaded needs a carrier — router query params or navigation `state` are the two natural options. **Left open for the design discussion**, since it's coupled to how the library page looks/behaves.

## Suggested delivery order

Steps 1–4 are backend/plumbing-heavy and don't depend on any UI decisions — safe to build and merge now. Steps 5–6 need the frontend design discussion first; step 3 (retain toggle) can happen any time before step 6 needs it, and is worth doing early since it's a real gap in the existing publish panel regardless of templates.
