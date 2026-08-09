# Frontend (Angular)

Angular 22, standalone components, signals for component state, RxJS only
where something is genuinely a stream (MQTT events, the message store).
Bootstrapped from `src/main.ts` → `src/app/app.config.ts`.

## Routes — `src/app/app.routes.ts`

| Path | Component | Directory |
| --- | --- | --- |
| `""` | → redirect to `connections` | |
| `connections` | `Connections` | `pages/connections/` |
| `connections/new` | `ConnectionForm` | `pages/connection-form/` |
| `connections/:id/edit` | `ConnectionForm` | (same component) |
| `broker/:id` | `BrokerWorkspace` | `pages/broker-workspace/` |
| `templates` | `TemplatesManagement` | `pages/templates-management/` |

Five routes, five page directories. A page directory holds its own
`.ts`/`.html`/`.css`/`.spec.ts` plus sub-directories for components that
belong to that page alone.

## `app.config.ts`

Providers: `provideRouter`, `provideBrowserGlobalErrorListeners`,
`GlobalErrorHandler` as the `ErrorHandler`, and an app initializer that
merely instantiates `HeartbeatService` and `UpdateNotifierService`. It must
stay **`void`-returning**: `provideAppInitializer` waits on any promise handed
back to it, which would put a network call in front of the first paint.

Both of those last two exist for the same reason: **diagnosing UI freezes
after the fact.** `GlobalErrorHandler` funnels every uncaught error into the
shared Rust log file; `HeartbeatService` logs a tick every 60s from outside
the Angular zone, so a gap in the log pins down when the main thread stopped
responding. If you're changing logging, keep that property.

## `src/app/core/`

**`models/`** — TypeScript mirrors of the Rust types in `core/src/models.rs`
(`broker-connection`, `favorite-message`, `favorite-collection`,
`message-format`, `qos`, `mqtt-event`, `stored-message`, `message-draft`,
`template-exchange`). These are hand-maintained, not generated: change a
Rust type and you must change its mirror here. `stored-message` and
`message-draft` are frontend-only — they have no Rust counterpart.

**`services/`**

| Service | What it does |
| --- | --- |
| `connections.service` | `invoke()` wrapper over the connection + broker commands (`list/get/create/update/delete/connect/disconnect/testConnection`) |
| `favorites.service` | Same, for templates |
| `favorite-collections.service` | Same, for collections |
| `mqtt.service` | `publish` / `subscribe` / `unsubscribe` |
| `mqtt-events.service` | `events$` — one `Observable<MqttEvent>` over the Tauri `"mqtt-event"` listener |
| `message-store.service` | The in-memory message history (see below) |
| `template-exchange.service` | Serializes/parses the `spec/` exchange format, including version checking |
| `json-format.service` | Pretty-print, compact, and tokenize JSON for the payload editor's highlighting |
| `variables.service` | CRUD over the `{{name}}` variable definitions, plus a loaded-once signal cache. The cache is the point: the publish panel validates and previews on every keystroke, which an `invoke()` per keystroke can't serve. The expansion logic itself is in the plain functions under `core/variables/` |
| `logger.service` | Forwards to the Rust log file via `@tauri-apps/plugin-log` |
| `update.service` | `invoke()` wrapper over `get_app_version` / `check_for_updates` / `skip_update_version` |
| `update-notifier.service` | App-wide update state, and the one throttled check per launch. Its policy — silent vs. up-to-date vs. offer — lives in the plain `update-announcement.ts` next to it |

Services are `providedIn: "root"` and injected with `inject()`, not
constructor params.

### `message-store.service` — worth reading before touching the workspace

Subscribes to `mqtt-events.service` once and accumulates received messages
into a `BehaviorSubject` of `Map<connectionId, Map<topic, StoredMessage[]>>`.
Everything it hands out is `readonly`, and it caps history at
`MAX_MESSAGES_PER_TOPIC` per topic — an `InjectionToken`, so tests can shrink
it. Consumers use `messagesFor(connectionId, topic)` or
`topicsFor(connectionId)`; both are `distinctUntilChanged()`, so an
unrelated topic's traffic doesn't re-render your view.

This store is **session-only**. Received messages are never persisted; only
connections, subscriptions, templates and collections hit SQLite.

## `src/app/pages/broker-workspace/`

The biggest surface in the app — one screen composed of several panels:

- `subscriptions-panel/` — subscribe/unsubscribe, lists persisted subscriptions
- `topic-tree/` — the live tree. Pure helpers next to it: `build-topic-tree.ts`, `find-updated-leaf-paths.ts`
- `message-stream/` — the history list. Virtualized: `virtual-range.ts` + `measure-height.directive.ts`
- `publish-panel/` — compose and publish; entry point for save/load template
- `qos-select/`, `save-template-modal/`, `load-template-modal/`
- `format/` — `payload-text.ts`, `time-ago.ts`

The pattern to notice: anything with real logic (tree building, virtual
range, formatting) is extracted into a **plain function file with its own
spec**, next to the component. Follow it — it's why the component specs stay
small.

## `src/app/shared/`

What isn't owned by a single page: `modal/` (the dialog shell),
`confirm-dialog/`, `payload-input/` (the CodeMirror-based JSON/raw editor),
`formatted-payload/` (read-only highlighted display), and `update-dialog/`.

`update-dialog/` is the odd one — no page uses it. It's rendered from
`AppComponent` (which is therefore no longer just `<router-outlet />`) so it
can appear over whatever route the user happens to be on. Like
`confirm-dialog`, it's purely presentational: every action is an output, and
Escape/backdrop/close all resolve to *dismiss* rather than *skip*, so the
harmless outcome is the one you get by accident.

## `src/app/pages/templates-management/`

Template CRUD (`template-form/`) plus `import-modal/` and `export-modal/`,
which speak the format defined in [`spec/`](../../spec/README.md) via
`template-exchange.service`.
