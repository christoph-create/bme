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

## Step 1 — Complete favorite-message CRUD (backend + service layer) — done

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

## Step 2 — Collections — done

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

## Step 3 — Retain toggle in the publish panel (frontend) — done

Prerequisite fix, independent of templates: `PublishPanel` needs a real retain control before a template's `retain` flag means anything when loaded into it.
- Add a `retain` form control (checkbox, next to the QoS selector) to `publish-panel.ts`/`.html`.
- Pass the live value into `mqttService.publish(...)` instead of the hardcoded `false`.
- Update `publish-panel.spec.ts`.

This is a small, self-contained, shippable change.

## Step 4 — "Save as template" from the publish panel — done

- Add a save action to `PublishPanel` that calls `FavoritesService.create(...)` with the current `topic`/`payload`/`qos`/`retain` plus a name (and optional description) captured from the user.
- Decision: saved templates default to `connection_id: null` (broker-independent), matching "independent of any particular broker or topic" from the original ask — even when saved from a specific broker's workspace. `connection_id` stays in the model for a possible future "scope to this broker" option, but nothing sets it yet.
- Exact interaction (inline field vs. a small dialog for name/description) is a frontend-design decision, deferred — this step just needs the service call wired to *some* trigger so it's testable.
- Shipped as a plain "Save as Template" button; name auto-derives from the topic's last path segment (matching the prototype's `saveFavorite()`), no dialog. Button placement/styling is a placeholder, not a final design.

## Frontend design decisions (resolved)

Both "save" and "load" are **modals**, not routes — templates are broker-independent, so navigating away from the broker workspace and back would just reintroduce a "how do we carry draft state across a route" problem for no benefit. A modal is a component conditionally rendered over the current view via a signal (no Angular CDK; this app has no modal precedent yet, but nothing here needs more than what the existing "⋯" menu's conditional rendering already does).

Resolved:
1. **`format` (`"json" | "raw"`) is added back to the favorite-message record.** It was dropped when the model was first extended (step 1) because the pre-existing `FavoriteMessage` didn't have it, but the prototype's original favorites always carried it, and without it, loading a template back can't know whether to treat its payload as pretty-printable JSON or opaque raw text.
2. **"Load Template" is a plain pick-and-load modal** — search/filter a list, click a row, it loads into the publish form and the modal closes. No inline edit/delete/rename/collection-management UI in this pass; the previously-planned full "Template Library" page is dropped from scope for now (can be revisited later if managing templates from a list-only picker turns out to be too limited).
3. **Collection assignment happens in the Save modal** — a picker (existing collections + "+ New collection" inline creation), not a separate step.
4. **Save modal is preview-only** for topic/payload/QoS/retain — only `name` (prefilled from the topic's last segment, as today) and `description` are editable. Editing the message itself belongs in the compose form, not a second copy of it in the modal.
5. **Loading a template plainly overwrites** the current topic/payload/format/QoS/retain — no dirty-form confirmation. Matches how clicking a topic in the tree already overwrites the topic field today.

## Step 5 — Add `format` to the favorite-message record (backend)

- `core::models`: new `MessageFormat` enum (`Json`, `Raw`), mirroring `QoS`'s shape (`ToSql`/`FromSql` impls in `core/src/storage/mod.rs`, stored as `TEXT` rather than `QoS`'s integer encoding — a couple of fixed string values are more legible directly in the sqlite file than reusing QoS's int-mapping convention, and there's no wire-protocol reason to match MQTT's encoding here).
- Add `format: MessageFormat` to `FavoriteMessage`, `NewFavoriteMessage`, `UpdateFavoriteMessage`.
- Migration `0005_favorite_message_format.sql`: `ALTER TABLE favorite_messages ADD COLUMN format TEXT NOT NULL DEFAULT 'json';` — `NOT NULL DEFAULT` rather than nullable, since every existing/future row has an unambiguous format and there's no "unknown" state worth representing.
- `favorites_repo.rs` insert/select/update statements and `row_to_favorite` gain the column; repo tests cover the round-trip.
- Tauri commands need no signature changes (they already pass the whole struct through) — just the IPC round-trip tests picking up the new field.
- Frontend: `FavoriteMessage`/`NewFavoriteMessage`/`UpdateFavoriteMessage` gain `format: PublishFormat` (reuse `publish-panel.ts`'s existing `"json" | "raw"` union — move it to `core/models/` since it stops being publish-panel-private once the favorite model uses it too).

## Step 6 — Save Template modal (frontend)

Replaces step 4's immediate one-click save with a review step:
- New component (e.g. `src/app/pages/broker-workspace/save-template-modal/`), opened from `PublishPanel`'s "Save as Template" button instead of saving immediately.
- Shows: read-only preview of topic/payload/QoS/retain from the current compose form; editable `name` (prefilled from the topic's last segment) and `description`; a collection picker sourced from `FavoriteCollectionsService.list()` plus inline "+ New collection" (calls `FavoriteCollectionsService.create()`).
- Confirm calls `FavoritesService.create(...)` with `connection_id: null`, the chosen `collection_id`, `name`, `description`, and the compose form's `topic`/`payload`/`format`/`qos`/`retain`; Cancel/Escape/backdrop-click discards.
- `publish-panel.spec.ts`'s existing step-4 tests (which assert an immediate `create` call) need updating to open-the-modal-then-confirm instead.

## Step 7 — Load Template modal (frontend)

- New component (e.g. `src/app/pages/broker-workspace/load-template-modal/`), opened from a new "Load Template" button in `PublishPanel` (next to "Save as Template").
- Lists `FavoritesService.list()` with a text filter (name/topic) and an optional collection filter; click a row to select.
- On selection: `PublishPanel` needs a way to receive a full draft (topic + payload + format + qos + retain), not just the `topic` input it has today (used for tree-click prefill) — likely a method the parent calls directly on selection, rather than another `input()`, since this is an imperative "apply this once" action rather than a reactively-bound value. Overwrites the form outright (see resolved decision 5) and closes the modal.

## Still open before implementing steps 6-7

- Does the Load modal need *any* delete affordance (the backend already supports it — `delete_favorite` from step 1), or is deleting a mis-saved template deferred entirely until a future management UI? Right now there'd be no way to remove a template at all once "Load Template" ships.
- Should Save/Load modals share a generic modal shell component (backdrop, Escape/backdrop-to-close, focus trap), given this is the app's first modal and there'll be exactly two of them built back-to-back? Recommend yes, for the same reason the retain toggle got pulled into a shared `.switch` class.

## Suggested delivery order

Steps 1–4 are done. Step 5 (format field) is backend-only and safe to build immediately. Steps 6–7 depend on the two open questions above being resolved, and step 7 depends on step 6 existing (shared modal shell, if we build one).
