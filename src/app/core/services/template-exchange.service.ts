import { Injectable } from "@angular/core";

import { FavoriteCollection } from "../models/favorite-collection.model";
import {
  FavoriteMessage,
  NewFavoriteMessage,
} from "../models/favorite-message.model";
import { MessageFormat } from "../models/message-format.model";
import { qosFromNumber, qosNumber } from "../models/qos";
import {
  BundleDocument,
  CollectionDocument,
  ExchangeDocument,
  TEMPLATE_EXCHANGE_SPEC_VERSION,
  TemplateDocument,
  TemplateItem,
} from "../models/template-exchange.model";

export type TemplateExchangeParseResult =
  | { readonly ok: true; readonly document: ExchangeDocument }
  | { readonly ok: false; readonly error: string };

/** Thrown by the parse-side helpers below and caught at the top of
 * `parse()` - lets validation short-circuit from anywhere in the call
 * tree and surface one human-readable message, the same "report the first
 * problem, not a stack of them" approach `JsonFormatService` uses. */
class InvalidDocument extends Error {}

/**
 * Single source of truth for building and parsing the JSON exchange
 * format defined in `spec/template-format-v1.md` - the export/import
 * counterpart to `JsonFormatService` for payload text.
 */
@Injectable({ providedIn: "root" })
export class TemplateExchangeService {
  toTemplateItem(favorite: FavoriteMessage): TemplateItem {
    return {
      name: favorite.name,
      description: favorite.description,
      topic: favorite.topic,
      payload: favorite.payload,
      format: favorite.format,
      qos: qosNumber(favorite.qos),
      retain: favorite.retain,
    };
  }

  buildTemplateDocument(favorite: FavoriteMessage): TemplateDocument {
    return {
      specVersion: TEMPLATE_EXCHANGE_SPEC_VERSION,
      kind: "template",
      template: this.toTemplateItem(favorite),
    };
  }

  buildCollectionDocument(
    collection: FavoriteCollection,
    templates: readonly FavoriteMessage[],
  ): CollectionDocument {
    return {
      specVersion: TEMPLATE_EXCHANGE_SPEC_VERSION,
      kind: "collection",
      collection: {
        name: collection.name,
        description: collection.description,
      },
      templates: templates.map((favorite) => this.toTemplateItem(favorite)),
    };
  }

  /** Groups `favorites` by `collection_id` itself, so callers just pass the
   * full lists exactly as loaded from the page's `collections`/`favorites`
   * signals. */
  buildBundleDocument(
    collections: readonly FavoriteCollection[],
    favorites: readonly FavoriteMessage[],
  ): BundleDocument {
    return {
      specVersion: TEMPLATE_EXCHANGE_SPEC_VERSION,
      kind: "bundle",
      collections: collections.map((collection) => ({
        name: collection.name,
        description: collection.description,
        templates: favorites
          .filter((favorite) => favorite.collection_id === collection.id)
          .map((favorite) => this.toTemplateItem(favorite)),
      })),
      templates: favorites
        .filter((favorite) => favorite.collection_id === null)
        .map((favorite) => this.toTemplateItem(favorite)),
    };
  }

  serialize(document: ExchangeDocument): string {
    return JSON.stringify(document, null, 2);
  }

  toNewFavorite(
    item: TemplateItem,
    collectionId: string | null,
  ): NewFavoriteMessage {
    return {
      collection_id: collectionId,
      name: item.name,
      description: item.description,
      topic: item.topic,
      payload: item.payload,
      format: item.format,
      qos: qosFromNumber(item.qos),
      retain: item.retain,
    };
  }

  parse(text: string): TemplateExchangeParseResult {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { ok: false, error: "That isn't valid JSON." };
    }
    try {
      return { ok: true, document: parseDocument(raw) };
    } catch (err) {
      if (err instanceof InvalidDocument) {
        return { ok: false, error: err.message };
      }
      throw err;
    }
  }
}

function parseDocument(raw: unknown): ExchangeDocument {
  const root = expectObject(raw, "document");
  const specVersion = expectString(root["specVersion"], "specVersion");
  assertSupportedVersion(specVersion);

  const kind = root["kind"];
  if (kind === "template") {
    return {
      specVersion,
      kind: "template",
      template: parseTemplateItem(root["template"]),
    };
  }
  if (kind === "collection") {
    return {
      specVersion,
      kind: "collection",
      collection: parseCollectionMeta(root["collection"]),
      templates: parseTemplateItemArray(root["templates"]),
    };
  }
  if (kind === "bundle") {
    return {
      specVersion,
      kind: "bundle",
      collections: parseBundleCollections(root["collections"]),
      templates: parseTemplateItemArray(root["templates"]),
    };
  }
  throw new InvalidDocument(
    `Unknown document kind "${String(kind)}" - expected "template", "collection", or "bundle".`,
  );
}

function assertSupportedVersion(specVersion: string): void {
  const majorVersion = specVersion.split(".")[0];
  if (majorVersion !== "1") {
    throw new InvalidDocument(
      `Unsupported specVersion "${specVersion}" - this app only understands version 1.x documents.`,
    );
  }
}

function parseBundleCollections(raw: unknown): BundleDocument["collections"] {
  if (!Array.isArray(raw)) {
    throw new InvalidDocument('"collections" must be an array.');
  }
  return raw.map((entry) => ({
    ...parseCollectionMeta(entry),
    templates: parseTemplateItemArray(expectObject(entry, "collection")["templates"]),
  }));
}

function parseCollectionMeta(raw: unknown): {
  name: string;
  description: string | null;
} {
  const obj = expectObject(raw, "collection");
  const name = expectString(obj["name"], "collection.name").trim();
  if (name === "") {
    throw new InvalidDocument("collection.name must not be empty.");
  }
  return {
    name,
    description: expectOptionalString(obj["description"], "collection.description"),
  };
}

function parseTemplateItemArray(raw: unknown): TemplateItem[] {
  if (!Array.isArray(raw)) {
    throw new InvalidDocument('"templates" must be an array.');
  }
  return raw.map((entry) => parseTemplateItem(entry));
}

function parseTemplateItem(raw: unknown): TemplateItem {
  const obj = expectObject(raw, "template");
  const topic = expectString(obj["topic"], "template.topic").trim();
  if (topic === "") {
    throw new InvalidDocument("template.topic must not be empty.");
  }
  return {
    name: expectOptionalString(obj["name"], "template.name"),
    description: expectOptionalString(obj["description"], "template.description"),
    topic,
    payload: expectString(obj["payload"], "template.payload"),
    format: expectFormat(obj["format"]),
    qos: expectQos(obj["qos"]),
    retain: expectBoolean(obj["retain"], "template.retain"),
  };
}

function expectObject(raw: unknown, field: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new InvalidDocument(`"${field}" must be an object.`);
  }
  return raw as Record<string, unknown>;
}

function expectString(raw: unknown, field: string): string {
  if (typeof raw !== "string") {
    throw new InvalidDocument(`"${field}" must be a string.`);
  }
  return raw;
}

function expectOptionalString(raw: unknown, field: string): string | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  return expectString(raw, field);
}

function expectBoolean(raw: unknown, field: string): boolean {
  if (typeof raw !== "boolean") {
    throw new InvalidDocument(`"${field}" must be a boolean.`);
  }
  return raw;
}

function expectFormat(raw: unknown): MessageFormat {
  if (raw !== "json" && raw !== "raw") {
    throw new InvalidDocument('"template.format" must be "json" or "raw".');
  }
  return raw;
}

function expectQos(raw: unknown): 0 | 1 | 2 {
  if (raw !== 0 && raw !== 1 && raw !== 2) {
    throw new InvalidDocument('"template.qos" must be 0, 1, or 2.');
  }
  return raw;
}
