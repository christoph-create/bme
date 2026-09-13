import {
  MessageProperties,
  UserProperty,
} from "../../../core/models/message-properties.model";

/**
 * The properties editor's raw value. Text fields are held as typed - blank
 * means unset - and the expiry is a string because that's what an `<input>`
 * gives back; `formToProperties` is where it becomes a number or nothing.
 */
export interface PublishPropertiesForm {
  contentType: string;
  responseTopic: string;
  correlationData: string;
  messageExpiry: string;
  payloadIsUtf8: boolean;
  userProperties: UserProperty[];
}

export function emptyPublishPropertiesForm(): PublishPropertiesForm {
  return {
    contentType: "",
    responseTopic: "",
    correlationData: "",
    messageExpiry: "",
    payloadIsUtf8: false,
    userProperties: [],
  };
}

/**
 * Form value to what goes on the wire, or `null` when nothing is set so the
 * publish call can leave the argument out entirely. Blank text fields become
 * null; user-property rows with a blank key are dropped rather than sent as
 * `"": value`, which is what an abandoned "+ Add" row would otherwise be.
 */
export function formToProperties(
  form: PublishPropertiesForm,
): MessageProperties | null {
  const properties: MessageProperties = {
    content_type: blankToNull(form.contentType),
    payload_is_utf8: form.payloadIsUtf8,
    message_expiry_interval: parseExpiry(form.messageExpiry),
    response_topic: blankToNull(form.responseTopic),
    correlation_data: blankToNull(form.correlationData),
    user_properties: form.userProperties
      .map((property) => ({ key: property.key.trim(), value: property.value }))
      .filter((property) => property.key !== ""),
  };

  const isEmpty =
    properties.content_type === null &&
    !properties.payload_is_utf8 &&
    properties.message_expiry_interval === null &&
    properties.response_topic === null &&
    properties.correlation_data === null &&
    properties.user_properties.length === 0;
  return isEmpty ? null : properties;
}

/** The other direction, for loading a draft. `null`/`undefined` clears the
 * editor: a draft with no properties means none, not "keep the old ones". */
export function propertiesToForm(
  properties: MessageProperties | null | undefined,
): PublishPropertiesForm {
  if (properties === null || properties === undefined) {
    return emptyPublishPropertiesForm();
  }
  return {
    contentType: properties.content_type ?? "",
    responseTopic: properties.response_topic ?? "",
    correlationData: properties.correlation_data ?? "",
    messageExpiry:
      properties.message_expiry_interval === null
        ? ""
        : String(properties.message_expiry_interval),
    payloadIsUtf8: properties.payload_is_utf8,
    userProperties: properties.user_properties.map((property) => ({
      ...property,
    })),
  };
}

/** What the chip on the publish layer says, or `null` when there is nothing
 * to say. Counts what would actually be sent, so an empty "+ Add" row does
 * not show up as a property. */
export function propertiesSummaryLabel(
  form: PublishPropertiesForm,
): string | null {
  const properties = formToProperties(form);
  if (properties === null) {
    return null;
  }
  const count =
    Number(properties.content_type !== null) +
    Number(properties.payload_is_utf8) +
    Number(properties.message_expiry_interval !== null) +
    Number(properties.response_topic !== null) +
    Number(properties.correlation_data !== null) +
    properties.user_properties.length;
  return count === 1 ? "1 property" : `${count} properties`;
}

/** The Message Expiry Interval is a four-byte unsigned integer of seconds.
 * Anything that isn't one - blank, negative, fractional, text - is treated as
 * unset rather than rejected, since the field is optional to begin with. */
function parseExpiry(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const seconds = Number(trimmed);
  return seconds <= 0xffff_ffff ? seconds : null;
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
