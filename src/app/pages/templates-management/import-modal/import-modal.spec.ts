import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FavoriteCollection } from "../../../core/models/favorite-collection.model";
import {
  BundleDocument,
  CollectionDocument,
  TemplateDocument,
  TemplateItem,
} from "../../../core/models/template-exchange.model";
import { FavoriteCollectionsService } from "../../../core/services/favorite-collections.service";
import { FavoritesService } from "../../../core/services/favorites.service";
import { ImportModal } from "./import-modal";

const EXISTING_COLLECTION: FavoriteCollection = {
  id: "c1",
  name: "Sensors",
  description: null,
  created_at: "2026-07-19T00:00:00Z",
};

function templateItem(overrides: Partial<TemplateItem> = {}): TemplateItem {
  return {
    name: "Turn fan on",
    description: null,
    topic: "home/livingroom/fan/set",
    payload: '{"state":"on"}',
    format: "json",
    qos: 1,
    retain: false,
    ...overrides,
  };
}

function templateDocument(overrides: Partial<TemplateItem> = {}): TemplateDocument {
  return {
    specVersion: "1.0",
    kind: "template",
    template: templateItem(overrides),
  };
}

function collectionDocument(
  name: string,
  templates: TemplateItem[] = [templateItem()],
): CollectionDocument {
  return {
    specVersion: "1.0",
    kind: "collection",
    collection: { name, description: "desc" },
    templates,
  };
}

function bundleDocument(
  collectionNames: string[],
  uncategorized: TemplateItem[] = [],
): BundleDocument {
  return {
    specVersion: "1.0",
    kind: "bundle",
    collections: collectionNames.map((name) => ({
      name,
      description: null,
      templates: [templateItem()],
    })),
    templates: uncategorized,
  };
}

async function setup(
  overrides: {
    collections?: FavoriteCollection[];
    create?: ReturnType<typeof vi.fn>;
    createCollection?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const favoritesService = {
    create: overrides.create ?? vi.fn().mockResolvedValue({}),
  };
  let nextCollectionId = 100;
  const collectionsService = {
    list: vi.fn().mockResolvedValue(overrides.collections ?? [EXISTING_COLLECTION]),
    create:
      overrides.createCollection ??
      vi.fn().mockImplementation((newCollection: { name: string; description: string | null }) =>
        Promise.resolve({
          id: `new-${nextCollectionId++}`,
          ...newCollection,
          created_at: "2026-07-19T00:00:00Z",
        }),
      ),
  };

  TestBed.configureTestingModule({
    imports: [ImportModal],
    providers: [
      { provide: FavoritesService, useValue: favoritesService },
      { provide: FavoriteCollectionsService, useValue: collectionsService },
    ],
  });

  const fixture = TestBed.createComponent(ImportModal);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, favoritesService, collectionsService };
}

function setPastedText(fixture: ReturnType<typeof TestBed.createComponent<ImportModal>>, text: string) {
  fixture.componentInstance.pastedText.set(text);
}

describe("ImportModal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a parse error for invalid JSON and stays on the paste step", async () => {
    const { fixture } = await setup();
    setPastedText(fixture, "not json");

    fixture.componentInstance.parse();
    fixture.detectChanges();

    expect(fixture.componentInstance.parseError()).toBe("That isn't valid JSON.");
    expect(fixture.componentInstance.parsedDocument()).toBeNull();
  });

  describe("template document", () => {
    it("parses and imports as a new, uncategorized template", async () => {
      const { fixture, favoritesService } = await setup();
      setPastedText(fixture, JSON.stringify(templateDocument()));
      fixture.componentInstance.parse();
      fixture.detectChanges();

      const imported = vi.fn();
      fixture.componentInstance.imported.subscribe(imported);
      await fixture.componentInstance.confirm();

      expect(favoritesService.create).toHaveBeenCalledWith({
        collection_id: null,
        name: "Turn fan on",
        description: null,
        topic: "home/livingroom/fan/set",
        payload: '{"state":"on"}',
        format: "json",
        qos: "AtLeastOnce",
        retain: false,
      });
      expect(imported).toHaveBeenCalledOnce();
    });
  });

  describe("collection document", () => {
    it("blocks confirm while the name collides with an existing collection", async () => {
      const { fixture, collectionsService } = await setup();
      setPastedText(fixture, JSON.stringify(collectionDocument("sensors")));
      fixture.componentInstance.parse();
      fixture.detectChanges();

      expect(fixture.componentInstance.hasUnresolvedConflicts()).toBe(true);
      await fixture.componentInstance.confirm();

      expect(collectionsService.create).not.toHaveBeenCalled();
    });

    it("imports the collection and its templates once renamed to something unique", async () => {
      const { fixture, collectionsService, favoritesService } = await setup();
      setPastedText(fixture, JSON.stringify(collectionDocument("Sensors")));
      fixture.componentInstance.parse();
      fixture.componentInstance.collectionNameDraft.set("Sensors (imported)");
      fixture.detectChanges();

      expect(fixture.componentInstance.hasUnresolvedConflicts()).toBe(false);
      const imported = vi.fn();
      fixture.componentInstance.imported.subscribe(imported);
      await fixture.componentInstance.confirm();

      expect(collectionsService.create).toHaveBeenCalledWith({
        name: "Sensors (imported)",
        description: "desc",
      });
      expect(favoritesService.create).toHaveBeenCalledWith(
        expect.objectContaining({ collection_id: "new-100" }),
      );
      expect(imported).toHaveBeenCalledOnce();
    });
  });

  describe("bundle document", () => {
    it("only blocks the colliding collection, importing others independently", async () => {
      const { fixture } = await setup();
      setPastedText(
        fixture,
        JSON.stringify(bundleDocument(["Sensors", "Actuators"])),
      );
      fixture.componentInstance.parse();
      fixture.detectChanges();

      expect(fixture.componentInstance.bundleCollectionConflict(0)).toBe(true);
      expect(fixture.componentInstance.bundleCollectionConflict(1)).toBe(false);
      expect(fixture.componentInstance.hasUnresolvedConflicts()).toBe(true);
    });

    it("creates every renamed collection plus uncategorized templates", async () => {
      const { fixture, collectionsService, favoritesService } = await setup();
      const uncategorized = templateItem({ topic: "home/hallway/light/set" });
      setPastedText(
        fixture,
        JSON.stringify(bundleDocument(["Sensors", "Actuators"], [uncategorized])),
      );
      fixture.componentInstance.parse();
      fixture.componentInstance.bundleCollectionNameDrafts.set([
        "Sensors (imported)",
        "Actuators",
      ]);
      fixture.detectChanges();

      expect(fixture.componentInstance.hasUnresolvedConflicts()).toBe(false);
      const imported = vi.fn();
      fixture.componentInstance.imported.subscribe(imported);
      await fixture.componentInstance.confirm();

      expect(collectionsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Sensors (imported)" }),
      );
      expect(collectionsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Actuators" }),
      );
      expect(favoritesService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          collection_id: null,
          topic: "home/hallway/light/set",
        }),
      );
      expect(imported).toHaveBeenCalledOnce();
    });
  });

  it("returns to the paste step on Back, keeping the pasted text", async () => {
    const { fixture } = await setup();
    setPastedText(fixture, JSON.stringify(templateDocument()));
    fixture.componentInstance.parse();
    fixture.detectChanges();

    fixture.componentInstance.backToPaste();
    fixture.detectChanges();

    expect(fixture.componentInstance.parsedDocument()).toBeNull();
    expect(fixture.componentInstance.pastedText()).toBe(
      JSON.stringify(templateDocument()),
    );
  });

  it("emits close when Cancel is clicked on the paste step", async () => {
    const { fixture } = await setup();
    const close_modal = vi.fn();
    fixture.componentInstance.close_modal.subscribe(close_modal);

    const cancelButton = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll("button"),
    ).find((button) => button.textContent?.trim() === "Cancel");
    (cancelButton as HTMLElement).click();

    expect(close_modal).toHaveBeenCalledOnce();
  });

  it("shows an error and does not emit imported when a create call fails", async () => {
    const { fixture } = await setup({
      create: vi.fn().mockRejectedValue(new Error("disk full")),
    });
    setPastedText(fixture, JSON.stringify(templateDocument()));
    fixture.componentInstance.parse();
    fixture.detectChanges();
    const imported = vi.fn();
    fixture.componentInstance.imported.subscribe(imported);

    await fixture.componentInstance.confirm();

    expect(fixture.componentInstance.importError()).toBe("disk full");
    expect(imported).not.toHaveBeenCalled();
  });
});
