-- A generic key/value table rather than a column per setting: app-level
-- settings arrive one at a time and are never queried together, so a wide
-- table would cost a migration per setting and give nothing back.
--
-- Keys are namespaced `area.name` (e.g. `update.skipped_version`) so a
-- settings screen can group them without needing a second column. Values are
-- TEXT and each consumer owns its own encoding - timestamps are RFC 3339.
CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
