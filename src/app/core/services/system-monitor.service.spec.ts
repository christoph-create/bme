import { TestBed } from "@angular/core/testing";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { Subject, of } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MqttEvent } from "../models/mqtt-event.model";
import { StoredMessage } from "../models/stored-message.model";
import { MessageStoreService } from "./message-store.service";
import { MqttEventsService } from "./mqtt-events.service";
import { MqttService } from "./mqtt.service";
import { SystemMonitorService } from "./system-monitor.service";

const ID = "11111111-1111-1111-1111-111111111111";
const OTHER_ID = "22222222-2222-2222-2222-222222222222";
const KEY = `sys.monitor.${ID}`;

/** Lets the `Connected` handler's chain of awaits run to completion - it
 * loads the remembered flags before it can decide anything, so a couple of
 * microtask ticks is not enough. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const MESSAGE: StoredMessage = {
  payload: [1],
  payloadLen: 1,
  qos: "AtMostOnce",
  retain: false,
  properties: null,
  receivedAt: 0,
};

function setup(
  options: {
    rows?: Record<string, string>;
    subscribeSystemTopics?: ReturnType<typeof vi.fn>;
    topics?: readonly string[];
  } = {},
) {
  const rows = options.rows ?? {};
  const subscribeSystemTopics =
    options.subscribeSystemTopics ?? vi.fn().mockResolvedValue(undefined);
  const unsubscribeSystemTopics = vi.fn().mockResolvedValue(undefined);
  const clearTopic = vi.fn();
  const topicsFor = vi
    .fn()
    .mockReturnValue(
      of(new Map((options.topics ?? []).map((t) => [t, [MESSAGE]] as const))),
    );
  const events$ = new Subject<MqttEvent>();
  const settingWrites: { cmd: string; args: unknown }[] = [];

  mockIPC((cmd, args) => {
    if (cmd === "list_app_settings") return rows;
    settingWrites.push({ cmd, args });
    return null;
  });

  TestBed.configureTestingModule({
    providers: [
      { provide: MqttEventsService, useValue: { events$ } },
      { provide: MessageStoreService, useValue: { topicsFor, clearTopic } },
      {
        provide: MqttService,
        useValue: { subscribeSystemTopics, unsubscribeSystemTopics },
      },
    ],
  });

  return {
    service: TestBed.inject(SystemMonitorService),
    events$,
    subscribeSystemTopics,
    unsubscribeSystemTopics,
    clearTopic,
    settingWrites,
  };
}

describe("SystemMonitorService", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    clearMocks();
  });

  it("monitors nothing until told to", async () => {
    const { service } = setup();
    await service.load();

    expect(service.isMonitoring(ID)).toBe(false);
  });

  it("subscribes and remembers when started", async () => {
    const { service, subscribeSystemTopics, settingWrites } = setup();

    await service.start(ID);

    expect(subscribeSystemTopics).toHaveBeenCalledWith(ID);
    expect(service.isMonitoring(ID)).toBe(true);
    expect(settingWrites).toEqual([
      { cmd: "set_app_setting", args: { key: KEY, value: "true" } },
    ]);
  });

  /** A toggle left on with nothing behind it looks exactly like a broker
   * that publishes no `$SYS`, so a refused subscribe must not stay on. */
  it("turns itself back off when the broker refuses, and remembers nothing", async () => {
    const { service, settingWrites } = setup({
      subscribeSystemTopics: vi
        .fn()
        .mockRejectedValue(new Error("Not connected to the broker")),
    });

    await expect(service.start(ID)).rejects.toThrow("Not connected");

    expect(service.isMonitoring(ID)).toBe(false);
    expect(settingWrites).toEqual([]);
  });

  it("unsubscribes, forgets the row and drops what it read when stopped", async () => {
    const { service, unsubscribeSystemTopics, clearTopic, settingWrites } =
      setup({
        topics: [
          "$SYS/broker/uptime",
          "home/livingroom/climate",
          "$SYS/broker/clients/connected",
        ],
      });
    await service.start(ID);
    settingWrites.length = 0;

    await service.stop(ID);

    expect(service.isMonitoring(ID)).toBe(false);
    expect(unsubscribeSystemTopics).toHaveBeenCalledWith(ID);
    expect(settingWrites).toEqual([
      { cmd: "remove_app_setting", args: { key: KEY } },
    ]);
    // Only the broker's own topics - the user's history is not this
    // service's to clear.
    expect(clearTopic.mock.calls).toEqual([
      [ID, "$SYS/broker/uptime"],
      [ID, "$SYS/broker/clients/connected"],
    ]);
  });

  it("reads the remembered flags back", async () => {
    const { service } = setup({
      rows: {
        [KEY]: "true",
        [`sys.monitor.${OTHER_ID}`]: "false",
        "ui.zoom": "1",
      },
    });

    await service.load();

    expect(service.isMonitoring(ID)).toBe(true);
    expect(service.isMonitoring(OTHER_ID)).toBe(false);
  });

  /**
   * The regression this service exists for. An auto-reconnect replays the
   * connection task's own subscription set, but `connect_broker` spawns a
   * fresh task seeded from the database, where `$SYS/#` deliberately is not -
   * so without this the panel silently freezes after a manual reconnect.
   */
  it("re-subscribes every time a session comes up", async () => {
    const { events$, subscribeSystemTopics } = setup({
      rows: { [KEY]: "true" },
    });

    events$.next({ Connected: { connection_id: ID } });
    await flush();
    events$.next({ Connected: { connection_id: ID } });
    await flush();

    expect(subscribeSystemTopics.mock.calls).toEqual([[ID], [ID]]);
  });

  it("leaves connections it is not monitoring alone", async () => {
    const { events$, subscribeSystemTopics } = setup({
      rows: { [KEY]: "true" },
    });

    events$.next({ Connected: { connection_id: OTHER_ID } });
    await flush();

    expect(subscribeSystemTopics).not.toHaveBeenCalled();
  });

  it("does nothing on events that are not a session coming up", async () => {
    const { events$, subscribeSystemTopics } = setup({
      rows: { [KEY]: "true" },
    });

    events$.next({ Disconnected: { connection_id: ID } });
    events$.next({ Warning: { connection_id: ID, message: "too big" } });
    await flush();

    expect(subscribeSystemTopics).not.toHaveBeenCalled();
  });

  /** The user's preference outlives one failed SUBSCRIBE; the panel's own
   * "waiting" state is what tells them nothing is arriving. */
  it("keeps the preference when a re-subscribe fails", async () => {
    const { service, events$ } = setup({
      rows: { [KEY]: "true" },
      subscribeSystemTopics: vi.fn().mockRejectedValue(new Error("gone")),
    });

    events$.next({ Connected: { connection_id: ID } });
    await flush();

    expect(service.isMonitoring(ID)).toBe(true);
  });

  it("drops a deleted broker's row", async () => {
    const { service, settingWrites } = setup();
    await service.start(ID);
    settingWrites.length = 0;

    await service.forget(ID);

    expect(service.isMonitoring(ID)).toBe(false);
    expect(settingWrites).toEqual([
      { cmd: "remove_app_setting", args: { key: KEY } },
    ]);
  });

  it("exposes one connection's state as a signal", async () => {
    const { service } = setup();
    const monitoring = service.monitoringFor(ID);

    expect(monitoring()).toBe(false);
    await service.start(ID);

    expect(monitoring()).toBe(true);
  });
});
