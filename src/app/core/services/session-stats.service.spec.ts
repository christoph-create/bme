import { TestBed } from "@angular/core/testing";
import { Subject } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { MqttEvent } from "../models/mqtt-event.model";
import { MqttEventsService } from "./mqtt-events.service";
import { SessionStatsService } from "./session-stats.service";

const ID = "11111111-1111-1111-1111-111111111111";
const OTHER_ID = "22222222-2222-2222-2222-222222222222";

function setup() {
  const events$ = new Subject<MqttEvent>();

  TestBed.configureTestingModule({
    providers: [{ provide: MqttEventsService, useValue: { events$ } }],
  });

  return { service: TestBed.inject(SessionStatsService), events$ };
}

function received(connectionId: string, topic = "sensors/temp"): MqttEvent {
  return {
    MessageReceived: {
      connection_id: connectionId,
      topic,
      payload: [1, 2, 3],
      payload_len: 3,
      qos: "AtMostOnce",
      retain: false,
    },
  };
}

describe("SessionStatsService", () => {
  it("has nothing to say about a connection that has done nothing", () => {
    const { service } = setup();

    expect(service.statsOf(ID)).toBeNull();
  });

  it("counts each connection separately", () => {
    const { service, events$ } = setup();

    events$.next(received(ID));
    events$.next(received(ID));
    events$.next(received(OTHER_ID));

    expect(service.statsOf(ID)?.messagesIn).toBe(2);
    expect(service.statsOf(OTHER_ID)?.messagesIn).toBe(1);
  });

  it("exposes a connection's counters as a signal", () => {
    const { service, events$ } = setup();
    const stats = service.statsFor(ID);

    expect(stats()).toBeNull();
    events$.next(received(ID));

    expect(stats()?.messagesIn).toBe(1);
  });

  it("starts over on reset and leaves other connections alone", () => {
    const { service, events$ } = setup();
    events$.next(received(ID));
    events$.next(received(OTHER_ID));

    service.reset(ID);

    expect(service.statsOf(ID)?.messagesIn).toBe(0);
    expect(service.statsOf(OTHER_ID)?.messagesIn).toBe(1);
  });

  it("forgets a connection outright", () => {
    const { service, events$ } = setup();
    events$.next(received(ID));

    service.forget(ID);

    expect(service.statsOf(ID)).toBeNull();
  });

  it("counts publishes it is told about", () => {
    const { service } = setup();

    service.recordPublish(ID, 42);

    expect(service.statsOf(ID)?.messagesOut).toBe(1);
    expect(service.statsOf(ID)?.payloadBytesOut).toBe(42);
  });

  /** Every `$SYS` message and every warning passes through; rebuilding the
   * map for them would wake every reader in the app on each one. */
  it("does not touch its state for an event that changed nothing", () => {
    const { service, events$ } = setup();
    events$.next(received(ID));
    const before = service.statsOf(ID);

    events$.next(received(ID, "$SYS/broker/uptime"));
    events$.next({ Warning: { connection_id: ID, message: "too big" } });

    expect(service.statsOf(ID)).toBe(before);
  });

  /** Outside the Tauri webview there is no stream to recover into, so the
   * service has to stop counting rather than throw past its subscriber. */
  it("survives the event stream failing", () => {
    const { service, events$ } = setup();

    expect(() => events$.error(new Error("no IPC bridge"))).not.toThrow();
    expect(service.statsOf(ID)).toBeNull();
  });

  it("stops counting once destroyed", () => {
    const { service, events$ } = setup();
    events$.next(received(ID));

    TestBed.resetTestingModule();
    events$.next(received(ID));

    expect(service.statsOf(ID)?.messagesIn).toBe(1);
  });

  it("times a session from the moment it starts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    try {
      const { service } = setup();

      service.reset(ID);

      expect(service.statsOf(ID)?.startedAt).toBe(Date.now());
      expect(service.statsOf(ID)?.connectedAt).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
