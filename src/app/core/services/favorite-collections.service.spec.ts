import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";

import {
  FavoriteCollection,
  NewFavoriteCollection,
  UpdateFavoriteCollection,
} from "../models/favorite-collection.model";
import { FavoriteCollectionsService } from "./favorite-collections.service";

const SAMPLE_ID = "33333333-3333-3333-3333-333333333333";

function sampleNewCollection(): NewFavoriteCollection {
  return {
    name: "Sensor payloads",
    description: "Common sensor test messages",
  };
}

function sampleCollection(): FavoriteCollection {
  return {
    id: SAMPLE_ID,
    ...sampleNewCollection(),
    created_at: "2026-07-11T00:00:00Z",
  };
}

describe("FavoriteCollectionsService", () => {
  afterEach(() => {
    clearMocks();
  });

  it("lists collections via the list_favorite_collections command", async () => {
    const collections = [sampleCollection()];
    mockIPC((cmd) => {
      if (cmd === "list_favorite_collections") return collections;
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(
      new FavoriteCollectionsService().list(),
    ).resolves.toEqual(collections);
  });

  it("gets a single collection via the get_favorite_collection command", async () => {
    const collection = sampleCollection();
    mockIPC((cmd, args) => {
      if (cmd === "get_favorite_collection") {
        expect(args).toEqual({ id: SAMPLE_ID });
        return collection;
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(
      new FavoriteCollectionsService().get(SAMPLE_ID),
    ).resolves.toEqual(collection);
  });

  it("resolves null from get_favorite_collection when not found", async () => {
    mockIPC((cmd) => {
      if (cmd === "get_favorite_collection") return null;
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(
      new FavoriteCollectionsService().get(SAMPLE_ID),
    ).resolves.toBeNull();
  });

  it("creates a collection via the create_favorite_collection command with camelCased args", async () => {
    const newCollection = sampleNewCollection();
    const created = sampleCollection();
    mockIPC((cmd, args) => {
      if (cmd === "create_favorite_collection") {
        expect(args).toEqual({ newCollection });
        return created;
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(
      new FavoriteCollectionsService().create(newCollection),
    ).resolves.toEqual(created);
  });

  it("updates a collection via the update_favorite_collection command with camelCased args", async () => {
    const update: UpdateFavoriteCollection = {
      name: "Renamed",
      description: null,
    };
    const updated: FavoriteCollection = { ...sampleCollection(), ...update };
    mockIPC((cmd, args) => {
      if (cmd === "update_favorite_collection") {
        expect(args).toEqual({ id: SAMPLE_ID, update });
        return updated;
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(
      new FavoriteCollectionsService().update(SAMPLE_ID, update),
    ).resolves.toEqual(updated);
  });

  it("deletes a collection via the delete_favorite_collection command", async () => {
    mockIPC((cmd, args) => {
      if (cmd === "delete_favorite_collection") {
        expect(args).toEqual({ id: SAMPLE_ID });
        return null;
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(
      new FavoriteCollectionsService().delete(SAMPLE_ID),
    ).resolves.toBeNull();
  });

  it("propagates command errors as rejected promises", async () => {
    mockIPC((cmd) => {
      if (cmd === "list_favorite_collections") {
        throw new Error("boom");
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(
      new FavoriteCollectionsService().list(),
    ).rejects.toThrow("boom");
  });
});
