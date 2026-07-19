CREATE TABLE favorite_collections (
    id BLOB PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL
);

ALTER TABLE favorite_messages
    ADD COLUMN collection_id BLOB REFERENCES favorite_collections(id) ON DELETE SET NULL;
