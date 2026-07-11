import { QoS } from "./qos";

/** A received MQTT message as kept in the in-memory session history. */
export interface StoredMessage {
  payload: number[];
  qos: QoS;
  retain: boolean;
  /** `Date.now()` at time of receipt — client-side only, not part of the wire format. */
  receivedAt: number;
}
