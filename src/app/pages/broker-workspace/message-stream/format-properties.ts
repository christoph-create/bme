import { MessageProperties } from "../../../core/models/message-properties.model";

/** One line of the properties block under a card's meta row. */
export interface PropertyRow {
  readonly label: string;
  readonly value: string;
  /** A user property, as opposed to one of the standard ones - shown with
   * the key as its label, which is why the two need telling apart. */
  readonly user: boolean;
}

/**
 * The properties a received message carried, as display rows in a fixed
 * order: the standard ones first, then user properties in the order the
 * sender wrote them. Empty for a message without properties, which is also
 * every v3.1.1 message - the template renders nothing for an empty list.
 */
export function formatPropertyRows(
  properties: MessageProperties | null,
): PropertyRow[] {
  if (properties === null) {
    return [];
  }
  const rows: PropertyRow[] = [];
  if (properties.content_type !== null) {
    rows.push(standard("Content type", properties.content_type));
  }
  if (properties.payload_is_utf8) {
    rows.push(standard("Payload format", "UTF-8 text"));
  }
  if (properties.message_expiry_interval !== null) {
    rows.push(
      standard("Expires", formatExpiry(properties.message_expiry_interval)),
    );
  }
  if (properties.response_topic !== null) {
    rows.push(standard("Response topic", properties.response_topic));
  }
  if (properties.correlation_data !== null) {
    rows.push(standard("Correlation data", properties.correlation_data));
  }
  for (const property of properties.user_properties) {
    rows.push({ label: property.key, value: property.value, user: true });
  }
  return rows;
}

function standard(label: string, value: string): PropertyRow {
  return { label, value, user: false };
}

/** Seconds as the sender set them, in the unit that reads most naturally.
 * Whole minutes and hours only: "90 s" is clearer than "1.5 min". */
function formatExpiry(seconds: number): string {
  if (seconds >= 3600 && seconds % 3600 === 0) {
    return `${seconds / 3600} h`;
  }
  if (seconds >= 60 && seconds % 60 === 0) {
    return `${seconds / 60} min`;
  }
  return `${seconds} s`;
}
