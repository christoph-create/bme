import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";

import {
  FavoriteMessage,
  NewFavoriteMessage,
} from "../models/favorite-message.model";
import { FavoritesService } from "./favorites.service";

const SAMPLE_ID = "22222222-2222-2222-2222-222222222222";

function sampleNewFavorite(): NewFavoriteMessage {
  return {
    connection_id: null,
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

  it("saves a favorite via the save_favorite command with camelCased args", async () => {
    const newFavorite = sampleNewFavorite();
    const saved = sampleFavorite();
    mockIPC((cmd, args) => {
      if (cmd === "save_favorite") {
        expect(args).toEqual({ newFavorite });
        return saved;
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(
      new FavoritesService().save(newFavorite),
    ).resolves.toEqual(saved);
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
