import { Component, HostListener, computed, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";

import { FavoriteCollection } from "../../core/models/favorite-collection.model";
import { FavoriteMessage } from "../../core/models/favorite-message.model";
import { qosNumber } from "../../core/models/qos";
import { FavoriteCollectionsService } from "../../core/services/favorite-collections.service";
import { FavoritesService } from "../../core/services/favorites.service";
import { FormattedPayload } from "../../shared/formatted-payload/formatted-payload";
import { TemplateForm } from "./template-form/template-form";

/** Sentinel `formTarget` value meaning "create form, no existing favorite",
 * distinct from `null` (form closed). */
type FormTarget = FavoriteMessage | "new" | null;

@Component({
  selector: "app-templates-management",
  imports: [RouterLink, TemplateForm, FormattedPayload],
  templateUrl: "./templates-management.html",
  styleUrl: "./templates-management.css",
})
export class TemplatesManagement {
  private readonly favoritesService = inject(FavoritesService);
  private readonly collectionsService = inject(FavoriteCollectionsService);

  readonly qosNumber = qosNumber;
  readonly favorites = signal<FavoriteMessage[]>([]);
  readonly collections = signal<FavoriteCollection[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly search = signal("");
  readonly collectionFilter = signal("");
  readonly openMenuId = signal<string | null>(null);
  readonly formTarget = signal<FormTarget>(null);
  readonly editingCollectionId = signal<string | null>(null);
  readonly collectionNameDraft = signal("");

  readonly formFavorite = computed(() => {
    const target = this.formTarget();
    return target === "new" ? null : target;
  });

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

  onCollectionNameDraftInput(event: Event): void {
    this.collectionNameDraft.set((event.target as HTMLInputElement).value);
  }

  toggleMenu(id: string, event: Event): void {
    event.stopPropagation();
    this.openMenuId.set(this.openMenuId() === id ? null : id);
  }

  /** Closes the "⋯" menu on any click that isn't handled (and stopped) by the menu itself. */
  @HostListener("document:click")
  closeMenu(): void {
    this.openMenuId.set(null);
  }

  async deleteTemplate(id: string, event: Event): Promise<void> {
    event.stopPropagation();
    this.openMenuId.set(null);
    await this.favoritesService.delete(id);
    this.favorites.update((favorites) =>
      favorites.filter((favorite) => favorite.id !== id),
    );
  }

  openCreateForm(): void {
    this.formTarget.set("new");
  }

  openEditForm(favorite: FavoriteMessage, event: Event): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.formTarget.set(favorite);
  }

  closeForm(): void {
    this.formTarget.set(null);
  }

  async onFormSaved(favorite: FavoriteMessage): Promise<void> {
    const wasCreate = this.formTarget() === "new";
    this.favorites.update((favorites) =>
      wasCreate
        ? [favorite, ...favorites]
        : favorites.map((existing) =>
            existing.id === favorite.id ? favorite : existing,
          ),
    );
    this.formTarget.set(null);
    // The form may have created a new collection inline ("+ New collection…"),
    // which only its own local collections list would know about otherwise.
    this.collections.set(await this.collectionsService.list());
  }

  startRenameCollection(collection: FavoriteCollection): void {
    this.editingCollectionId.set(collection.id);
    this.collectionNameDraft.set(collection.name);
  }

  cancelRenameCollection(): void {
    this.editingCollectionId.set(null);
  }

  async saveRenameCollection(id: string): Promise<void> {
    const name = this.collectionNameDraft().trim();
    if (name === "") {
      return;
    }
    const description =
      this.collections().find((collection) => collection.id === id)
        ?.description ?? null;
    const updated = await this.collectionsService.update(id, {
      name,
      description,
    });
    this.collections.update((collections) =>
      collections.map((collection) =>
        collection.id === id ? updated : collection,
      ),
    );
    this.editingCollectionId.set(null);
  }

  async deleteCollection(id: string): Promise<void> {
    await this.collectionsService.delete(id);
    this.collections.update((collections) =>
      collections.filter((collection) => collection.id !== id),
    );
    this.favorites.update((favorites) =>
      favorites.map((favorite) =>
        favorite.collection_id === id
          ? { ...favorite, collection_id: null }
          : favorite,
      ),
    );
    if (this.collectionFilter() === id) {
      this.collectionFilter.set("");
    }
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
