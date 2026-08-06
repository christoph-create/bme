import { TestBed } from "@angular/core/testing";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AvailableRelease, UpdateCheck } from "../models/update-check.model";
import { UpdateNotifierService } from "./update-notifier.service";

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

/** Records every skip_update_version call, and answers checks with `result`. */
function mockBackend(result: UpdateCheck | Error): { skipped: string[] } {
  const skipped: string[] = [];
  mockIPC((cmd, args) => {
    switch (cmd) {
      case "get_app_version":
        return "0.7.0";
      case "check_for_updates":
        if (result instanceof Error) throw result;
        return result;
      case "skip_update_version":
        skipped.push((args as { version: string }).version);
        return null;
      default:
        return undefined;
    }
  });
  return { skipped };
}

/** Creates the service and lets its delayed startup check run to completion. */
async function startup(): Promise<UpdateNotifierService> {
  const service = TestBed.inject(UpdateNotifierService);
  await vi.runAllTimersAsync();
  return service;
}

describe("UpdateNotifierService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    vi.useRealTimers();
    clearMocks();
  });

  it("offers a newer, unskipped release after the startup check", async () => {
    mockBackend(check());

    const service = await startup();

    expect(service.available()).toEqual(release());
    expect(service.currentVersion()).toBe("0.7.0");
  });

  it("stays silent on startup when the check was throttled", async () => {
    mockBackend(check({ latest: null, throttled: true }));

    expect((await startup()).available()).toBeNull();
  });

  it("stays silent on startup when the release isn't newer", async () => {
    mockBackend(check({ latest: release({ is_newer: false }) }));

    expect((await startup()).available()).toBeNull();
  });

  it("stays silent on startup when the release was skipped", async () => {
    mockBackend(check({ latest: release({ is_skipped: true }) }));

    expect((await startup()).available()).toBeNull();
  });

  it("swallows a failing startup check rather than surfacing it", async () => {
    mockBackend(new Error("could not reach GitHub: dns"));

    // The assertion that matters is that this resolves at all - an unhandled
    // rejection here would take down the app's error handler.
    expect((await startup()).available()).toBeNull();
  });

  it("offers a skipped release when the user checks manually", async () => {
    mockBackend(check({ latest: release({ is_skipped: true }) }));
    const service = await startup();

    const announcement = await service.checkManually();

    expect(announcement.kind).toBe("update");
    expect(service.available()).toEqual(release({ is_skipped: true }));
  });

  it("reports up-to-date from a manual check without opening anything", async () => {
    mockBackend(check({ latest: release({ is_newer: false }) }));
    const service = await startup();

    const announcement = await service.checkManually();

    expect(announcement).toEqual({ kind: "up-to-date" });
    expect(service.available()).toBeNull();
  });

  it("rethrows from a manual check so the caller can show the error", async () => {
    mockBackend(new Error("could not reach GitHub: dns"));
    const service = await startup();

    await expect(service.checkManually()).rejects.toThrow(
      "could not reach GitHub",
    );
  });

  it("persists the skipped version and closes the dialog", async () => {
    const backend = mockBackend(check());
    const service = await startup();

    await service.skip();

    expect(backend.skipped).toEqual(["0.8.0"]);
    expect(service.available()).toBeNull();
  });

  it("closes the dialog even when persisting the skip fails", async () => {
    mockIPC((cmd) => {
      if (cmd === "get_app_version") return "0.7.0";
      if (cmd === "check_for_updates") return check();
      throw new Error("database is locked");
    });
    const service = await startup();

    await service.skip();

    expect(service.available()).toBeNull();
  });

  it("dismissing leaves nothing persisted", async () => {
    const backend = mockBackend(check());
    const service = await startup();

    service.dismiss();

    expect(service.available()).toBeNull();
    expect(backend.skipped).toEqual([]);
  });
});
