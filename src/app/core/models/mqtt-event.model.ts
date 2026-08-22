import { QoS } from "./qos";

/** Mirrors the `MessageReceived` variant's payload. */
export interface MqttMessageReceived {
  connection_id: string;
  topic: string;
  /** Capped by the backend at 256 KiB, so this can be shorter than
   * `payload_len` - see `MAX_IPC_PAYLOAD_BYTES` in `core/src/mqtt/port.rs`. */
  payload: number[];
  /** The payload's real length on the wire, whatever made it across. */
  payload_len: number;
  qos: QoS;
  retain: boolean;
}

/** Mirrors the `Warning` variant's payload: something the user should know
 * about that the session survived, so it must not change the status. */
export interface MqttWarning {
  connection_id: string;
  message: string;
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
  | { Disconnected: { connection_id: string; reason?: string } }
  | { Reconnecting: MqttReconnecting }
  | { Warning: MqttWarning }
  | { MessageReceived: MqttMessageReceived };
