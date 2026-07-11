import { QoS } from "./qos";

/** Mirrors `core::models::FavoriteMessage`. */
export interface FavoriteMessage {
  id: string;
  connection_id: string | null;
  topic: string;
  payload: string;
  qos: QoS;
  retain: boolean;
  created_at: string;
}

/** Mirrors `core::models::NewFavoriteMessage`. */
export interface NewFavoriteMessage {
  connection_id: string | null;
  topic: string;
  payload: string;
  qos: QoS;
  retain: boolean;
}
