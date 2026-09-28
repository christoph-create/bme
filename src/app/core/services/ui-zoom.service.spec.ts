import { computed, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppSettings, DEFAULT_SETTINGS } from "../settings/app-settings";
import { LoggerService } from "./logger.service";
import { SettingsService } from "./settings.service";
import { UiZoomService } from "./ui-zoom.service";

describe("UiZoomService", () => {
  let zoomCalls: number[];
  let settings: ReturnType<typeof signal<AppSettings>>;
  let warn: ReturnType<typeof vi.fn>;
  let set: ReturnType<typeof vi.fn>;

  function service(): UiZoomService {
    return TestBed.inject(UiZoomService);
  }

  /** Runs the service's effect, which is what calls `setZoom`. */
  function flush(): void {
    TestBed.tick();
  }

  beforeEach(() => {
    zoomCalls = [];
    warn = vi.fn();
    settings = signal<AppSettings>({ ...DEFAULT_SETTINGS });
    set = vi.fn(
      <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
        settings.update((s) => ({ ...s, [key]: value }));
        return Promise.resolve();
      },
    );

    mockWindows("main");
    mockIPC((cmd, args) => {
      if (cmd === "plugin:webview|set_webview_zoom") {
        zoomCalls.push((args as { value: number }).value);
        return null;
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    TestBed.configureTestingModule({
      providers: [
        { provide: LoggerService, useValue: { warn, debug: vi.fn() } },
        {
          provide: SettingsService,
          useValue: {
            settings,
            value: (key: keyof AppSettings) => computed(() => settings()[key]),
            set,
          },
        },
      ],
    });
  });

  afterEach(() => {
    clearMocks();
  });

  it("applies the current zoom as soon as it exists", () => {
    service();
    flush();

    expect(zoomCalls).toEqual([1]);
  });

  it("re-applies when the setting changes", () => {
    service();
    flush();

    settings.update((s) => ({ ...s, uiZoom: 1.5 }));
    flush();

    expect(zoomCalls).toEqual([1, 1.5]);
  });

  it("steps up and down through the levels, saving each", () => {
    const zoom = service();
    flush();

    zoom.stepIn();
    expect(set).toHaveBeenCalledWith("uiZoom", 1.1);
    zoom.stepIn();
    expect(set).toHaveBeenCalledWith("uiZoom", 1.25);
    zoom.stepOut();
    expect(set).toHaveBeenLastCalledWith("uiZoom", 1.1);

    // Only the value it ended on reaches the webview: the effect coalesces
    // the three writes into one run.
    flush();
    expect(zoomCalls).toEqual([1, 1.1]);
  });

  it("does not write when already at the end of the range", () => {
    settings.update((s) => ({ ...s, uiZoom: 2 }));
    const zoom = service();
    flush();
    set.mockClear();

    zoom.stepIn();

    expect(set).not.toHaveBeenCalled();
  });

  it("resets to 100%", () => {
    settings.update((s) => ({ ...s, uiZoom: 1.75 }));
    const zoom = service();
    flush();

    zoom.reset();

    expect(set).toHaveBeenCalledWith("uiZoom", 1);
  });

  it("logs rather than throwing when there is no webview to zoom", async () => {
    // What the demo build in a plain browser looks like.
    mockIPC(() => {
      throw new Error("no webview");
    });
    service();
    flush();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ui zoom"));
  });
});
