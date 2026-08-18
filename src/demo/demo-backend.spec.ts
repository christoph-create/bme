import { invoke } from "@tauri-apps/api/core";
import { clearMocks } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BrokerConnection } from "../app/core/models/broker-connection.model";
import { FavoriteMessage } from "../app/core/models/favorite-message.model";
import { MqttEvent } from "../app/core/models/mqtt-event.model";
import { installDemoBackend } from "./demo-backend";
import {
  DEMO_CONNECTIONS,
  DEMO_TIMELINE,
  DEMO_TIMELINES,
  HOME_CONNECTION_ID,
  OFFICE_CONNECTION_ID,
} from "./demo-data";

/** Lets the async `listen()` IPC round-trip finish before anything emits. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("installDemoBackend", () => {
  beforeEach(() => {
    installDemoBackend();
  });

  afterEach(() => {
    clearMocks();
  });

  it("serves the fixture's connections", async () => {
    const connections = await invoke<BrokerConnection[]>("list_connections");

    expect(connections.map((c) => c.name)).toEqual(
      DEMO_CONNECTIONS.map((c) => c.name),
    );
  });

  it("persists a created template into subsequent listings", async () => {
    const before = await invoke<FavoriteMessage[]>("list_favorites");

    await invoke("create_favorite", {
      newFavorite: {
        collection_id: null,
        name: "Ad hoc",
        description: null,
        topic: "demo/topic",
        payload: "{}",
        format: "json",
        qos: "AtMostOnce",
        retain: false,
      },
    });
    const after = await invoke<FavoriteMessage[]>("list_favorites");

    expect(after).toHaveLength(before.length + 1);
    expect(after[0].name).toBe("Ad hoc");
  });

  it("replays the timeline as mqtt-events on the given connection", async () => {
    const { listen } = await import("@tauri-apps/api/event");
    const received: MqttEvent[] = [];
    await listen<MqttEvent>("mqtt-event", (event) => received.push(event.payload));
    await flushMicrotasks();

    await window.__bmeDemo.playTimeline(HOME_CONNECTION_ID);

    expect(received).toHaveLength(DEMO_TIMELINE.length);
    const first = received[0];
    expect("MessageReceived" in first && first.MessageReceived.topic).toBe(
      DEMO_TIMELINE[0].topic,
    );
  });

  /** A shot with two tabs open should not show the same stream twice. */
  it("replays each connection's own timeline", async () => {
    const { listen } = await import("@tauri-apps/api/event");
    const topics: string[] = [];
    await listen<MqttEvent>("mqtt-event", (event) => {
      if ("MessageReceived" in event.payload) {
        topics.push(event.payload.MessageReceived.topic);
      }
    });
    await flushMicrotasks();

    await window.__bmeDemo.playTimeline(OFFICE_CONNECTION_ID);

    expect(topics).toEqual(
      DEMO_TIMELINES[OFFICE_CONNECTION_ID].map((message) => message.topic),
    );
    expect(topics).not.toEqual(DEMO_TIMELINE.map((message) => message.topic));
  });

  it("falls back to the home timeline for a connection with none of its own", async () => {
    const { listen } = await import("@tauri-apps/api/event");
    const received: MqttEvent[] = [];
    await listen<MqttEvent>("mqtt-event", (event) => received.push(event.payload));
    await flushMicrotasks();

    await window.__bmeDemo.playTimeline("no-timeline-of-its-own");

    expect(received).toHaveLength(DEMO_TIMELINE.length);
  });

  it("rejects a command it does not implement, rather than resolving to undefined", async () => {
    await expect(invoke("no_such_command")).rejects.toThrow(
      /unhandled command/,
    );
  });
});
