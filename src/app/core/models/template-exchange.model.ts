import { MessageFormat } from "./message-format.model";

/** Mirrors `spec/template-format-v1.md`. */
export const TEMPLATE_EXCHANGE_SPEC_VERSION = "1.0";

/** A template's portable, identity-free fields - no `id`/`collection_id`/
 * `created_at`, since those are local to this installation. Used both as
 * the payload of a standalone `TemplateDocument` and as entries in a
 * collection's `templates` array. */
export interface TemplateItem {
  name: string | null;
  description: string | null;
  topic: string;
  payload: string;
  format: MessageFormat;
  /** Numeric MQTT QoS (0/1/2), not the app's internal `QoS` enum - see
   * `qosNumber`/`qosFromNumber` in `./qos.ts`. */
  qos: 0 | 1 | 2;
  retain: boolean;
}

export interface TemplateDocument {
  specVersion: string;
  kind: "template";
  template: TemplateItem;
}

export interface CollectionDocument {
  specVersion: string;
  kind: "collection";
  collection: { name: string; description: string | null };
  templates: TemplateItem[];
}

export interface BundleDocument {
  specVersion: string;
  kind: "bundle";
  collections: {
    name: string;
    description: string | null;
    templates: TemplateItem[];
  }[];
  templates: TemplateItem[];
}

export type ExchangeDocument = TemplateDocument | CollectionDocument | BundleDocument;
