import { QoS } from "./qos";

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
  use_tls: boolean;
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
  use_tls: boolean;
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
  use_tls: boolean;
  keep_alive_secs: number;
  auto_reconnect: boolean;
  max_reconnect_attempts: number;
}
