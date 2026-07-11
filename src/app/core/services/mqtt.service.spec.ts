import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";

import { MqttService } from "./mqtt.service";

const CONNECTION_ID = "11111111-1111-1111-1111-111111111111";

describe("MqttService", () => {
  afterEach(() => {
    clearMocks();
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
      new MqttService().publish(
        CONNECTION_ID,
        "sensors/temp",
        Uint8Array.of(1, 2, 3),
        "AtLeastOnce",
        true,
      ),
    ).resolves.toBeNull();
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
      new MqttService().subscribe(CONNECTION_ID, "sensors/#", "ExactlyOnce"),
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
      new MqttService().unsubscribe(CONNECTION_ID, subscriptionId, "sensors/#"),
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
      new MqttService().publish(
        CONNECTION_ID,
        "t",
        Uint8Array.of(),
        "AtMostOnce",
        false,
      ),
    ).rejects.toThrow("not connected");
  });
});
