import { TestBed } from "@angular/core/testing";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MqttService } from "./mqtt.service";
import { SessionStatsService } from "./session-stats.service";

const CONNECTION_ID = "11111111-1111-1111-1111-111111111111";

const recordPublish = vi.fn();

/** Through the injector rather than `new`: the service counts what it sends,
 * so it has a dependency now. */
function service(): MqttService {
  return TestBed.inject(MqttService);
}

describe("MqttService", () => {
  beforeEach(() => {
    recordPublish.mockClear();
    TestBed.configureTestingModule({
      providers: [
        { provide: SessionStatsService, useValue: { recordPublish } },
      ],
    });
  });

  afterEach(() => {
    clearMocks();
    TestBed.resetTestingModule();
  });

  it("publishes a message via the publish_message command, sending the payload as bytes", async () => {
    mockIPC((cmd, args) => {
      if (cmd === "publish_message") {
        expect(args).toEqual({
          connectionId: CONNECTION_ID,
          topic: "sensors/temp",
          payload: [1, 2, 3],
          qos: "AtLeastOnce",
          retain: true,
        });
        return null;
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(
      service().publish(
        CONNECTION_ID,
        "sensors/temp",
        Uint8Array.of(1, 2, 3),
        "AtLeastOnce",
        true,
      ),
    ).resolves.toBeUndefined();
  });

  it("sends MQTT 5 properties when given some, and no key at all otherwise", async () => {
    const properties = {
      content_type: "text/plain",
      payload_is_utf8: true,
      message_expiry_interval: null,
      response_topic: null,
      correlation_data: null,
      user_properties: [{ key: "k", value: "v" }],
    };
    mockIPC((cmd, args) => {
      if (cmd === "publish_message") {
        expect(args).toEqual(expect.objectContaining({ properties }));
        return null;
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await service().publish(
      CONNECTION_ID,
      "t",
      Uint8Array.of(1),
      "AtMostOnce",
      false,
      properties,
    );
  });

  it("subscribes to a topic via the subscribe_topic command and resolves the persisted subscription", async () => {
    const subscription = {
      id: "22222222-2222-2222-2222-222222222222",
      connection_id: CONNECTION_ID,
      topic: "sensors/#",
      qos: "ExactlyOnce",
    };
    mockIPC((cmd, args) => {
      if (cmd === "subscribe_topic") {
        expect(args).toEqual({
          connectionId: CONNECTION_ID,
          topic: "sensors/#",
          qos: "ExactlyOnce",
        });
        return subscription;
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(
      service().subscribe(CONNECTION_ID, "sensors/#", "ExactlyOnce"),
    ).resolves.toEqual(subscription);
  });

  it("unsubscribes from a topic via the unsubscribe_topic command", async () => {
    const subscriptionId = "22222222-2222-2222-2222-222222222222";
    mockIPC((cmd, args) => {
      if (cmd === "unsubscribe_topic") {
        expect(args).toEqual({
          connectionId: CONNECTION_ID,
          subscriptionId,
          topic: "sensors/#",
        });
        return null;
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(
      service().unsubscribe(CONNECTION_ID, subscriptionId, "sensors/#"),
    ).resolves.toBeNull();
  });

  it("propagates command errors as rejected promises", async () => {
    mockIPC((cmd) => {
      if (cmd === "publish_message") {
        throw new Error("not connected");
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(
      service().publish(
        CONNECTION_ID,
        "t",
        Uint8Array.of(),
        "AtMostOnce",
        false,
      ),
    ).rejects.toThrow("not connected");
  });

  /** The one door everything the app sends goes through, so the counter sits
   * here rather than at each call site. */
  it("counts what it published, in payload bytes", async () => {
    mockIPC(() => null);

    await service().publish(
      CONNECTION_ID,
      "sensors/temp",
      Uint8Array.of(1, 2, 3, 4),
      "AtMostOnce",
      false,
    );

    expect(recordPublish).toHaveBeenCalledWith(CONNECTION_ID, 4);
  });

  it("does not count a publish the backend rejected", async () => {
    mockIPC(() => {
      throw new Error("not connected");
    });

    await expect(
      service().publish(
        CONNECTION_ID,
        "t",
        Uint8Array.of(1),
        "AtMostOnce",
        false,
      ),
    ).rejects.toThrow("not connected");
    expect(recordPublish).not.toHaveBeenCalled();
  });
});
