import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";

import { FavoriteMessage } from "../../../core/models/favorite-message.model";
import { MessageDraft } from "../../../core/models/message-draft.model";
import { MessageFormat } from "../../../core/models/message-format.model";
import { isStateful } from "../../../core/models/payload-variable.model";
import { QoS } from "../../../core/models/qos";
import { JsonFormatService } from "../../../core/services/json-format.service";
import { LoggerService } from "../../../core/services/logger.service";
import { MqttService } from "../../../core/services/mqtt.service";
import { VariablesService } from "../../../core/services/variables.service";
import {
  hasPlaceholders,
  replacePlaceholders,
  unknownPlaceholderNames,
} from "../../../core/variables/placeholders";
import { probeExpand } from "../../../core/variables/probe-expand";
import { VariableRuntime } from "../../../core/variables/variable-runtime";
import { PayloadInput } from "../../../shared/payload-input/payload-input";
import { LoadTemplateModal } from "../load-template-modal/load-template-modal";
import { QosSelect } from "../qos-select/qos-select";
import { SaveTemplateModal } from "../save-template-modal/save-template-modal";
import {
  MAX_INTERVAL_MS,
  MAX_REPEAT_COUNT,
  MIN_INTERVAL_MS,
  MIN_REPEAT_COUNT,
  clampCount,
  clampInterval,
  repeatFinishedLabel,
  repeatProgressLabel,
  repeatStoppedMessage,
  repeatSummaryLabel,
} from "./repeat-status";
import { VariablesModal } from "../../../shared/variables-modal/variables-modal";

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
    VariablesModal,
  ],
  templateUrl: "./publish-panel.html",
  styleUrls: ["./publish-panel.css", "./publish-settings.css"],
})
export class PublishPanel {
  readonly formatOptions = FORMAT_OPTIONS;
  readonly minInterval = MIN_INTERVAL_MS;
  readonly maxInterval = MAX_INTERVAL_MS;
  readonly minCount = MIN_REPEAT_COUNT;
  readonly maxCount = MAX_REPEAT_COUNT;

  readonly connectionId = input.required<string>();
  readonly connected = input<boolean>(true);

  private readonly mqttService = inject(MqttService);
  private readonly jsonFormat = inject(JsonFormatService);
  private readonly variablesService = inject(VariablesService);
  private readonly logger = inject(LoggerService);
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

  /** The second layer: the panel body swaps to publish settings rather than
   * growing. The panel is height-constrained (200-560px), so the controls
   * that are set once and then left alone - retain, repeat, variables - live
   * behind the gear instead of competing with the payload for space. */
  readonly showSettings = signal(false);
  readonly showVariablesModal = signal(false);

  readonly repeatEnabled = signal(false);
  readonly intervalMs = signal(1000);
  readonly repeatForever = signal(true);
  readonly repeatCount = signal(10);
  readonly running = signal(false);
  readonly sentCount = signal(0);
  readonly finishedFlash = signal<string | null>(null);

  readonly variables = this.variablesService.variables;
  readonly showPreview = signal(false);

  /** The live topic/payload text, as a signal.
   *
   * A reactive form control's `.value` is a plain property, so reading it
   * inside a `computed` registers no dependency and the computed never
   * recomputes when you type. Mirroring `valueChanges` into a signal is what
   * makes the preview and the unknown-variable warning actually track the
   * draft. */
  private readonly draft = signal(this.form.getRawValue());

  private flashTimeout: ReturnType<typeof setTimeout> | null = null;
  private templateSavedTimeout: ReturnType<typeof setTimeout> | null = null;
  private finishedTimeout: ReturnType<typeof setTimeout> | null = null;
  private repeatTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Counter state. Reset in exactly two places, and nowhere else:
   *
   * - when a repeat run starts, so every run's sequence reads from the
   *   configured start;
   * - when "Reset counters" is pressed in the settings layer.
   *
   * A one-off Publish deliberately *advances* counters without resetting
   * them, so clicking Publish five times gives you 1, 2, 3, 4, 5 - the same
   * sequence a five-message run would send.
   */
  private readonly runtime = new VariableRuntime();

  /** Bumped whenever `runtime`'s state changes, purely so the preview and the
   * counter readout recompute - the runtime itself isn't reactive. */
  private readonly runtimeVersion = signal(0);

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
   * directly by PayloadInput itself on every keystroke, no such lag.
   *
   * Validity is judged on the probe-expanded text, so `{"t":{{tempC}}}` -
   * which is what a simulator payload looks like - isn't rejected for failing
   * to be literal JSON. See `core/variables/probe-expand.ts`. */
  readonly payloadInvalid = computed(() => {
    if (this.format() !== "json") {
      return false;
    }
    const text = this.payloadText$();
    if (text.trim() === "") {
      return false;
    }
    return !this.jsonFormat.format(probeExpand(text, this.placeholderKinds())).ok;
  });

  /** The payload as the user currently sees it. Prefers PayloadInput's own
   * signal (see `payloadInvalid` above for why), falling back to the mirrored
   * form value before the view child exists. */
  private readonly payloadText$ = computed(
    () => this.payloadInputRef()?.value() ?? this.draft().payload,
  );

  readonly placeholderKinds = this.variablesService.valueKinds;

  /** The always-visible summary chip: what Start would do, without having to
   * open the settings layer to find out. */
  readonly repeatSummary = computed(() =>
    repeatSummaryLabel(this.intervalMs(), this.effectiveCount()),
  );

  readonly repeatProgress = computed(() =>
    repeatProgressLabel(this.running(), this.sentCount(), this.effectiveCount()),
  );

  /** True when the draft uses any variables at all - gates the preview
   * toggle, so an ordinary payload's panel is unchanged. */
  readonly usesVariables = computed(
    () => hasPlaceholders(this.draft().topic) || hasPlaceholders(this.payloadText$()),
  );

  /**
   * What the *next* message will look like on the wire.
   *
   * Peeks rather than consumes: previewing must not advance the counters a
   * real publish will use, or the sequence you send would depend on how much
   * you typed. The upside is that mid-run the preview shows the value the
   * next message actually carries, not the counter's start.
   */
  readonly preview = computed<{ topic: string; payload: string } | null>(() => {
    const { topic } = this.draft();
    const payload = this.payloadText$();
    // Read both so the preview refreshes when a definition changes or a
    // counter advances, not only when the draft text does.
    const variables = this.variables();
    this.runtimeVersion();
    if (!this.usesVariables()) {
      return null;
    }

    const resolve = this.runtime.peekResolver(variables);
    return {
      topic: replacePlaceholders(topic, resolve),
      payload: replacePlaceholders(payload, resolve),
    };
  });

  readonly unknownVariables = computed(() => {
    const known = new Set(this.variables().map((v) => v.name));
    return [
      ...new Set([
        ...unknownPlaceholderNames(this.draft().topic, known),
        ...unknownPlaceholderNames(this.payloadText$(), known),
      ]),
    ];
  });

  /** Where each counter has got to, keyed by variable id - shown per row in
   * the variables modal, which is also where they're reset from. Makes "when
   * does a counter reset" answerable by looking. */
  readonly counterValues = computed<ReadonlyMap<string, string>>(() => {
    this.runtimeVersion();
    const state = this.runtime.counterState();
    return new Map(
      this.variables()
        .filter((v) => isStateful(v.generator))
        .map((v) => [
          v.id,
          String(
            state.get(v.id) ??
              (v.generator.kind === "counter" ? v.generator.start : 0),
          ),
        ]),
    );
  });

  constructor() {
    // Failing to load leaves the variables list empty, which degrades to
    // "placeholders are sent as written" - worth a log line, but not worth
    // taking the publish panel down over.
    this.variablesService.load().catch((err: unknown) => {
      this.logger.warn(`could not load payload variables: ${String(err)}`);
    });

    const draftSubscription = this.form.valueChanges.subscribe(() => {
      this.draft.set(this.form.getRawValue());
    });

    this.destroyRef.onDestroy(() => {
      draftSubscription.unsubscribe();
      if (this.flashTimeout !== null) {
        clearTimeout(this.flashTimeout);
      }
      if (this.templateSavedTimeout !== null) {
        clearTimeout(this.templateSavedTimeout);
      }
      if (this.finishedTimeout !== null) {
        clearTimeout(this.finishedTimeout);
      }
      if (this.repeatTimeout !== null) {
        clearTimeout(this.repeatTimeout);
      }
    });
  }

  selectFormat(format: MessageFormat): void {
    this.format.set(format);
  }

  toggleRetain(): void {
    this.retain.set(!this.retain());
  }

  toggleSettings(): void {
    this.showSettings.set(!this.showSettings());
  }

  openSettings(): void {
    this.showSettings.set(true);
  }

  toggleRepeatEnabled(): void {
    const next = !this.repeatEnabled();
    this.repeatEnabled.set(next);
    if (!next) {
      this.stopRepeat();
    }
  }

  toggleRepeatForever(): void {
    this.repeatForever.set(!this.repeatForever());
  }

  onIntervalInput(value: string): void {
    this.intervalMs.set(clampInterval(Number(value)));
  }

  onRepeatCountInput(value: string): void {
    this.repeatCount.set(clampCount(Number(value)));
  }

  /** The submit button: a single send, or arming the repeat run, or stopping
   * one that's already going. */
  async submit(): Promise<void> {
    if (this.running()) {
      this.stopRepeat();
      return;
    }
    if (this.repeatEnabled()) {
      this.startRepeat();
      return;
    }
    await this.publish();
  }

  async publish(): Promise<void> {
    if (!this.canSend()) {
      return;
    }

    this.clearFinishedFlash();
    const error = await this.sendOnce();
    if (error !== null) {
      this.publishError.set(error);
      return;
    }

    this.publishError.set(null);
    this.flashPublished();
  }

  startRepeat(): void {
    if (!this.canSend() || this.running()) {
      return;
    }

    this.resetCounters();
    this.sentCount.set(0);
    this.publishError.set(null);
    this.clearFinishedFlash();
    this.running.set(true);
    // First message goes immediately: waiting a full interval before anything
    // happens reads as a broken button.
    void this.runTick();
  }

  stopRepeat(): void {
    if (this.repeatTimeout !== null) {
      clearTimeout(this.repeatTimeout);
      this.repeatTimeout = null;
    }
    this.running.set(false);
  }

  /** Opens the Save Template modal with a snapshot of the current
   * topic/payload/QoS/retain/format - see docs/plans/message-templates.md.
   * Placeholders are saved verbatim: a template carrying `{{uuid}}` is the
   * point, so no expansion happens here. */
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

  openVariablesModal(): void {
    this.showVariablesModal.set(true);
  }

  closeVariablesModal(): void {
    this.showVariablesModal.set(false);
  }

  togglePreview(): void {
    this.showPreview.set(!this.showPreview());
  }

  /** Puts every counter back to its configured start. Called when a run
   * starts; together with `resetCounter` these are the only things that reset
   * a counter. */
  resetCounters(): void {
    this.runtime.reset();
    this.runtimeVersion.update((n) => n + 1);
  }

  /** Puts one counter back to its configured start, from the variables
   * modal's per-row Reset. */
  resetCounter(id: string): void {
    this.runtime.resetOne(id);
    this.runtimeVersion.update((n) => n + 1);
  }

  /** Set from the topic tree on double-click. A method rather than an input,
   * for the same reason as `loadDraft`: double-clicking the *same* topic after
   * editing the field by hand has to restore it, and an unchanged input signal
   * wouldn't fire again. */
  setTopic(topic: string): void {
    this.form.controls.topic.setValue(topic);
    this.draft.set(this.form.getRawValue());
  }

  /** Plainly overwrites the current draft. Shared by "load template" and by
   * resending a received message from the stream. */
  loadDraft(draft: MessageDraft): void {
    this.form.setValue({ topic: draft.topic, payload: draft.payload });
    this.draft.set(this.form.getRawValue());
    this.format.set(draft.format);
    this.qos.set(draft.qos);
    this.retain.set(draft.retain);
    this.publishError.set(null);
  }

  /** `null` means "until stopped". */
  private effectiveCount(): number | null {
    return this.repeatForever() ? null : this.repeatCount();
  }

  private canSend(): boolean {
    return !this.form.invalid && !this.payloadInvalid() && this.connected();
  }

  /**
   * One iteration of a run: send, then schedule the next off the *completion*
   * of this one. A self-scheduling timeout rather than setInterval, because
   * publish is async - an interval would keep firing into a broker that hasn't
   * finished accepting the last message, and the sends would pile up.
   */
  private async runTick(): Promise<void> {
    const error = await this.sendOnce();

    if (!this.running()) {
      // Stopped while the send was in flight.
      return;
    }

    if (error !== null) {
      this.publishError.set(repeatStoppedMessage(this.sentCount(), error));
      this.stopRepeat();
      return;
    }

    const sent = this.sentCount() + 1;
    this.sentCount.set(sent);

    const target = this.effectiveCount();
    if (target !== null && sent >= target) {
      this.stopRepeat();
      this.flashFinished(repeatFinishedLabel(sent));
      return;
    }

    this.repeatTimeout = setTimeout(() => {
      this.repeatTimeout = null;
      void this.runTick();
    }, this.intervalMs());
  }

  /** Sends the current draft once, expanding placeholders in both the topic
   * and the payload. Returns the error message, or `null` on success. */
  private async sendOnce(): Promise<string | null> {
    const { topic, payload } = this.form.getRawValue();
    const resolve = this.runtime.resolver(this.variables());

    try {
      await this.mqttService.publish(
        this.connectionId(),
        replacePlaceholders(topic, resolve),
        this.encodePayload(replacePlaceholders(payload, resolve)),
        this.qos(),
        this.retain(),
      );
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    } finally {
      // The resolver consumed counter values whether or not the publish went
      // through, so the readouts have to catch up either way.
      this.runtimeVersion.update((n) => n + 1);
    }
    return null;
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

  /** The "Sent N messages" confirmation, on the same timer as the other two
   * flashes - a run that finished is news for a moment, then just clutter in
   * the header. */
  private flashFinished(message: string): void {
    this.clearFinishedFlash();
    this.finishedFlash.set(message);
    this.finishedTimeout = setTimeout(() => {
      this.finishedFlash.set(null);
      this.finishedTimeout = null;
    }, FLASH_DURATION_MS);
  }

  private clearFinishedFlash(): void {
    if (this.finishedTimeout !== null) {
      clearTimeout(this.finishedTimeout);
      this.finishedTimeout = null;
    }
    this.finishedFlash.set(null);
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
