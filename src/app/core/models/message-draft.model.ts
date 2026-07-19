import { MessageFormat } from "./message-format.model";
import { QoS } from "./qos";

/** A publish-panel draft's shape - what's carried into a "save as template"
 * or back out of a "load template" action. */
export interface MessageDraft {
  topic: string;
  payload: string;
  format: MessageFormat;
  qos: QoS;
  retain: boolean;
}
