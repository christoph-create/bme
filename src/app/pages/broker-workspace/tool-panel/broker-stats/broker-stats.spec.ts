import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionStatsService } from "../../../../core/services/session-stats.service";
import {
  createRateWindow,
  recordInWindow,
} from "../../../../core/stats/rate-window";
import {
  SessionStats,
  emptySessionStats,
} from "../../../../core/stats/session-stats";
import { BrokerStats } from "./broker-stats";

const CONNECTION_ID = "11111111-1111-1111-1111-111111111111";
const START = 1_700_000_000_000;

function stats(overrides: Partial<SessionStats> = {}): SessionStats {
  return { ...emptySessionStats(START), ...overrides };
}

async function setup(session: SessionStats | null) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [BrokerStats],
    providers: [
      {
        provide: SessionStatsService,
        useValue: { statsOf: () => session },
      },
    ],
  });

  const fixture = TestBed.createComponent(BrokerStats);
  fixture.componentRef.setInput("connectionId", CONNECTION_ID);
  fixture.detectChanges();
  return fixture;
}

function tiles(fixture: Awaited<ReturnType<typeof setup>>) {
  return [...fixture.nativeElement.querySelectorAll("app-stat-tile")].map(
    (tile: HTMLElement) => ({
      label: tile.querySelector(".tile-label")?.textContent?.trim(),
      value: tile.querySelector(".tile-value")?.textContent?.trim(),
    }),
  );
}

describe("BrokerStats", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says nothing has been counted before a connection has been made", async () => {
    const fixture = await setup(null);

    expect(fixture.nativeElement.querySelector(".empty").textContent).toContain(
      "Counting starts when you",
    );
    expect(tiles(fixture)).toEqual([]);
  });

  it("shows the session's counters, formatted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START + 12 * 60_000 + 4000);

    const fixture = await setup(
      stats({
        connectedAt: START,
        messagesIn: 12_481,
        payloadBytesIn: 412_000,
        messagesOut: 7,
        reconnects: 2,
      }),
    );

    expect(tiles(fixture)).toEqual([
      { label: "Uptime", value: "12m 04s" },
      { label: "Messages in", value: "12,481" },
      { label: "Payload in", value: "412 KB" },
      { label: "Messages in/s", value: "0/s" },
      { label: "Published", value: "7" },
      { label: "Reconnects", value: "2" },
    ]);
  });

  /** An uptime with no link behind it is the last known value, not a running
   * clock. Dimmed rather than dropped - it still answers "how long did it
   * run". */
  it("marks the uptime stale while the link is down", async () => {
    const down = await setup(stats({ connectedAt: null }));
    expect(down.nativeElement.querySelector(".uptime").classList).toContain(
      "stale",
    );

    const up = await setup(stats({ connectedAt: START }));
    expect(up.nativeElement.querySelector(".uptime").classList).not.toContain(
      "stale",
    );
  });

  it("reads the rate off the window", async () => {
    vi.useFakeTimers();
    // Half a second into the second after the traffic: one complete second
    // has elapsed and it is the one holding the six messages.
    vi.setSystemTime(START + 1500);

    let rate = createRateWindow(START);
    for (let i = 0; i < 6; i++) {
      rate = recordInWindow(rate, START, 10);
    }
    const fixture = await setup(stats({ rate }));

    expect(
      tiles(fixture).find((tile) => tile.label === "Messages in/s")?.value,
    ).toBe("6.0/s");
  });

  it("ranks the busiest topics with a bar each", async () => {
    const fixture = await setup(
      stats({
        messagesIn: 60,
        perTopic: new Map([
          ["home/livingroom/climate", 40],
          ["sensors/flow", 20],
        ]),
      }),
    );

    const rows = [...fixture.nativeElement.querySelectorAll(".busiest-row")];
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector(".busiest-topic").textContent).toContain(
      "home/livingroom/climate",
    );
    expect(rows[0].querySelector(".busiest-fill").style.width).toBe("100%");
    expect(rows[1].querySelector(".busiest-fill").style.width).toBe("50%");
  });

  it("says so when a connected session has seen no traffic", async () => {
    const fixture = await setup(stats({ connectedAt: START }));

    expect(fixture.nativeElement.querySelector(".busiest")).toBeNull();
    expect(fixture.nativeElement.textContent).toContain("No messages yet");
  });

  it("stops ticking once it is gone", async () => {
    vi.useFakeTimers();
    const fixture = await setup(stats({ connectedAt: START }));
    const cleared = vi.spyOn(globalThis, "clearInterval");

    fixture.destroy();

    expect(cleared).toHaveBeenCalled();
  });
});
