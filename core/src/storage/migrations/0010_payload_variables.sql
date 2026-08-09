-- Named `{{placeholder}}` definitions, expanded into the topic and payload at
-- publish time. App-wide on purpose: not scoped to a connection or a template,
-- so one defined fleet is usable everywhere.
--
-- `generator` holds the serde JSON of `models::VariableGenerator` rather than a
-- column per generator type. Each type carries a different set of parameters,
-- so columns would be mostly-NULL and every new generator would cost a
-- migration. The same JSON is what crosses IPC, so there is one encoding to
-- keep in sync with the frontend, not two.
CREATE TABLE payload_variables (
    id BLOB PRIMARY KEY,
    name TEXT NOT NULL,
    generator TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Same rule as collection names: a `{{name}}` reference has to resolve to
-- exactly one definition, and case-sensitive near-duplicates would be a trap.
CREATE UNIQUE INDEX idx_payload_variables_name_nocase
    ON payload_variables (name COLLATE NOCASE);

-- Seed the four generators that were previously hardcoded placeholders, so the
-- feature is usable before the user defines anything. These are ordinary rows -
-- editable and deletable like any other. Fixed ids rather than randomblob(16):
-- seed data wants to be deterministic, and hand-written v4 UUIDs keep the
-- column well-formed.
INSERT INTO payload_variables (id, name, generator, created_at) VALUES
    (x'0195b1a07c414e2a9f01000000000001', 'uuid',
     '{"kind":"uuid"}', '2026-01-01 00:00:00+00:00'),
    (x'0195b1a07c414e2a9f01000000000002', 'timestamp',
     '{"kind":"timestamp","format":"unixMillis"}', '2026-01-01 00:00:00+00:00'),
    (x'0195b1a07c414e2a9f01000000000003', 'isoDate',
     '{"kind":"timestamp","format":"iso8601"}', '2026-01-01 00:00:00+00:00'),
    (x'0195b1a07c414e2a9f01000000000004', 'counter',
     '{"kind":"counter","start":1,"step":1}', '2026-01-01 00:00:00+00:00');
