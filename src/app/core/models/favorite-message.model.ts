import { MessageFormat } from "./message-format.model";
import { QoS } from "./qos";

/** Mirrors `core::models::FavoriteMessage`. */
export interface FavoriteMessage {
  id: string;
  collection_id: string | null;
  name: string | null;
  description: string | null;
  topic: string;
  payload: string;
  format: MessageFormat;
  qos: QoS;
  retain: boolean;
  created_at: string;
}

/** Mirrors `core::models::NewFavoriteMessage`. */
export interface NewFavoriteMessage {
  collection_id: string | null;
  name: string | null;
  description: string | null;
  topic: string;
  payload: string;
  format: MessageFormat;
  qos: QoS;
  retain: boolean;
}

/** Mirrors `core::models::UpdateFavoriteMessage`. */
export interface UpdateFavoriteMessage {
  collection_id: string | null;
  name: string | null;
  description: string | null;
  topic: string;
  payload: string;
  format: MessageFormat;
  qos: QoS;
  retain: boolean;
}
