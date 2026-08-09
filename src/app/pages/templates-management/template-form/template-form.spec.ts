import { computed, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FavoriteCollection } from "../../../core/models/favorite-collection.model";
import { FavoriteMessage } from "../../../core/models/favorite-message.model";
import {
  PayloadVariable,
  valueKindOf,
} from "../../../core/models/payload-variable.model";
import { FavoriteCollectionsService } from "../../../core/services/favorite-collections.service";
import { FavoritesService } from "../../../core/services/favorites.service";
import { VariablesService } from "../../../core/services/variables.service";
import { TemplateForm } from "./template-form";

const COLLECTION: FavoriteCollection = {
  id: "55555555-5555-5555-5555-555555555555",
  name: "Sensors",
  description: null,
  created_at: "2026-07-18T00:00:00Z",
};

const EXISTING: FavoriteMessage = {
  id: "66666666-6666-6666-6666-666666666666",
  collection_id: COLLECTION.id,
  name: "Temperature",
  description: "Zone A temperature reading",
  topic: "sensors/zone-a/temperature",
  payload: '{"celsius": 21.5}',
  format: "json",
  qos: "AtLeastOnce",
  retain: true,
  created_at: "2026-07-18T00:00:00Z",
};

async function setup(overrides: {
  favorite?: FavoriteMessage | null;
  create?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
  listCollections?: ReturnType<typeof vi.fn>;
  createCollection?: ReturnType<typeof vi.fn>;
  variables?: PayloadVariable[];
} = {}) {
  const favoritesService = {
    create: overrides.create ?? vi.fn().mockResolvedValue(EXISTING),
    update: overrides.update ?? vi.fn().mockResolvedValue(EXISTING),
  };
  const collectionsService = {
    list: overrides.listCollections ?? vi.fn().mockResolvedValue([COLLECTION]),
    create: overrides.createCollection ?? vi.fn(),
  };

  const stored = signal<readonly PayloadVariable[]>(overrides.variables ?? []);
  const variablesService = {
    variables: stored.asReadonly(),
    valueKinds: computed(
      () => new Map(stored().map((v) => [v.name, valueKindOf(v.generator)])),
    ),
    load: vi.fn().mockResolvedValue(undefined),
  };

  TestBed.configureTestingModule({
    imports: [TemplateForm],
    providers: [
      { provide: FavoritesService, useValue: favoritesService },
      { provide: FavoriteCollectionsService, useValue: collectionsService },
      { provide: VariablesService, useValue: variablesService },
    ],
  });

  const fixture = TestBed.createComponent(TemplateForm);
  if (overrides.favorite !== undefined) {
    fixture.componentRef.setInput("favorite", overrides.favorite);
  }
  fixture.detectChanges();
  await fixture.whenStable();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, favoritesService, collectionsService, variablesService };
}

describe("TemplateForm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("create mode", () => {
    it("starts with blank fields and json/AtMostOnce/no-retain defaults", async () => {
      const { fixture } = await setup();
      const component = fixture.componentInstance;

      expect(component.form.controls.name.value).toBe("");
      expect(component.form.controls.topic.value).toBe("");
      expect(component.form.controls.payload.value).toBe("");
      expect(component.format()).toBe("json");
      expect(component.qos()).toBe("AtMostOnce");
      expect(component.retain()).toBe(false);
    });

    it("does not save when topic or payload is empty", async () => {
      const { fixture, favoritesService } = await setup();
      fixture.componentInstance.form.controls.payload.setValue("");

      await fixture.componentInstance.save();

      expect(favoritesService.create).not.toHaveBeenCalled();
    });

    it("creates a template with all fields including format/qos/retain", async () => {
      const { fixture, favoritesService } = await setup();
      const component = fixture.componentInstance;
      component.form.controls.name.setValue("New Template");
      component.form.controls.description.setValue("A description");
      component.form.controls.topic.setValue("sensors/new");
      component.form.controls.payload.setValue('{"x":1}');
      component.format.set("raw");
      component.qos.set("ExactlyOnce");
      component.retain.set(true);

      await component.save();

      expect(favoritesService.create).toHaveBeenCalledWith({
        collection_id: null,
        name: "New Template",
        description: "A description",
        topic: "sensors/new",
        payload: '{"x":1}',
        format: "raw",
        qos: "ExactlyOnce",
        retain: true,
      });
    });

    it("creates a new collection then saves with its id when '+ New collection' is chosen", async () => {
      const createCollection = vi.fn().mockResolvedValue({
        ...COLLECTION,
        id: "77777777-7777-7777-7777-777777777777",
        name: "New Group",
      });
      const { fixture, favoritesService } = await setup({ createCollection });
      const component = fixture.componentInstance;
      component.form.controls.topic.setValue("sensors/new");
      component.form.controls.payload.setValue("{}");
      component.form.controls.collectionId.setValue("__new__");
      component.form.controls.newCollectionName.setValue("New Group");

      await component.save();

      expect(createCollection).toHaveBeenCalledWith({
        name: "New Group",
        description: null,
      });
      expect(favoritesService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          collection_id: "77777777-7777-7777-7777-777777777777",
        }),
      );
    });

    it("blocks save() when '+ New collection' name collides with an existing collection", async () => {
      const createCollection = vi.fn();
      const { fixture, favoritesService } = await setup({ createCollection });
      const component = fixture.componentInstance;
      component.form.controls.topic.setValue("sensors/new");
      component.form.controls.payload.setValue("{}");
      component.form.controls.collectionId.setValue("__new__");
      component.form.controls.newCollectionName.setValue("sensors");

      expect(component.newCollectionNameConflict()).toBe(true);
      await component.save();

      expect(createCollection).not.toHaveBeenCalled();
      expect(favoritesService.create).not.toHaveBeenCalled();
    });

    it("emits the created favorite on save", async () => {
      const { fixture } = await setup();
      const component = fixture.componentInstance;
      component.form.controls.topic.setValue("sensors/new");
      component.form.controls.payload.setValue("{}");
      const saved = vi.fn();
      component.saved.subscribe(saved);

      await component.save();

      expect(saved).toHaveBeenCalledWith(EXISTING);
    });
  });

  describe("edit mode", () => {
    it("prefills every field from the given favorite", async () => {
      const { fixture } = await setup({ favorite: EXISTING });
      const component = fixture.componentInstance;

      expect(component.form.controls.name.value).toBe("Temperature");
      expect(component.form.controls.description.value).toBe(
        "Zone A temperature reading",
      );
      expect(component.form.controls.topic.value).toBe(
        "sensors/zone-a/temperature",
      );
      expect(component.form.controls.payload.value).toBe(
        JSON.stringify({ celsius: 21.5 }, null, 2),
      );
      expect(component.form.controls.collectionId.value).toBe(COLLECTION.id);
      expect(component.format()).toBe("json");
      expect(component.qos()).toBe("AtLeastOnce");
      expect(component.retain()).toBe(true);
    });

    it("saves edits to every field via update, not create", async () => {
      const { fixture, favoritesService } = await setup({
        favorite: EXISTING,
      });
      const component = fixture.componentInstance;
      component.form.controls.name.setValue("Renamed");
      component.form.controls.topic.setValue("sensors/zone-a/humidity");
      component.form.controls.payload.setValue('{"pct":55}');
      component.format.set("raw");
      component.qos.set("AtMostOnce");
      component.retain.set(false);
      component.form.controls.collectionId.setValue("");

      await component.save();

      expect(favoritesService.create).not.toHaveBeenCalled();
      expect(favoritesService.update).toHaveBeenCalledWith(EXISTING.id, {
        collection_id: null,
        name: "Renamed",
        description: "Zone A temperature reading",
        topic: "sensors/zone-a/humidity",
        payload: '{"pct":55}',
        format: "raw",
        qos: "AtMostOnce",
        retain: false,
      });
    });
  });

  describe("payloadInvalid", () => {
    it("blocks save() for malformed JSON while in JSON format", async () => {
      const { fixture, favoritesService } = await setup();
      const component = fixture.componentInstance;
      component.form.controls.topic.setValue("sensors/new");
      component.form.controls.payload.setValue("not json");

      await component.save();

      expect(component.payloadInvalid()).toBe(true);
      expect(favoritesService.create).not.toHaveBeenCalled();
    });

    it("disables the Save button in the DOM", async () => {
      const { fixture } = await setup();
      const component = fixture.componentInstance;
      component.form.controls.topic.setValue("sensors/new");
      component.form.controls.payload.setValue("not json");
      fixture.detectChanges();

      const saveButton = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll("button"),
      ).find((button) => button.textContent?.trim() === "Save") as HTMLButtonElement;

      expect(saveButton.disabled).toBe(true);
    });

    it("allows saving the same malformed text once switched to RAW format", async () => {
      const { fixture, favoritesService } = await setup();
      const component = fixture.componentInstance;
      component.form.controls.topic.setValue("sensors/new");
      component.form.controls.payload.setValue("not json");
      component.format.set("raw");

      await component.save();

      expect(favoritesService.create).toHaveBeenCalled();
    });
  });

  it("shows an error and does not emit saved when the save fails", async () => {
    const { fixture } = await setup({
      create: vi.fn().mockRejectedValue(new Error("disk full")),
    });
    const component = fixture.componentInstance;
    component.form.controls.topic.setValue("sensors/new");
    component.form.controls.payload.setValue("{}");
    const saved = vi.fn();
    component.saved.subscribe(saved);

    await component.save();

    expect(component.error()).toBe("disk full");
    expect(saved).not.toHaveBeenCalled();
  });

  it("emits close when Cancel is clicked", async () => {
    const { fixture } = await setup();
    const close_modal = vi.fn();
    fixture.componentInstance.close_modal.subscribe(close_modal);

    const cancelButton = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll("button"),
    ).find((button) => button.textContent?.trim() === "Cancel");
    (cancelButton as HTMLElement).click();

    expect(close_modal).toHaveBeenCalledOnce();
  });
});

describe("TemplateForm variables", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  function variable(name: string): PayloadVariable {
    return {
      id: name,
      name,
      generator: { kind: "randomInt", min: 0, max: 9 },
      created_at: "2026-01-01T00:00:00Z",
    };
  }

  it("opens the variables editor from the form", async () => {
    const { fixture } = await setup();
    const component = fixture.componentInstance;
    expect(component.showVariablesModal()).toBe(false);

    const button = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll("button"),
    ).find((b) => b.textContent?.trim() === "Edit Vars") as HTMLButtonElement;
    button.click();
    fixture.detectChanges();

    expect(component.showVariablesModal()).toBe(true);
    expect(
      (fixture.nativeElement as HTMLElement).textContent,
    ).toContain("Variables");
  });

  it("accepts a numeric variable in a JSON value position", async () => {
    const { fixture } = await setup({ variables: [variable("tempC")] });
    const component = fixture.componentInstance;

    component.form.controls.payload.setValue('{"t":{{tempC}}}');

    expect(component.payloadInvalid()).toBe(false);
  });

  it("warns about an unknown name even where the JSON still parses", async () => {
    const { fixture } = await setup();
    const component = fixture.componentInstance;

    component.form.controls.payload.setValue('{"id":"{{typo}}"}');
    fixture.detectChanges();

    expect(component.payloadInvalid()).toBe(false);
    expect(component.unknownVariables()).toEqual(["typo"]);
  });

  it("picks up unknown names used in the topic too", async () => {
    const { fixture } = await setup();
    const component = fixture.componentInstance;

    component.form.controls.topic.setValue("sensors/{{missing}}");

    expect(component.unknownVariables()).toEqual(["missing"]);
  });
});
