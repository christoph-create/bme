import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  forwardRef,
  inject,
  input,
  signal,
  viewChild,
} from "@angular/core";
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from "@angular/forms";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";

import { MessageFormat } from "../../core/models/message-format.model";
import { VariableValueKind } from "../../core/models/payload-variable.model";
import {
  JsonFormatResult,
  JsonFormatService,
} from "../../core/services/json-format.service";
import { formatPreservingPlaceholders } from "../../core/variables/mask-placeholders";
import { unknownPlaceholderNames } from "../../core/variables/placeholders";
import { probeExpand } from "../../core/variables/probe-expand";
import {
  jsonWithPlaceholders,
  placeholderTag,
} from "./json-placeholder-mode";

/** Tags a dispatched transaction as a programmatic sync (from `writeValue`
 * or `formatPayload`) rather than a user edit, so the update listener below
 * doesn't loop it back into `onChange` - only genuine typing should notify
 * the form control via `onChange`. */
const externalUpdate = Annotation.define<boolean>();

// eslint-disable-next-line @typescript-eslint/no-empty-function
function noop(): void {}

/** Colors reference the shared `--color-json-*` custom properties (see
 * styles.css) so this editor's highlighting stays in sync with
 * app-formatted-payload's, without the two sharing a tokenizer. */
const jsonHighlightStyle = HighlightStyle.define([
  { tag: tags.propertyName, color: "var(--color-json-key)" },
  { tag: tags.string, color: "var(--color-json-string)" },
  { tag: tags.number, color: "var(--color-json-number)" },
  { tag: tags.bool, color: "var(--color-json-boolean)" },
  { tag: tags.null, color: "var(--color-json-null)" },
  { tag: tags.punctuation, color: "var(--color-json-punctuation)" },
  {
    tag: placeholderTag,
    color: "var(--color-json-placeholder)",
    fontStyle: "italic",
  },
]);

const editorTheme = EditorView.theme({
  "&": {
    fontSize: "12.5px",
    color: "var(--color-text)",
    backgroundColor: "var(--color-input-bg)",
    border: "1px solid var(--color-input-border)",
    borderRadius: "var(--radius-input)",
    flex: "1",
    minHeight: "0",
  },
  "&.cm-focused": {
    outline: "none",
    borderColor: "var(--color-accent)",
  },
  ".cm-content": {
    fontFamily: "var(--font-mono)",
    padding: "8px 10px",
    minHeight: "100px",
    // CodeMirror renders the native contenteditable caret here (no
    // drawSelection() extension is in use) - the base theme's caret is
    // black, invisible against this dark background, hence the override.
    caretColor: "var(--color-text)",
  },
  ".cm-scroller": {
    overflow: "auto",
  },
  ".cm-gutters": {
    display: "none",
  },
});

/**
 * Shared editable payload field - a JSON-highlighting CodeMirror editor
 * with a "Format" action when `format` is "json", or a plain textarea for
 * "raw" (no highlighting/Format action for opaque, non-JSON text). Plugs
 * into reactive forms via `formControlName` like a native input. See
 * docs/plans/json_rework.md.
 */
@Component({
  selector: "app-payload-input",
  imports: [],
  templateUrl: "./payload-input.html",
  styleUrl: "./payload-input.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => PayloadInput),
      multi: true,
    },
  ],
})
export class PayloadInput implements ControlValueAccessor {
  readonly format = input<MessageFormat>("raw");

  /** Value kinds for the `{{placeholder}}` variables in scope, keyed by name.
   *
   * When set, JSON validity is judged on the *probe-expanded* text, so a
   * payload like `{"t":{{tempC}}}` reads as valid - it will be, once it goes
   * on the wire. `null` (the default) keeps the plain literal check for every
   * caller that has nothing to do with variables. A data input rather than a
   * callback so this component stays presentational and doesn't grow a
   * dependency on the variables service. */
  readonly placeholderKinds = input<ReadonlyMap<
    string,
    VariableValueKind
  > | null>(null);

  private readonly jsonFormat = inject(JsonFormatService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly editorHost =
    viewChild<ElementRef<HTMLDivElement>>("editorHost");

  readonly value = signal("");
  readonly disabled = signal(false);

  /** Placeholder names in the value that have no variable behind them. Those
   * expand to nothing - they go on the wire as the literal `{{name}}` text -
   * which is usually the reason a payload using variables fails to parse. */
  readonly unknownVariables = computed(() => {
    const kinds = this.placeholderKinds();
    if (kinds === null) {
      return [];
    }
    return unknownPlaceholderNames(this.value(), new Set(kinds.keys()));
  });

  /** Live JSON validity error for the current value - recomputed on every
   * keystroke, not just when Format is clicked.
   *
   * When the payload uses an undefined variable, that gets named. Otherwise
   * `{"n": {{count}}}` reports only "Payload isn't valid JSON", which is true
   * but sends you hunting for a syntax error that isn't there - the real
   * problem is that `count` doesn't exist, so it never became a number. */
  readonly formatError = computed(() => {
    if (this.format() !== "json") {
      return null;
    }
    const text = this.value();
    if (text.trim() === "") {
      return null;
    }
    const result = this.jsonFormat.format(this.textToValidate(text));
    if (result.ok) {
      return null;
    }

    const unknown = this.unknownVariables();
    if (unknown.length === 0) {
      return result.error;
    }
    const names = unknown.map((name) => `"${name}"`).join(", ");
    return unknown.length === 1
      ? `${result.error} — there is no variable named ${names}`
      : `${result.error} — there are no variables named ${names}`;
  });

  /** The pretty-printed form of the current value, or the reason there isn't
   * one; `null` when formatting doesn't apply at all. Shared by the Format
   * button's state and its click handler, so the two can't disagree about
   * whether formatting will work. */
  private readonly formatted = computed<JsonFormatResult | null>(() => {
    if (this.format() !== "json" || this.value().trim() === "") {
      return null;
    }
    return formatPreservingPlaceholders(this.value(), (text) =>
      this.jsonFormat.format(text),
    );
  });

  /** Format is offered exactly when clicking it will work.
   *
   * Both halves are needed. Validity alone would offer it for `{"a": 1{{n}}}`,
   * which expands to valid JSON but has no maskable form, so the click would
   * silently do nothing. The round trip alone would offer it for
   * `{ {{k}}: 1 }`, which masks and restores fine but which the error line
   * above is simultaneously calling invalid - and Format must never
   * contradict that. */
  readonly canFormat = computed(
    () => this.formatError() === null && (this.formatted()?.ok ?? false),
  );

  /** Why Format is greyed out, for its tooltip. Distinguishes "fix your JSON
   * first" from the rarer cases where the payload is fine but formatting it
   * would not round-trip. */
  readonly formatUnavailableReason = computed(() => {
    if (this.canFormat()) {
      return null;
    }
    if (this.value().trim() === "") {
      return "Nothing to format yet";
    }
    if (this.formatError() !== null) {
      return "Formatting is unavailable while the payload isn't valid JSON";
    }
    const result = this.formatted();
    return result !== null && !result.ok ? result.error : null;
  });

  private onChange: (value: string) => void = noop;
  private onTouched: () => void = noop;

  private editorView: EditorView | null = null;
  private readonly editableCompartment = new Compartment();

  constructor() {
    effect(() => {
      const host = this.editorHost();
      const isJson = this.format() === "json";
      if (isJson && host && !this.editorView) {
        this.createEditor(host.nativeElement);
      } else if (!isJson && this.editorView) {
        this.editorView.destroy();
        this.editorView = null;
      }
    });

    effect(() => {
      const isDisabled = this.disabled();
      this.editorView?.dispatch({
        effects: this.editableCompartment.reconfigure(
          EditorView.editable.of(!isDisabled),
        ),
      });
    });

    this.destroyRef.onDestroy(() => {
      this.editorView?.destroy();
    });
  }

  writeValue(value: string | null): void {
    const text = value ?? "";
    this.value.set(text);
    this.syncEditorContent(text);
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  onTextareaInput(event: Event): void {
    const text = (event.target as HTMLTextAreaElement).value;
    this.value.set(text);
    this.onChange(text);
  }

  markTouched(): void {
    this.onTouched();
  }

  /** Pretty-prints the current payload, in place, keeping any
   * `{{placeholders}}` exactly as written - see `mask-placeholders.ts`. A
   * no-op unless `canFormat` says the round trip works; the button is
   * disabled in that case, and this is the guard behind it. */
  formatPayload(): void {
    const result = this.formatted();
    if (!this.canFormat() || !result?.ok) {
      return;
    }
    this.value.set(result.value);
    this.syncEditorContent(result.value);
    this.onChange(result.value);
  }

  private createEditor(parent: HTMLElement): void {
    const updateListener = EditorView.updateListener.of((update) => {
      if (!update.docChanged) {
        return;
      }
      const text = update.state.doc.toString();
      this.value.set(text);
      const isExternal = update.transactions.some((tr) =>
        tr.annotation(externalUpdate),
      );
      if (!isExternal) {
        this.onChange(text);
      }
    });

    const state = EditorState.create({
      doc: this.value(),
      extensions: [
        jsonWithPlaceholders,
        indentOnInput(),
        syntaxHighlighting(jsonHighlightStyle),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        editorTheme,
        this.editableCompartment.of(EditorView.editable.of(!this.disabled())),
        updateListener,
        EditorView.domEventHandlers({
          blur: () => {
            this.onTouched();
            return false;
          },
        }),
      ],
    });

    this.editorView = new EditorView({ state, parent });
  }

  /** The text JSON validity is judged on: probe-expanded when placeholder
   * kinds are in scope, the literal text otherwise. */
  private textToValidate(text: string): string {
    const kinds = this.placeholderKinds();
    return kinds === null ? text : probeExpand(text, kinds);
  }

  private syncEditorContent(text: string): void {
    const view = this.editorView;
    if (!view) {
      return;
    }
    const current = view.state.doc.toString();
    if (current === text) {
      return;
    }
    view.dispatch({
      changes: { from: 0, to: current.length, insert: text },
      annotations: externalUpdate.of(true),
    });
  }
}
