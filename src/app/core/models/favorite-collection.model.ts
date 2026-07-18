/** Mirrors `core::models::FavoriteCollection`. */
export interface FavoriteCollection {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

/** Mirrors `core::models::NewFavoriteCollection`. */
export interface NewFavoriteCollection {
  name: string;
  description: string | null;
}

/** Mirrors `core::models::UpdateFavoriteCollection`. */
export interface UpdateFavoriteCollection {
  name: string;
  description: string | null;
}
