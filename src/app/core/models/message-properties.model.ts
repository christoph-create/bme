/** Mirrors `core::models::UserProperty`. Duplicate keys are legal. */
export interface UserProperty {
  key: string;
  value: string;
}

/**
 * Mirrors `core::models::MessageProperties` - the MQTT 5 PUBLISH properties
 * the user can set and see. Only ever present on an MQTT 5 connection; a
 * v3.1.1 message carries no properties object at all.
 */
export interface MessageProperties {
  content_type: string | null;
  /** The Payload Format Indicator: set means "this payload is UTF-8 text". */
  payload_is_utf8: boolean;
  /** Seconds until the broker drops an undelivered copy. */
  message_expiry_interval: number | null;
  response_topic: string | null;
  /** Binary on the wire, text here - see the Rust model for why. */
  correlation_data: string | null;
  user_properties: UserProperty[];
}

export function emptyMessageProperties(): MessageProperties {
  return {
    content_type: null,
    payload_is_utf8: false,
    message_expiry_interval: null,
    response_topic: null,
    correlation_data: null,
    user_properties: [],
  };
}

/** True when nothing is set, so a caller can leave the whole object off. */
export function isEmptyMessageProperties(
  properties: MessageProperties,
): boolean {
  return (
    properties.content_type === null &&
    !properties.payload_is_utf8 &&
    properties.message_expiry_interval === null &&
    properties.response_topic === null &&
    properties.correlation_data === null &&
    properties.user_properties.length === 0
  );
}
