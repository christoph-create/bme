import {
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
} from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";

import { QoS } from "../../../core/models/qos";
import { MqttService } from "../../../core/services/mqtt.service";
import { QosSelect } from "../qos-select/qos-select";

const FLASH_DURATION_MS = 1800;
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
  private readonly formBuilder = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  readonly form = this.formBuilder.nonNullable.group({
    topic: ["", Validators.required],
    payload: ["", Validators.required],
  });

  readonly format = signal<PublishFormat>("json");
  readonly qos = signal<QoS>("AtMostOnce");
  readonly publishedFlash = signal(false);
  readonly publishError = signal<string | null>(null);

  private flashTimeout: ReturnType<typeof setTimeout> | null = null;

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
    });
  }

  selectFormat(format: PublishFormat): void {
    this.format.set(format);
  }

  /** Pretty-prints the payload field as JSON, in place. */
  formatPayload(): void {
    const payload = this.form.controls.payload.value;
    try {
      const pretty = JSON.stringify(JSON.parse(payload), null, 2);
      this.form.controls.payload.setValue(pretty);
      this.publishError.set(null);
    } catch {
      this.publishError.set("Payload isn't valid JSON");
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
        false,
      );
    } catch (err) {
      this.publishError.set(err instanceof Error ? err.message : String(err));
      return;
    }

    this.publishError.set(null);
    this.flashPublished();
  }

  private encodePayload(payload: string): Uint8Array {
    const text = this.format() === "json" ? compactJson(payload) : payload;
    return new TextEncoder().encode(text);
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
}

/** Best-effort JSON compaction - falls back to the raw text if it's not valid JSON. */
function compactJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return text;
  }
}
