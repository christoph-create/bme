import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";

import {
  FavoriteMessage,
  NewFavoriteMessage,
  UpdateFavoriteMessage,
} from "../models/favorite-message.model";
import { FavoritesService } from "./favorites.service";

const SAMPLE_ID = "22222222-2222-2222-2222-222222222222";

function sampleNewFavorite(): NewFavoriteMessage {
  return {
    connection_id: null,
    name: "Temperature reading",
    description: "A sample sensor payload",
    topic: "sensors/temp",
    payload: "42",
    qos: "AtMostOnce",
    retain: false,
  };
}

function sampleFavorite(): FavoriteMessage {
  return {
    id: SAMPLE_ID,
    ...sampleNewFavorite(),
    created_at: "2026-07-11T00:00:00Z",
  };
}

describe("FavoritesService", () => {
  afterEach(() => {
    clearMocks();
  });

  it("lists favorites via the list_favorites command", async () => {
    const favorites = [sampleFavorite()];
    mockIPC((cmd) => {
      if (cmd === "list_favorites") return favorites;
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(new FavoritesService().list()).resolves.toEqual(favorites);
  });

  it("gets a single favorite via the get_favorite command", async () => {
    const favorite = sampleFavorite();
    mockIPC((cmd, args) => {
      if (cmd === "get_favorite") {
        expect(args).toEqual({ id: SAMPLE_ID });
        return favorite;
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(new FavoritesService().get(SAMPLE_ID)).resolves.toEqual(
      favorite,
    );
  });

  it("resolves null from get_favorite when the favorite is not found", async () => {
    mockIPC((cmd) => {
      if (cmd === "get_favorite") return null;
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(
      new FavoritesService().get(SAMPLE_ID),
    ).resolves.toBeNull();
  });

  it("creates a favorite via the create_favorite command with camelCased args", async () => {
    const newFavorite = sampleNewFavorite();
    const created = sampleFavorite();
    mockIPC((cmd, args) => {
      if (cmd === "create_favorite") {
        expect(args).toEqual({ newFavorite });
        return created;
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(
      new FavoritesService().create(newFavorite),
    ).resolves.toEqual(created);
  });

  it("updates a favorite via the update_favorite command with camelCased args", async () => {
    const update: UpdateFavoriteMessage = {
      connection_id: null,
      name: "Renamed",
      description: null,
      topic: "sensors/humidity",
      payload: "55",
      qos: "ExactlyOnce",
      retain: true,
    };
    const updated: FavoriteMessage = { ...sampleFavorite(), ...update };
    mockIPC((cmd, args) => {
      if (cmd === "update_favorite") {
        expect(args).toEqual({ id: SAMPLE_ID, update });
        return updated;
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(
      new FavoritesService().update(SAMPLE_ID, update),
    ).resolves.toEqual(updated);
  });

  it("deletes a favorite via the delete_favorite command", async () => {
    mockIPC((cmd, args) => {
      if (cmd === "delete_favorite") {
        expect(args).toEqual({ id: SAMPLE_ID });
        return null;
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(
      new FavoritesService().delete(SAMPLE_ID),
    ).resolves.toBeNull();
  });

  it("propagates command errors as rejected promises", async () => {
    mockIPC((cmd) => {
      if (cmd === "list_favorites") {
        throw new Error("boom");
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(new FavoritesService().list()).rejects.toThrow("boom");
  });
});
