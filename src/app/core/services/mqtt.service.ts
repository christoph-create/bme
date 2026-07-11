import { Injectable } from "@angular/core";
import { invoke } from "@tauri-apps/api/core";

import { QoS } from "../models/qos";

@Injectable({ providedIn: "root" })
export class MqttService {
  publish(
    connectionId: string,
    topic: string,
    payload: Uint8Array,
    qos: QoS,
    retain: boolean,
  ): Promise<void> {
    return invoke("publish_message", {
      connectionId,
      topic,
      payload: Array.from(payload),
      qos,
      retain,
    });
  }

  subscribe(connectionId: string, topic: string, qos: QoS): Promise<void> {
    return invoke("subscribe_topic", { connectionId, topic, qos });
  }
}
