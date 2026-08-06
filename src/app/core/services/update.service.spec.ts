import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";

import { UpdateCheck } from "../models/update-check.model";
import { UpdateService } from "./update.service";

function sampleCheck(): UpdateCheck {
  return {
    current_version: "0.7.0",
    latest: {
      version: "0.8.0",
      name: "v0.8.0",
      notes: "notes",
      url: "https://github.com/christoph-create/bme/releases/tag/v0.8.0",
      published_at: "2026-08-01T00:00:00Z",
      is_newer: true,
      is_skipped: false,
    },
    throttled: false,
  };
}

describe("UpdateService", () => {
  afterEach(() => {
    clearMocks();
  });

  it("reads the app version via the get_app_version command", async () => {
    mockIPC((cmd) => (cmd === "get_app_version" ? "0.7.0" : undefined));

    await expect(new UpdateService().getAppVersion()).resolves.toBe("0.7.0");
  });

  it("passes force through to the check_for_updates command", async () => {
    const seen: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd !== "check_for_updates") return undefined;
      seen.push(args);
      return sampleCheck();
    });

    const service = new UpdateService();
    await service.check(false);
    await service.check(true);

    expect(seen).toEqual([{ force: false }, { force: true }]);
  });

  it("sends the version to the skip_update_version command", async () => {
    const seen: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd !== "skip_update_version") return undefined;
      seen.push(args);
      return null;
    });

    await new UpdateService().skip("0.8.0");

    expect(seen).toEqual([{ version: "0.8.0" }]);
  });

  it("rejects when the backend reports a failure", async () => {
    mockIPC(() => {
      throw new Error("could not reach GitHub: dns");
    });

    await expect(new UpdateService().check(true)).rejects.toThrow(
      "could not reach GitHub",
    );
  });
});
