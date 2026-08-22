import { QoS } from "./qos";

/** A received MQTT message as kept in the in-memory session history. */
export interface StoredMessage {
  /** Capped by the backend at 256 KiB, so it can be shorter than `payloadLen`. */
  payload: number[];
  /** What the message really weighed on the wire. */
  payloadLen: number;
  qos: QoS;
  retain: boolean;
  /** `Date.now()` at time of receipt — client-side only, not part of the wire format. */
  receivedAt: number;
}
