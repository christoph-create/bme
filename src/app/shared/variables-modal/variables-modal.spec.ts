import { computed, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PayloadVariable,
  VariableGenerator,
  valueKindOf,
} from "../../core/models/payload-variable.model";
import { VariablesService } from "../../core/services/variables.service";
import { VariablesModal } from "./variables-modal";

function variable(
  name: string,
  generator: VariableGenerator,
  id = name,
): PayloadVariable {
  return { id, name, generator, created_at: "2026-01-01T00:00:00Z" };
}

async function setup(initial: PayloadVariable[] = []) {
  const stored = signal<readonly PayloadVariable[]>(initial);
  const variablesService = {
    variables: stored.asReadonly(),
    valueKinds: computed(
      () => new Map(stored().map((v) => [v.name, valueKindOf(v.generator)])),
    ),
    load: vi.fn().mockResolvedValue(undefined),
    create: vi.fn(async (input: { name: string; generator: VariableGenerator }) => {
      const created = variable(input.name, input.generator, `id-${input.name}`);
      stored.set([...stored(), created]);
      return created;
    }),
    update: vi.fn(
      async (id: string, input: { name: string; generator: VariableGenerator }) => {
        const updated = variable(input.name, input.generator, id);
        stored.set(stored().map((v) => (v.id === id ? updated : v)));
        return updated;
      },
    ),
    delete: vi.fn(async (id: string) => {
      stored.set(stored().filter((v) => v.id !== id));
    }),
  };

  TestBed.configureTestingModule({
    imports: [VariablesModal],
    providers: [{ provide: VariablesService, useValue: variablesService }],
  });

  const fixture = TestBed.createComponent(VariablesModal);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, component: fixture.componentInstance, variablesService };
}

describe("VariablesModal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists the defined variables", async () => {
    const { fixture } = await setup([
      variable("deviceId", { kind: "fixedText", value: "dev-42" }),
    ]);

    const names = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(".variable-name"),
    ).map((el) => el.textContent?.trim());

    expect(names).toEqual(["deviceId"]);
  });

  it("creates a variable with the chosen generator", async () => {
    const { component, variablesService } = await setup();

    component.startAdd();
    component.setName("deviceId");
    component.selectKind("fixedText");
    component.setGeneratorText("value", "dev-42");
    await component.save();

    expect(variablesService.create).toHaveBeenCalledWith({
      name: "deviceId",
      generator: { kind: "fixedText", value: "dev-42" },
    });
  });

  it("resets the generator parameters when the type changes", async () => {
    // Otherwise switching Counter -> Random float would carry `start`/`step`
    // along as fields the new variant has no meaning for.
    const { component } = await setup();
    component.startAdd();
    component.selectKind("counter");
    component.setGeneratorNumber("start", "10");

    component.selectKind("randomFloat");

    expect(component.draft()?.generator).toEqual({
      kind: "randomFloat",
      min: 0,
      max: 1,
      decimals: 2,
    });
  });

  it("rejects a name that isn't referenceable as a placeholder", async () => {
    const { component } = await setup();
    component.startAdd();

    component.setName("device-id");

    expect(component.nameError()).toContain("letters, digits and underscores");
    expect(component.canSave()).toBe(false);
  });

  it("rejects a name that collides case-insensitively, before the backend does", async () => {
    const { component } = await setup([variable("uuid", { kind: "uuid" })]);
    component.startAdd();

    component.setName("UUID");

    expect(component.nameError()).toBe("A variable with that name already exists.");
    expect(component.canSave()).toBe(false);
  });

  it("does not report a collision against the variable being edited", async () => {
    const { component } = await setup([variable("uuid", { kind: "uuid" })]);

    component.startEdit(variable("uuid", { kind: "uuid" }));

    expect(component.nameError()).toBeNull();
    expect(component.canSave()).toBe(true);
  });

  it("updates an existing variable rather than creating a second one", async () => {
    const { component, variablesService } = await setup([
      variable("seq", { kind: "counter", start: 1, step: 1 }, "id-seq"),
    ]);

    component.startEdit(
      variable("seq", { kind: "counter", start: 1, step: 1 }, "id-seq"),
    );
    component.setGeneratorNumber("step", "5");
    await component.save();

    expect(variablesService.create).not.toHaveBeenCalled();
    expect(variablesService.update).toHaveBeenCalledWith("id-seq", {
      name: "seq",
      generator: { kind: "counter", start: 1, step: 5 },
    });
  });

  it("leaves the stored definition untouched when an edit is cancelled", async () => {
    const original = variable("seq", { kind: "counter", start: 1, step: 1 }, "id-seq");
    const { component, variablesService } = await setup([original]);

    component.startEdit(original);
    component.setGeneratorNumber("step", "99");
    component.cancelEdit();

    expect(component.draft()).toBeNull();
    expect(variablesService.update).not.toHaveBeenCalled();
    expect(component.variables()[0].generator).toEqual({
      kind: "counter",
      start: 1,
      step: 1,
    });
  });

  it("asks before deleting, and only deletes on confirm", async () => {
    const target = variable("seq", { kind: "uuid" }, "id-seq");
    const { component, variablesService } = await setup([target]);

    component.askDelete(target);
    expect(variablesService.delete).not.toHaveBeenCalled();

    component.cancelDelete();
    expect(component.pendingDelete()).toBeNull();

    component.askDelete(target);
    await component.confirmDelete();

    expect(variablesService.delete).toHaveBeenCalledWith("id-seq");
  });

  it("deletes a seeded built-in like any other variable", async () => {
    const builtIn = variable("uuid", { kind: "uuid" }, "id-uuid");
    const { component, variablesService } = await setup([builtIn]);

    component.askDelete(builtIn);
    await component.confirmDelete();

    expect(variablesService.delete).toHaveBeenCalledWith("id-uuid");
    expect(component.variables()).toEqual([]);
  });

  it("surfaces a backend failure instead of silently closing the editor", async () => {
    const { component, variablesService } = await setup();
    variablesService.create.mockRejectedValueOnce(
      new Error('a variable named "x" already exists'),
    );
    component.startAdd();
    component.setName("x");

    await component.save();

    expect(component.error()).toBe('a variable named "x" already exists');
    expect(component.draft()).not.toBeNull();
    expect(component.saving()).toBe(false);
  });

  it("preselects the edited variable's real type, not the first option", async () => {
    // A `[value]` binding on the <select> is applied before @for has created
    // the options, so it silently fell back to "Fixed text" for every type.
    const { fixture, component } = await setup([
      variable("seq", { kind: "counter", start: 1, step: 1 }, "id-seq"),
    ]);

    component.startEdit(
      variable("seq", { kind: "counter", start: 1, step: 1 }, "id-seq"),
    );
    fixture.detectChanges();

    const select = (fixture.nativeElement as HTMLElement).querySelector(
      "#variableKind",
    ) as HTMLSelectElement;
    expect(select.value).toBe("counter");
  });

  it("preselects the right timestamp format when editing", async () => {
    const iso = variable("when", { kind: "timestamp", format: "iso8601" }, "id-w");
    const { fixture, component } = await setup([iso]);

    component.startEdit(iso);
    fixture.detectChanges();

    const select = (fixture.nativeElement as HTMLElement).querySelector(
      "#timestampFormat",
    ) as HTMLSelectElement;
    expect(select.value).toBe("iso8601");
  });
});

describe("VariablesModal counters", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a Reset button and the next value only for counters", async () => {
    const { fixture } = await setup([
      variable("seq", { kind: "counter", start: 1, step: 1 }, "id-seq"),
      variable("id", { kind: "uuid" }, "id-uuid"),
    ]);
    fixture.componentRef.setInput(
      "counterValues",
      new Map([["id-seq", "7"]]),
    );
    fixture.detectChanges();

    const rows = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(".variable-row"),
    );
    expect(rows[0].textContent).toContain("next 7");
    expect(
      Array.from(rows[0].querySelectorAll("button")).map((b) =>
        b.textContent?.trim(),
      ),
    ).toContain("Reset");
    expect(
      Array.from(rows[1].querySelectorAll("button")).map((b) =>
        b.textContent?.trim(),
      ),
    ).not.toContain("Reset");
  });

  it("emits the variable id when its Reset is pressed", async () => {
    const { fixture, component } = await setup([
      variable("seq", { kind: "counter", start: 1, step: 1 }, "id-seq"),
    ]);
    fixture.componentRef.setInput("counterValues", new Map([["id-seq", "7"]]));
    fixture.detectChanges();
    const emitted: string[] = [];
    component.reset_counter.subscribe((id) => emitted.push(id));

    const reset = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll("button"),
    ).find((b) => b.textContent?.trim() === "Reset") as HTMLButtonElement;
    reset.click();

    expect(emitted).toEqual(["id-seq"]);
  });
});
