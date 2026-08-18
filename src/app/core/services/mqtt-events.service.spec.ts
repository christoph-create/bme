import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";

import { MqttEvent } from "../models/mqtt-event.model";
import { MqttEventsService } from "./mqtt-events.service";

/** Lets the async `listen()` IPC round-trip finish before we `emit()` in a test. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("MqttEventsService", () => {
  afterEach(() => {
    clearMocks();
  });

  it("delivers mqtt-event payloads emitted from the backend", async () => {
    mockIPC(() => undefined, { shouldMockEvents: true });
    const received: MqttEvent[] = [];
    const subscription = new MqttEventsService().events$.subscribe((event) =>
      received.push(event),
    );
    await flushMicrotasks();

    const payload: MqttEvent = { Connected: { connection_id: "abc" } };
    await emit("mqtt-event", payload);

    expect(received).toEqual([payload]);
    subscription.unsubscribe();
  });

  it("ignores events published under a different name", async () => {
    mockIPC(() => undefined, { shouldMockEvents: true });
    const received: MqttEvent[] = [];
    const subscription = new MqttEventsService().events$.subscribe((event) =>
      received.push(event),
    );
    await flushMicrotasks();

    await emit("some-other-event", { Connected: { connection_id: "abc" } });

    expect(received).toEqual([]);
    subscription.unsubscribe();
  });

  it("stops delivering events once unsubscribed", async () => {
    mockIPC(() => undefined, { shouldMockEvents: true });
    const received: MqttEvent[] = [];
    const subscription = new MqttEventsService().events$.subscribe((event) =>
      received.push(event),
    );
    await flushMicrotasks();

    subscription.unsubscribe();
    await flushMicrotasks();
    await emit("mqtt-event", { Disconnected: { connection_id: "abc" } });

    expect(received).toEqual([]);
  });

  /** Proof that there is one backend listener rather than one per subscriber:
   * a second subscriber is live straight away, without waiting for a `listen()`
   * round-trip of its own. */
  it("attaches later subscribers to the listener that is already open", async () => {
    mockIPC(() => undefined, { shouldMockEvents: true });
    const service = new MqttEventsService();
    const first = service.events$.subscribe();
    await flushMicrotasks();

    const received: MqttEvent[] = [];
    const second = service.events$.subscribe((event) => received.push(event));
    const payload: MqttEvent = { Connected: { connection_id: "abc" } };
    await emit("mqtt-event", payload);

    expect(received).toEqual([payload]);
    first.unsubscribe();
    second.unsubscribe();
  });

  it("delivers every event to every subscriber", async () => {
    mockIPC(() => undefined, { shouldMockEvents: true });
    const service = new MqttEventsService();
    const first: MqttEvent[] = [];
    const second: MqttEvent[] = [];
    const subscriptions = [
      service.events$.subscribe((event) => first.push(event)),
      service.events$.subscribe((event) => second.push(event)),
    ];
    await flushMicrotasks();

    const payload: MqttEvent = { Connected: { connection_id: "abc" } };
    await emit("mqtt-event", payload);

    expect(first).toEqual([payload]);
    expect(second).toEqual([payload]);
    subscriptions.forEach((subscription) => subscription.unsubscribe());
  });

  /** The listener is torn down with the last subscriber, so a later one has to
   * open a fresh one rather than sit on a dead channel. */
  it("reopens the listener for a subscriber that arrives after the last one left", async () => {
    mockIPC(() => undefined, { shouldMockEvents: true });
    const service = new MqttEventsService();
    service.events$.subscribe().unsubscribe();
    await flushMicrotasks();

    const received: MqttEvent[] = [];
    const subscription = service.events$.subscribe((event) =>
      received.push(event),
    );
    await flushMicrotasks();
    const payload: MqttEvent = { Connected: { connection_id: "abc" } };
    await emit("mqtt-event", payload);

    expect(received).toEqual([payload]);
    subscription.unsubscribe();
  });
});
