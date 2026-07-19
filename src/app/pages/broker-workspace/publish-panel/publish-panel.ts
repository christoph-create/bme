import {
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
} from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";

import { FavoriteMessage } from "../../../core/models/favorite-message.model";
import { MessageDraft } from "../../../core/models/message-draft.model";
import { MessageFormat } from "../../../core/models/message-format.model";
import { QoS } from "../../../core/models/qos";
import { MqttService } from "../../../core/services/mqtt.service";
import { LoadTemplateModal } from "../load-template-modal/load-template-modal";
import { QosSelect } from "../qos-select/qos-select";
import { SaveTemplateModal } from "../save-template-modal/save-template-modal";

const FLASH_DURATION_MS = 1800;
const FORMAT_ERROR_DURATION_MS = 2500;
const FORMAT_OPTIONS: readonly MessageFormat[] = ["json", "raw"];

@Component({
  selector: "app-publish-panel",
  imports: [ReactiveFormsModule, QosSelect, SaveTemplateModal, LoadTemplateModal],
  templateUrl: "./publish-panel.html",
  styleUrl: "./publish-panel.css",
})
export class PublishPanel {
  readonly formatOptions = FORMAT_OPTIONS;

  readonly connectionId = input.required<string>();
  readonly topic = input<string | null>(null);

  private readonly mqttService = inject(MqttService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  readonly form = this.formBuilder.nonNullable.group({
    topic: ["", Validators.required],
    payload: ["", Validators.required],
  });

  readonly format = signal<MessageFormat>("json");
  readonly qos = signal<QoS>("AtMostOnce");
  readonly retain = signal(false);
  readonly publishedFlash = signal(false);
  readonly publishError = signal<string | null>(null);
  readonly formatError = signal<string | null>(null);
  readonly templateSaved = signal(false);
  readonly saveModalDraft = signal<MessageDraft | null>(null);
  readonly showLoadModal = signal(false);

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

  selectFormat(format: MessageFormat): void {
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

  /** Opens the Save Template modal with a snapshot of the current
   * topic/payload/QoS/retain/format - see docs/plans/message-templates.md. */
  openSaveModal(): void {
    if (this.form.invalid) {
      return;
    }

    const { topic, payload } = this.form.getRawValue();
    this.saveModalDraft.set({
      topic,
      payload: this.payloadText(payload),
      format: this.format(),
      qos: this.qos(),
      retain: this.retain(),
    });
  }

  closeSaveModal(): void {
    this.saveModalDraft.set(null);
  }

  onTemplateSaved(): void {
    this.saveModalDraft.set(null);
    this.flashTemplateSaved();
  }

  openLoadModal(): void {
    this.showLoadModal.set(true);
  }

  closeLoadModal(): void {
    this.showLoadModal.set(false);
  }

  /** Plainly overwrites the current draft with the selected template's
   * fields - matches how clicking a topic in the tree already behaves. */
  onTemplateSelected(favorite: FavoriteMessage): void {
    this.form.setValue({ topic: favorite.topic, payload: favorite.payload });
    this.format.set(favorite.format);
    this.qos.set(favorite.qos);
    this.retain.set(favorite.retain);
    this.showLoadModal.set(false);
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
