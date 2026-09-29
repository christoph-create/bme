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
| `settings` | `Settings` | `pages/settings/` |

Six routes, six page directories. A page directory holds its own
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
   └─ <router-outlet />     the six routes above
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
instantiates `HeartbeatService`, `UpdateNotifierService` and `UiZoomService`
and kicks off `SettingsService.load()` without awaiting it. It must stay
**`void`-returning**: `provideAppInitializer` waits on any promise handed
back to it, which would put a network call (or a database read) in front of
the first paint. Consumers run on the default settings until the load lands
and re-seed from the signal when it does.

`GlobalErrorHandler` and `HeartbeatService` exist for the same reason: **diagnosing UI freezes
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
| `mqtt.service` | `publish` / `subscribe` / `unsubscribe`. `publish` is also where outbound messages are counted for `session-stats.service` — the one door everything the app sends goes through |
| `mqtt-events.service` | `events$` — one `Observable<MqttEvent>` over the Tauri `"mqtt-event"` listener. `share()`d, so N subscribers still mean one listener |
| `connection-status.service` | Every broker's connection status, keyed by id, folded from `events$` by the pure `core/status/connection-status.ts`. App-wide because status outlives whatever is showing it — a broker stays connected after you leave its workspace, and the tab bar and the connections list both say so |
| `workspaces.service` | Which broker workspaces are open, in tab order, and which is active. Owns tab closing, including dropping that broker's history, charts and counters. Tab-selection logic is the pure `core/workspaces/next-active-tab.ts` |
| `message-store.service` | The in-memory message history (see below) |
| `session-stats.service` | How much each connection has moved this session — uptime, messages and payload bytes in and out, QoS split, reconnects, a rolling one-minute rate and a per-topic tally. The third consumer of `events$`, folded by the pure `core/stats/session-stats.ts` over `core/stats/rate-window.ts`. `$SYS` traffic is excluded, or the broker panel would be counting itself. Counters start over when Connect is pressed and survive an auto-reconnect; nothing is persisted. Deliberately timerless — whoever shows uptime or a rate ticks on its own |
| `system-monitor.service` | Which brokers the app is reading `$SYS` from, remembered per connection in an `app_settings` row `sys.monitor.<uuid>` — per-broker state, so deliberately not part of the global `AppSettings` schema. Off by default: subscribing is traffic the user did not ask for, and a `$SYS` ACL can refuse or log it. **Re-issues the subscribe on every `Connected`** — the connection task replays its own set across an auto-reconnect, but `connect_broker` spawns a fresh one seeded from the database where `$SYS/#` is not, so without this the panel freezes silently after a manual reconnect |
| `template-exchange.service` | Serializes/parses the `spec/` exchange format, including version checking |
| `json-format.service` | Pretty-print, compact, and tokenize JSON for the payload editor's highlighting |
| `variables.service` | CRUD over the `{{name}}` variable definitions, plus a loaded-once signal cache. The cache is the point: the publish panel validates and previews on every keystroke, which an `invoke()` per keystroke can't serve. The expansion logic itself is in the plain functions under `core/variables/` |
| `settings.service` | The app-level settings as a signal read model over the backend's `app_settings` key/value store, loaded once at startup. The schema — keys, defaults, bounds, encoding — is the plain `core/settings/app-settings.ts`; the backend never interprets the values. Writes are optimistic so a change on the settings page re-seeds every consumer immediately |
| `ui-zoom.service` | Holds the webview's zoom in step with the `ui.zoom` setting, and steps it for the Ctrl+`+`/`-`/`0` shortcuts. See below |
| `logger.service` | Forwards to the Rust log file via `@tauri-apps/plugin-log` |
| `update.service` | `invoke()` wrapper over `get_app_version` / `check_for_updates` / `skip_update_version` |
| `update-notifier.service` | App-wide update state, and the one throttled check per launch. Its policy — silent vs. up-to-date vs. offer — lives in the plain `update-announcement.ts` next to it |
| `value-charts.service` | Which value charts are open, per connection. Signal-backed rather than RxJS like the store next door, because nothing streams into it. Session-only, same as the history it plots |

Services are `providedIn: "root"` and injected with `inject()`, not
constructor params.

### `ui-zoom.service` — why zoom rather than a font size

"Interface size" is the webview's own zoom (`setZoom`, the
`core:webview:allow-set-webview-zoom` permission), not a CSS font scale.

The workspace's geometry is not purely CSS: `DOCK_LIMITS`, `SPLITTER_PX` and
`MIN_CENTRE_WIDTH` in `pages/broker-workspace/layout/dock-layout.ts` are
JavaScript numbers, and the message stream measures and caches row heights to
virtualise the list. Scaling only fonts would leave all of that at its
original size — bigger text in unchanged docks, and mis-measured rows.
Webview zoom scales the CSS pixel itself, so every one of those numbers keeps
its meaning and the interface grows as one piece.

The levels, the stepping and the snapping live in the plain
`core/settings/zoom-levels.ts`; the keypress mapping in
`core/settings/zoom-shortcut.ts`, bound once on `AppComponent` because zoom
is app-wide. Applying it can fail — there is no webview in the demo build's
plain browser — so the service logs and carries on rather than surfacing it.

### `message-store.service` — worth reading before touching the workspace

Subscribes to `mqtt-events.service` once and accumulates received messages
into a `BehaviorSubject` of `Map<connectionId, Map<topic, StoredMessage[]>>`.
Everything it hands out is `readonly`, and it caps history per topic at
`SettingsService`'s `maxMessagesPerTopic`, read on every append so a change on
the settings page applies mid-session (a lowered cap trims a topic on its next
message). Consumers use `messagesFor(connectionId, topic)` or
`topicsFor(connectionId)`; both are `distinctUntilChanged()`, so an
unrelated topic's traffic doesn't re-render your view.

This store is **session-only**. Received messages are never persisted; only
connections, subscriptions, templates and collections hit SQLite.

## `src/app/pages/broker-workspace/`

The biggest surface in the app — one screen composed of several panels:

- `subscriptions-panel/` — subscribe/unsubscribe, lists persisted subscriptions
- `topic-tree/` — the live tree. Pure helpers next to it: `build-topic-tree.ts`, `find-updated-leaf-paths.ts`
- `message-stream/` — the history list. Virtualized: `virtual-range.ts` + `measure-height.directive.ts`. `message-to-draft.ts` is what Resend hands the publish panel (properties included); `format-properties.ts` turns a message's MQTT 5 properties into the rows on its card
- `publish-panel/` — compose and publish; entry point for save/load template. The MQTT 5 properties editor lives on its settings layer and only renders when the workspace passes `protocolVersion: "v5"`; `publish-properties.ts` is the form ↔ `MessageProperties` mapping, and the reason nothing typed there ever leaves on a 3.1.1 connection
- `tool-panel/` — the right-hand dock, one tool at a time (a `@switch`, so Pin/Compare drop in as extra cases). The switcher is an ARIA tab strip that appears once there is a second tool, scrolls rather than shrinks when the dock is dragged narrow, and takes arrow keys via the pure `tool-switcher.ts`. Two tools today:
  - `value-charts/` — a stack of hand-rolled SVG charts, with `numeric-fields.ts`, `sample-series.ts`, `chart-geometry.ts`, `axis-ticks.ts` and `axis-format.ts` as its pure helpers
  - `broker-stats/` — how this connection is doing, off `session-stats.service`. `stat-tile` is the tile (borrowing `chart-geometry.ts` for its sparkline, ticks computed and ignored); `format-stat.ts` is the one place every number on the panel is rounded, and `busiest-topics.ts` ranks the per-topic tally. Fed from the counters rather than from the message store, whose per-topic cap would tie every busy topic at 500
  - `broker-stats/sys-stats` — the broker's own health, read from `$SYS`, in three layers of which only the last knows any broker by name:
    - `sys-normalise.ts` strips the scaffolding (`broker`/`brokers`/`stats`/`metrics`, the cluster node, a trailing `count`), so mosquitto's `$SYS/broker/subscriptions/count` and EMQX's `$SYS/brokers/<node>/stats/subscriptions/count` become one key
    - `sys-classify.ts` derives a group, a label and a unit from the words in that key and the shape of the value. Measured against real captures this places 55/55 mosquitto and 134/141 EMQX topics with no broker-specific code, which is what makes a broker nobody has seen render as something readable
    - `sys-concepts.ts` promotes ~15 of them to tiles, keyed by meaning with a list of spellings each. **This is the only broker-specific code in the panel, and adding a broker is usually nothing at all — at worst a few strings on an existing concept, never a new table**
    - `sys-topics.ts` composes the three; `sys-dashboard-state.ts` picks between the panel's five faces, and its `UNSUPPORTED_AFTER_MS` is 15s because mosquitto's `sys_interval` defaults to 10
    - The readings come from `MessageStoreService` like any other topic, so the sparklines are bounded by `maxMessagesPerTopic` and a Clear elsewhere wipes them — both fine for a live dashboard, and noted so nobody adds a second store
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
