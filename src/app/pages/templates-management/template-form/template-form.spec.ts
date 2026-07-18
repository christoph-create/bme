import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FavoriteCollection } from "../../../core/models/favorite-collection.model";
import { FavoriteMessage } from "../../../core/models/favorite-message.model";
import { FavoriteCollectionsService } from "../../../core/services/favorite-collections.service";
import { FavoritesService } from "../../../core/services/favorites.service";
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
} = {}) {
  const favoritesService = {
    create: overrides.create ?? vi.fn().mockResolvedValue(EXISTING),
    update: overrides.update ?? vi.fn().mockResolvedValue(EXISTING),
  };
  const collectionsService = {
    list: overrides.listCollections ?? vi.fn().mockResolvedValue([COLLECTION]),
    create: overrides.createCollection ?? vi.fn(),
  };

  TestBed.configureTestingModule({
    imports: [TemplateForm],
    providers: [
      { provide: FavoritesService, useValue: favoritesService },
      { provide: FavoriteCollectionsService, useValue: collectionsService },
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

  return { fixture, favoritesService, collectionsService };
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
        '{"celsius": 21.5}',
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
