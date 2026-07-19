import { Injectable } from "@angular/core";
import { invoke } from "@tauri-apps/api/core";

import {
  FavoriteCollection,
  NewFavoriteCollection,
  UpdateFavoriteCollection,
} from "../models/favorite-collection.model";

@Injectable({ providedIn: "root" })
export class FavoriteCollectionsService {
  list(): Promise<FavoriteCollection[]> {
    return invoke("list_favorite_collections");
  }

  get(id: string): Promise<FavoriteCollection | null> {
    return invoke("get_favorite_collection", { id });
  }

  create(newCollection: NewFavoriteCollection): Promise<FavoriteCollection> {
    return invoke("create_favorite_collection", { newCollection });
  }

  update(
    id: string,
    update: UpdateFavoriteCollection,
  ): Promise<FavoriteCollection> {
    return invoke("update_favorite_collection", { id, update });
  }

  delete(id: string): Promise<void> {
    return invoke("delete_favorite_collection", { id });
  }
}
