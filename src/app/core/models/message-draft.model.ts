import { MessageFormat } from "./message-format.model";
import { MessageProperties } from "./message-properties.model";
import { QoS } from "./qos";

/** A publish-panel draft's shape - what's carried into a "save as template"
 * or back out of a "load template" action. */
export interface MessageDraft {
  topic: string;
  payload: string;
  format: MessageFormat;
  qos: QoS;
  retain: boolean;
  /** MQTT 5 properties, when the draft came from a v5 message or panel.
   * Optional because templates don't carry them (yet): a draft saved as a
   * template drops them, and one loaded from a template has none. */
  properties?: MessageProperties;
}
