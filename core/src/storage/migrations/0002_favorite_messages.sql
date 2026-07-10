CREATE TABLE favorite_messages (
    id BLOB PRIMARY KEY,
    connection_id BLOB REFERENCES broker_connections(id) ON DELETE SET NULL,
    topic TEXT NOT NULL,
    payload TEXT NOT NULL,
    qos INTEGER NOT NULL,
    retain INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
