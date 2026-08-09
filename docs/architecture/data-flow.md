# Data flow

Four paths cross the frontend/backend boundary. If you're tracing a bug,
find yours here first.

## The layers

```
Angular component
      │  inject()
Angular service (src/app/core/services/)
      │  invoke("command_name", {...})        ← IPC, camelCase args
#[tauri::command]  (src-tauri/src/commands.rs)
      │  State<…>
MqttClientManager / *Repository  (core/)
      │
MqttPort impl (rumqttc)          SQLite
```

…and one path that runs the other way:

```
broker → RumqttcAdapter → mpsc channel → lib.rs pump → emit("mqtt-event")
      → MqttEventsService.events$ → MessageStoreService → components
```

## 1. Connecting

`ConnectionsService.connect(id)` → `connect_broker` → loads the
`BrokerConnection` from the repo and hands it to `MqttClientManager::connect`.
The call returns as soon as the command is accepted; the UI learns it
actually worked when a `Connected` event arrives.

The connection's **persisted subscriptions** are *not* replayed here — the
connection task re-issues them after every ConnAck, first one included, so
that they also survive a reconnect (see `reconnect` in `backend.md`).

If an established session drops, the task retries with a capped exponential
backoff instead of ending, emitting `Reconnecting { attempt, max_attempts,
delay_ms }` for each wait. `Disconnected` then means "gave up" (or "you asked
me to stop"), which is what lets the workspace show a retry banner and an
error banner as two distinct states.

`test_connection` is the odd one out: it takes a whole unsaved connection,
connects, and persists **nothing** — it's the form's "does this even work"
button.

## 2. Publishing

`MqttService.publish(...)` → `publish_message` → `MqttClientManager::publish`
→ adapter. Fire-and-forget: no ack comes back through the return value. The
publish panel's draft (`message-draft.model.ts`) lives in component state
until you publish or save it as a template.

## 3. Subscribing

`MqttService.subscribe(...)` → `subscribe_topic` → **two** effects: the
subscription is persisted via `connections_repo.add_subscription`, *and* the
broker is told. Deliberately independent — subscribe/unsubscribe manage the
saved list correctly even when you were never connected (there's a test for
exactly that in `src-tauri/src/lib.rs`). Unsubscribing takes both the
`subscriptionId` and the `topic` for the same reason.

## 4. Receiving

The adapter's event loop pushes `MqttEvent`s into an unbounded `tokio::mpsc`
channel. `lib.rs`'s spawned task drains it and `emit`s each one to the
webview under the single event name `"mqtt-event"`.
`MqttEventsService.events$` wraps that listener as an Observable;
`MessageStoreService` is the only subscriber that keeps state, folding
`MessageReceived` into its per-connection/per-topic map (capped per topic)
and letting `Connected`/`Reconnecting`/`Disconnected` through for status.

Payloads cross as `Vec<u8>` → `number[]`; decoding to text happens in the
frontend (`format/payload-text.ts`).

Received messages are **never written to SQLite** — close the app and the
history is gone. Only connections, subscriptions, templates and collections
persist.

## 5. Checking for updates

The one flow that leaves the machine for something other than MQTT.

`app.config.ts`'s `provideAppInitializer` instantiates
`UpdateNotifierService`, whose constructor schedules the check 3s later,
outside the Angular zone (same shape as `HeartbeatService`) — the initializer
itself must stay `void`-returning or bootstrap would wait on a network call.
That calls `check_for_updates` with `force: false` → `UpdateChecker` reads
`update.last_checked_at` from `app_settings` and short-circuits if it's under
24h old → otherwise `GithubReleaseSource` fetches, the tag is parsed and
compared against `CARGO_PKG_VERSION`, and `update.skipped_version` decides
`is_skipped`.

The backend returns **facts** (`is_newer`, `is_skipped`, `throttled`), never a
verdict. `announcementFor()` in `core/services/update-announcement.ts` turns
those into `update` / `up-to-date` / `silent`, and it is the single place the
"don't be annoying" rule lives: the automatic check is silent about
everything except a newer, unskipped release, and it swallows failures into a
log line. The dialog is mounted on `AppComponent` rather than a page so it can
appear over any route.

The manual path is the same call with `force: true`, from the connections
footer. It bypasses the throttle, re-offers a skipped version (pressing the
button is asking again), and always says *something* — the dialog, "You're on
the latest version", or the error.

## Contract points that must stay in sync

Change one side of any of these and the other breaks silently:

| Rust | TypeScript |
| --- | --- |
| `core/src/models.rs` | `src/app/core/models/*.model.ts` |
| `UpdateCheck` / `AvailableRelease` in `core/src/models.rs` | `update-check.model.ts` |
| `MqttEvent` in `core/src/mqtt/port.rs` (externally tagged) | `mqtt-event.model.ts` |
| `QoS` (serialized by name: `"AtLeastOnce"`) | `qos.ts` |
| `MessageFormat` (`"json"` / `"raw"`) | `message-format.model.ts` |
| `VariableGenerator` (internally tagged on `kind`, camelCase) | the union in `payload-variable.model.ts` |
| command names + arg names in `commands.rs` | the `invoke()` calls in `core/services/` |
| the exchange format in `spec/` | `template-exchange.service.ts` |

`VariableGenerator`'s JSON is doubly load-bearing: it is both the
`payload_variables.generator` column and the IPC payload, so a change to the
tag or a field name breaks stored data as well as the frontend. The Rust side
never *expands* a placeholder — that happens in `core/variables/` in the
frontend, because the preview needs it live per keystroke — so there is no
expansion logic duplicated across the boundary, only the definition shape.

The `app_settings` key strings (`update.skipped_version`,
`update.last_checked_at`, defined in `core/src/update/mod.rs`) are a contract
too, just an internal one: renaming a key silently orphans whatever users had
already saved under the old name.
