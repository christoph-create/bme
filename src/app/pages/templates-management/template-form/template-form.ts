import { Component, effect, inject, input, output, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";

import { FavoriteCollection } from "../../../core/models/favorite-collection.model";
import { FavoriteMessage } from "../../../core/models/favorite-message.model";
import { MessageFormat } from "../../../core/models/message-format.model";
import { QoS } from "../../../core/models/qos";
import { FavoriteCollectionsService } from "../../../core/services/favorite-collections.service";
import { FavoritesService } from "../../../core/services/favorites.service";
import { QosSelect } from "../../broker-workspace/qos-select/qos-select";
import { Modal } from "../../../shared/modal/modal";

/** Sentinel `collectionId` form value meaning "create a new collection from
 * `newCollectionName` and use that", distinct from "" (no collection). */
const NEW_COLLECTION = "__new__";
const FORMAT_OPTIONS: readonly MessageFormat[] = ["json", "raw"];

@Component({
  selector: "app-template-form",
  imports: [Modal, QosSelect, ReactiveFormsModule],
  templateUrl: "./template-form.html",
  styleUrl: "./template-form.css",
})
export class TemplateForm {
  readonly favorite = input<FavoriteMessage | null>(null);
  readonly close_modal = output<void>();
  readonly saved = output<FavoriteMessage>();

  private readonly favoritesService = inject(FavoritesService);
  private readonly collectionsService = inject(FavoriteCollectionsService);
  private readonly formBuilder = inject(FormBuilder);

  readonly newCollectionValue = NEW_COLLECTION;
  readonly formatOptions = FORMAT_OPTIONS;
  readonly collections = signal<FavoriteCollection[]>([]);
  readonly loadingCollections = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly format = signal<MessageFormat>("json");
  readonly qos = signal<QoS>("AtMostOnce");
  readonly retain = signal(false);

  readonly form = this.formBuilder.nonNullable.group({
    name: [""],
    description: [""],
    topic: ["", Validators.required],
    payload: ["", Validators.required],
    collectionId: [""],
    newCollectionName: [""],
  });

  get isEditMode(): boolean {
    return this.favorite() !== null;
  }

  constructor() {
    // `favorite` is an optional input - reading it in a field initializer
    // would only ever see the default (null), since Angular applies input
    // bindings after the constructor runs. An effect defers the read until
    // after that binding happens, mirroring SaveTemplateModal's `draft`.
    effect(() => {
      const favorite = this.favorite();
      if (favorite === null) {
        return;
      }
      this.form.patchValue({
        name: favorite.name ?? "",
        description: favorite.description ?? "",
        topic: favorite.topic,
        payload: favorite.payload,
        collectionId: favorite.collection_id ?? "",
      });
      this.format.set(favorite.format);
      this.qos.set(favorite.qos);
      this.retain.set(favorite.retain);
    });

    void this.loadCollections();
  }

  selectFormat(format: MessageFormat): void {
    this.format.set(format);
  }

  toggleRetain(): void {
    this.retain.set(!this.retain());
  }

  async save(): Promise<void> {
    if (this.form.invalid || this.saving()) {
      return;
    }

    this.saving.set(true);
    this.error.set(null);
    try {
      const collectionId = await this.resolveCollectionId();
      const { name, description, topic, payload } = this.form.getRawValue();
      const payloadData = {
        collection_id: collectionId,
        name: name || null,
        description: description || null,
        topic,
        payload,
        format: this.format(),
        qos: this.qos(),
        retain: this.retain(),
      };

      const existing = this.favorite();
      const result = existing
        ? await this.favoritesService.update(existing.id, payloadData)
        : await this.favoritesService.create(payloadData);
      this.saved.emit(result);
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
