import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";

import { MessageFormat } from "../../core/models/message-format.model";
import { JsonFormatService, JsonToken } from "../../core/services/json-format.service";

/**
 * Read-only, syntax-highlighted display of a payload - shared by every
 * place a payload is shown (message stream, template previews/list). Pretty-
 * prints and tokenizes JSON payloads; "raw" payloads are shown as plain
 * text. See docs/plans/json_rework.md.
 */
@Component({
  selector: "app-formatted-payload",
  imports: [],
  templateUrl: "./formatted-payload.html",
  styleUrl: "./formatted-payload.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormattedPayload {
  readonly payload = input.required<string>();
  readonly format = input<MessageFormat>("raw");
  /** Whether JSON payloads are pretty-printed before display - off for
   * message-stream's "Raw" toggle, which shows the payload exactly as
   * received. */
  readonly prettyPrint = input(true);

  private readonly jsonFormat = inject(JsonFormatService);

  private readonly displayText = computed(() => {
    const raw = this.payload();
    if (this.format() !== "json" || !this.prettyPrint()) {
      return raw;
    }
    return this.jsonFormat.tryFormat(raw);
  });

  readonly tokens = computed<readonly JsonToken[]>(() => {
    const text = this.displayText();
    return this.format() === "json"
      ? this.jsonFormat.tokenize(text)
      : [{ kind: "plain", text }];
  });
}
