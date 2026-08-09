import {
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from "@angular/core";

import {
  GENERATOR_KINDS,
  PayloadVariable,
  VariableGenerator,
  VariableGeneratorKind,
  defaultGenerator,
  generatorKindLabel,
  generatorLabel,
  generatorSummary,
  isStateful,
} from "../../core/models/payload-variable.model";
import { VariablesService } from "../../core/services/variables.service";
import { isValidVariableName } from "../../core/variables/placeholders";
import { Modal } from "../modal/modal";

/** The row being edited. `id` is null for a variable that hasn't been created
 * yet, which is the only difference between add and edit. */
interface Draft {
  readonly id: string | null;
  name: string;
  generator: VariableGenerator;
}

@Component({
  selector: "app-variables-modal",
  imports: [Modal],
  templateUrl: "./variables-modal.html",
  styleUrl: "./variables-modal.css",
})
export class VariablesModal {
  /** Where each counter has got to, by variable id. Owned by the publish
   * panel (the runtime lives there, with the run), passed down so the row a
   * counter is reset from is also the row that shows its position. */
  readonly counterValues = input<ReadonlyMap<string, string>>(new Map());

  readonly close_modal = output<void>();
  readonly reset_counter = output<string>();

  readonly generatorKinds = GENERATOR_KINDS;

  /** Literal `{{…}}` text has to come from here rather than the template:
   * Angular decodes HTML entities before parsing interpolation, so even
   * `&#123;&#123;` in the HTML would be read as an interpolation delimiter. */
  readonly syntaxExample = "{{name}}";
  readonly generatorLabel = generatorLabel;
  readonly generatorKindLabel = generatorKindLabel;
  readonly generatorSummary = generatorSummary;

  private readonly variablesService = inject(VariablesService);

  readonly variables = this.variablesService.variables;
  readonly draft = signal<Draft | null>(null);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);
  readonly pendingDelete = signal<PayloadVariable | null>(null);

  /** Blocks Save with the reason, rather than letting the backend's unique
   * index be the first thing that tells you the name is taken. */
  readonly nameError = computed(() => {
    const draft = this.draft();
    if (draft === null || draft.name === "") {
      return null;
    }
    if (!isValidVariableName(draft.name)) {
      return "Use letters, digits and underscores, starting with a letter.";
    }
    const clash = this.variables().some(
      (v) =>
        v.id !== draft.id &&
        v.name.toLowerCase() === draft.name.toLowerCase(),
    );
    return clash ? "A variable with that name already exists." : null;
  });

  readonly canSave = computed(() => {
    const draft = this.draft();
    return draft !== null && draft.name !== "" && this.nameError() === null;
  });

  constructor() {
    void this.variablesService.load();
  }

  startAdd(): void {
    this.error.set(null);
    this.draft.set({ id: null, name: "", generator: defaultGenerator("fixedText") });
  }

  startEdit(variable: PayloadVariable): void {
    this.error.set(null);
    this.draft.set({
      id: variable.id,
      name: variable.name,
      // Cloned so cancelling leaves the stored definition untouched.
      generator: structuredClone(variable.generator),
    });
  }

  cancelEdit(): void {
    this.draft.set(null);
    this.error.set(null);
  }

  setName(name: string): void {
    this.patchDraft((draft) => ({ ...draft, name: name.trim() }));
  }

  selectKind(kind: VariableGeneratorKind): void {
    this.patchDraft((draft) => ({ ...draft, generator: defaultGenerator(kind) }));
  }

  /** Generator fields are patched by name because each variant has a
   * different set of them; the template only ever passes fields that the
   * currently selected variant actually has. */
  setGeneratorNumber(field: string, value: string): void {
    const parsed = Number(value);
    this.patchGenerator(field, Number.isFinite(parsed) ? parsed : 0);
  }

  setGeneratorText(field: string, value: string): void {
    this.patchGenerator(field, value);
  }

  /** How `name` is written in a topic or payload. */
  reference(name: string): string {
    return `{{${name}}}`;
  }

  /** The next value a counter will produce, or null for anything stateless -
   * which is also what decides whether the row gets a Reset button. */
  counterValue(variable: PayloadVariable): string | null {
    return isStateful(variable.generator)
      ? (this.counterValues().get(variable.id) ?? null)
      : null;
  }

  async save(): Promise<void> {
    const draft = this.draft();
    if (draft === null || !this.canSave()) {
      return;
    }

    this.saving.set(true);
    this.error.set(null);
    try {
      const payload = { name: draft.name, generator: draft.generator };
      if (draft.id === null) {
        await this.variablesService.create(payload);
      } else {
        await this.variablesService.update(draft.id, payload);
      }
      this.draft.set(null);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.saving.set(false);
    }
  }

  askDelete(variable: PayloadVariable): void {
    this.pendingDelete.set(variable);
  }

  cancelDelete(): void {
    this.pendingDelete.set(null);
  }

  async confirmDelete(): Promise<void> {
    const variable = this.pendingDelete();
    if (variable === null) {
      return;
    }

    this.error.set(null);
    try {
      await this.variablesService.delete(variable.id);
      if (this.draft()?.id === variable.id) {
        this.draft.set(null);
      }
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.pendingDelete.set(null);
    }
  }

  private patchDraft(update: (draft: Draft) => Draft): void {
    const draft = this.draft();
    if (draft !== null) {
      this.draft.set(update(draft));
    }
  }

  private patchGenerator(field: string, value: unknown): void {
    this.patchDraft((draft) => ({
      ...draft,
      generator: { ...draft.generator, [field]: value } as VariableGenerator,
    }));
  }
}
