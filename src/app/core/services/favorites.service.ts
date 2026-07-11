import { Injectable } from "@angular/core";
import { invoke } from "@tauri-apps/api/core";

import {
  FavoriteMessage,
  NewFavoriteMessage,
} from "../models/favorite-message.model";

@Injectable({ providedIn: "root" })
export class FavoritesService {
  list(): Promise<FavoriteMessage[]> {
    return invoke("list_favorites");
  }

  save(newFavorite: NewFavoriteMessage): Promise<FavoriteMessage> {
    return invoke("save_favorite", { newFavorite });
  }
}
