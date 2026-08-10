---
name: screenshots
description: Regenerate the README's screenshots and keep the README honest about them. Use when a UI change has landed and the images or the text around them may be stale, when adding a screenshot for a new feature, or when the user asks to refresh/update the screenshots or check whether they are out of date.
---

# Screenshots

`docs/screenshots/*.png` are **generated**, never hand-captured and never
edited. One command reproduces all of them:

```bash
npm run screenshots
```

Output is byte-identical between runs, so `git status docs/screenshots/` after
a run tells you exactly which images the last UI change actually altered. An
image that changes when you did not expect it to is a finding, not noise.

## The three files

| File | What it owns |
|---|---|
| `src/demo/demo-data.ts` | The example data: connections, subscriptions, collections, templates, variables, and the timeline of received messages. |
| `src/demo/demo-backend.ts` | The mock Tauri backend (`mockIPC`) that serves that data, plus `window.__bmeDemo` for staging session-only state. |
| `scripts/screenshots.mjs` | The `SHOTS` list — one entry per PNG: name, viewport, and the clicks that stage it. |

`scripts/screenshots.sh` only starts the demo dev server and tears it down.

## Doing the job

1. **Work out which shots the change invalidates.** Map the feature to the
   screens it appears on. The workspace shots (`broker-workspace`,
   `value-charts`, `variables-modal`, `repeat-publishing`,
   `save-template-modal`) all show the sidebar, the message stream and the
   publish panel, so a change to any of those touches five images at once.

2. **Extend the fixture first, if the feature needs data that isn't there.**
   A new field, a new payload shape, a new template — that belongs in
   `demo-data.ts`, never staged ad-hoc inside a shot's `setup`. `setup` is for
   UI state (navigate, click, open a modal); everything the app would have
   loaded from the database is data.

3. **Add a shot** by appending to `SHOTS`. Keep existing filenames stable —
   the README references them by path. Prefer driving the app the way a user
   would (load a template rather than typing into CodeMirror; click a label
   rather than the checkbox hidden under its switch track).

4. **Run it**, then `git status docs/screenshots/`, then **read the changed
   PNGs**. Do not skip this: the script cannot tell you that a panel is
   cropped, a chart is cut in half, or a focus ring makes it look like
   something is mid-edit.

5. **Reconcile the README.** For every `<img>` in the Screenshots section:
   does the file still show what the caption says, and what the (long,
   descriptive) `alt` text says? Then the other direction — is there a
   feature the README describes in prose with no screenshot behind it? The
   `How to use it` steps and the feature list are the places to check.

6. **Commit the images with the change that caused them**, not separately.

## Constraints worth knowing

- Screenshots are captured from **Chromium**, while the shipped app renders in
  WebKitGTK. Layout and colours match; expect small font-rasterisation
  differences from any older, hand-captured image.
- Every shot is captured at the same **1400×900** viewport, on purpose — the
  images sit next to each other in the README, and mismatched shapes look
  unfinished. A screen with empty space below its content is fine; if it looks
  too sparse, the fix is more example data in `demo-data.ts`, not a shorter
  viewport.
- The script refuses to capture if the dev server is showing a build-error
  overlay or `app-root` rendered nothing, and refuses to start at all if
  something else is already on port 1421. If you hit that last one, a previous
  run leaked its server: `pkill -f 'ng serve --configuration demo'`.
- Determinism comes from three places, all of which you can break by accident:
  the virtual clock in `src/demo/demo-clock.ts` (which is why messages read
  "9s ago" identically every run), the animation/caret freeze CSS in
  `screenshots.mjs`, and the Chromium rasterisation flags on `chromium.launch`.
  If a run starts producing churn, suspect those before suspecting the app.
- The whole `src/demo/` tree only ships in the `demo` build configuration
  (`angular.json` swaps `src/main.ts` for `src/main.demo.ts`), so nothing here
  reaches a release build. It is still linted and type-checked like any other
  source, so `npm run lint` must pass.
- A single shot can be recaptured on its own: `npm run screenshots -- connections`.
