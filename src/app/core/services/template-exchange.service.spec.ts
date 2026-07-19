import { beforeEach, describe, expect, it } from "vitest";

import { FavoriteCollection } from "../models/favorite-collection.model";
import { FavoriteMessage } from "../models/favorite-message.model";
import { TemplateExchangeService } from "./template-exchange.service";

function favorite(overrides: Partial<FavoriteMessage> = {}): FavoriteMessage {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    collection_id: null,
    name: "Turn fan on",
    description: "Sets the fan to on",
    topic: "home/livingroom/fan/set",
    payload: '{"state":"on"}',
    format: "json",
    qos: "AtLeastOnce",
    retain: false,
    created_at: "2026-07-19T00:00:00Z",
    ...overrides,
  };
}

const COLLECTION: FavoriteCollection = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Living room",
  description: "Everything for the living room",
  created_at: "2026-07-19T00:00:00Z",
};

describe("TemplateExchangeService", () => {
  let service: TemplateExchangeService;

  beforeEach(() => {
    service = new TemplateExchangeService();
  });

  describe("template document round trip", () => {
    it("builds, serializes, and parses back to an equivalent document", () => {
      const built = service.buildTemplateDocument(favorite());
      const parsed = service.parse(service.serialize(built));

      expect(parsed).toEqual({ ok: true, document: built });
    });

    it("drops id/collection_id/created_at from the template item", () => {
      const built = service.buildTemplateDocument(
        favorite({ collection_id: COLLECTION.id }),
      );

      expect(built.template).toEqual({
        name: "Turn fan on",
        description: "Sets the fan to on",
        topic: "home/livingroom/fan/set",
        payload: '{"state":"on"}',
        format: "json",
        qos: 1,
        retain: false,
      });
    });

    it("converts the parsed item back into a NewFavoriteMessage", () => {
      const built = service.buildTemplateDocument(favorite());
      const result = service.parse(service.serialize(built));
      if (!result.ok || result.document.kind !== "template") {
        throw new Error("expected a parsed template document");
      }

      expect(service.toNewFavorite(result.document.template, COLLECTION.id)).toEqual({
        collection_id: COLLECTION.id,
        name: "Turn fan on",
        description: "Sets the fan to on",
        topic: "home/livingroom/fan/set",
        payload: '{"state":"on"}',
        format: "json",
        qos: "AtLeastOnce",
        retain: false,
      });
    });
  });

  describe("collection document round trip", () => {
    it("builds, serializes, and parses back to an equivalent document", () => {
      const templates = [
        favorite({ collection_id: COLLECTION.id }),
        favorite({
          id: "33333333-3333-3333-3333-333333333333",
          collection_id: COLLECTION.id,
          topic: "home/livingroom/lamp/set",
        }),
      ];
      const built = service.buildCollectionDocument(COLLECTION, templates);
      const parsed = service.parse(service.serialize(built));

      expect(parsed).toEqual({ ok: true, document: built });
      expect(built.templates).toHaveLength(2);
    });
  });

  describe("bundle document round trip", () => {
    it("groups favorites by collection_id, uncategorized ones go under top-level templates", () => {
      const inCollection = favorite({ collection_id: COLLECTION.id });
      const uncategorized = favorite({
        id: "44444444-4444-4444-4444-444444444444",
        collection_id: null,
        topic: "home/hallway/light/set",
      });
      const built = service.buildBundleDocument(
        [COLLECTION],
        [inCollection, uncategorized],
      );

      expect(built.collections).toEqual([
        {
          name: COLLECTION.name,
          description: COLLECTION.description,
          templates: [service.toTemplateItem(inCollection)],
        },
      ]);
      expect(built.templates).toEqual([service.toTemplateItem(uncategorized)]);

      const parsed = service.parse(service.serialize(built));
      expect(parsed).toEqual({ ok: true, document: built });
    });
  });

  describe("parse validation", () => {
    it("rejects text that isn't valid JSON", () => {
      expect(service.parse("not json")).toEqual({
        ok: false,
        error: "That isn't valid JSON.",
      });
    });

    it("rejects a JSON document that isn't an object", () => {
      const result = service.parse("[1,2,3]");
      expect(result).toEqual({ ok: false, error: '"document" must be an object.' });
    });

    it("rejects a missing specVersion", () => {
      const result = service.parse(JSON.stringify({ kind: "template" }));
      expect(result).toEqual({
        ok: false,
        error: '"specVersion" must be a string.',
      });
    });

    it("rejects an unsupported major specVersion", () => {
      const result = service.parse(
        JSON.stringify({ specVersion: "2.0", kind: "template", template: {} }),
      );
      expect(result).toEqual({
        ok: false,
        error:
          'Unsupported specVersion "2.0" - this app only understands version 1.x documents.',
      });
    });

    it("accepts a forward-compatible minor specVersion", () => {
      const built = service.buildTemplateDocument(favorite());
      const withNewerMinor = { ...built, specVersion: "1.7" };

      const result = service.parse(JSON.stringify(withNewerMinor));

      expect(result).toEqual({ ok: true, document: withNewerMinor });
    });

    it("rejects an unknown kind", () => {
      const result = service.parse(
        JSON.stringify({ specVersion: "1.0", kind: "bogus" }),
      );
      expect(result).toEqual({
        ok: false,
        error: 'Unknown document kind "bogus" - expected "template", "collection", or "bundle".',
      });
    });

    it("rejects a template document missing a required field", () => {
      const result = service.parse(
        JSON.stringify({
          specVersion: "1.0",
          kind: "template",
          template: {
            name: null,
            description: null,
            payload: "{}",
            format: "json",
            qos: 0,
            retain: false,
          },
        }),
      );
      expect(result).toEqual({
        ok: false,
        error: '"template.topic" must be a string.',
      });
    });

    it("rejects an empty topic", () => {
      const built = service.buildTemplateDocument(favorite({ topic: "   " }));
      const result = service.parse(service.serialize(built));
      expect(result).toEqual({
        ok: false,
        error: "template.topic must not be empty.",
      });
    });

    it("rejects an invalid format value", () => {
      const built = service.buildTemplateDocument(favorite());
      const invalid = {
        ...built,
        template: { ...built.template, format: "xml" },
      };
      const result = service.parse(JSON.stringify(invalid));
      expect(result).toEqual({
        ok: false,
        error: '"template.format" must be "json" or "raw".',
      });
    });

    it("rejects an invalid qos value", () => {
      const built = service.buildTemplateDocument(favorite());
      const invalid = { ...built, template: { ...built.template, qos: 3 } };
      const result = service.parse(JSON.stringify(invalid));
      expect(result).toEqual({
        ok: false,
        error: '"template.qos" must be 0, 1, or 2.',
      });
    });

    it("rejects a non-boolean retain value", () => {
      const built = service.buildTemplateDocument(favorite());
      const invalid = {
        ...built,
        template: { ...built.template, retain: "yes" },
      };
      const result = service.parse(JSON.stringify(invalid));
      expect(result).toEqual({
        ok: false,
        error: '"template.retain" must be a boolean.',
      });
    });

    it("rejects an empty collection name", () => {
      const built = service.buildCollectionDocument(
        { ...COLLECTION, name: "  " },
        [],
      );
      const result = service.parse(service.serialize(built));
      expect(result).toEqual({
        ok: false,
        error: "collection.name must not be empty.",
      });
    });

    it("rejects templates that isn't an array", () => {
      const result = service.parse(
        JSON.stringify({
          specVersion: "1.0",
          kind: "collection",
          collection: { name: "X", description: null },
          templates: "not an array",
        }),
      );
      expect(result).toEqual({
        ok: false,
        error: '"templates" must be an array.',
      });
    });

    it("ignores unknown extra fields instead of rejecting the document", () => {
      const built = service.buildTemplateDocument(favorite());
      const withExtra = {
        ...built,
        extraTopLevelField: "ignored",
        template: { ...built.template, extraFieldOnTemplate: 42 },
      };

      const result = service.parse(JSON.stringify(withExtra));

      expect(result).toEqual({ ok: true, document: built });
    });
  });
});
