import { Component, OnInit, computed, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";

import { MessageFormat } from "../../core/models/message-format.model";
import { SettingsService } from "../../core/services/settings.service";
import {
  AppSettings,
  MAX_MESSAGES_PER_TOPIC,
  MIN_MESSAGES_PER_TOPIC,
  TimestampMode,
} from "../../core/settings/app-settings";
import {
  ZOOM_LEVELS,
  formatZoomPercent,
  zoomIn,
  zoomOut,
} from "../../core/settings/zoom-levels";
import { QosSelect } from "../broker-workspace/qos-select/qos-select";

const TIMESTAMP_MODES: readonly { value: TimestampMode; label: string }[] = [
  { value: "relative", label: "Relative" },
  { value: "absolute", label: "Real time" },
];
const FORMAT_OPTIONS: readonly MessageFormat[] = ["json", "raw"];

/**
 * App-level defaults. Every control writes through immediately - there is no
 * Save, because nothing here is a draft: each setting is independent, and
 * a change is visible in any open workspace the moment it's made, which is
 * the quickest way to see whether it's the one you wanted.
 */
@Component({
  selector: "app-settings",
  imports: [RouterLink, QosSelect],
  templateUrl: "./settings.html",
  styleUrls: ["./settings.css", "./settings-controls.css"],
})
export class Settings implements OnInit {
  private readonly settingsService = inject(SettingsService);

  readonly settings = this.settingsService.settings;
  readonly timestampModes = TIMESTAMP_MODES;
  readonly formatZoomPercent = formatZoomPercent;
  readonly atMinZoom = computed(() => this.settings().uiZoom === ZOOM_LEVELS[0]);
  readonly atMaxZoom = computed(
    () => this.settings().uiZoom === ZOOM_LEVELS[ZOOM_LEVELS.length - 1],
  );
  readonly formatOptions = FORMAT_OPTIONS;
  readonly minMessages = MIN_MESSAGES_PER_TOPIC;
  readonly maxMessages = MAX_MESSAGES_PER_TOPIC;

  /** A failed write. The signal already shows the new value (writes are
   * optimistic), so this is the only sign it won't survive a restart. */
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    // Normally a no-op: the app initializer already loaded. It matters if
    // that load failed and the user came here to see why.
    this.settingsService.load().catch((err: unknown) => this.fail(err));
  }

  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    this.error.set(null);
    this.settingsService
      .set(key, value)
      .catch((err: unknown) => this.fail(err));
  }

  /** On `change`, not `input`: clamping a half-typed number under the
   * cursor would fight the user. The service clamps; the field is then
   * re-synced by hand because a clamp that lands on the value already in the
   * signal would otherwise leave the typed text in place. */
  onMaxMessagesChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const typed = input.valueAsNumber;
    if (Number.isNaN(typed)) {
      input.value = String(this.settings().maxMessagesPerTopic);
      return;
    }
    this.set("maxMessagesPerTopic", typed);
    input.value = String(this.settings().maxMessagesPerTopic);
  }

  stepZoomIn(): void {
    this.set("uiZoom", zoomIn(this.settings().uiZoom));
  }

  stepZoomOut(): void {
    this.set("uiZoom", zoomOut(this.settings().uiZoom));
  }

  onPrettyJsonChange(event: Event): void {
    this.set("prettyJson", (event.target as HTMLInputElement).checked);
  }

  onRetainChange(event: Event): void {
    this.set("publishRetain", (event.target as HTMLInputElement).checked);
  }

  resetAll(): void {
    this.error.set(null);
    this.settingsService.resetAll().catch((err: unknown) => this.fail(err));
  }

  private fail(err: unknown): void {
    this.error.set(
      `Could not save settings: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
