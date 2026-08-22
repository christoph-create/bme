import { BrokerScheme } from "../models/broker-connection.model";

/** Every scheme, in the order the form offers them. */
export const BROKER_SCHEMES: readonly BrokerScheme[] = [
  "mqtt",
  "mqtts",
  "ws",
  "wss",
];

/** Where brokers serve MQTT-over-WebSocket when nobody says otherwise. */
export const DEFAULT_WS_PATH = "/mqtt";

/**
 * The port the form starts at for a freshly picked scheme. These match
 * `BrokerScheme::default_port` on the Rust side; managed brokers vary (HiveMQ
 * Cloud is 8884), so they are a starting point rather than a rule.
 */
export function defaultPortFor(scheme: BrokerScheme): number {
  switch (scheme) {
    case "mqtt":
      return 1883;
    case "mqtts":
      return 8883;
    case "ws":
      return 8083;
    case "wss":
      return 8084;
  }
}

export function isTls(scheme: BrokerScheme): boolean {
  return scheme === "mqtts" || scheme === "wss";
}

export function isWebSocket(scheme: BrokerScheme): boolean {
  return scheme === "ws" || scheme === "wss";
}

/**
 * The endpoint as one line, which is how people paste broker addresses to each
 * other. Assembled the same way the backend assembles the address it hands
 * rumqttc, so what the form shows is what the connection will actually dial -
 * including the path defaulting and the missing leading slash.
 *
 * `port` is a string because the form holds numbers as text; a half-typed port
 * is shown as-is rather than as `NaN`.
 */
export function brokerUrl(
  scheme: BrokerScheme,
  host: string,
  port: number | string,
  wsPath: string | null = null,
): string {
  const authority = `${host || "…"}:${port === "" ? "…" : port}`;
  if (!isWebSocket(scheme)) {
    return `${scheme}://${authority}`;
  }
  return `${scheme}://${authority}${normalizeWsPath(wsPath)}`;
}

/**
 * Unset, blank and a bare slash all mean the conventional default, and a path
 * typed without its leading slash still addresses the endpoint the user meant.
 * Mirrors `transport::ws_path` in the backend.
 */
export function normalizeWsPath(path: string | null | undefined): string {
  const trimmed = (path ?? "").trim();
  if (trimmed === "" || trimmed === "/") {
    return DEFAULT_WS_PATH;
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/**
 * The last segment of a certificate path, for showing a picked file without
 * the directory it came from. Handles both separators, since a path typed on
 * Windows can end up in a database opened on Linux.
 */
export function certificateName(path: string | null): string | null {
  if (path === null || path.trim() === "") {
    return null;
  }
  const segments = path.split(/[\\/]/);
  return segments[segments.length - 1] || path;
}
