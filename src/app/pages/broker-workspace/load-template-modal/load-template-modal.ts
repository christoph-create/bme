import { Component, computed, inject, output, signal } from "@angular/core";

import { FavoriteCollection } from "../../../core/models/favorite-collection.model";
import { FavoriteMessage } from "../../../core/models/favorite-message.model";
import { FavoriteCollectionsService } from "../../../core/services/favorite-collections.service";
import { FavoritesService } from "../../../core/services/favorites.service";
import { Modal } from "../../../shared/modal/modal";

@Component({
  selector: "app-load-template-modal",
  imports: [Modal],
  templateUrl: "./load-template-modal.html",
  styleUrl: "./load-template-modal.css",
})
export class LoadTemplateModal {
  readonly close_modal = output<void>();
  readonly selected = output<FavoriteMessage>();

  private readonly favoritesService = inject(FavoritesService);
  private readonly collectionsService = inject(FavoriteCollectionsService);

  readonly favorites = signal<FavoriteMessage[]>([]);
  readonly collections = signal<FavoriteCollection[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly search = signal("");
  readonly collectionFilter = signal("");

  readonly filteredFavorites = computed(() => {
    const query = this.search().trim().toLowerCase();
    const collectionId = this.collectionFilter();
    return this.favorites().filter((favorite) => {
      const matchesQuery =
        query === "" ||
        (favorite.name?.toLowerCase().includes(query) ?? false) ||
        favorite.topic.toLowerCase().includes(query);
      const matchesCollection =
        collectionId === "" || favorite.collection_id === collectionId;
      return matchesQuery && matchesCollection;
    });
  });

  constructor() {
    void this.load();
  }

  select(favorite: FavoriteMessage): void {
    this.selected.emit(favorite);
  }

  collectionName(collectionId: string | null): string | null {
    if (collectionId === null) {
      return null;
    }
    return (
      this.collections().find((collection) => collection.id === collectionId)
        ?.name ?? null
    );
  }

  onSearchInput(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  onCollectionFilterChange(event: Event): void {
    this.collectionFilter.set((event.target as HTMLSelectElement).value);
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [favorites, collections] = await Promise.all([
        this.favoritesService.list(),
        this.collectionsService.list(),
      ]);
      this.favorites.set(favorites);
      this.collections.set(collections);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.loading.set(false);
    }
  }
}
