import { describe, expect, it } from "vitest";

import { collectionNameConflict, FavoriteCollection } from "./favorite-collection.model";

function collection(id: string, name: string): FavoriteCollection {
  return { id, name, description: null, created_at: "2026-07-11T00:00:00Z" };
}

describe("collectionNameConflict", () => {
  const collections = [collection("1", "Sensors"), collection("2", "Actuators")];

  it("is false when the name doesn't match any existing collection", () => {
    expect(collectionNameConflict("Living room", collections)).toBe(false);
  });

  it("is true for an exact match", () => {
    expect(collectionNameConflict("Sensors", collections)).toBe(true);
  });

  it("is true for a case-insensitive, whitespace-padded match", () => {
    expect(collectionNameConflict("  sensors  ", collections)).toBe(true);
  });

  it("is false when the only match is the excluded id (renaming in place)", () => {
    expect(collectionNameConflict("Sensors", collections, "1")).toBe(false);
  });

  it("is true when the match is a different collection than the excluded id", () => {
    expect(collectionNameConflict("Actuators", collections, "1")).toBe(true);
  });

  it("is false for an empty or whitespace-only name", () => {
    expect(collectionNameConflict("", collections)).toBe(false);
    expect(collectionNameConflict("   ", collections)).toBe(false);
  });
});
