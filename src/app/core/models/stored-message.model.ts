import { MessageProperties } from "./message-properties.model";
import { QoS } from "./qos";

/**
 * A received MQTT message as kept in the in-memory session history.
 *
 * There is no id field, and `receivedAt` is `Date.now()`, which collides
 * under load - so the **object reference is this type's de-facto identity**.
 * `MessageStoreService.append` preserves it across every emission, and the
 * message stream's row heights, value-chart-card's parse cache and the
 * compare tool's pin all key on it. Anything that rebuilds these objects on
 * the way out of the store breaks all three at once.
 */
export interface StoredMessage {
  /** Capped by the backend at 256 KiB, so it can be shorter than `payloadLen`. */
  payload: number[];
  /** What the message really weighed on the wire. */
  payloadLen: number;
  qos: QoS;
  retain: boolean;
  /** The MQTT 5 properties it arrived with, or null - v3.1.1 messages and
   * property-less v5 ones look the same here. */
  properties: MessageProperties | null;
  /** `Date.now()` at time of receipt — client-side only, not part of the wire format. */
  receivedAt: number;
}
