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

/** True when `name` collides (trimmed, case-insensitive) with an existing
 * collection other than `excludeId` - collection names are unique in the
 * backend (see the `idx_favorite_collections_name_nocase` migration), so
 * every place that creates or renames a collection checks this first to
 * show an inline error instead of round-tripping to the database error. */
export function collectionNameConflict(
  name: string,
  collections: readonly FavoriteCollection[],
  excludeId?: string,
): boolean {
  const normalized = name.trim().toLowerCase();
  if (normalized === "") {
    return false;
  }
  return collections.some(
    (collection) =>
      collection.id !== excludeId &&
      collection.name.trim().toLowerCase() === normalized,
  );
}
