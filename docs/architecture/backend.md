# Backend (Rust)

A two-crate Cargo workspace (`Cargo.toml` at the repo root):

- **`bme_core`** (`core/`) — all the logic. No Tauri dependency, so every
  test here runs as a plain `cargo test`.
- **`bme`** (`src-tauri/`) — the Tauri shell. Wiring, IPC, app lifecycle.

## `core/src/models.rs`

Plain serde types, no I/O. The vocabulary of the whole app:

- `QoS` — `AtMostOnce` / `AtLeastOnce` / `ExactlyOnce`. Converts to/from
  `i64` for the wire and the DB; serializes **by name** to the frontend.
- `MessageFormat` — `json` / `raw`. Stored as TEXT so the sqlite file stays
  readable.
- `BrokerConnection` + `Subscription`, with `New*` / `Update*` variants —
  the create/update payloads are separate types, so "what you may set" is
  encoded in the type rather than in a comment.
- `FavoriteMessage`, `FavoriteCollection` (+ their `New*`/`Update*`). Note:
  "favorite" in the Rust layer is what the UI calls a **template**. The
  rename happened in the UI only; the storage and IPC names still say
  favorite.

## `core/src/mqtt/`

| File | Role |
| --- | --- |
| `port.rs` | `MqttPort` trait, `MqttEvent` enum, `MqttError`. The contract. |
| `rumqttc_adapter.rs` | The real implementation, on top of `rumqttc`. |
| `manager.rs` | Owns the set of live connections; generic over `P: MqttPort`. |
| `reconnect.rs` | The backoff schedule, as a pure function of the attempt number. |
| `subscription_set.rs` | The topics a connection wants, replayed after every ConnAck. |

Three things worth knowing before you touch this:

1. **Every `MqttPort` method is fire-and-forget.** `Ok(())` means "the
   command was accepted", not "the broker did it". Real outcomes arrive
   later as `MqttEvent`s. Don't add a return value that pretends otherwise.
2. **`MqttEvent` is serialized externally tagged** (serde's default for a
   data-carrying enum): `{"MessageReceived": {…}}`. The frontend mirror in
   `src/app/core/models/mqtt-event.model.ts` depends on that shape — change
   one, change the other.
3. **A dropped session is not the end of the connection task.** rumqttc's
   event loop re-establishes itself if you keep polling it, so
   `run_connection` waits out a capped exponential backoff (1s doubling to
   30s, `max_reconnect_attempts` times) and carries on, emitting
   `Reconnecting { attempt, max_attempts, delay_ms }` so the UI can show
   progress. The backoff only arms once a session has actually come up —
   a broker that never answered fails fast instead. Because the session is
   clean, the task re-issues its whole `SubscriptionSet` on every ConnAck;
   `connect_broker` deliberately does *not* replay subscriptions itself.

`MqttClientManager` is generic over the port, so tests inject a fake and
never open a socket. The reconnect schedule and the subscription set are
separate modules for the same reason: both are testable without a broker,
while the loop that uses them is not.

## `core/src/storage/`

`mod.rs` owns opening the DB (`open_at`, `open_in_memory`), running
migrations via `rusqlite_migration`, and the `ToSql`/`FromSql` impls that
teach the domain types how to persist themselves (kept here so `models.rs`
stays ignorant of rusqlite). `StorageError` also carries
`DuplicateCollectionName`, since a unique-constraint violation is a normal
user-facing outcome, not a crash.

Three repositories, each a trait + a `Sqlite*` impl over a shared
`Arc<Mutex<Connection>>`:

- `connections_repo.rs` — `create/get/list/update/delete` plus
  `add_subscription`/`remove_subscription`. Subscriptions are persisted so
  they can be replayed on reconnect.
- `favorites_repo.rs` — templates.
- `favorite_collections_repo.rs` — template collections.

### Migrations

`core/src/storage/migrations/NNNN_*.sql`, applied in order at startup.
**Never edit a migration that has shipped** — existing installs have already
applied it. Add a new numbered file instead.

## `src-tauri/src/lib.rs`

The only place that knows about both `core` and Tauri. `run()` does, in
order: install a panic hook that logs backtraces → configure
`tauri_plugin_log` (file + stdout, colored, 10 MB rotation) → open the
SQLite file under the app data dir and `manage()` the three repositories →
create the MQTT event channel and `manage()` the manager → spawn the task
that forwards every `MqttEvent` to the webview as a `"mqtt-event"` →
(Linux/BSD only) disable WebKitGTK smooth scrolling → register the IPC
handler list.

Most of the file's length is its test module: it builds the same managed
state against an in-memory DB and drives the real commands over real IPC
with `tauri::test::get_ipc_response`, so the JSON contract is covered
end to end without a display.

## `src-tauri/src/commands.rs` — the IPC surface

Every `#[tauri::command]` lives here and is a thin adapter: take `State<…>`,
call core, map errors to `String`. Adding a command means touching **three**
places, plus a fourth if you want it under test:

1. `commands.rs` — the function.
2. `lib.rs` — add it to `tauri::generate_handler![…]`.
3. `src-tauri/capabilities/default.json` — add `"allow-<kebab-command-name>"`,
   or the webview's call is rejected by the ACL.
   (`permissions/autogenerated/*.toml` is generated by Tauri; don't hand-edit.)
4. `lib.rs`'s test `build_test_app()` — its own handler list.

Current commands, by area:

- **misc** — `greet` (Tauri scaffold leftover), `open_log_dir`
- **connections** — `list_connections`, `create_connection`,
  `update_connection`, `delete_connection`, `get_connection`
- **broker** — `connect_broker`, `disconnect_broker`, `test_connection`,
  `publish_message`, `subscribe_topic`, `unsubscribe_topic`
- **templates** — `list_favorites`, `create_favorite`, `get_favorite`,
  `update_favorite`, `delete_favorite`
- **collections** — `list_favorite_collections`,
  `create_favorite_collection`, `get_favorite_collection`,
  `update_favorite_collection`, `delete_favorite_collection`

Arguments are camelCase over IPC (`newConnection`, `connectionId`) even
though the Rust params are snake_case — Tauri does that conversion.
