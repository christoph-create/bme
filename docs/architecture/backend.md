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
| `connection_registry.rs` | Which connection task currently owns each id, with a generation per task. |
| `reconnect.rs` | The backoff schedule, as a pure function of the attempt number. |
| `subscription_set.rs` | The topics a connection wants, replayed after every ConnAck. |

Four things worth knowing before you touch this:

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
   A packet over `MAX_PACKET_BYTES` (16 MiB) drops the socket the same way,
   but `mqtt::oversize` classifies it apart: it emits a non-fatal `Warning`
   with the real size, retries on its own budget-free schedule so a huge
   retained message cannot take a working broker offline, and leaves `attempt`
   untouched so it never eats the budget a real network fault needs. With
   auto-reconnect off it disconnects like any other drop, but fills in
   `Disconnected { reason }` so the UI can say what actually happened.
4. **Connecting an id that is already connected replaces the session, it does
   not add one.** Two tasks for one id would deliver every message twice, and
   whichever exited first would unregister the other — which is why the
   registry tags each entry with a generation and a task may only remove *its
   own*. The task being replaced shuts down with `announce: false`, so its
   `Disconnected` doesn't land after the replacement's `Connected` and read as
   a fresh drop. `ConnectionRegistry` is generic over its value so this
   bookkeeping is tested without a socket.

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

Four repositories, each a trait + a `Sqlite*` impl over a shared
`Arc<Mutex<Connection>>`:

- `connections_repo.rs` — `create/get/list/update/delete` plus
  `add_subscription`/`remove_subscription`. Subscriptions are persisted so
  they can be replayed on reconnect.
- `favorites_repo.rs` — templates.
- `favorite_collections_repo.rs` — template collections.
- `payload_variables_repo.rs` — the `{{name}}` variable definitions
  (migration `0010`), app-wide rather than per connection or per template.
  The `generator` column holds the serde JSON of `VariableGenerator`, so a new
  generator type costs no migration (removing one does need care: an existing
  row would then fail to decode). The migration seeds `uuid`, `timestamp`,
  `isoDate` and `counter`; they're ordinary rows, editable and deletable.
- `app_settings_repo.rs` — a generic `key`/`value` table for app-level
  settings (migration `0009`). Not domain data: no model type, no ids, just
  `get`/`set`/`remove` on namespaced `area.name` keys, with each consumer
  owning the encoding of its own value string. Deliberately generic so a
  settings screen doesn't need a migration per setting.

### Migrations

`core/src/storage/migrations/NNNN_*.sql`, applied in order at startup.
**Never edit a migration that has shipped** — existing installs have already
applied it. Add a new numbered file instead.

`rusqlite_migration` tracks progress by *count*, not by filename, so two
branches that each add an `NNNN_` file at the same number will collide:
whichever merges second has to renumber, and any database that already ran
the first one will skip the second entirely. Check for a competing number
before picking one.

## `core/src/update/`

Finding out whether a newer bme has been released. Notify-only — nothing here
downloads or installs anything; the user goes to the release page and decides.

- `port.rs` — the `ReleaseSource` trait plus `ReleaseInfo`/`UpdateError`. The
  trait returns `impl Future` rather than being an `async fn`, because
  `async_fn_in_trait` is a warning and CI runs clippy with `-D warnings`.
- `github.rs` — the real adapter, over `reqwest`, against
  `/repos/christoph-create/bme/releases/latest`.
- `version.rs` — pure parsing and comparison of `vX.Y.Z` tags.
- `checker.rs` — `UpdateChecker<S, R>`, generic over both collaborators so the
  tests drive the whole policy with a fake source and an in-memory database.

Things that are load-bearing rather than incidental:

- **A prerelease is never offered.** `/releases/latest` already excludes drafts
  and prereleases, the adapter rejects them again if GitHub's behaviour ever
  changes, and `parse_version` refuses any tag containing `-` or `+` rather
  than stripping the suffix.
- **The release URL is built from the parsed tag, never read from the
  response.** It opens in the user's real browser, so it shouldn't come from
  the network.
- **The last-checked timestamp is written on success *or* a rate limit, and
  not on a network failure.** A flaky connection should retry next launch; a
  rate limit should back off for the day.
- **An unreadable tag is an error, not "you're up to date."** A manual check
  must never claim it looked when it couldn't tell.
- GitHub answers `403` to a request with no `User-Agent`, and the
  unauthenticated limit is 60/hour per IP — which the 24h throttle keeps
  nowhere near.
- reqwest is built with `rustls-no-provider` so the crypto provider stays
  ours (`ring`, already in the tree via rumqttc) rather than aws-lc-rs, which
  would need cmake and a C toolchain in every CI job. The consequence is that
  `github.rs` installs the process-wide provider itself, once.

### Seeing the dialog without publishing a release

The update dialog only appears while running something older than the newest
tag, which normally means it can't be exercised at all. Two dev affordances:

```bash
scripts/reset-update-check.sh            # clears the 24h throttle + skipped version
BME_UPDATE_VERSION=0.1.0 npm run tauri dev
```

`BME_UPDATE_VERSION` (read in `commands::effective_version`) overrides what
the app reports *and* compares against, so the real release looks newer and
the popup fires against the real release notes. `run()` logs a `WARN` whenever
it's set, so it can never be quietly on in a build someone is trusting. The
reset script is only needed for the automatic startup popup — the manual
"Check for updates" button bypasses the throttle anyway.

## `src-tauri/src/lib.rs`

The only place that knows about both `core` and Tauri. `run()` does, in
order: install a panic hook that logs backtraces → configure
`tauri_plugin_log` (file + stdout, colored, 10 MB rotation) → open the
SQLite file under the app data dir and `manage()` the four repositories →
`manage()` the `UpdateChecker` (which holds its own handle to the same
settings table) → create the MQTT event channel and `manage()` the manager →
spawn the task
that forwards every `MqttEvent` to the webview as a `"mqtt-event"` →
(Linux/BSD only) disable WebKitGTK smooth scrolling → register the IPC
handler list.

Most of the file's length is its test module: it builds the same managed
state against an in-memory DB and drives the real commands over real IPC
with `tauri::test::get_ipc_response`, so the JSON contract is covered
end to end without a display.

## `src-tauri/src/commands.rs` — the IPC surface

Every `#[tauri::command]` lives here and is a thin adapter: take `State<…>`,
call core, map errors to `String`. Adding a command means touching **four**
places, plus a fifth if you want it under test:

1. `commands.rs` — the function.
2. `lib.rs` — add it to `tauri::generate_handler![…]`.
3. `src-tauri/build.rs` — add it to `AppManifest::new().commands([…])`, which
   is what makes `tauri-build` generate the permission file.
4. `src-tauri/capabilities/default.json` — add `"allow-<kebab-command-name>"`,
   or the webview's call is rejected by the ACL.
   (`permissions/autogenerated/*.toml` is generated by Tauri; don't hand-edit.)
5. `lib.rs`'s test `build_test_app()` — its own handler list.

Steps 3 and 4 have a **chicken-and-egg order**: the ACL validates capability
entries against the generated permission files, so a build with the new name
already in `default.json` fails with "Permission … not found". Do step 3,
build once, then add step 4.

Current commands, by area:

- **misc** — `greet` (Tauri scaffold leftover), `open_log_dir`
- **updates** — `get_app_version`, `check_for_updates`, `skip_update_version`.
  `check_for_updates` is the only **async** command in the file, and has to
  be: a network call in a plain `#[tauri::command]` runs on the main thread
  and would freeze the window for the request timeout. Async commands need
  the explicit `State<'_, …>` lifetime and a `Result` return.
- **connections** — `list_connections`, `create_connection`,
  `update_connection`, `delete_connection`, `get_connection`
- **broker** — `connect_broker`, `disconnect_broker`, `test_connection`,
  `publish_message`, `subscribe_topic`, `unsubscribe_topic`
- **templates** — `list_favorites`, `create_favorite`, `get_favorite`,
  `update_favorite`, `delete_favorite`
- **collections** — `list_favorite_collections`,
  `create_favorite_collection`, `get_favorite_collection`,
  `update_favorite_collection`, `delete_favorite_collection`
- **payload variables** — `list_payload_variables`,
  `create_payload_variable`, `get_payload_variable`,
  `update_payload_variable`, `delete_payload_variable`

Arguments are camelCase over IPC (`newConnection`, `connectionId`) even
though the Rust params are snake_case — Tauri does that conversion.
