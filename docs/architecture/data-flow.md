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

## Contract points that must stay in sync

Change one side of any of these and the other breaks silently:

| Rust | TypeScript |
| --- | --- |
| `core/src/models.rs` | `src/app/core/models/*.model.ts` |
| `MqttEvent` in `core/src/mqtt/port.rs` (externally tagged) | `mqtt-event.model.ts` |
| `QoS` (serialized by name: `"AtLeastOnce"`) | `qos.ts` |
| `MessageFormat` (`"json"` / `"raw"`) | `message-format.model.ts` |
| command names + arg names in `commands.rs` | the `invoke()` calls in `core/services/` |
| the exchange format in `spec/` | `template-exchange.service.ts` |
