import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FavoriteCollection } from "../../../core/models/favorite-collection.model";
import { FavoriteMessage } from "../../../core/models/favorite-message.model";
import { FavoriteCollectionsService } from "../../../core/services/favorite-collections.service";
import { FavoritesService } from "../../../core/services/favorites.service";
import { LoadTemplateModal } from "./load-template-modal";

function favorite(overrides: Partial<FavoriteMessage>): FavoriteMessage {
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

const TEMPERATURE = favorite({
  id: "22222222-2222-2222-2222-222222222222",
  name: "Temperature",
  topic: "sensors/zone-a/temperature",
  collection_id: "33333333-3333-3333-3333-333333333333",
});

const HUMIDITY = favorite({
  id: "44444444-4444-4444-4444-444444444444",
  name: "Humidity",
  topic: "sensors/zone-a/humidity",
});

const SENSORS_COLLECTION: FavoriteCollection = {
  id: "33333333-3333-3333-3333-333333333333",
  name: "Sensors",
  description: null,
  created_at: "2026-07-18T00:00:00Z",
};

async function setup(overrides: {
  favorites?: FavoriteMessage[];
  collections?: FavoriteCollection[];
  listFavorites?: ReturnType<typeof vi.fn>;
} = {}) {
  const favoritesService = {
    list:
      overrides.listFavorites ??
      vi.fn().mockResolvedValue(overrides.favorites ?? [TEMPERATURE, HUMIDITY]),
  };
  const collectionsService = {
    list: vi.fn().mockResolvedValue(overrides.collections ?? [SENSORS_COLLECTION]),
  };

  TestBed.configureTestingModule({
    imports: [LoadTemplateModal],
    providers: [
      { provide: FavoritesService, useValue: favoritesService },
      { provide: FavoriteCollectionsService, useValue: collectionsService },
    ],
  });

  const fixture = TestBed.createComponent(LoadTemplateModal);
  fixture.detectChanges();
  await fixture.whenStable();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, favoritesService, collectionsService };
}

function rowTexts(fixture: Awaited<ReturnType<typeof setup>>["fixture"]): string[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll(".template-row"),
  ).map((row) => row.textContent ?? "");
}

function detailElements(
  fixture: Awaited<ReturnType<typeof setup>>["fixture"],
): HTMLElement[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll(
      ".template-detail",
    ),
  ) as HTMLElement[];
}

describe("LoadTemplateModal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists all templates by default", async () => {
    const { fixture } = await setup();

    const texts = rowTexts(fixture);
    expect(texts.length).toBe(2);
    expect(texts.some((t) => t.includes("Temperature"))).toBe(true);
    expect(texts.some((t) => t.includes("Humidity"))).toBe(true);
  });

  it("falls back to the topic when a template has no name", async () => {
    const { fixture } = await setup({
      favorites: [favorite({ name: null, topic: "sensors/unnamed" })],
    });

    expect(rowTexts(fixture)[0]).toContain("sensors/unnamed");
  });

  it("shows the description instead of the topic when a description is present", async () => {
    const { fixture } = await setup({
      favorites: [
        favorite({
          name: "Temperature",
          topic: "sensors/zone-a/temperature",
          description: "Sent every 30s while the sensor is online",
        }),
      ],
    });

    const [detail] = detailElements(fixture);
    expect(detail.textContent?.trim()).toBe(
      "Sent every 30s while the sensor is online",
    );
    expect(detail.title).toBe("sensors/zone-a/temperature");
  });

  it("falls back to the topic when there is no description", async () => {
    const { fixture } = await setup({
      favorites: [
        favorite({
          name: "Temperature",
          topic: "sensors/zone-a/temperature",
          description: null,
        }),
      ],
    });

    const [detail] = detailElements(fixture);
    expect(detail.textContent?.trim()).toBe("sensors/zone-a/temperature");
  });

  it("shows an empty state when there are no templates", async () => {
    const { fixture } = await setup({ favorites: [] });

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("No templates yet");
    expect(rowTexts(fixture).length).toBe(0);
  });

  it("filters by search text against name and topic", async () => {
    const { fixture } = await setup();

    fixture.componentInstance.search.set("humidity");
    fixture.detectChanges();

    const texts = rowTexts(fixture);
    expect(texts.length).toBe(1);
    expect(texts[0]).toContain("Humidity");
  });

  it("shows a no-matches message when the filter matches nothing", async () => {
    const { fixture } = await setup();

    fixture.componentInstance.search.set("nonexistent");
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("No matching templates");
  });

  it("filters by collection", async () => {
    const { fixture } = await setup();

    fixture.componentInstance.collectionFilter.set(SENSORS_COLLECTION.id);
    fixture.detectChanges();

    const texts = rowTexts(fixture);
    expect(texts.length).toBe(1);
    expect(texts[0]).toContain("Temperature");
  });

  it("shows the collection name next to templates that belong to one", async () => {
    const { fixture } = await setup();

    expect(rowTexts(fixture)[0]).toContain("Sensors");
  });

  it("emits selected with the clicked template", async () => {
    const { fixture } = await setup();
    const selected = vi.fn();
    fixture.componentInstance.selected.subscribe(selected);

    const row = (fixture.nativeElement as HTMLElement).querySelector(
      ".template-row",
    ) as HTMLElement;
    row.click();

    expect(selected).toHaveBeenCalledWith(TEMPERATURE);
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

  it("shows an error if loading fails", async () => {
    const { fixture } = await setup({
      listFavorites: vi.fn().mockRejectedValue(new Error("offline")),
    });

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("offline");
  });
});
