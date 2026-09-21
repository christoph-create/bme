import { TestBed } from "@angular/core/testing";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS, SETTING_KEYS } from "../settings/app-settings";
import { LoggerService } from "./logger.service";
import { SettingsService } from "./settings.service";

interface Call {
  cmd: string;
  args: Record<string, unknown>;
}

describe("SettingsService", () => {
  let calls: Call[];
  let rows: Record<string, string>;

  function service(): SettingsService {
    return TestBed.inject(SettingsService);
  }

  beforeEach(() => {
    calls = [];
    rows = {};
    mockIPC((cmd, args) => {
      calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
      switch (cmd) {
        case "list_app_settings":
          return { ...rows };
        case "set_app_setting":
        case "remove_app_setting":
          return null;
        default:
          throw new Error(`unexpected command: ${cmd}`);
      }
    });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: LoggerService,
          useValue: { debug: vi.fn(), warn: vi.fn() },
        },
      ],
    });
  });

  afterEach(() => {
    clearMocks();
  });

  it("serves the defaults synchronously before anything is loaded", () => {
    expect(service().settings()).toEqual(DEFAULT_SETTINGS);
    expect(calls).toEqual([]);
  });

  it("hands out one memoised signal per key", async () => {
    const s = service();
    const qos = s.value("publishQos");
    expect(qos).toBe(s.value("publishQos"));
    expect(qos()).toBe("AtMostOnce");

    await s.set("publishQos", "AtLeastOnce");

    expect(qos()).toBe("AtLeastOnce");
  });

  it("decodes what the backend holds on load", async () => {
    rows = {
      "stream.pretty_json": "false",
      "store.max_messages_per_topic": "250",
      "update.skipped_version": "0.9.9",
    };

    await service().load();

    expect(service().settings()).toEqual({
      ...DEFAULT_SETTINGS,
      prettyJson: false,
      maxMessagesPerTopic: 250,
    });
  });

  it("shares one in-flight load between concurrent callers", async () => {
    const s = service();
    await Promise.all([s.load(), s.load(), s.load()]);

    expect(calls.filter((c) => c.cmd === "list_app_settings")).toHaveLength(1);
  });

  it("does not cache a failed load", async () => {
    let fail = true;
    mockIPC((cmd) => {
      if (fail) throw new Error("db locked");
      if (cmd === "list_app_settings") return { "stream.pretty_json": "false" };
      return null;
    });

    const s = service();
    await expect(s.load()).rejects.toThrow("db locked");
    fail = false;
    await s.load();

    expect(s.settings().prettyJson).toBe(false);
  });

  it("updates the signal before the write lands, then persists the encoded value", async () => {
    const s = service();
    const pending = s.set("publishQos", "ExactlyOnce");

    expect(s.settings().publishQos).toBe("ExactlyOnce");
    await pending;
    expect(calls).toEqual([
      {
        cmd: "set_app_setting",
        args: { key: "publish.default_qos", value: "ExactlyOnce" },
      },
    ]);
  });

  it("clamps an out-of-range number before showing or storing it", async () => {
    const s = service();
    await s.set("maxMessagesPerTopic", 3);

    expect(s.settings().maxMessagesPerTopic).toBe(10);
    expect(calls[0].args).toEqual({
      key: "store.max_messages_per_topic",
      value: "10",
    });
  });

  it("resets by removing exactly the setting keys", async () => {
    const s = service();
    await s.set("prettyJson", false);
    calls = [];

    await s.resetAll();

    expect(s.settings()).toEqual(DEFAULT_SETTINGS);
    expect(calls.map((c) => c.cmd)).toEqual(
      Object.values(SETTING_KEYS).map(() => "remove_app_setting"),
    );
    expect(calls.map((c) => c.args["key"]).sort()).toEqual(
      Object.values(SETTING_KEYS).sort(),
    );
  });
});
