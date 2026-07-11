# bme — Better MQTT Explorer

A desktop app for developing against MQTT brokers: connect, subscribe, publish, and keep a library of favorite messages for quick reuse. Built with [Tauri](https://tauri.app) (Rust backend) and [Angular](https://angular.dev) (frontend).

## Status

Phase 1 (backend) is done: a Rust core library (`core/`) with SQLite-backed storage for broker connections/subscriptions and favorite messages, and an MQTT client built on [rumqttc](https://github.com/bytebeamio/rumqttc), all developed test-first.

Phase 2 (Angular frontend) is in progress, built one screen at a time, test-first, against the real Tauri commands:

- **Connections** — list, create, and delete saved broker connections.
- **Broker Workspace** — connect to a broker; manage its subscriptions (persisted, replayed on reconnect); a live topic tree built from received messages (expand/collapse, message counts, last-payload preview with a flash on update, time-ago); a messages panel showing the full session history for the selected topic (newest first, QoS, retained flag, payload).
- Publish panel is still a placeholder shell.

<!-- Screenshots will go here once there's a UI to show. -->

## Features

- Manage multiple broker connections (host, port, credentials, TLS, keep-alive) and their subscription topics
- Connect/disconnect, publish, and subscribe against real MQTT brokers
- Save and reuse favorite messages (topic, payload, QoS, retain), optionally tied to a specific connection
- SQLite storage, no external database required

## Development

Prerequisites: [Rust](https://rustup.rs), [Node.js](https://nodejs.org) (LTS), and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform.

```sh
npm install

# Run the app in dev mode (Angular dev server + Tauri window)
npm run tauri dev

# Rust workspace: lint, test, build
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

# Frontend: lint, build
npm run lint
npm run build
```

CI runs the same checks on every push via Forgejo Actions (`.forgejo/workflows/ci.yml`); pushing a `v*` tag additionally builds and publishes a release.

## License

GPL-3.0-or-later - see [LICENSE](LICENSE).

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer) + [Angular Language Service](https://marketplace.visualstudio.com/items?itemName=Angular.ng-template).
