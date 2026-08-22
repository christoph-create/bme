import { QoS } from "./qos";

/**
 * Mirrors `core::models::BrokerScheme`. Serialized lowercase, and the same
 * string is the first segment of the URL shown in the UI.
 */
export type BrokerScheme = "mqtt" | "mqtts" | "ws" | "wss";

/** Mirrors `core::models::Subscription`. */
export interface Subscription {
  id: string;
  connection_id: string;
  topic: string;
  qos: QoS;
}

/** Mirrors `core::models::BrokerConnection`. */
export interface BrokerConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  client_id: string;
  username: string | null;
  password: string | null;
  scheme: BrokerScheme;
  /** `ws`/`wss` only; empty or null means `/mqtt`. */
  ws_path: string | null;
  /** Absolute paths to PEM files, read by the backend on every connect. */
  ca_cert_path: string | null;
  client_cert_path: string | null;
  client_key_path: string | null;
  /** Comma-separated ALPN protocols, e.g. `x-amzn-mqtt-ca` for AWS IoT. */
  alpn: string | null;
  skip_cert_verification: boolean;
  keep_alive_secs: number;
  auto_reconnect: boolean;
  max_reconnect_attempts: number;
  subscriptions: Subscription[];
}

/** Mirrors `core::models::NewSubscription`. */
export interface NewSubscription {
  topic: string;
  qos: QoS;
}

/** Mirrors `core::models::NewBrokerConnection`. */
export interface NewBrokerConnection {
  name: string;
  host: string;
  port: number;
  client_id: string;
  username: string | null;
  password: string | null;
  scheme: BrokerScheme;
  ws_path: string | null;
  ca_cert_path: string | null;
  client_cert_path: string | null;
  client_key_path: string | null;
  alpn: string | null;
  skip_cert_verification: boolean;
  keep_alive_secs: number;
  auto_reconnect: boolean;
  max_reconnect_attempts: number;
  subscriptions: NewSubscription[];
}

/** Mirrors `core::models::UpdateBrokerConnection`. */
export interface UpdateBrokerConnection {
  name: string;
  host: string;
  port: number;
  client_id: string;
  username: string | null;
  password: string | null;
  scheme: BrokerScheme;
  ws_path: string | null;
  ca_cert_path: string | null;
  client_cert_path: string | null;
  client_key_path: string | null;
  alpn: string | null;
  skip_cert_verification: boolean;
  keep_alive_secs: number;
  auto_reconnect: boolean;
  max_reconnect_attempts: number;
}
