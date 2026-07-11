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
});
