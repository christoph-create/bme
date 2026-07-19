import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FavoriteCollection } from "../../core/models/favorite-collection.model";
import { FavoriteMessage } from "../../core/models/favorite-message.model";
import { FavoriteCollectionsService } from "../../core/services/favorite-collections.service";
import { FavoritesService } from "../../core/services/favorites.service";
import { TemplatesManagement } from "./templates-management";

function favorite(overrides: Partial<FavoriteMessage> = {}): FavoriteMessage {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    collection_id: null,
    name: null,
    description: null,
    topic: "sensors/zone-a",
    payload: "{}",
    format: "json",
    qos: "AtMostOnce",
    retain: false,
    created_at: "2026-07-18T00:00:00Z",
    ...overrides,
  };
}

const SENSORS_COLLECTION: FavoriteCollection = {
  id: "33333333-3333-3333-3333-333333333333",
  name: "Sensors",
  description: null,
  created_at: "2026-07-18T00:00:00Z",
};

const TEMPERATURE = favorite({
  id: "22222222-2222-2222-2222-222222222222",
  name: "Temperature",
  description: "Zone A temperature reading",
  topic: "sensors/zone-a/temperature",
  payload: '{"celsius": 21.5}',
  qos: "AtLeastOnce",
  retain: true,
  collection_id: SENSORS_COLLECTION.id,
});

const HUMIDITY = favorite({
  id: "44444444-4444-4444-4444-444444444444",
  name: "Humidity",
  topic: "sensors/zone-a/humidity",
});

async function setup(
  overrides: {
    favorites?: FavoriteMessage[];
    collections?: FavoriteCollection[];
    listFavorites?: ReturnType<typeof vi.fn>;
    listCollections?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const favoritesService = {
    list:
      overrides.listFavorites ??
      vi.fn().mockResolvedValue(overrides.favorites ?? [TEMPERATURE, HUMIDITY]),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const collectionsService = {
    list:
      overrides.listCollections ??
      vi.fn().mockResolvedValue(overrides.collections ?? [SENSORS_COLLECTION]),
    update: vi
      .fn()
      .mockImplementation((id: string, update: { name: string }) =>
        Promise.resolve({ ...SENSORS_COLLECTION, id, ...update }),
      ),
    delete: vi.fn().mockResolvedValue(undefined),
  };

  TestBed.configureTestingModule({
    imports: [TemplatesManagement],
    providers: [
      provideRouter([]),
      { provide: FavoritesService, useValue: favoritesService },
      { provide: FavoriteCollectionsService, useValue: collectionsService },
    ],
  });

  const fixture = TestBed.createComponent(TemplatesManagement);
  fixture.detectChanges();
  await fixture.whenStable();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, favoritesService, collectionsService };
}

describe("TemplatesManagement", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a heading and a link back to Connections", async () => {
    const { fixture } = await setup();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain("Templates");
    expect(element.querySelector('a[href="/connections"]')).toBeTruthy();
  });

  it("renders full detail for every template", async () => {
    const { fixture } = await setup();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("Temperature");
    expect(text).toContain("Zone A temperature reading");
    expect(text).toContain("sensors/zone-a/temperature");
    expect(text).toContain(JSON.stringify({ celsius: 21.5 }, null, 2));
    expect(text).toContain("Q1");
    expect(text).toContain("Retain");
    expect(text).toContain("Sensors");

    expect(text).toContain("Humidity");
    expect(text).toContain("sensors/zone-a/humidity");
  });

  it("shows the raw payload unformatted for raw-format templates", async () => {
    const { fixture } = await setup({
      favorites: [favorite({ payload: "plain text", format: "raw" })],
    });

    const preview = fixture.nativeElement.querySelector(".template-payload");
    expect(preview.textContent).toBe("plain text");
  });

  it("shows an empty state when there are no templates", async () => {
    const { fixture } = await setup({ favorites: [] });

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("No templates yet.");
  });

  it("shows an error message when loading fails", async () => {
    const { fixture } = await setup({
      listFavorites: vi.fn().mockRejectedValue(new Error("disk full")),
    });

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("disk full");
  });

  it("filters templates by search query matching name or topic", async () => {
    const { fixture } = await setup();
    const component = fixture.componentInstance;

    component.search.set("humidity");
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("Humidity");
    expect(text).not.toContain("Temperature");
  });

  it("filters templates by collection", async () => {
    const { fixture } = await setup();
    const component = fixture.componentInstance;

    component.collectionFilter.set(SENSORS_COLLECTION.id);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("Temperature");
    expect(text).not.toContain("Humidity");
  });

  it("deletes a template when Delete is clicked and removes it from the list", async () => {
    const { fixture, favoritesService } = await setup();

    await fixture.componentInstance.deleteTemplate(
      TEMPERATURE.id,
      new Event("click"),
    );
    fixture.detectChanges();

    expect(favoritesService.delete).toHaveBeenCalledWith(TEMPERATURE.id);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).not.toContain("Temperature");
    expect(text).toContain("Humidity");
  });

  it("closes the open menu on a click anywhere outside it", async () => {
    const { fixture } = await setup();
    const component = fixture.componentInstance;

    component.toggleMenu(TEMPERATURE.id, new Event("click"));
    expect(component.openMenuId()).toBe(TEMPERATURE.id);

    document.dispatchEvent(new Event("click"));

    expect(component.openMenuId()).toBeNull();
  });

  it("opens the form in create mode from the New Template button", async () => {
    const { fixture } = await setup();
    const component = fixture.componentInstance;

    component.openCreateForm();
    fixture.detectChanges();

    expect(component.formTarget()).toBe("new");
    const form = fixture.nativeElement.querySelector("app-template-form");
    expect(form).toBeTruthy();
  });

  it("adds the created template to the list when the form emits saved", async () => {
    const { fixture } = await setup();
    const component = fixture.componentInstance;
    const created = favorite({
      id: "88888888-8888-8888-8888-888888888888",
      name: "Brand New",
    });

    component.openCreateForm();
    component.onFormSaved(created);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("Brand New");
    expect(component.formTarget()).toBeNull();
  });

  it("opens the form in edit mode with the selected template", async () => {
    const { fixture } = await setup();
    const component = fixture.componentInstance;

    component.openEditForm(TEMPERATURE, new Event("click"));
    fixture.detectChanges();

    expect(component.formTarget()).toBe(TEMPERATURE);
    const form = fixture.nativeElement.querySelector("app-template-form");
    expect(form).toBeTruthy();
  });

  it("replaces the edited template in the list when the form emits saved", async () => {
    const { fixture } = await setup();
    const component = fixture.componentInstance;
    const updated = { ...TEMPERATURE, name: "Renamed" };

    component.openEditForm(TEMPERATURE, new Event("click"));
    component.onFormSaved(updated);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("Renamed");
    expect(text).not.toContain("Temperature");
  });

  it("picks up a collection created inline by the form without a page reload", async () => {
    const NEW_COLLECTION: FavoriteCollection = {
      id: "99999999-9999-9999-9999-999999999999",
      name: "New Group",
      description: null,
      created_at: "2026-07-18T00:00:00Z",
    };
    const listCollections = vi
      .fn()
      .mockResolvedValueOnce([SENSORS_COLLECTION])
      .mockResolvedValue([SENSORS_COLLECTION, NEW_COLLECTION]);
    const { fixture } = await setup({ listCollections });
    const component = fixture.componentInstance;
    const updated = { ...TEMPERATURE, collection_id: NEW_COLLECTION.id };

    component.openEditForm(TEMPERATURE, new Event("click"));
    await component.onFormSaved(updated);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("New Group");
    expect(
      component
        .collections()
        .some((collection) => collection.id === NEW_COLLECTION.id),
    ).toBe(true);
  });

  it("renders each collection with rename and delete controls", async () => {
    const { fixture } = await setup();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("Sensors");
    const collectionRow = (fixture.nativeElement as HTMLElement).querySelector(
      ".collection-row",
    );
    expect(collectionRow).toBeTruthy();
  });

  it("renames a collection and reflects the new name on its templates", async () => {
    const { fixture, collectionsService } = await setup();
    const component = fixture.componentInstance;

    component.startRenameCollection(SENSORS_COLLECTION);
    component.collectionNameDraft.set("Environment");
    await component.saveRenameCollection(SENSORS_COLLECTION.id);
    fixture.detectChanges();

    expect(collectionsService.update).toHaveBeenCalledWith(
      SENSORS_COLLECTION.id,
      { name: "Environment", description: null },
    );
    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("Environment");
    expect(text).not.toContain("Sensors");
  });

  it("deletes a collection and un-scopes its templates without a refetch", async () => {
    const { fixture, collectionsService, favoritesService } = await setup();
    const component = fixture.componentInstance;

    await component.deleteCollection(SENSORS_COLLECTION.id);
    fixture.detectChanges();

    expect(collectionsService.delete).toHaveBeenCalledWith(
      SENSORS_COLLECTION.id,
    );
    expect(favoritesService.list).toHaveBeenCalledTimes(1);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).not.toContain("Sensors");
    expect(text).toContain("Temperature");
    expect(
      component
        .favorites()
        .find((favorite) => favorite.id === TEMPERATURE.id)?.collection_id,
    ).toBeNull();
  });
});
