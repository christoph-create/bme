import { TestBed } from "@angular/core/testing";
import { Subject, firstValueFrom } from "rxjs";
import { describe, expect, it } from "vitest";

import { MqttEvent, MqttMessageReceived } from "../models/mqtt-event.model";
import {
  MAX_MESSAGES_PER_TOPIC,
  MessageStoreService,
} from "./message-store.service";
import { MqttEventsService } from "./mqtt-events.service";

const CONNECTION_A = "11111111-1111-1111-1111-111111111111";
const CONNECTION_B = "22222222-2222-2222-2222-222222222222";

function setup(maxMessagesPerTopic?: number): {
  events$: Subject<MqttEvent>;
  store: MessageStoreService;
} {
  const events$ = new Subject<MqttEvent>();
  TestBed.configureTestingModule({
    providers: [
      { provide: MqttEventsService, useValue: { events$ } },
      ...(maxMessagesPerTopic === undefined
        ? []
        : [{ provide: MAX_MESSAGES_PER_TOPIC, useValue: maxMessagesPerTopic }]),
    ],
  });
  return { events$, store: TestBed.inject(MessageStoreService) };
}

function messageReceived(
  overrides: Partial<MqttMessageReceived> = {},
): MqttMessageReceived {
  return {
    connection_id: CONNECTION_A,
    topic: "sensors/temp",
    payload: [1, 2, 3],
    qos: "AtLeastOnce",
    retain: false,
    ...overrides,
  };
}

describe("MessageStoreService", () => {
  it("starts empty for a connection/topic that has never received anything", async () => {
    const { store } = setup();

    await expect(
      firstValueFrom(store.messagesFor(CONNECTION_A, "sensors/temp")),
    ).resolves.toEqual([]);
  });

  it("records a received message under its connection and topic", async () => {
    const { events$, store } = setup();

    events$.next({ MessageReceived: messageReceived() });

    const messages = await firstValueFrom(
      store.messagesFor(CONNECTION_A, "sensors/temp"),
    );
    expect(messages).toEqual([
      {
        payload: [1, 2, 3],
        qos: "AtLeastOnce",
        retain: false,
        receivedAt: expect.any(Number),
      },
    ]);
  });

  it("accumulates multiple messages on the same topic in arrival order", async () => {
    const { events$, store } = setup();

    events$.next({ MessageReceived: messageReceived({ payload: [1] }) });
    events$.next({ MessageReceived: messageReceived({ payload: [2] }) });

    const messages = await firstValueFrom(
      store.messagesFor(CONNECTION_A, "sensors/temp"),
    );
    expect(messages.map((m) => m.payload)).toEqual([[1], [2]]);
  });

  it("keeps messages for different topics and connections isolated", async () => {
    const { events$, store } = setup();

    events$.next({
      MessageReceived: messageReceived({ topic: "sensors/temp", payload: [1] }),
    });
    events$.next({
      MessageReceived: messageReceived({
        topic: "sensors/humidity",
        payload: [2],
      }),
    });
    events$.next({
      MessageReceived: messageReceived({
        connection_id: CONNECTION_B,
        topic: "sensors/temp",
        payload: [3],
      }),
    });

    expect(
      (
        await firstValueFrom(store.messagesFor(CONNECTION_A, "sensors/temp"))
      ).map((m) => m.payload),
    ).toEqual([[1]]);
    expect(
      (
        await firstValueFrom(
          store.messagesFor(CONNECTION_A, "sensors/humidity"),
        )
      ).map((m) => m.payload),
    ).toEqual([[2]]);
    expect(
      (
        await firstValueFrom(store.messagesFor(CONNECTION_B, "sensors/temp"))
      ).map((m) => m.payload),
    ).toEqual([[3]]);
  });

  it("ignores Connected and Disconnected events", async () => {
    const { events$, store } = setup();

    events$.next({ Connected: { connection_id: CONNECTION_A } });
    events$.next({ Disconnected: { connection_id: CONNECTION_A } });

    await expect(
      firstValueFrom(store.messagesFor(CONNECTION_A, "sensors/temp")),
    ).resolves.toEqual([]);
  });

  it("does not throw when the underlying event stream errors (e.g. no Tauri bridge available)", async () => {
    const { events$, store } = setup();

    expect(() => events$.error(new Error("no bridge"))).not.toThrow();
    await expect(
      firstValueFrom(store.messagesFor(CONNECTION_A, "sensors/temp")),
    ).resolves.toEqual([]);
  });

  it("caps history per topic, dropping the oldest message first", async () => {
    const { events$, store } = setup(3);

    for (const payload of [[1], [2], [3], [4]]) {
      events$.next({ MessageReceived: messageReceived({ payload }) });
    }

    const messages = await firstValueFrom(
      store.messagesFor(CONNECTION_A, "sensors/temp"),
    );
    expect(messages.map((m) => m.payload)).toEqual([[2], [3], [4]]);
  });

  it("clear() with no arguments empties every connection's history", async () => {
    const { events$, store } = setup();

    events$.next({ MessageReceived: messageReceived() });
    events$.next({
      MessageReceived: messageReceived({ connection_id: CONNECTION_B }),
    });
    store.clear();

    expect(
      await firstValueFrom(store.messagesFor(CONNECTION_A, "sensors/temp")),
    ).toEqual([]);
    expect(
      await firstValueFrom(store.messagesFor(CONNECTION_B, "sensors/temp")),
    ).toEqual([]);
  });

  it("topicsFor starts empty for a connection with no messages", async () => {
    const { store } = setup();

    const topics = await firstValueFrom(store.topicsFor(CONNECTION_A));
    expect(topics.size).toBe(0);
  });

  it("topicsFor reflects every topic received for that connection", async () => {
    const { events$, store } = setup();

    events$.next({
      MessageReceived: messageReceived({ topic: "sensors/temp", payload: [1] }),
    });
    events$.next({
      MessageReceived: messageReceived({
        topic: "sensors/humidity",
        payload: [2],
      }),
    });
    events$.next({
      MessageReceived: messageReceived({
        connection_id: CONNECTION_B,
        topic: "other",
        payload: [9],
      }),
    });

    const topics = await firstValueFrom(store.topicsFor(CONNECTION_A));
    expect([...topics.keys()].sort()).toEqual([
      "sensors/humidity",
      "sensors/temp",
    ]);
    expect(topics.get("sensors/temp")?.map((m) => m.payload)).toEqual([[1]]);
  });

  it("clear(connectionId) empties only that connection's history", async () => {
    const { events$, store } = setup();

    events$.next({ MessageReceived: messageReceived() });
    events$.next({
      MessageReceived: messageReceived({ connection_id: CONNECTION_B }),
    });
    store.clear(CONNECTION_A);

    expect(
      await firstValueFrom(store.messagesFor(CONNECTION_A, "sensors/temp")),
    ).toEqual([]);
    expect(
      (
        await firstValueFrom(store.messagesFor(CONNECTION_B, "sensors/temp"))
      ).length,
    ).toBe(1);
  });

  it("clearTopic() drops one topic and leaves the connection's other topics alone", async () => {
    const { events$, store } = setup();

    events$.next({
      MessageReceived: messageReceived({ topic: "sensors/temp" }),
    });
    events$.next({
      MessageReceived: messageReceived({ topic: "sensors/humidity" }),
    });
    store.clearTopic(CONNECTION_A, "sensors/temp");

    expect(
      await firstValueFrom(store.messagesFor(CONNECTION_A, "sensors/temp")),
    ).toEqual([]);
    expect(
      (
        await firstValueFrom(
          store.messagesFor(CONNECTION_A, "sensors/humidity"),
        )
      ).length,
    ).toBe(1);
  });

  it("clearTopic() removes the topic from topicsFor, so it leaves the tree", async () => {
    const { events$, store } = setup();

    events$.next({
      MessageReceived: messageReceived({ topic: "sensors/temp" }),
    });
    events$.next({
      MessageReceived: messageReceived({ topic: "sensors/humidity" }),
    });
    store.clearTopic(CONNECTION_A, "sensors/temp");

    const topics = await firstValueFrom(store.topicsFor(CONNECTION_A));
    expect([...topics.keys()]).toEqual(["sensors/humidity"]);
  });

  it("clearTopic() leaves the same topic on other connections untouched", async () => {
    const { events$, store } = setup();

    events$.next({ MessageReceived: messageReceived() });
    events$.next({
      MessageReceived: messageReceived({ connection_id: CONNECTION_B }),
    });
    store.clearTopic(CONNECTION_A, "sensors/temp");

    expect(
      (
        await firstValueFrom(store.messagesFor(CONNECTION_B, "sensors/temp"))
      ).length,
    ).toBe(1);
  });

  it("clearTopic() is a no-op for an unknown connection or topic", async () => {
    const { events$, store } = setup();

    events$.next({ MessageReceived: messageReceived() });
    store.clearTopic(CONNECTION_B, "sensors/temp");
    store.clearTopic(CONNECTION_A, "never/seen");

    expect(
      (
        await firstValueFrom(store.messagesFor(CONNECTION_A, "sensors/temp"))
      ).length,
    ).toBe(1);
  });
});
