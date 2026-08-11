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
| `broker/:id` | `BrokerRouteShell` | `pages/broker-workspace/` |
| `templates` | `TemplatesManagement` | `pages/templates-management/` |

Five routes, five page directories. A page directory holds its own
`.ts`/`.html`/`.css`/`.spec.ts` plus sub-directories for components that
belong to that page alone.

### The workspace shell — `src/app/shell/`

`broker/:id` is the exception: it maps to `BrokerRouteShell`, which renders
**nothing**. The workspaces themselves are mounted by `WorkspaceHost`, which
sits in `AppComponent` *outside* the router outlet and keeps one
`BrokerWorkspace` per open tab alive, showing only the active one
(`display: none` for the rest).

That is what makes tabs tabs: switching between brokers must not destroy a
workspace, because a background tab has work in flight — a repeating
publisher still firing, a half-typed draft, an expanded topic tree, a stream
scrolled to where you left it. `BrokerRouteShell` exists only to translate the
URL into "show this one", which keeps deep links, the address bar and the back
button working exactly as they did when the workspace *was* the route.

```
AppComponent
├─ <app-workspace-tabs>     shell/workspace-tabs/  — one tab per open broker
└─ .shell-body
   ├─ <app-workspace-host>  shell/workspace-host/  — every open workspace, one visible
   └─ <router-outlet />     the five routes above
```

Two consequences worth knowing before touching either side:

- **Anything that measures the DOM has to tolerate being hidden.** A hidden
  element reports zero height and fires a `scroll` event as it goes. Both
  guards live in `message-stream/` (`MeasureHeight` never reports a zero
  height; `onScroll` ignores events while inactive) and both exist to protect
  a background tab's scroll position.
- **A tab's lifetime is a session's lifetime.** Tabs have no close button:
  `Disconnect` ends the session *and* closes the tab, and closing drops that
  broker's message history and charts, since none of it is persisted.

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
| `mqtt-events.service` | `events$` — one `Observable<MqttEvent>` over the Tauri `"mqtt-event"` listener. `share()`d, so N subscribers still mean one listener |
| `connection-status.service` | Every broker's connection status, keyed by id, folded from `events$` by the pure `core/status/connection-status.ts`. App-wide because status outlives whatever is showing it — a broker stays connected after you leave its workspace, and the tab bar and the connections list both say so |
| `workspaces.service` | Which broker workspaces are open, in tab order, and which is active. Owns tab closing, including dropping that broker's history and charts. Tab-selection logic is the pure `core/workspaces/next-active-tab.ts` |
| `message-store.service` | The in-memory message history (see below) |
| `template-exchange.service` | Serializes/parses the `spec/` exchange format, including version checking |
| `json-format.service` | Pretty-print, compact, and tokenize JSON for the payload editor's highlighting |
| `variables.service` | CRUD over the `{{name}}` variable definitions, plus a loaded-once signal cache. The cache is the point: the publish panel validates and previews on every keystroke, which an `invoke()` per keystroke can't serve. The expansion logic itself is in the plain functions under `core/variables/` |
| `logger.service` | Forwards to the Rust log file via `@tauri-apps/plugin-log` |
| `update.service` | `invoke()` wrapper over `get_app_version` / `check_for_updates` / `skip_update_version` |
| `update-notifier.service` | App-wide update state, and the one throttled check per launch. Its policy — silent vs. up-to-date vs. offer — lives in the plain `update-announcement.ts` next to it |
| `value-charts.service` | Which value charts are open, per connection. Signal-backed rather than RxJS like the store next door, because nothing streams into it. Session-only, same as the history it plots |

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
- `tool-panel/` — the right-hand dock, one tool at a time (a `@switch`, so Pin/Compare drop in as extra cases). `value-charts/` is the only tool today: a stack of hand-rolled SVG charts, with `numeric-fields.ts`, `sample-series.ts`, `chart-geometry.ts`, `axis-ticks.ts` and `axis-format.ts` as its pure helpers
- `layout/dock-layout.ts` — the whole geometry of the three docks as plain functions over a plain `LayoutInput`: sizes, the two grid templates, and folding a splitter drag back in. Sizes are stored as a **fraction of the window**, so recomputing after a resize is a pure multiply rather than an increment that could drift
- `qos-select/`, `save-template-modal/`, `load-template-modal/`
- `format/` — `payload-text.ts`, `time-ago.ts`

The three docks (subscriptions left, publish along the bottom of the centre
column, tools right) each hide from a button in the header. A hidden dock
keeps **zero-width grid tracks rather than losing them**, which is both what
lets the centre column's rows stay anchored unconditionally and what makes the
open/close transition interpolable. Its component stays mounted, and is marked
`inert` so nothing in it can be tabbed into.

The pattern to notice: anything with real logic (tree building, virtual
range, formatting) is extracted into a **plain function file with its own
spec**, next to the component. Follow it — it's why the component specs stay
small.

## `src/app/shared/`

What isn't owned by a single page: `modal/` (the dialog shell),
`confirm-dialog/`, `payload-input/` (the CodeMirror-based JSON/raw editor),
`formatted-payload/` (read-only highlighted display), `update-dialog/`, and
three small pieces the workspace shell is built from — `splitter/` (a drag
handle reporting a cumulative delta, using pointer capture rather than
document listeners), `dock-toggle/` (the header's show/hide buttons, whose
icon is a miniature of the workspace with that dock's edge filled in) and
`status-dot/`.

`update-dialog/` is the odd one — no page uses it. It's rendered from
`AppComponent`, alongside the tab bar and the workspace host, so it can appear
over whatever route the user happens to be on. Like
`confirm-dialog`, it's purely presentational: every action is an output, and
Escape/backdrop/close all resolve to *dismiss* rather than *skip*, so the
harmless outcome is the one you get by accident.

## `src/app/pages/templates-management/`

Template CRUD (`template-form/`) plus `import-modal/` and `export-modal/`,
which speak the format defined in [`spec/`](../../spec/README.md) via
`template-exchange.service`.
