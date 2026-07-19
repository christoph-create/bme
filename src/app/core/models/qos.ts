/** Mirrors `core::models::QoS` (serde's default unit-enum representation). */
export type QoS = "AtMostOnce" | "AtLeastOnce" | "ExactlyOnce";

const QOS_NUMBERS: Record<QoS, 0 | 1 | 2> = {
  AtMostOnce: 0,
  AtLeastOnce: 1,
  ExactlyOnce: 2,
};

/** The numeric MQTT QoS level (0/1/2), as conventionally displayed in the UI. */
export function qosNumber(qos: QoS): 0 | 1 | 2 {
  return QOS_NUMBERS[qos];
}

const QOS_FROM_NUMBER: Record<0 | 1 | 2, QoS> = {
  0: "AtMostOnce",
  1: "AtLeastOnce",
  2: "ExactlyOnce",
};

/** Inverse of {@link qosNumber} - turns a wire-level MQTT QoS number back
 * into the app's internal enum, e.g. when importing an exported template. */
export function qosFromNumber(qos: 0 | 1 | 2): QoS {
  return QOS_FROM_NUMBER[qos];
}
