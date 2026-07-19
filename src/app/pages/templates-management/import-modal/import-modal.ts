import { Component, computed, inject, output, signal } from "@angular/core";

import {
  collectionNameConflict,
  FavoriteCollection,
} from "../../../core/models/favorite-collection.model";
import {
  ExchangeDocument,
  TemplateItem,
} from "../../../core/models/template-exchange.model";
import { FavoriteCollectionsService } from "../../../core/services/favorite-collections.service";
import { FavoritesService } from "../../../core/services/favorites.service";
import { TemplateExchangeService } from "../../../core/services/template-exchange.service";
import { Modal } from "../../../shared/modal/modal";

/** Paste → review/resolve-conflicts → confirm, per `spec/template-format-v1.md`'s
 * import semantics: a `template` document always lands as a new,
 * uncategorized template (bme already tolerates duplicate template names);
 * a `collection` (or each collection inside a `bundle`) whose name collides
 * with an existing one blocks confirmation until renamed, since collection
 * names are unique - see `collectionNameConflict`. */
@Component({
  selector: "app-import-modal",
  imports: [Modal],
  templateUrl: "./import-modal.html",
  styleUrl: "./import-modal.css",
})
export class ImportModal {
  readonly close_modal = output<void>();
  readonly imported = output<void>();

  private readonly favoritesService = inject(FavoritesService);
  private readonly collectionsService = inject(FavoriteCollectionsService);
  private readonly templateExchange = inject(TemplateExchangeService);

  readonly collections = signal<FavoriteCollection[]>([]);
  readonly loadingCollections = signal(true);

  readonly pastedText = signal("");
  readonly parseError = signal<string | null>(null);
  readonly parsedDocument = signal<ExchangeDocument | null>(null);

  /** Editable name for a `collection` document's single collection. */
  readonly collectionNameDraft = signal("");
  /** Editable names for a `bundle` document's collections, parallel to
   * `parsedDocument().collections`. */
  readonly bundleCollectionNameDrafts = signal<string[]>([]);

  readonly importing = signal(false);
  readonly importError = signal<string | null>(null);

  readonly hasUnresolvedConflicts = computed(() => {
    const document = this.parsedDocument();
    if (document?.kind === "collection") {
      return collectionNameConflict(this.collectionNameDraft(), this.collections());
    }
    if (document?.kind === "bundle") {
      return this.bundleCollectionNameDrafts().some((name) =>
        collectionNameConflict(name, this.collections()),
      );
    }
    return false;
  });

  constructor() {
    void this.loadCollections();
  }

  onPastedTextInput(event: Event): void {
    this.pastedText.set((event.target as HTMLTextAreaElement).value);
  }

  parse(): void {
    const result = this.templateExchange.parse(this.pastedText());
    if (!result.ok) {
      this.parseError.set(result.error);
      this.parsedDocument.set(null);
      return;
    }
    this.parseError.set(null);
    this.parsedDocument.set(result.document);
    if (result.document.kind === "collection") {
      this.collectionNameDraft.set(result.document.collection.name);
    } else if (result.document.kind === "bundle") {
      this.bundleCollectionNameDrafts.set(
        result.document.collections.map((collection) => collection.name),
      );
    }
  }

  backToPaste(): void {
    this.parsedDocument.set(null);
    this.importError.set(null);
  }

  onCollectionNameDraftInput(event: Event): void {
    this.collectionNameDraft.set((event.target as HTMLInputElement).value);
  }

  onBundleCollectionNameDraftInput(index: number, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.bundleCollectionNameDrafts.update((drafts) =>
      drafts.map((draft, draftIndex) => (draftIndex === index ? value : draft)),
    );
  }

  bundleCollectionConflict(index: number): boolean {
    return collectionNameConflict(
      this.bundleCollectionNameDrafts()[index] ?? "",
      this.collections(),
    );
  }

  async confirm(): Promise<void> {
    const document = this.parsedDocument();
    if (document === null || this.importing() || this.hasUnresolvedConflicts()) {
      return;
    }

    this.importing.set(true);
    this.importError.set(null);
    try {
      if (document.kind === "template") {
        await this.createTemplate(document.template);
      } else if (document.kind === "collection") {
        await this.createCollection(
          this.collectionNameDraft(),
          document.collection.description,
          document.templates,
        );
      } else {
        const names = this.bundleCollectionNameDrafts();
        for (const [index, collection] of document.collections.entries()) {
          await this.createCollection(
            names[index],
            collection.description,
            collection.templates,
          );
        }
        for (const item of document.templates) {
          await this.createTemplate(item);
        }
      }
      this.imported.emit();
    } catch (err) {
      this.importError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.importing.set(false);
    }
  }

  private async createTemplate(item: TemplateItem): Promise<void> {
    await this.favoritesService.create(this.templateExchange.toNewFavorite(item, null));
  }

  private async createCollection(
    name: string,
    description: string | null,
    templates: readonly TemplateItem[],
  ): Promise<void> {
    const created = await this.collectionsService.create({ name, description });
    for (const item of templates) {
      await this.favoritesService.create(
        this.templateExchange.toNewFavorite(item, created.id),
      );
    }
  }

  private async loadCollections(): Promise<void> {
    this.loadingCollections.set(true);
    try {
      this.collections.set(await this.collectionsService.list());
    } finally {
      this.loadingCollections.set(false);
    }
  }
}
