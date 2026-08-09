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

## Payload placeholders

`topic` and `payload` may contain `{{name}}` placeholders, where `name` is a
letter or underscore followed by letters, digits or underscores. Optional
whitespace inside the braces (`{{ name }}`) is part of the syntax.

This is a **producer/consumer convention layered on top of the format, not a
new field**. Nothing above changes, and no version bump is implied:

- A consumer that implements placeholders substitutes a generated value for
  each one before publishing.
- A consumer that does not **must send the text exactly as written**. A
  literal `{{uuid}}` on the wire is the correct behaviour for such a consumer,
  never an error and never an empty string.
- A `format` of `"json"` still doesn't require `payload` to parse — see the
  Template Item table. `{"t":{{tempC}}}` is a legitimate JSON-format template:
  it becomes valid JSON once expanded. This is already covered by the existing
  rule that a consumer must not reject a document solely because a
  JSON-format payload doesn't parse.
- Placeholder *names* are the only thing that travels. The **definitions** —
  what generates each value — are deliberately not part of this format; they
  are local application configuration. So an imported template may refer to
  names the importer has never heard of, and that is not a validation error.
  What such a consumer does about it (leave it literal, warn, offer to create
  the variable) is up to it.

An exchange document is therefore identical whether or not placeholders are
involved:

```json
{
  "name": "Simulated sensor reading",
  "description": null,
  "topic": "sensors/{{deviceId}}/temp",
  "payload": "{\"id\":\"{{uuid}}\",\"t\":{{tempC}},\"n\":{{seq}}}",
  "format": "json",
  "qos": 0,
  "retain": false
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
