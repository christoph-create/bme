import {
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
} from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";

import { NewFavoriteMessage } from "../../../core/models/favorite-message.model";
import { QoS } from "../../../core/models/qos";
import { FavoritesService } from "../../../core/services/favorites.service";
import { MqttService } from "../../../core/services/mqtt.service";
import { QosSelect } from "../qos-select/qos-select";

const FLASH_DURATION_MS = 1800;
const FORMAT_ERROR_DURATION_MS = 2500;
export type PublishFormat = "json" | "raw";
const FORMAT_OPTIONS: readonly PublishFormat[] = ["json", "raw"];

@Component({
  selector: "app-publish-panel",
  imports: [ReactiveFormsModule, QosSelect],
  templateUrl: "./publish-panel.html",
  styleUrl: "./publish-panel.css",
})
export class PublishPanel {
  readonly formatOptions = FORMAT_OPTIONS;

  readonly connectionId = input.required<string>();
  readonly topic = input<string | null>(null);

  private readonly mqttService = inject(MqttService);
  private readonly favoritesService = inject(FavoritesService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  readonly form = this.formBuilder.nonNullable.group({
    topic: ["", Validators.required],
    payload: ["", Validators.required],
  });

  readonly format = signal<PublishFormat>("json");
  readonly qos = signal<QoS>("AtMostOnce");
  readonly retain = signal(false);
  readonly publishedFlash = signal(false);
  readonly publishError = signal<string | null>(null);
  readonly formatError = signal<string | null>(null);
  readonly templateSaved = signal(false);
  readonly templateSaveError = signal<string | null>(null);

  private flashTimeout: ReturnType<typeof setTimeout> | null = null;
  private formatErrorTimeout: ReturnType<typeof setTimeout> | null = null;
  private templateSavedTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const topic = this.topic();
      if (topic !== null) {
        this.form.controls.topic.setValue(topic);
      }
    });

    this.destroyRef.onDestroy(() => {
      if (this.flashTimeout !== null) {
        clearTimeout(this.flashTimeout);
      }
      if (this.formatErrorTimeout !== null) {
        clearTimeout(this.formatErrorTimeout);
      }
      if (this.templateSavedTimeout !== null) {
        clearTimeout(this.templateSavedTimeout);
      }
    });
  }

  selectFormat(format: PublishFormat): void {
    this.format.set(format);
  }

  toggleRetain(): void {
    this.retain.set(!this.retain());
  }

  /** Pretty-prints the payload field as JSON, in place. */
  formatPayload(): void {
    const payload = this.form.controls.payload.value;
    try {
      const pretty = JSON.stringify(JSON.parse(payload), null, 2);
      this.form.controls.payload.setValue(pretty);
    } catch {
      this.flashFormatError("Payload isn't valid JSON");
    }
  }

  async publish(): Promise<void> {
    if (this.form.invalid) {
      return;
    }

    const { topic, payload } = this.form.getRawValue();
    const bytes = this.encodePayload(payload);

    try {
      await this.mqttService.publish(
        this.connectionId(),
        topic,
        bytes,
        this.qos(),
        this.retain(),
      );
    } catch (err) {
      this.publishError.set(err instanceof Error ? err.message : String(err));
      return;
    }

    this.publishError.set(null);
    if (this.formatErrorTimeout !== null) {
      clearTimeout(this.formatErrorTimeout);
      this.formatErrorTimeout = null;
    }
    this.formatError.set(null);
    this.flashPublished();
  }

  /** Saves the current topic/payload/QoS/retain as a reusable template,
   * independent of any particular broker - see docs/plans/message-templates.md. */
  async saveAsTemplate(): Promise<void> {
    if (this.form.invalid) {
      return;
    }

    const { topic, payload } = this.form.getRawValue();
    const newFavorite: NewFavoriteMessage = {
      connection_id: null,
      collection_id: null,
      name: topic.split("/").filter(Boolean).pop() ?? topic,
      description: null,
      topic,
      payload: this.payloadText(payload),
      qos: this.qos(),
      retain: this.retain(),
    };

    try {
      await this.favoritesService.create(newFavorite);
    } catch (err) {
      this.templateSaveError.set(
        err instanceof Error ? err.message : String(err),
      );
      return;
    }

    this.templateSaveError.set(null);
    this.flashTemplateSaved();
  }

  private payloadText(payload: string): string {
    return this.format() === "json" ? compactJson(payload) : payload;
  }

  private encodePayload(payload: string): Uint8Array {
    return new TextEncoder().encode(this.payloadText(payload));
  }

  private flashPublished(): void {
    if (this.flashTimeout !== null) {
      clearTimeout(this.flashTimeout);
    }
    this.publishedFlash.set(true);
    this.flashTimeout = setTimeout(() => {
      this.publishedFlash.set(false);
      this.flashTimeout = null;
    }, FLASH_DURATION_MS);
  }

  private flashTemplateSaved(): void {
    if (this.templateSavedTimeout !== null) {
      clearTimeout(this.templateSavedTimeout);
    }
    this.templateSaved.set(true);
    this.templateSavedTimeout = setTimeout(() => {
      this.templateSaved.set(false);
      this.templateSavedTimeout = null;
    }, FLASH_DURATION_MS);
  }

  private flashFormatError(message: string): void {
    if (this.formatErrorTimeout !== null) {
      clearTimeout(this.formatErrorTimeout);
    }
    this.formatError.set(message);
    this.formatErrorTimeout = setTimeout(() => {
      this.formatError.set(null);
      this.formatErrorTimeout = null;
    }, FORMAT_ERROR_DURATION_MS);
  }
}

/** Best-effort JSON compaction - falls back to the raw text if it's not valid JSON. */
function compactJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return text;
  }
}
