CREATE TABLE broker_connections (
    id BLOB PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    client_id TEXT NOT NULL,
    username TEXT,
    password TEXT,
    use_tls INTEGER NOT NULL,
    keep_alive_secs INTEGER NOT NULL
);

CREATE TABLE subscriptions (
    id BLOB PRIMARY KEY,
    connection_id BLOB NOT NULL REFERENCES broker_connections(id) ON DELETE CASCADE,
    topic TEXT NOT NULL,
    qos INTEGER NOT NULL
);
