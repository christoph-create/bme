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

CI (`.github/workflows/ci.yml`) runs exactly these, as lint → test (the
Angular production build rides along in test), on every PR and on every push
to `master`. Clippy is `-D warnings`; a warning is a failed build. Nothing in
`ci.yml` builds an installer — see [Releasing](#releasing).

## Testing

- **Rust unit tests** live in a `#[cfg(test)] mod tests` at the bottom of the
  file they cover. Storage tests use `storage::open_in_memory()`; MQTT tests
  inject a fake `MqttPort` and update-check tests a fake `ReleaseSource` —
  nothing in the suite opens a socket or needs a broker.
- **IPC integration tests** live in `src-tauri/src/lib.rs`'s test module and
  drive real commands through real IPC against an in-memory DB. Add one when
  you add a command whose JSON shape matters.
- **Frontend tests** are vitest, in `*.spec.ts` next to the file they cover.
- Logic worth testing gets **extracted into a plain function file with its
  own spec** rather than tested through a component (see
  `pages/broker-workspace/topic-tree/build-topic-tree.ts`,
  `message-stream/virtual-range.ts`, `format/time-ago.ts`). Keep doing this.

## Network access

Any outbound HTTP sits behind a port trait in `core/`, with the real client as
an adapter — `MqttPort`/`rumqttc_adapter`, `ReleaseSource`/`GithubReleaseSource`.
That's what keeps the test suite socket-free, and it's what lets the policy
(when to check, what counts as newer) be tested separately from the transport.
Don't call out to the network from `src-tauri/`; it belongs in `core/` behind
a trait like everything else.

App-settings keys are namespaced `area.name`, values are strings the consumer
encodes itself, and timestamps are RFC 3339 in UTC — stated explicitly rather
than left to rusqlite's chrono support, since the column is a generic `TEXT`.

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
scripts/bump-version.sh 0.10.0-rc.1
scripts/bump-version.sh release  # 0.10.0-rc.N -> 0.10.0
```

`src-tauri/Cargo.toml` is the source of truth — `release.yml` refuses to
publish if the pushed `v*` tag doesn't match it.

## Releasing

Three workflows under `.github/workflows/`:

| Workflow | Runs on | Does |
| --- | --- | --- |
| `ci.yml` | push to `master`, PRs | lint → test. No installers. |
| `bundle.yml` | **manual** (Actions → Bundle → Run workflow), or called by `release.yml` | Every installer for Linux (AppImage/deb/rpm/pkg.tar.zst) and Windows (NSIS/msi/portable exe), uploaded as workflow artifacts — never as a release. This is how to get test builds of any branch. |
| `release.yml` | push of a `v*` tag | tag check → ci → bundle → one GitHub release with everything attached |

What a tag turns into:

- **`vX.Y.Z`** → a **draft** release, visible only to maintainers. Download
  and test it, then press *Publish* on GitHub. Publishing is the go-live
  step: the in-app update check (which reads `/releases/latest`) only sees it
  from then on.
- **`vX.Y.Z-rc.N`** → a public **prerelease** for testers. The update check
  ignores prereleases. No MSI: WiX can't version an rc, so
  Windows gets NSIS + portable only. The pacman package gets pkgver
  `X.Y.Zrc.N`, since pacman forbids `-`.

The app now **displays** its version (connections footer) and compares it
against the newest GitHub release, so a `bump-version.sh` that half-ran is
user-visible rather than just a CI failure.

## Database migrations

Add a new numbered `.sql` in `core/src/storage/migrations/`. **Never modify a
migration that has shipped** — installed copies have already run it.

`rusqlite_migration` counts migrations rather than reading their names, so two
feature branches that each add `0009_*.sql` will collide: whichever merges
second must renumber, and any database that already applied the first will
never run the second. Check the other branches before claiming a number.

## Not in the repo

`docs/plans/` and `/.claude` are gitignored. Planning docs stay scratch;
don't commit them.
