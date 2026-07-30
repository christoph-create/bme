# Conventions

## Commands

```bash
npm install
npm run tauri dev      # Angular dev server + Tauri window

cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

npm run lint
npm run test           # vitest
npm run build
```

CI (`.github/workflows/ci.yml`) runs exactly these, in the order
lint → test → build, on every PR. Clippy is `-D warnings`; a warning is a
failed build.

## Testing

- **Rust unit tests** live in a `#[cfg(test)] mod tests` at the bottom of the
  file they cover. Storage tests use `storage::open_in_memory()`; MQTT tests
  inject a fake `MqttPort` — nothing in the suite opens a socket or needs a
  broker.
- **IPC integration tests** live in `src-tauri/src/lib.rs`'s test module and
  drive real commands through real IPC against an in-memory DB. Add one when
  you add a command whose JSON shape matters.
- **Frontend tests** are vitest, in `*.spec.ts` next to the file they cover.
- Logic worth testing gets **extracted into a plain function file with its
  own spec** rather than tested through a component (see
  `pages/broker-workspace/topic-tree/build-topic-tree.ts`,
  `message-stream/virtual-range.ts`, `format/time-ago.ts`). Keep doing this.

## Naming

- Angular files: kebab-case, no `.component` suffix on newer files
  (`connections.ts`, `topic-tree.ts`); services keep `.service.ts` and models
  keep `.model.ts`.
- **"favorite" (Rust, DB, IPC) == "template" (UI, docs, spec).** The user-facing
  rename never reached the backend. Don't "fix" one side in isolation — it's a
  schema and IPC-contract change.
- Rust: `snake_case` commands; Tauri exposes their arguments as camelCase to
  the webview.

## Comments

The existing code explains **why**, not what — especially where a choice
looks arbitrary (the WebKitGTK scroll workaround in `lib.rs`, the fern
logger's `.targets()` vs `.target()` note, why `QoS` persists as an integer
but `MessageFormat` as text). Match that density: no narration of obvious
code, but write down the non-obvious reason.

## Versioning & release

Six files hold the version. Never edit them by hand:

```bash
scripts/bump-version.sh patch    # or minor / major / X.Y.Z
```

`src-tauri/Cargo.toml` is the source of truth — the release job refuses to
publish if the pushed `v*` tag doesn't match it. (The script's header
comment still says `.forgejo/workflows/ci.yml`; the workflow has since moved
to GitHub Actions.)

Pushing a `vX.Y.Z` tag builds and publishes Linux (AppImage/deb/rpm) and
Windows (portable exe/NSIS/msi) artifacts. A tag containing `-` is published
as a prerelease.

## Database migrations

Add a new numbered `.sql` in `core/src/storage/migrations/`. **Never modify a
migration that has shipped** — installed copies have already run it.

## Not in the repo

`docs/plans/` and `/.claude` are gitignored. Planning docs stay scratch;
don't commit them.
