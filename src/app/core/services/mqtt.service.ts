import { Injectable, inject } from "@angular/core";
import { invoke } from "@tauri-apps/api/core";

import { Subscription } from "../models/broker-connection.model";
import { MessageProperties } from "../models/message-properties.model";
import { QoS } from "../models/qos";
import { SessionStatsService } from "./session-stats.service";

@Injectable({ providedIn: "root" })
export class MqttService {
  private readonly sessionStats = inject(SessionStatsService);

  async publish(
    connectionId: string,
    topic: string,
    payload: Uint8Array,
    qos: QoS,
    retain: boolean,
    properties: MessageProperties | null = null,
  ): Promise<void> {
    await invoke("publish_message", {
      connectionId,
      topic,
      payload: Array.from(payload),
      qos,
      retain,
      // Left out rather than sent as null: the backend reads an absent
      // argument as `None`, and v3.1.1 connections never have any.
      ...(properties === null ? {} : { properties }),
    });
    // Counted here rather than at the call sites: this is the one door
    // everything the app sends goes through, so repeat publishing and
    // whatever comes next can't forget. After the await, so a rejected
    // publish isn't counted as one that happened.
    this.sessionStats.recordPublish(connectionId, payload.length);
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
