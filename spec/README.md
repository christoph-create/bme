# bme Message Template / Collection Exchange Format

An open, tool-independent JSON format for sharing MQTT message templates and
collections of templates between users and applications. Any app can produce
or consume this format — it isn't bme-specific beyond its origin.

- [`template-format-v1.md`](./template-format-v1.md) — the current (and so
  far only) version of the spec.

## Versioning

Every document has a top-level `specVersion`. Breaking changes to the shape
of the format bump the major part of `specVersion` and get their own
`template-format-vN.md` file; the previous version's file is kept as-is.
Consumers should reject documents whose major `specVersion` they don't
recognize rather than guess.
