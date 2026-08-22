import {
  BrokerConnection,
  BrokerScheme,
  UpdateBrokerConnection,
} from "../../core/models/broker-connection.model";

/**
 * The form's raw value. Numbers are held as strings because that's what an
 * `<input>` gives back, and the pattern validators check them as text before
 * anything converts them.
 */
export interface ConnectionFormValue {
  name: string;
  scheme: BrokerScheme;
  host: string;
  port: string;
  wsPath: string;
  clientId: string;
  keepAliveSecs: string;
  autoReconnect: boolean;
  maxReconnectAttempts: string;
  requiresAuth: boolean;
  username: string;
  password: string;
  caCertPath: string;
  clientCertPath: string;
  clientKeyPath: string;
  alpn: string;
  skipCertVerification: boolean;
}

/**
 * Form value to the shape the backend takes. The optional text fields become
 * `null` rather than `""` when they're blank: the Rust side treats them as
 * `Option<String>`, and an empty string there would read as "the user picked a
 * file whose path is nothing" rather than "no file".
 */
export function formValueToConnection(
  value: ConnectionFormValue,
): UpdateBrokerConnection {
  return {
    name: value.name,
    host: value.host.trim(),
    port: Number(value.port),
    client_id: value.clientId,
    username: value.requiresAuth ? value.username : null,
    password: value.requiresAuth ? value.password : null,
    scheme: value.scheme,
    // The path only means anything for the WebSocket schemes, so switching
    // back to mqtt:// drops it rather than leaving it to reappear if the user
    // switches forward again with a different endpoint in mind.
    ws_path: isWebSocketScheme(value.scheme) ? blankToNull(value.wsPath) : null,
    ca_cert_path: blankToNull(value.caCertPath),
    client_cert_path: blankToNull(value.clientCertPath),
    client_key_path: blankToNull(value.clientKeyPath),
    alpn: blankToNull(value.alpn),
    skip_cert_verification: value.skipCertVerification,
    keep_alive_secs: Number(value.keepAliveSecs),
    auto_reconnect: value.autoReconnect,
    max_reconnect_attempts: Number(value.maxReconnectAttempts),
  };
}

/**
 * The other direction, for the edit route. Every control has to appear here:
 * the form is filled with `setValue`, which throws on a missing key rather
 * than quietly leaving it at its default.
 */
export function connectionToFormValue(
  connection: BrokerConnection,
): ConnectionFormValue {
  return {
    name: connection.name,
    scheme: connection.scheme,
    host: connection.host,
    port: String(connection.port),
    wsPath: connection.ws_path ?? "",
    clientId: connection.client_id,
    keepAliveSecs: String(connection.keep_alive_secs),
    autoReconnect: connection.auto_reconnect,
    maxReconnectAttempts: String(connection.max_reconnect_attempts),
    requiresAuth: connection.username !== null,
    username: connection.username ?? "",
    password: connection.password ?? "",
    caCertPath: connection.ca_cert_path ?? "",
    clientCertPath: connection.client_cert_path ?? "",
    clientKeyPath: connection.client_key_path ?? "",
    alpn: connection.alpn ?? "",
    skipCertVerification: connection.skip_cert_verification,
  };
}

function isWebSocketScheme(scheme: BrokerScheme): boolean {
  return scheme === "ws" || scheme === "wss";
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
