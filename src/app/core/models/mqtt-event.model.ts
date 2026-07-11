import { QoS } from "./qos";

/** Mirrors the `MessageReceived` variant's payload. */
export interface MqttMessageReceived {
  connection_id: string;
  topic: string;
  payload: number[];
  qos: QoS;
  retain: boolean;
}

/**
 * Mirrors `core::mqtt::port::MqttEvent`, serialized externally-tagged
 * (serde's default for a data-carrying enum): `{ "VariantName": { ...fields } }`.
 */
export type MqttEvent =
  | { Connected: { connection_id: string } }
  | { Disconnected: { connection_id: string } }
  | { MessageReceived: MqttMessageReceived };
