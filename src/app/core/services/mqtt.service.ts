import { Injectable } from "@angular/core";
import { invoke } from "@tauri-apps/api/core";

import { Subscription } from "../models/broker-connection.model";
import { MessageProperties } from "../models/message-properties.model";
import { QoS } from "../models/qos";

@Injectable({ providedIn: "root" })
export class MqttService {
  publish(
    connectionId: string,
    topic: string,
    payload: Uint8Array,
    qos: QoS,
    retain: boolean,
    properties: MessageProperties | null = null,
  ): Promise<void> {
    return invoke("publish_message", {
      connectionId,
      topic,
      payload: Array.from(payload),
      qos,
      retain,
      // Left out rather than sent as null: the backend reads an absent
      // argument as `None`, and v3.1.1 connections never have any.
      ...(properties === null ? {} : { properties }),
    });
  }

  subscribe(
    connectionId: string,
    topic: string,
    qos: QoS,
  ): Promise<Subscription> {
    return invoke("subscribe_topic", { connectionId, topic, qos });
  }

  unsubscribe(
    connectionId: string,
    subscriptionId: string,
    topic: string,
  ): Promise<void> {
    return invoke("unsubscribe_topic", { connectionId, subscriptionId, topic });
  }
}
