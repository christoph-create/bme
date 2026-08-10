// Captures every screenshot the README uses, from the app running against the
// demo backend (`src/demo/`). Started by scripts/screenshots.sh, which owns the
// dev server; run directly only if you already have one on --base-url.
//
// The shots are data: add an entry to SHOTS and the file appears. Anything a
// shot needs on screen that isn't UI state - another connection, another
// template, more traffic - belongs in src/demo/demo-data.ts, not here.

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = join(repoRoot, "docs", "screenshots");

const HOME_CONNECTION_ID = "11111111-1111-4111-8111-111111111111";
/** Must match DEMO_SELECTED_TOPIC in src/demo/demo-data.ts. */
const SELECTED_TOPIC = "home/livingroom/climate";

/**
 * One viewport for every shot. Wide enough for the workspace's three columns
 * to breathe (the README displays these at 820px, so 1400 leaves room for a
 * little downscaling), and uniform so the images sit together in the README
 * without one being a different shape from the next. Resist per-shot sizes:
 * a screen with room to spare reads as a screen with room to spare, which is
 * true, whereas a set of mismatched crops just looks unfinished.
 */
const VIEWPORT = { width: 1400, height: 900 };

/**
 * The message stream re-reads the (virtual) clock on a 1s interval, so a shot
 * taken immediately after the timeline plays would show times from before the
 * final settle gap. One real tick is enough - the demo clock is frozen, so
 * waiting longer changes nothing.
 */
const CLOCK_TICK_MS = 1_200;

/**
 * Everything that would make two runs of the same shot differ: transitions
 * caught mid-flight, the CodeMirror caret's blink phase, and the flashing
 * highlight the topic tree puts on a row that just received a message. The
 * fixed scrollbar width keeps the layout identical across machines.
 */
const FREEZE_CSS = `
  *, *::before, *::after {
    transition: none !important;
    animation: none !important;
  }
  .cm-content { caret-color: transparent !important; }
  ::-webkit-scrollbar { width: 8px; height: 8px; }
`;

async function openWorkspace(page, { topic = SELECTED_TOPIC } = {}) {
  await page.goto(`/broker/${HOME_CONNECTION_ID}`);
  await page.getByText("Connected", { exact: true }).waitFor();
  await page.evaluate(
    (id) => window.__bmeDemo.playTimeline(id),
    HOME_CONNECTION_ID,
  );
  // The tree starts collapsed and shows only a topic's last segment, so the
  // leaf has to be reachable and its name unique - see DEMO_SELECTED_TOPIC.
  await page.getByRole("button", { name: "Expand all" }).click();
  if (topic !== null) {
    await page
      .locator(".tree-row.leaf")
      .filter({ hasText: topic.split("/").pop() })
      .click();
  }
  await page.waitForTimeout(CLOCK_TICK_MS);
}

/** Fills the publish panel by loading a template, which is both a real user
 * path and far more robust than synthesising keystrokes into CodeMirror. */
async function loadTemplate(page, name) {
  await page.getByRole("button", { name: "Load Template" }).click();
  await page.locator(".template-row").filter({ hasText: name }).click();
}

/** Drags the horizontal splitter up by `deltaPx`, making the publish panel
 * that much taller. It is deliberately short by default, which crops any shot
 * of what lives inside it. */
/** Drops the focus ring `fill()` leaves behind - it reads as "the user is
 * mid-edit here", which is never what a screenshot is trying to say. */
async function blurFocus(page) {
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      active.blur();
    }
  });
}

async function growPublishPanel(page, deltaPx) {
  const box = await page.locator(".resizer-row").boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - deltaPx, { steps: 10 });
  await page.mouse.up();
}

const SHOTS = [
  {
    name: "connections",
    async setup(page) {
      await page.goto("/connections");
      await page.getByText("Home Assistant").waitFor();
    },
  },

  {
    name: "new-connection",
    async setup(page) {
      await page.goto("/connections/new");
      await page.getByLabel("Name").fill("Greenhouse");
      await page.getByLabel("Host").fill("greenhouse.local");
      await page.getByLabel("Client ID").fill("bme-desktop");
      await blurFocus(page);
    },
  },

  {
    name: "broker-workspace",
    async setup(page) {
      await openWorkspace(page);
      await loadTemplate(page, "Temperature reading");
    },
  },

  {
    name: "value-charts",
    async setup(page) {
      await openWorkspace(page);
      await loadTemplate(page, "Temperature reading");
      await page.getByRole("button", { name: "Tools" }).click();
      await page.getByRole("button", { name: /^\+ Add chart/ }).click();
      // Two, so the expanded two-column layout comes out as one full row.
      const picker = page.locator(".picker-option");
      await picker.filter({ hasText: "temperature" }).click();
      await picker.filter({ hasText: "humidity" }).click();
      await page.getByRole("button", { name: "Done" }).click();
      // Expanded, so the cards lay out two-up and fit whole in frame.
      await page
        .getByRole("button", { name: "Expand over the messages" })
        .click();
    },
  },

  {
    name: "save-template-modal",
    async setup(page) {
      await openWorkspace(page);
      await loadTemplate(page, "Temperature reading");
      await page.getByRole("button", { name: "Save as Template" }).click();
      await page.getByLabel("Name").fill("Living room sample");
      await page
        .getByLabel("Description")
        .fill("The reading currently in the publish draft.");
      await page.getByLabel("Collection").selectOption({ label: "Sensors" });
      await blurFocus(page);
    },
  },

  {
    name: "variables-modal",
    async setup(page) {
      await openWorkspace(page);
      await loadTemplate(page, "Discovery ping");
      await page.getByRole("button", { name: "Edit Vars" }).click();
      await page.getByText("deviceId", { exact: true }).waitFor();
    },
  },

  {
    name: "repeat-publishing",
    async setup(page) {
      await openWorkspace(page);
      await loadTemplate(page, "Discovery ping");
      await growPublishPanel(page, 260);
      await page.getByRole("button", { name: "Publish settings" }).click();
      // The checkboxes sit under their switch tracks, so the label is the only
      // clickable way in - the same one a user has.
      const toggle = (name) =>
        page.locator("label.toggle-field").filter({ hasText: name }).click();
      await toggle("Repeat publishing");
      // Off, so the "Number of messages" field the setting is really about is
      // on screen rather than hidden behind the forever switch.
      await toggle("Keep going until stopped");
    },
  },

  {
    name: "templates-management",
    async setup(page) {
      await page.goto("/templates");
      await page.getByText("Temperature reading").waitFor();
    },
  },
];

/**
 * Refuses to save a screenshot of something that is not the app.
 *
 * This exists because it already happened: a stale build cache made the dev
 * server serve a Vite "Could not resolve" overlay, the shot's own
 * `waitFor` still passed because the app was in the DOM *behind* the overlay,
 * and a picture of a red error box went into docs/ unnoticed. A generated
 * screenshot is only worth anything if a bad one fails loudly.
 */
async function assertRenderedApp(page, name) {
  // `vite-error-overlay` only - not `.backdrop`, which is the app's own modal
  // shell and legitimately present in half the shots. The message lives in the
  // element's shadow root, so `innerText` on the host comes back empty.
  const buildError = await page.evaluate(() => {
    const root = document.querySelector("vite-error-overlay")?.shadowRoot;
    if (!root) return null;
    // Named parts only - the whole shadow root's textContent drags the
    // overlay's inlined stylesheet along with the message.
    const parts = [".message-body", ".file", ".frame"]
      .map((selector) => root.querySelector(selector)?.textContent?.trim())
      .filter(Boolean);
    // Never an empty string: the overlay being present is the finding, even
    // when none of its known parts matched.
    return parts.length > 0 ? parts.join("\n") : "(overlay present, no message)";
  });
  if (buildError !== null) {
    throw new Error(`${name}: dev server is showing a build error:\n${buildError}`);
  }

  const rendered = await page.evaluate(
    () => document.querySelector("app-root")?.textContent?.trim().length ?? 0,
  );
  if (rendered === 0) {
    throw new Error(`${name}: app-root rendered nothing`);
  }
}

async function main() {
  const baseUrl = process.env.BME_DEMO_URL ?? "http://localhost:1421";
  const only = process.argv.slice(2);
  const shots = only.length
    ? SHOTS.filter((shot) => only.includes(shot.name))
    : SHOTS;

  const unknown = only.filter((name) => !SHOTS.some((s) => s.name === name));
  if (unknown.length) {
    throw new Error(`unknown shot(s): ${unknown.join(", ")}`);
  }

  await mkdir(outputDir, { recursive: true });
  // Rasterisation flags, not behaviour flags: without them Chromium is free to
  // vary subpixel text positioning and layer compositing between runs, which
  // shows up as a handful of changed pixels in an otherwise identical PNG and
  // makes `git diff docs/screenshots/` useless as a signal.
  const browser = await chromium.launch({
    args: [
      "--disable-lcd-text",
      "--disable-font-subpixel-positioning",
      "--font-render-hinting=none",
      "--force-color-profile=srgb",
      "--disable-gpu",
      "--disable-partial-raster",
      "--run-all-compositor-stages-before-draw",
    ],
  });

  try {
    for (const shot of shots) {
      // A fresh context per shot, so message history, open charts and the
      // demo clock all start from the same place every time.
      const context = await browser.newContext({
        baseURL: baseUrl,
        viewport: VIEWPORT,
        deviceScaleFactor: 1,
        colorScheme: "dark",
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      // An init script rather than addStyleTag: several shots navigate more
      // than once, and a style tag would be thrown away with the old document.
      await page.addInitScript((css) => {
        document.addEventListener("DOMContentLoaded", () => {
          const style = document.createElement("style");
          style.textContent = css;
          document.head.append(style);
        });
      }, FREEZE_CSS);

      const failures = [];
      page.on("pageerror", (error) => failures.push(error.message));

      await shot.setup(page);

      if (failures.length) {
        throw new Error(`${shot.name}: page errors: ${failures.join("; ")}`);
      }
      await assertRenderedApp(page, shot.name);

      const file = join(outputDir, `${shot.name}.png`);
      await page.screenshot({ path: file });
      console.log(`  ✓ ${shot.name}.png`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

await main();
