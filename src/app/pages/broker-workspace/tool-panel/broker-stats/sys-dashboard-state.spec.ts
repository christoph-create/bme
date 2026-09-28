import { describe, expect, it } from "vitest";

import {
  SysDashboardInput,
  UNSUPPORTED_AFTER_MS,
  sysDashboardState,
} from "./sys-dashboard-state";

function input(overrides: Partial<SysDashboardInput> = {}): SysDashboardInput {
  return {
    connected: true,
    monitoring: true,
    sysTopicCount: 0,
    msSinceStart: 0,
    ...overrides,
  };
}

describe("sysDashboardState", () => {
  it("offers the switch when the broker isn't being monitored", () => {
    expect(sysDashboardState(input({ monitoring: false }))).toBe("off");
    expect(
      sysDashboardState(input({ monitoring: false, connected: false })),
    ).toBe("off");
  });

  it("says so when there is no session to read over", () => {
    expect(sysDashboardState(input({ connected: false }))).toBe("disconnected");
  });

  it("waits before drawing a conclusion", () => {
    expect(sysDashboardState(input({ msSinceStart: 0 }))).toBe("waiting");
    expect(
      sysDashboardState(input({ msSinceStart: UNSUPPORTED_AFTER_MS - 1 })),
    ).toBe("waiting");
  });

  /** Mosquitto's `sys_interval` defaults to ten seconds, so a shorter grace
   * period would call every healthy broker unsupported. */
  it("leaves room for more than one publish interval", () => {
    expect(UNSUPPORTED_AFTER_MS).toBeGreaterThan(10_000);
  });

  it("treats a long enough silence as the answer", () => {
    expect(
      sysDashboardState(input({ msSinceStart: UNSUPPORTED_AFTER_MS })),
    ).toBe("unsupported");
  });

  it("shows data as soon as there is any", () => {
    expect(sysDashboardState(input({ sysTopicCount: 12 }))).toBe("ready");
  });

  /** A broker with a long `sys_interval`, or one that was simply slow, must
   * be able to change the panel's mind. */
  it("lets a late broker turn 'unsupported' back into 'ready'", () => {
    expect(
      sysDashboardState(
        input({ msSinceStart: 10 * UNSUPPORTED_AFTER_MS, sysTopicCount: 3 }),
      ),
    ).toBe("ready");
  });

  /** After a disconnect the last readings are still the answer to "what was
   * this broker doing" - and the header already says the session is gone. */
  it("keeps showing what it read after the session goes", () => {
    expect(
      sysDashboardState(input({ connected: false, sysTopicCount: 12 })),
    ).toBe("ready");
  });
});
