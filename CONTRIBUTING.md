# Contributing to bme

Thanks for taking an interest. bme is a side project I build in my free time,
so please read the first section before you spend an evening on a patch — I'd
rather tell you "yes, go for it" up front than turn down finished work.

## Before you start

- **Small and obvious?** Typos, broken links, a clear one-line bug fix — just
  open a pull request. No ceremony needed.
- **Anything bigger?** Open an issue first and let's agree on the approach.
  New features, refactors, new dependencies, or anything touching the storage
  schema or the IPC surface fall under this. It's not a gate to keep you out;
  it's so a large PR doesn't collide with something half-finished on my side, or
  with the direction in the [Roadmap](README.md#roadmap).
- **Not sure it's a bug?** Open an issue anyway. A report that turns out to be
  a misunderstanding usually means the UI or the docs could be clearer.

## Setting up

Prerequisites and the full command list live in the README's
[Development](README.md#development) section — that's the canonical copy, so
this file doesn't repeat it and can't drift from it. The short version:

```sh
npm install
npm run tauri dev
```

You need [Rust](https://rustup.rs), [Node.js](https://nodejs.org) (LTS), and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform.

You do **not** need a running MQTT broker to work on bme or to run its tests.
The test suite is socket-free by design, and `src/demo/` provides a mock backend
that lets the whole UI run in a plain browser with no broker and no database.

## Finding your way around

Two-crate Cargo workspace (`core/` + `src-tauri/`) plus an Angular frontend in
`src/`. Rather than describing it twice, start at
[docs/architecture/README.md](docs/architecture/README.md) — it has a
"want to change X → start at Y" table that will land you in the right file
faster than reading the tree.

## Before you open a pull request

Run what CI runs. If these pass locally, CI will pass:

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

npm run lint
npm run test
npm run build
```

Clippy warnings fail the build — that's deliberate, not an accident of
configuration.

## Things that will get a PR sent back

These are the rules that aren't obvious from reading the code, so they're worth
stating plainly:

- **Never edit a migration that has already shipped.** Schema changes go in a
  new file under `core/src/storage/migrations/`. An edited migration silently
  corrupts existing users' databases.
- **Never hand-edit version numbers.** Six files have to agree; use
  `scripts/bump-version.sh <patch|minor|major|X.Y.Z>`.
- **Never hand-edit or hand-capture the README screenshots.** They're generated
  from the demo fixture with `npm run screenshots`, and output is byte-identical
  between runs — so a changed PNG means the UI actually changed.
- **Adding an IPC command touches five places.** The function in
  `src-tauri/src/commands.rs`, the `generate_handler!` list in
  `src-tauri/src/lib.rs`, the command list in `src-tauri/build.rs`, an
  `"allow-<kebab-name>"` entry in `src-tauri/capabilities/default.json`, and
  `build_test_app()`'s handler list in `lib.rs`'s test module. Miss one and the
  build fails with a permissions error that doesn't obviously point at the cause.
- **Keep both sides of a cross-boundary contract in sync.** `src/app/core/models/`
  are hand-maintained TypeScript mirrors of the Rust types in
  `core/src/models.rs`. Changing one without the other breaks things silently —
  [docs/architecture/data-flow.md](docs/architecture/data-flow.md) lists every
  such contract.
- **Put testable logic in its own file.** Logic worth unit-testing gets
  extracted into a plain function with a `.spec.ts`/test module beside it,
  rather than tested through the component. See
  `src/app/pages/broker-workspace/topic-tree/build-topic-tree.ts` for the shape.
- **Comments explain _why_, not _what_.** Match the surrounding density rather
  than narrating obvious code.

## Commit messages and PRs

Nothing formal — a readable subject line and a description of *why* is plenty.
If your PR fixes an issue, link it. If it changes the UI, include a screenshot.

## Licensing

bme is licensed under GPL-3.0-or-later. By contributing, you agree that your
contribution is licensed under the same terms.

## Code of Conduct

This project ships a [Code of Conduct](CODE_OF_CONDUCT.md). Participating means
you're expected to follow it.
