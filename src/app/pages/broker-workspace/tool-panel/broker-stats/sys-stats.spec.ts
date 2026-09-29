import { TestBed } from "@angular/core/testing";
import { of } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StoredMessage } from "../../../../core/models/stored-message.model";
import { MessageStoreService } from "../../../../core/services/message-store.service";
import { SystemMonitorService } from "../../../../core/services/system-monitor.service";
import { UNSUPPORTED_AFTER_MS } from "./sys-dashboard-state";
import { SysStats } from "./sys-stats";

const CONNECTION_ID = "11111111-1111-1111-1111-111111111111";

function message(text: string): StoredMessage {
  const payload = [...new TextEncoder().encode(text)];
  return {
    payload,
    payloadLen: payload.length,
    qos: "AtMostOnce",
    retain: false,
    properties: null,
    receivedAt: 0,
  };
}

/** A topic with one reading, or several for a sparkline. */
function topic(...values: string[]): readonly StoredMessage[] {
  return values.map(message);
}

async function setup(
  options: {
    monitoring?: boolean;
    connected?: boolean;
    topics?: Record<string, readonly StoredMessage[]>;
    start?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const start = options.start ?? vi.fn().mockResolvedValue(undefined);
  const stop = vi.fn().mockResolvedValue(undefined);
  const monitor = {
    isMonitoring: () => options.monitoring ?? false,
    start,
    stop,
  };
  const topicsFor = vi
    .fn()
    .mockReturnValue(of(new Map(Object.entries(options.topics ?? {}))));

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [SysStats],
    providers: [
      { provide: SystemMonitorService, useValue: monitor },
      { provide: MessageStoreService, useValue: { topicsFor } },
    ],
  });

  const fixture = TestBed.createComponent(SysStats);
  fixture.componentRef.setInput("connectionId", CONNECTION_ID);
  fixture.componentRef.setInput("connected", options.connected ?? true);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, start, stop };
}

function text(fixture: { nativeElement: HTMLElement }): string {
  return fixture.nativeElement.textContent ?? "";
}

describe("SysStats", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("explains itself and offers the switch when not monitoring", async () => {
    const { fixture } = await setup();

    expect(text(fixture)).toContain("Not saved to your subscriptions");
    expect(
      fixture.nativeElement.querySelector(".toggle-link").textContent.trim(),
    ).toBe("Monitor");
  });

  /** There is nothing to subscribe over, and the command would refuse. The
   * explainer stays: what the switch does is still the useful message. */
  it("cannot be switched on without a session", async () => {
    const { fixture } = await setup({ connected: false });

    expect(
      fixture.nativeElement.querySelector(".toggle-link").classList,
    ).toContain("disabled");
    expect(text(fixture)).toContain("Not saved to your subscriptions");
  });

  /** Only once monitoring is on does a missing session become the thing
   * worth saying - before that, the switch is the story. */
  it("says what is missing when monitoring is on but the session is not", async () => {
    const { fixture } = await setup({ monitoring: true, connected: false });

    expect(text(fixture)).toContain("Connect to read");
  });

  it("waits before drawing a conclusion about a quiet broker", async () => {
    const { fixture } = await setup({ monitoring: true });

    expect(text(fixture)).toContain("Waiting for");
  });

  /** Mosquitto's `sys_interval` defaults to ten seconds, so silence only
   * becomes an answer after a grace period - and it names both causes,
   * because a `$SYS` ACL is otherwise baffling. */
  it("names both reasons once the silence has gone on long enough", async () => {
    vi.useFakeTimers();
    const { fixture } = await setup({ monitoring: true });

    vi.advanceTimersByTime(UNSUPPORTED_AFTER_MS + 1000);
    fixture.detectChanges();

    expect(text(fixture)).toContain("may not publish it");
    expect(text(fixture)).toContain("not be permitted to read it");
  });

  it("labels and formats what the broker published", async () => {
    const { fixture } = await setup({
      monitoring: true,
      topics: {
        "$SYS/broker/version": topic("mosquitto version 2.0.18"),
        "$SYS/broker/uptime": topic("91240 seconds"),
        "$SYS/broker/clients/connected": topic("17"),
        "home/livingroom/climate": topic('{"temperature":21.5}'),
      },
    });

    const tiles = [
      ...fixture.nativeElement.querySelectorAll("app-stat-tile"),
    ].map((tile: HTMLElement) => [
      tile.querySelector(".tile-label")?.textContent?.trim(),
      tile.querySelector(".tile-value")?.textContent?.trim(),
    ]);
    expect(tiles).toEqual([
      ["Version", "mosquitto version 2.0.18"],
      ["Broker uptime", "1d 1h"],
      ["Connected", "17"],
    ]);
    // The user's own topics are none of this section's business.
    expect(text(fixture)).not.toContain("temperature");
  });

  /** An EMQX tree reaches the same tiles as mosquitto's, with no code that
   * knows either broker's name - that is what the normalise-then-classify
   * layers are for. */
  it("reads a broker with a completely different tree", async () => {
    const { fixture } = await setup({
      monitoring: true,
      topics: {
        "$SYS/brokers/emqx@127.0.0.1/version": topic("5.4.1"),
        "$SYS/brokers/emqx@127.0.0.1/uptime": topic("91240"),
        "$SYS/brokers/emqx@127.0.0.1/stats/connections/count": topic("17"),
      },
    });

    const tiles = [
      ...fixture.nativeElement.querySelectorAll("app-stat-tile"),
    ].map((tile: HTMLElement) => [
      tile.querySelector(".tile-label")?.textContent?.trim(),
      tile.querySelector(".tile-value")?.textContent?.trim(),
    ]);
    expect(tiles).toEqual([
      ["Version", "5.4.1"],
      ["Broker uptime", "1d 1h"],
      ["Connected", "17"],
    ]);
  });

  /** Anything not promoted to a tile is still grouped and labelled, behind a
   * toggle per group - collapsed, because a broker can publish a hundred of
   * them. */
  it("puts the rest behind a toggle per group", async () => {
    const { fixture } = await setup({
      monitoring: true,
      topics: {
        "$SYS/broker/clients/expired": topic("4"),
        "$SYS/broker/load/messages/sent/5min": topic("14.16"),
      },
    });

    const toggles = [
      ...fixture.nativeElement.querySelectorAll(".group-toggle"),
    ].map((el: HTMLElement) => el.textContent?.replace(/\s+/g, " ").trim());
    expect(toggles).toEqual(["› Clients (1)", "› Load (1)"]);
    expect(fixture.nativeElement.querySelector(".readings")).toBeNull();

    fixture.nativeElement.querySelector(".group-toggle").click();
    fixture.detectChanges();

    expect(text(fixture)).toContain("Clients expired");
    expect(text(fixture)).toContain("4");
  });

  /** The difference between "we don't support this broker" and a blank
   * panel. */
  it("says so when it recognises none of what a broker sent", async () => {
    const { fixture } = await setup({
      monitoring: true,
      topics: { "$SYS/vendor/flux/capacitance": topic("1.21") },
    });

    expect(text(fixture)).toContain("doesn't recognise this broker");

    fixture.nativeElement.querySelector(".group-toggle").click();
    fixture.detectChanges();

    expect(text(fixture)).toContain("Vendor flux capacitance");
  });

  it("draws a sparkline where the shape says more than the number", async () => {
    const { fixture } = await setup({
      monitoring: true,
      topics: {
        "$SYS/broker/clients/connected": topic("12", "14", "17"),
        "$SYS/broker/version": topic("mosquitto version 2.0.18"),
      },
    });

    // One chart, on the reading that has a history worth a shape.
    expect(fixture.nativeElement.querySelectorAll(".spark")).toHaveLength(1);
  });

  it("starts monitoring when the switch is used", async () => {
    const { fixture, start } = await setup();

    fixture.nativeElement.querySelector(".toggle-link").click();
    await fixture.whenStable();

    expect(start).toHaveBeenCalledWith(CONNECTION_ID);
  });

  it("stops monitoring when the switch is used again", async () => {
    const { fixture, stop } = await setup({ monitoring: true });

    fixture.nativeElement.querySelector(".toggle-link").click();
    await fixture.whenStable();

    expect(stop).toHaveBeenCalledWith(CONNECTION_ID);
  });

  /** A refused subscribe has to be said out loud, or the panel just sits
   * there looking like a broker with no `$SYS`. */
  it("reports a refusal rather than swallowing it", async () => {
    const { fixture } = await setup({
      start: vi
        .fn()
        .mockRejectedValue(new Error("Not connected to the broker")),
    });

    fixture.nativeElement.querySelector(".toggle-link").click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector(".sys-error").textContent,
    ).toContain("Not connected");
  });

  it("stops ticking once it is gone", async () => {
    vi.useFakeTimers();
    const { fixture } = await setup({ monitoring: true });
    const cleared = vi.spyOn(globalThis, "clearInterval");

    fixture.destroy();

    expect(cleared).toHaveBeenCalled();
  });
});
