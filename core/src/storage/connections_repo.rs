use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection, OptionalExtension, Row};
use uuid::Uuid;

use crate::models::{
    BrokerConnection, NewBrokerConnection, NewSubscription, Subscription, UpdateBrokerConnection,
};
use crate::storage::StorageError;

pub trait ConnectionsRepository {
    fn create(&self, new: NewBrokerConnection) -> Result<BrokerConnection, StorageError>;
    fn get(&self, id: Uuid) -> Result<Option<BrokerConnection>, StorageError>;
    fn list(&self) -> Result<Vec<BrokerConnection>, StorageError>;
    fn update(
        &self,
        id: Uuid,
        update: UpdateBrokerConnection,
    ) -> Result<Option<BrokerConnection>, StorageError>;
    fn delete(&self, id: Uuid) -> Result<(), StorageError>;
    fn add_subscription(
        &self,
        connection_id: Uuid,
        subscription: NewSubscription,
    ) -> Result<Subscription, StorageError>;
    fn remove_subscription(&self, subscription_id: Uuid) -> Result<(), StorageError>;
}

pub struct SqliteConnectionsRepository {
    conn: Arc<Mutex<Connection>>,
}

impl SqliteConnectionsRepository {
    /// Takes a shared connection handle so it can coexist with other
    /// repositories (e.g. `SqliteFavoritesRepository`) over the same
    /// physical SQLite database.
    pub fn new(conn: Arc<Mutex<Connection>>) -> Self {
        Self { conn }
    }
}

/// The column list every read shares. Kept in one place because it appears in
/// two queries and has to stay in step with `row_to_connection`.
const CONNECTION_COLUMNS: &str = "id, name, host, port, client_id, username, password, scheme, \
     ws_path, ca_cert_path, client_cert_path, client_key_path, alpn, skip_cert_verification, \
     keep_alive_secs, auto_reconnect, max_reconnect_attempts";

/// Reads by column *name* rather than position. The table is seventeen columns
/// wide now, and positional indices made every added column a renumbering
/// exercise across four separate queries. Subscriptions are left empty; they
/// come from their own table.
fn row_to_connection(row: &Row) -> rusqlite::Result<BrokerConnection> {
    Ok(BrokerConnection {
        id: row.get("id")?,
        name: row.get("name")?,
        host: row.get("host")?,
        port: row.get("port")?,
        client_id: row.get("client_id")?,
        username: row.get("username")?,
        password: row.get("password")?,
        scheme: row.get("scheme")?,
        ws_path: row.get("ws_path")?,
        ca_cert_path: row.get("ca_cert_path")?,
        client_cert_path: row.get("client_cert_path")?,
        client_key_path: row.get("client_key_path")?,
        alpn: row.get("alpn")?,
        skip_cert_verification: row.get("skip_cert_verification")?,
        keep_alive_secs: row.get("keep_alive_secs")?,
        auto_reconnect: row.get("auto_reconnect")?,
        max_reconnect_attempts: row.get("max_reconnect_attempts")?,
        subscriptions: Vec::new(),
    })
}

/// Every path that returns a connection - including the two write paths - goes
/// through here rather than re-assembling the struct from what it was handed.
/// A column that stores differently to how it was passed in then shows up
/// immediately instead of on the next read.
fn read_connection(conn: &Connection, id: Uuid) -> Result<Option<BrokerConnection>, StorageError> {
    let connection = conn
        .query_row(
            &format!("SELECT {CONNECTION_COLUMNS} FROM broker_connections WHERE id = ?1"),
            params![id],
            row_to_connection,
        )
        .optional()?;

    let Some(mut connection) = connection else {
        return Ok(None);
    };
    connection.subscriptions = load_subscriptions(conn, id)?;
    Ok(Some(connection))
}

impl ConnectionsRepository for SqliteConnectionsRepository {
    fn create(&self, new: NewBrokerConnection) -> Result<BrokerConnection, StorageError> {
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4();
        conn.execute(
            "INSERT INTO broker_connections
                (id, name, host, port, client_id, username, password, scheme, ws_path,
                 ca_cert_path, client_cert_path, client_key_path, alpn,
                 skip_cert_verification, keep_alive_secs, auto_reconnect,
                 max_reconnect_attempts)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
            params![
                id,
                new.name,
                new.host,
                new.port,
                new.client_id,
                new.username,
                new.password,
                new.scheme,
                new.ws_path,
                new.ca_cert_path,
                new.client_cert_path,
                new.client_key_path,
                new.alpn,
                new.skip_cert_verification,
                new.keep_alive_secs,
                new.auto_reconnect,
                new.max_reconnect_attempts,
            ],
        )?;

        for subscription in new.subscriptions {
            insert_subscription(&conn, id, subscription)?;
        }

        read_connection(&conn, id)?
            .ok_or(StorageError::Database(rusqlite::Error::QueryReturnedNoRows))
    }

    fn get(&self, id: Uuid) -> Result<Option<BrokerConnection>, StorageError> {
        let conn = self.conn.lock().unwrap();
        read_connection(&conn, id)
    }

    fn list(&self) -> Result<Vec<BrokerConnection>, StorageError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT {CONNECTION_COLUMNS} FROM broker_connections ORDER BY name"
        ))?;
        let mut connections = stmt
            .query_map([], row_to_connection)?
            .collect::<Result<Vec<_>, _>>()?;

        for connection in &mut connections {
            connection.subscriptions = load_subscriptions(&conn, connection.id)?;
        }
        Ok(connections)
    }

    fn update(
        &self,
        id: Uuid,
        update: UpdateBrokerConnection,
    ) -> Result<Option<BrokerConnection>, StorageError> {
        let conn = self.conn.lock().unwrap();
        let rows_changed = conn.execute(
            "UPDATE broker_connections
             SET name = ?1, host = ?2, port = ?3, client_id = ?4, username = ?5,
                 password = ?6, scheme = ?7, ws_path = ?8, ca_cert_path = ?9,
                 client_cert_path = ?10, client_key_path = ?11, alpn = ?12,
                 skip_cert_verification = ?13, keep_alive_secs = ?14,
                 auto_reconnect = ?15, max_reconnect_attempts = ?16
             WHERE id = ?17",
            params![
                update.name,
                update.host,
                update.port,
                update.client_id,
                update.username,
                update.password,
                update.scheme,
                update.ws_path,
                update.ca_cert_path,
                update.client_cert_path,
                update.client_key_path,
                update.alpn,
                update.skip_cert_verification,
                update.keep_alive_secs,
                update.auto_reconnect,
                update.max_reconnect_attempts,
                id,
            ],
        )?;

        if rows_changed == 0 {
            return Ok(None);
        }

        read_connection(&conn, id)
    }

    fn delete(&self, id: Uuid) -> Result<(), StorageError> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM broker_connections WHERE id = ?1", params![id])?;
        Ok(())
    }

    fn add_subscription(
        &self,
        connection_id: Uuid,
        subscription: NewSubscription,
    ) -> Result<Subscription, StorageError> {
        let conn = self.conn.lock().unwrap();
        insert_subscription(&conn, connection_id, subscription)
    }

    fn remove_subscription(&self, subscription_id: Uuid) -> Result<(), StorageError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM subscriptions WHERE id = ?1",
            params![subscription_id],
        )?;
        Ok(())
    }
}

fn insert_subscription(
    conn: &Connection,
    connection_id: Uuid,
    new: NewSubscription,
) -> Result<Subscription, StorageError> {
    let id = Uuid::new_v4();
    conn.execute(
        "INSERT INTO subscriptions (id, connection_id, topic, qos) VALUES (?1, ?2, ?3, ?4)",
        params![id, connection_id, new.topic, new.qos],
    )?;
    Ok(Subscription {
        id,
        connection_id,
        topic: new.topic,
        qos: new.qos,
    })
}

fn load_subscriptions(
    conn: &Connection,
    connection_id: Uuid,
) -> Result<Vec<Subscription>, StorageError> {
    let mut stmt = conn.prepare(
        "SELECT id, topic, qos FROM subscriptions WHERE connection_id = ?1 ORDER BY topic",
    )?;
    let subscriptions = stmt
        .query_map(params![connection_id], |row| {
            Ok(Subscription {
                id: row.get(0)?,
                connection_id,
                topic: row.get(1)?,
                qos: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(subscriptions)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{BrokerScheme, QoS};
    use crate::storage::{migrate_to_latest, open_in_memory, open_in_memory_at_version};

    fn repo() -> SqliteConnectionsRepository {
        SqliteConnectionsRepository::new(Arc::new(Mutex::new(open_in_memory())))
    }

    fn sample_connection() -> NewBrokerConnection {
        NewBrokerConnection {
            name: "Local Mosquitto".to_string(),
            host: "localhost".to_string(),
            port: 1883,
            client_id: "bme-dev".to_string(),
            username: None,
            password: None,
            scheme: BrokerScheme::Mqtt,
            ws_path: None,
            ca_cert_path: None,
            client_cert_path: None,
            client_key_path: None,
            alpn: None,
            skip_cert_verification: false,
            keep_alive_secs: 30,
            auto_reconnect: true,
            max_reconnect_attempts: 10,
            subscriptions: vec![NewSubscription {
                topic: "sensors/#".to_string(),
                qos: QoS::AtLeastOnce,
            }],
        }
    }

    #[test]
    fn create_then_get_returns_the_same_connection() {
        let repo = repo();
        let created = repo.create(sample_connection()).unwrap();

        let fetched = repo.get(created.id).unwrap().expect("connection to exist");

        assert_eq!(fetched, created);
        assert_eq!(fetched.subscriptions.len(), 1);
        assert_eq!(fetched.subscriptions[0].topic, "sensors/#");
        assert_eq!(fetched.subscriptions[0].qos, QoS::AtLeastOnce);
    }

    #[test]
    fn create_then_get_round_trips_the_reconnect_settings() {
        let repo = repo();
        let mut new = sample_connection();
        new.auto_reconnect = false;
        new.max_reconnect_attempts = 25;

        let created = repo.create(new).unwrap();
        let fetched = repo.get(created.id).unwrap().expect("connection to exist");

        assert!(!fetched.auto_reconnect);
        assert_eq!(fetched.max_reconnect_attempts, 25);
    }

    /// Connections that predate migration 0008 have no reconnect columns of
    /// their own, so the whole feature hinges on the column defaults being
    /// what an existing user would want: reconnect on, ten attempts.
    #[test]
    fn rows_written_before_the_reconnect_columns_existed_get_the_defaults() {
        let repo = repo();
        let id = Uuid::new_v4();
        repo.conn
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO broker_connections
                    (id, name, host, port, client_id, username, password, keep_alive_secs)
                 VALUES (?1, 'Legacy', 'legacy.local', 1883, 'bme-legacy', NULL, NULL, 60)",
                params![id],
            )
            .unwrap();

        let fetched = repo.get(id).unwrap().expect("connection to exist");

        assert!(fetched.auto_reconnect);
        assert_eq!(fetched.max_reconnect_attempts, 10);
        assert_eq!(fetched.scheme, BrokerScheme::Mqtt);
        assert!(!fetched.skip_cert_verification);
    }

    /// The scheme column is a rewrite of the old `use_tls` flag rather than an
    /// addition, so migration 0011 has to carry existing rows across: a saved
    /// TLS connection must still point at the same broker afterwards. Runs the
    /// migrations only as far as 0010 so there are genuinely pre-scheme rows
    /// to carry.
    #[test]
    fn tls_flags_written_before_the_scheme_column_existed_become_schemes() {
        let mut conn = open_in_memory_at_version(10);
        let plain = Uuid::new_v4();
        let secured = Uuid::new_v4();
        for (id, use_tls) in [(plain, 0), (secured, 1)] {
            conn.execute(
                "INSERT INTO broker_connections
                    (id, name, host, port, client_id, username, password, use_tls,
                     keep_alive_secs, auto_reconnect, max_reconnect_attempts)
                 VALUES (?1, ?2, 'legacy.local', 1883, 'bme-legacy', NULL, NULL, ?3, 60, 1, 10)",
                params![id, id.to_string(), use_tls],
            )
            .unwrap();
        }

        migrate_to_latest(&mut conn);
        let repo = SqliteConnectionsRepository::new(Arc::new(Mutex::new(conn)));

        assert_eq!(
            repo.get(plain)
                .unwrap()
                .expect("connection to exist")
                .scheme,
            BrokerScheme::Mqtt
        );
        assert_eq!(
            repo.get(secured)
                .unwrap()
                .expect("connection to exist")
                .scheme,
            BrokerScheme::Mqtts
        );
    }

    #[test]
    fn create_then_get_round_trips_the_websocket_and_tls_settings() {
        let repo = repo();
        let mut new = sample_connection();
        new.scheme = BrokerScheme::Wss;
        new.port = 8884;
        new.ws_path = Some("/mqtt".to_string());
        new.ca_cert_path = Some("/certs/AmazonRootCA1.pem".to_string());
        new.client_cert_path = Some("/certs/device-01-cert.pem".to_string());
        new.client_key_path = Some("/certs/device-01-key.pem".to_string());
        new.alpn = Some("x-amzn-mqtt-ca".to_string());
        new.skip_cert_verification = true;

        let created = repo.create(new).unwrap();
        let fetched = repo.get(created.id).unwrap().expect("connection to exist");

        assert_eq!(fetched, created);
        assert_eq!(fetched.scheme, BrokerScheme::Wss);
        assert_eq!(fetched.ws_path.as_deref(), Some("/mqtt"));
        assert_eq!(
            fetched.ca_cert_path.as_deref(),
            Some("/certs/AmazonRootCA1.pem")
        );
        assert_eq!(
            fetched.client_cert_path.as_deref(),
            Some("/certs/device-01-cert.pem")
        );
        assert_eq!(
            fetched.client_key_path.as_deref(),
            Some("/certs/device-01-key.pem")
        );
        assert_eq!(fetched.alpn.as_deref(), Some("x-amzn-mqtt-ca"));
        assert!(fetched.skip_cert_verification);
    }

    #[test]
    fn get_returns_none_for_unknown_id() {
        let repo = repo();
        assert_eq!(repo.get(Uuid::new_v4()).unwrap(), None);
    }

    #[test]
    fn list_returns_all_created_connections() {
        let repo = repo();
        repo.create(sample_connection()).unwrap();
        let mut second = sample_connection();
        second.name = "Cloud Broker".to_string();
        repo.create(second).unwrap();

        let all = repo.list().unwrap();

        assert_eq!(all.len(), 2);
        assert_eq!(all[0].name, "Cloud Broker");
        assert_eq!(all[1].name, "Local Mosquitto");
    }

    #[test]
    fn update_changes_the_stored_fields_and_preserves_subscriptions() {
        let repo = repo();
        let created = repo.create(sample_connection()).unwrap();

        let updated = repo
            .update(
                created.id,
                UpdateBrokerConnection {
                    name: "Renamed".to_string(),
                    host: "renamed.local".to_string(),
                    port: 8883,
                    client_id: "bme-renamed".to_string(),
                    username: Some("alice".to_string()),
                    password: Some("hunter2".to_string()),
                    scheme: BrokerScheme::Wss,
                    ws_path: Some("/mqtt".to_string()),
                    ca_cert_path: Some("/certs/ca.pem".to_string()),
                    client_cert_path: None,
                    client_key_path: None,
                    alpn: Some("mqtt".to_string()),
                    skip_cert_verification: true,
                    keep_alive_secs: 45,
                    auto_reconnect: false,
                    max_reconnect_attempts: 3,
                },
            )
            .unwrap()
            .expect("connection to exist");

        assert_eq!(updated.id, created.id);
        assert_eq!(updated.name, "Renamed");
        assert_eq!(updated.host, "renamed.local");
        assert_eq!(updated.port, 8883);
        assert_eq!(updated.client_id, "bme-renamed");
        assert_eq!(updated.username.as_deref(), Some("alice"));
        assert_eq!(updated.password.as_deref(), Some("hunter2"));
        assert_eq!(updated.scheme, BrokerScheme::Wss);
        assert_eq!(updated.ws_path.as_deref(), Some("/mqtt"));
        assert_eq!(updated.ca_cert_path.as_deref(), Some("/certs/ca.pem"));
        assert_eq!(updated.alpn.as_deref(), Some("mqtt"));
        assert!(updated.skip_cert_verification);
        assert_eq!(updated.keep_alive_secs, 45);
        assert!(!updated.auto_reconnect);
        assert_eq!(updated.max_reconnect_attempts, 3);
        assert_eq!(updated.subscriptions.len(), 1);

        let fetched = repo.get(created.id).unwrap().expect("connection to exist");
        assert_eq!(fetched, updated);
    }

    #[test]
    fn update_returns_none_for_unknown_id() {
        let repo = repo();

        let result = repo
            .update(
                Uuid::new_v4(),
                UpdateBrokerConnection {
                    name: "Ghost".to_string(),
                    host: "ghost.local".to_string(),
                    port: 1883,
                    client_id: "bme-ghost".to_string(),
                    username: None,
                    password: None,
                    scheme: BrokerScheme::Mqtt,
                    ws_path: None,
                    ca_cert_path: None,
                    client_cert_path: None,
                    client_key_path: None,
                    alpn: None,
                    skip_cert_verification: false,
                    keep_alive_secs: 30,
                    auto_reconnect: true,
                    max_reconnect_attempts: 10,
                },
            )
            .unwrap();

        assert_eq!(result, None);
    }

    #[test]
    fn delete_removes_the_connection_and_its_subscriptions() {
        let repo = repo();
        let created = repo.create(sample_connection()).unwrap();

        repo.delete(created.id).unwrap();

        assert_eq!(repo.get(created.id).unwrap(), None);
    }

    #[test]
    fn add_subscription_appends_to_an_existing_connection() {
        let repo = repo();
        let created = repo.create(sample_connection()).unwrap();

        repo.add_subscription(
            created.id,
            NewSubscription {
                topic: "alerts/critical".to_string(),
                qos: QoS::ExactlyOnce,
            },
        )
        .unwrap();

        let fetched = repo.get(created.id).unwrap().unwrap();
        assert_eq!(fetched.subscriptions.len(), 2);
    }

    #[test]
    fn remove_subscription_deletes_only_that_subscription() {
        let repo = repo();
        let created = repo.create(sample_connection()).unwrap();
        let subscription_id = created.subscriptions[0].id;

        repo.remove_subscription(subscription_id).unwrap();

        let fetched = repo.get(created.id).unwrap().unwrap();
        assert!(fetched.subscriptions.is_empty());
    }
}
