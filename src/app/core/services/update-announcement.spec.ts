import { describe, expect, it } from "vitest";

import { AvailableRelease, UpdateCheck } from "../models/update-check.model";
import { announcementFor } from "./update-announcement";

function release(overrides: Partial<AvailableRelease> = {}): AvailableRelease {
  return {
    version: "0.8.0",
    name: "v0.8.0",
    notes: "notes",
    url: "https://github.com/christoph-create/bme/releases/tag/v0.8.0",
    published_at: "2026-08-01T00:00:00Z",
    is_newer: true,
    is_skipped: false,
    ...overrides,
  };
}

function check(overrides: Partial<UpdateCheck> = {}): UpdateCheck {
  return {
    current_version: "0.7.0",
    latest: release(),
    throttled: false,
    ...overrides,
  };
}

describe("announcementFor", () => {
  it("stays silent when the check was throttled, asked for or not", () => {
    const throttled = check({ latest: null, throttled: true });
    expect(announcementFor(throttled, false)).toEqual({ kind: "silent" });
    expect(announcementFor(throttled, true)).toEqual({ kind: "silent" });
  });

  it("reports up-to-date only to a manual check when nothing is published", () => {
    const nothing = check({ latest: null });
    expect(announcementFor(nothing, true)).toEqual({ kind: "up-to-date" });
    expect(announcementFor(nothing, false)).toEqual({ kind: "silent" });
  });

  it("reports up-to-date only to a manual check when the release isn't newer", () => {
    const same = check({ latest: release({ is_newer: false }) });
    expect(announcementFor(same, true)).toEqual({ kind: "up-to-date" });
    expect(announcementFor(same, false)).toEqual({ kind: "silent" });
  });

  it("offers a newer, unskipped release either way", () => {
    const newer = check();
    expect(announcementFor(newer, false)).toEqual({
      kind: "update",
      release: release(),
    });
    expect(announcementFor(newer, true)).toEqual({
      kind: "update",
      release: release(),
    });
  });

  it("hides a skipped release from the automatic check but not from a manual one", () => {
    // Pressing the button is asking again, so it overrides the skip.
    const skipped = check({ latest: release({ is_skipped: true }) });
    expect(announcementFor(skipped, false)).toEqual({ kind: "silent" });
    expect(announcementFor(skipped, true)).toEqual({
      kind: "update",
      release: release({ is_skipped: true }),
    });
  });

  it("never offers a skipped release that also isn't newer", () => {
    const old = check({ latest: release({ is_newer: false, is_skipped: true }) });
    expect(announcementFor(old, true)).toEqual({ kind: "up-to-date" });
    expect(announcementFor(old, false)).toEqual({ kind: "silent" });
  });
});
