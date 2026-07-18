import { Component, effect, inject, input, output, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";

import { FavoriteCollection } from "../../../core/models/favorite-collection.model";
import { MessageDraft } from "../../../core/models/message-draft.model";
import { qosNumber } from "../../../core/models/qos";
import { FavoriteCollectionsService } from "../../../core/services/favorite-collections.service";
import { FavoritesService } from "../../../core/services/favorites.service";
import { Modal } from "../../../shared/modal/modal";

/** Sentinel `collectionId` form value meaning "create a new collection from
 * `newCollectionName` and use that", distinct from "" (no collection). */
const NEW_COLLECTION = "__new__";

@Component({
  selector: "app-save-template-modal",
  imports: [Modal, ReactiveFormsModule],
  templateUrl: "./save-template-modal.html",
  styleUrl: "./save-template-modal.css",
})
export class SaveTemplateModal {
  readonly draft = input.required<MessageDraft>();
  readonly close_modal = output<void>();
  readonly saved = output<void>();

  private readonly favoritesService = inject(FavoritesService);
  private readonly collectionsService = inject(FavoriteCollectionsService);
  private readonly formBuilder = inject(FormBuilder);

  readonly newCollectionValue = NEW_COLLECTION;
  readonly qosNumber = qosNumber;
  readonly collections = signal<FavoriteCollection[]>([]);
  readonly loadingCollections = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.formBuilder.nonNullable.group({
    name: ["", Validators.required],
    description: [""],
    collectionId: [""],
    newCollectionName: [""],
  });

  constructor() {
    // `draft` is a required input - not readable synchronously in a field
    // initializer (throws NG0952), so the default name is set here once
    // Angular has bound it, mirroring PublishPanel's `topic` input effect.
    effect(() => {
      const topic = this.draft().topic;
      const defaultName = topic.split("/").filter(Boolean).pop() ?? topic;
      this.form.controls.name.setValue(defaultName);
    });

    void this.loadCollections();
  }

  async save(): Promise<void> {
    if (this.form.invalid || this.saving()) {
      return;
    }

    this.saving.set(true);
    this.error.set(null);
    try {
      const collectionId = await this.resolveCollectionId();
      const { name, description } = this.form.getRawValue();
      const draft = this.draft();
      await this.favoritesService.create({
        connection_id: null,
        collection_id: collectionId,
        name,
        description: description || null,
        topic: draft.topic,
        payload: draft.payload,
        format: draft.format,
        qos: draft.qos,
        retain: draft.retain,
      });
      this.saved.emit();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.saving.set(false);
    }
  }

  private async loadCollections(): Promise<void> {
    this.loadingCollections.set(true);
    try {
      this.collections.set(await this.collectionsService.list());
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.loadingCollections.set(false);
    }
  }

  private async resolveCollectionId(): Promise<string | null> {
    const { collectionId, newCollectionName } = this.form.getRawValue();
    if (collectionId === NEW_COLLECTION) {
      const created = await this.collectionsService.create({
        name: newCollectionName,
        description: null,
      });
      return created.id;
    }
    return collectionId || null;
  }
}
