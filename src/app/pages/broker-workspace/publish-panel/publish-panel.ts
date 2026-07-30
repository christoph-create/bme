import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";

import { FavoriteMessage } from "../../../core/models/favorite-message.model";
import { MessageDraft } from "../../../core/models/message-draft.model";
import { MessageFormat } from "../../../core/models/message-format.model";
import { QoS } from "../../../core/models/qos";
import { JsonFormatService } from "../../../core/services/json-format.service";
import { MqttService } from "../../../core/services/mqtt.service";
import { PayloadInput } from "../../../shared/payload-input/payload-input";
import { LoadTemplateModal } from "../load-template-modal/load-template-modal";
import { QosSelect } from "../qos-select/qos-select";
import { SaveTemplateModal } from "../save-template-modal/save-template-modal";

const FLASH_DURATION_MS = 1800;
const FORMAT_OPTIONS: readonly MessageFormat[] = ["json", "raw"];

@Component({
  selector: "app-publish-panel",
  imports: [
    ReactiveFormsModule,
    QosSelect,
    SaveTemplateModal,
    LoadTemplateModal,
    PayloadInput,
  ],
  templateUrl: "./publish-panel.html",
  styleUrl: "./publish-panel.css",
})
export class PublishPanel {
  readonly formatOptions = FORMAT_OPTIONS;

  readonly connectionId = input.required<string>();
  readonly topic = input<string | null>(null);
  readonly connected = input<boolean>(true);

  private readonly mqttService = inject(MqttService);
  private readonly jsonFormat = inject(JsonFormatService);
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
  readonly templateSaved = signal(false);
  readonly saveModalDraft = signal<MessageDraft | null>(null);
  readonly showLoadModal = signal(false);

  private flashTimeout: ReturnType<typeof setTimeout> | null = null;
  private templateSavedTimeout: ReturnType<typeof setTimeout> | null = null;

  private readonly payloadInputRef = viewChild(PayloadInput);

  /** True while `format` is "json" and the payload doesn't parse - gates
   * publishing and saving as a template, since neither makes sense for a
   * payload that's declared JSON but isn't.
   *
   * Reads PayloadInput's `value` signal directly via the view child ref,
   * rather than going through its `format` *input* - an input only updates
   * on the next change-detection pass, which CodeMirror's edits don't
   * trigger (they're not an Angular-bound DOM event), so that would lag a
   * beat behind the live error text below the field. `value` is set
   * directly by PayloadInput itself on every keystroke, no such lag. */
  readonly payloadInvalid = computed(() => {
    if (this.format() !== "json") {
      return false;
    }
    const text = this.payloadInputRef()?.value() ?? this.form.controls.payload.value;
    return text.trim() !== "" && !this.jsonFormat.format(text).ok;
  });

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

  async publish(): Promise<void> {
    if (this.form.invalid || this.payloadInvalid()) {
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
    this.flashPublished();
  }

  /** Opens the Save Template modal with a snapshot of the current
   * topic/payload/QoS/retain/format - see docs/plans/message-templates.md. */
  openSaveModal(): void {
    if (this.form.invalid || this.payloadInvalid()) {
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

  onTemplateSelected(favorite: FavoriteMessage): void {
    this.loadDraft(favorite);
    this.showLoadModal.set(false);
  }

  /** Plainly overwrites the current draft - matches how clicking a topic in
   * the tree already behaves. Shared by "load template" and by resending a
   * received message from the stream. */
  loadDraft(draft: MessageDraft): void {
    this.form.setValue({ topic: draft.topic, payload: draft.payload });
    this.format.set(draft.format);
    this.qos.set(draft.qos);
    this.retain.set(draft.retain);
    this.publishError.set(null);
  }

  private payloadText(payload: string): string {
    return this.format() === "json"
      ? this.jsonFormat.compact(payload)
      : payload;
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

}
