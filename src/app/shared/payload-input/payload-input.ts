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
import { json } from "@codemirror/lang-json";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";

import { MessageFormat } from "../../core/models/message-format.model";
import { JsonFormatService } from "../../core/services/json-format.service";

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
  {
    tag: [tags.punctuation, tags.separator, tags.brace, tags.squareBracket],
    color: "var(--color-json-punctuation)",
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

  private readonly jsonFormat = inject(JsonFormatService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly editorHost =
    viewChild<ElementRef<HTMLDivElement>>("editorHost");

  readonly value = signal("");
  readonly disabled = signal(false);

  /** Live JSON validity error for the current value - recomputed on every
   * keystroke, not just when Format is clicked. */
  readonly formatError = computed(() => {
    if (this.format() !== "json") {
      return null;
    }
    const text = this.value();
    if (text.trim() === "") {
      return null;
    }
    const result = this.jsonFormat.format(text);
    return result.ok ? null : result.error;
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

  /** Pretty-prints the current payload, in place. A no-op for invalid JSON
   * - the live error above already reports why. */
  formatPayload(): void {
    const result = this.jsonFormat.format(this.value());
    if (!result.ok) {
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
        json(),
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
