import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FavoriteCollection } from "../../../core/models/favorite-collection.model";
import { FavoriteMessage } from "../../../core/models/favorite-message.model";
import { MessageDraft } from "../../../core/models/message-draft.model";
import { FavoriteCollectionsService } from "../../../core/services/favorite-collections.service";
import { FavoritesService } from "../../../core/services/favorites.service";
import { SaveTemplateModal } from "./save-template-modal";

const DRAFT: MessageDraft = {
  topic: "sensors/zone-a",
  payload: '{"a":1}',
  format: "json",
  qos: "AtLeastOnce",
  retain: true,
};

const COLLECTION: FavoriteCollection = {
  id: "55555555-5555-5555-5555-555555555555",
  name: "Sensors",
  description: null,
  created_at: "2026-07-18T00:00:00Z",
};

const CREATED_FAVORITE: FavoriteMessage = {
  id: "66666666-6666-6666-6666-666666666666",
  collection_id: null,
  name: "zone-a",
  description: null,
  ...DRAFT,
  created_at: "2026-07-18T00:00:00Z",
};

async function setup(overrides: {
  create?: ReturnType<typeof vi.fn>;
  listCollections?: ReturnType<typeof vi.fn>;
  createCollection?: ReturnType<typeof vi.fn>;
  draft?: MessageDraft;
} = {}) {
  const favoritesService = {
    create: overrides.create ?? vi.fn().mockResolvedValue(CREATED_FAVORITE),
  };
  const collectionsService = {
    list: overrides.listCollections ?? vi.fn().mockResolvedValue([COLLECTION]),
    create: overrides.createCollection ?? vi.fn(),
  };

  TestBed.configureTestingModule({
    imports: [SaveTemplateModal],
    providers: [
      { provide: FavoritesService, useValue: favoritesService },
      { provide: FavoriteCollectionsService, useValue: collectionsService },
    ],
  });

  const fixture = TestBed.createComponent(SaveTemplateModal);
  fixture.componentRef.setInput("draft", overrides.draft ?? DRAFT);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, favoritesService, collectionsService };
}

describe("SaveTemplateModal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefills the name from the topic's last segment", async () => {
    const { fixture } = await setup();

    expect(fixture.componentInstance.form.controls.name.value).toBe("zone-a");
  });

  it("loads and lists the available collections", async () => {
    const { fixture, collectionsService } = await setup();

    expect(collectionsService.list).toHaveBeenCalled();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("Sensors");
  });

  it("does not save when the name is empty", async () => {
    const { fixture, favoritesService } = await setup();
    fixture.componentInstance.form.controls.name.setValue("");

    await fixture.componentInstance.save();

    expect(favoritesService.create).not.toHaveBeenCalled();
  });

  it("saves with collection_id null when no collection is selected", async () => {
    const { fixture, favoritesService } = await setup();

    await fixture.componentInstance.save();

    expect(favoritesService.create).toHaveBeenCalledWith({
      collection_id: null,
      name: "zone-a",
      description: null,
      topic: "sensors/zone-a",
      payload: '{"a":1}',
      format: "json",
      qos: "AtLeastOnce",
      retain: true,
    });
  });

  it("saves with the selected collection's id", async () => {
    const { fixture, favoritesService } = await setup();
    fixture.componentInstance.form.controls.collectionId.setValue(
      COLLECTION.id,
    );

    await fixture.componentInstance.save();

    expect(favoritesService.create).toHaveBeenCalledWith(
      expect.objectContaining({ collection_id: COLLECTION.id }),
    );
  });

  it("creates a new collection then saves with its id when '+ New collection' is chosen", async () => {
    const createCollection = vi.fn().mockResolvedValue({
      ...COLLECTION,
      id: "77777777-7777-7777-7777-777777777777",
      name: "New Group",
    });
    const { fixture, favoritesService } = await setup({
      createCollection,
    });
    fixture.componentInstance.form.controls.collectionId.setValue("__new__");
    fixture.componentInstance.form.controls.newCollectionName.setValue(
      "New Group",
    );

    await fixture.componentInstance.save();

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

  it("emits saved on a successful save", async () => {
    const { fixture } = await setup();
    const saved = vi.fn();
    fixture.componentInstance.saved.subscribe(saved);

    await fixture.componentInstance.save();

    expect(saved).toHaveBeenCalledOnce();
  });

  it("shows an error and does not emit saved when the save fails", async () => {
    const { fixture } = await setup({
      create: vi.fn().mockRejectedValue(new Error("disk full")),
    });
    const saved = vi.fn();
    fixture.componentInstance.saved.subscribe(saved);

    await fixture.componentInstance.save();

    expect(fixture.componentInstance.error()).toBe("disk full");
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
