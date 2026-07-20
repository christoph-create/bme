# Template/Collection Exchange Format — v1

`specVersion: "1.0"`

## Goals

- Round-trip a single message template, or a whole collection of them,
  through plain JSON that a human can read and hand-edit.
- Be usable by tools other than bme: no bme-internal identifiers (database
  IDs, timestamps) in the wire format — importing always creates fresh
  local records.
- Stay forward-compatible: unknown extra fields are ignored by consumers,
  not rejected.

## Common type: Template Item

A template's portable, identity-free fields. Used both as the payload of a
standalone template document and as entries in a collection's `templates`
array.

| Field         | Type               | Required | Notes |
|---------------|--------------------|----------|-------|
| `name`        | string \| null     | no (default `null`) | Display name. |
| `description` | string \| null     | no (default `null`) | Free text. |
| `topic`       | string             | yes | Must be non-empty. |
| `payload`     | string             | yes | Raw payload text, exactly as it would go on the wire. |
| `format`      | `"json"` \| `"raw"`| yes | How bme renders/edits the payload. `"json"` implies `payload` should parse as JSON, but a consumer must not reject an otherwise-valid document solely because it doesn't. |
| `qos`         | `0` \| `1` \| `2`  | yes | MQTT QoS level, numeric (0 = at most once, 1 = at least once, 2 = exactly once) — not an app-internal enum name. |
| `retain`      | boolean            | yes | MQTT retain flag. |

```json
{
  "name": "Turn fan on",
  "description": "Sets the living room fan to on at medium speed",
  "topic": "home/livingroom/fan/set",
  "payload": "{\"state\":\"on\",\"speed\":\"medium\"}",
  "format": "json",
  "qos": 1,
  "retain": false
}
```

## Document: Template

A single exported template.

| Field         | Type            | Required |
|---------------|-----------------|----------|
| `specVersion` | `"1.0"`         | yes |
| `kind`        | `"template"`    | yes |
| `template`    | Template Item   | yes |

```json
{
  "specVersion": "1.0",
  "kind": "template",
  "template": {
    "name": "Turn fan on",
    "description": null,
    "topic": "home/livingroom/fan/set",
    "payload": "{\"state\":\"on\"}",
    "format": "json",
    "qos": 1,
    "retain": false
  }
}
```

## Document: Collection

A named group of templates.

| Field         | Type                  | Required | Notes |
|---------------|-----------------------|----------|-------|
| `specVersion` | `"1.0"`               | yes | |
| `kind`        | `"collection"`        | yes | |
| `collection`  | object                | yes | See below. |
| `collection.name` | string            | yes | Non-empty. Collection names are unique within a single bme installation — see Import semantics. |
| `collection.description` | string \| null | no (default `null`) | |
| `templates`   | Template Item[]       | yes | May be empty. |

```json
{
  "specVersion": "1.0",
  "kind": "collection",
  "collection": {
    "name": "Living room",
    "description": "Everything for the living room automation"
  },
  "templates": [
    {
      "name": "Turn fan on",
      "description": null,
      "topic": "home/livingroom/fan/set",
      "payload": "{\"state\":\"on\"}",
      "format": "json",
      "qos": 1,
      "retain": false
    }
  ]
}
```

## Document: Bundle

An "export everything" document: every collection (each with its own
templates), plus templates that don't belong to any collection. Exists so a
full-library export/import is a single paste, without inventing a nested
kind: a bundle is flat, one level, no bundles-of-bundles.

| Field         | Type                  | Required | Notes |
|---------------|-----------------------|----------|-------|
| `specVersion` | `"1.0"`               | yes | |
| `kind`        | `"bundle"`            | yes | |
| `collections` | object[]              | yes | May be empty. Each has `name`, `description`, `templates` — same shape as the Collection document's `collection` + `templates` fields, combined. |
| `templates`   | Template Item[]       | yes | Templates with no collection. May be empty. |

```json
{
  "specVersion": "1.0",
  "kind": "bundle",
  "collections": [
    {
      "name": "Living room",
      "description": null,
      "templates": [ { "...": "Template Item" } ]
    }
  ],
  "templates": [ { "...": "Template Item, no collection" } ]
}
```

## Validation rules for consumers

A document is rejected (with a field-level error, not a silent drop) if:

- `specVersion`'s major version isn't recognized (only `"1.0"` exists today).
- `kind` isn't one of `"template"`, `"collection"`, `"bundle"`.
- A required field above is missing or the wrong JSON type.
- `topic` or `collection.name` is empty/whitespace-only.
- `format` isn't `"json"` or `"raw"`.
- `qos` isn't `0`, `1`, or `2`.

Unknown extra fields anywhere in the document are ignored, not rejected —
this is what lets the format gain optional fields later without breaking
older consumers.

## Import semantics (bme specifically)

These aren't part of the wire format, just how bme's importer behaves —
another consumer of this spec is free to do something else:

- Importing a **template** document always creates a new, uncategorized
  template. bme already allows several templates to share a name, so no
  name-collision handling is needed here.
- Importing a **collection** document whose name collides with an existing
  collection prompts the user for a different name before creating it —
  bme enforces unique collection names (case-insensitive). It never
  silently merges into the existing collection.
- Importing a **bundle** applies the same two rules per element: each
  collection is checked/renamed independently, and the top-level
  `templates` are added uncategorized.
