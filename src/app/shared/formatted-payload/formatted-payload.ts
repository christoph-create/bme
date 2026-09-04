import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";

import { MessageFormat } from "../../core/models/message-format.model";
import { JsonFormatService, JsonToken } from "../../core/services/json-format.service";
import { splitForHighlight } from "./highlight-tokens";

export interface DisplayToken {
  readonly kind: JsonToken["kind"];
  readonly text: string;
  readonly matched: boolean;
}

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
  /** Substring to mark within the rendered text, e.g. from an active
   * message-stream search - empty means nothing is highlighted. */
  readonly highlight = input("");

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

  /** `tokens()` re-split around the highlight query, one entry per segment -
   * a match keeps its token's syntax `kind` so highlighting never affects
   * JSON coloring. */
  readonly displayTokens = computed<readonly DisplayToken[]>(() => {
    const query = this.highlight();
    return this.tokens().flatMap((token) =>
      splitForHighlight(token.text, query).map((segment) => ({
        kind: token.kind,
        text: segment.text,
        matched: segment.matched,
      })),
    );
  });
}
