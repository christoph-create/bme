import { Injectable } from "@angular/core";
import { invoke } from "@tauri-apps/api/core";

import {
  FavoriteMessage,
  NewFavoriteMessage,
  UpdateFavoriteMessage,
} from "../models/favorite-message.model";

@Injectable({ providedIn: "root" })
export class FavoritesService {
  list(): Promise<FavoriteMessage[]> {
    return invoke("list_favorites");
  }

  get(id: string): Promise<FavoriteMessage | null> {
    return invoke("get_favorite", { id });
  }

  create(newFavorite: NewFavoriteMessage): Promise<FavoriteMessage> {
    return invoke("create_favorite", { newFavorite });
  }

  update(id: string, update: UpdateFavoriteMessage): Promise<FavoriteMessage> {
    return invoke("update_favorite", { id, update });
  }

  delete(id: string): Promise<void> {
    return invoke("delete_favorite", { id });
  }
}
