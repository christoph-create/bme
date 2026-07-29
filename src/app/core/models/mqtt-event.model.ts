import { QoS } from "./qos";

/** Mirrors the `MessageReceived` variant's payload. */
export interface MqttMessageReceived {
  connection_id: string;
  topic: string;
  payload: number[];
  qos: QoS;
  retain: boolean;
}

/** Mirrors the `Reconnecting` variant's payload. `attempt` is 1-based. */
export interface MqttReconnecting {
  connection_id: string;
  attempt: number;
  max_attempts: number;
  delay_ms: number;
}

/**
 * Mirrors `core::mqtt::port::MqttEvent`, serialized externally-tagged
 * (serde's default for a data-carrying enum): `{ "VariantName": { ...fields } }`.
 */
export type MqttEvent =
  | { Connected: { connection_id: string } }
  | { Disconnected: { connection_id: string } }
  | { Reconnecting: MqttReconnecting }
  | { MessageReceived: MqttMessageReceived };
