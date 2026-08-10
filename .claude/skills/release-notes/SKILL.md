---
name: release-notes
description: Draft the GitHub release notes for a new bme version, in this repo's established house style. Use when preparing or tagging a release, or when the user asks for release notes, a changelog for a version, or a summary of what changed since the last tag.
---

# Release notes

**Output is plain text, printed in the reply.** The user pastes it into the
GitHub release themselves, after the pipeline has finished. This skill does
not commit, tag, push, or run `gh release edit` / `gh release create`.

## Gather

Take an explicit range if the user names one. Otherwise work it out — and note
that notes are usually wanted **after** the release tag has been pushed, so
the newest tag is often the one being written about, not the one to diff from:

```bash
git tag --list 'v*' --sort=-v:refname | head -2
git describe --tags --exact-match HEAD 2>/dev/null   # non-empty: HEAD is tagged
```

- If HEAD is **already tagged** (the usual case — bump, tag, pipeline runs,
  now you want notes): the range is the previous tag to that tag, e.g.
  `v0.7.0..v0.8.0`. Never `<newest-tag>..HEAD`; that is empty.
- If HEAD is **not tagged**: `<newest-tag>..HEAD`, and the notes cover
  unreleased work.

Then read what landed:

```bash
git log --no-merges --stat <from>..<to>
gh pr list --state merged --base master --limit 20 --json number,title,mergedAt,body
```

Commit subjects in this repo are terse (`added charts`, `added publish
settings and and vars`) and PR titles are branch names. **They are not enough
to write from.** For each change, read what actually landed — `git diff
<prev-tag>..HEAD -- <paths>`, the new components under `src/app/`, new
commands in `src-tauri/src/commands.rs`, new migrations under
`core/src/storage/migrations/` — and describe the *user-visible* result.

## Write

Match `v0.6.0`, the one release with a body — it sets the house style:

```
New
- **Feature name** — what it does for the user, in one sentence.
- **Another feature** — same shape. Inline code for paths, like `spec/`.

**Improved**
- **Thing that got better** — and why that matters in use.
```

- Sections in this order, and only the ones that have content: `New`,
  `**Improved**`, `**Fixed**`.
- Bullets are `- **Bolded name** — sentence`, em dash, sentence case, no
  trailing period on fragments.
- Same voice as `README.md`: concrete, user-facing, no implementation detail.
  "Chart any numeric value in a topic's payload" — not "added `ValueCharts`
  component".
- **Leave out** refactors, test-only changes, CI/workflow edits, dependency
  bumps, and documentation churn. A release note answers "what do I get?".
- Keep markdown light. `src/app/shared/update-dialog/release-notes-text.ts`
  renders the release body as **plain text** in the in-app update dialog, so
  headings, links and nested lists show up as literal characters to anyone
  who reads the notes there. Bold and inline code are fine — they are the
  established style — but do not reach for anything more.

## Check before handing it over

- Every bullet corresponds to something a user could notice.
- Nothing shipped in the range is missing — walk the diff, not the log.
- The version the notes are for matches `src-tauri/Cargo.toml`, which is the
  file CI verifies the tag against. If they disagree, say so; the fix is
  `scripts/bump-version.sh`, never a hand-edit.
