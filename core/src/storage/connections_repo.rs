use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection, OptionalExtension};
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

impl ConnectionsRepository for SqliteConnectionsRepository {
    fn create(&self, new: NewBrokerConnection) -> Result<BrokerConnection, StorageError> {
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4();
        conn.execute(
            "INSERT INTO broker_connections
                (id, name, host, port, client_id, username, password, use_tls, keep_alive_secs,
                 auto_reconnect, max_reconnect_attempts)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                id,
                new.name,
                new.host,
                new.port,
                new.client_id,
                new.username,
                new.password,
                new.use_tls,
                new.keep_alive_secs,
                new.auto_reconnect,
                new.max_reconnect_attempts,
            ],
        )?;

        let subscriptions = new
            .subscriptions
            .into_iter()
            .map(|sub| insert_subscription(&conn, id, sub))
            .collect::<Result<Vec<_>, _>>()?;

        Ok(BrokerConnection {
            id,
            name: new.name,
            host: new.host,
            port: new.port,
            client_id: new.client_id,
            username: new.username,
            password: new.password,
            use_tls: new.use_tls,
            keep_alive_secs: new.keep_alive_secs,
            auto_reconnect: new.auto_reconnect,
            max_reconnect_attempts: new.max_reconnect_attempts,
            subscriptions,
        })
    }

    fn get(&self, id: Uuid) -> Result<Option<BrokerConnection>, StorageError> {
        let conn = self.conn.lock().unwrap();
        let row = conn
            .query_row(
                "SELECT name, host, port, client_id, username, password, use_tls, keep_alive_secs,
                        auto_reconnect, max_reconnect_attempts
                 FROM broker_connections WHERE id = ?1",
                params![id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, u16>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, Option<String>>(5)?,
                        row.get::<_, bool>(6)?,
                        row.get::<_, u16>(7)?,
                        row.get::<_, bool>(8)?,
                        row.get::<_, u32>(9)?,
                    ))
                },
            )
            .optional()?;

        let Some((
            name,
            host,
            port,
            client_id,
            username,
            password,
            use_tls,
            keep_alive_secs,
            auto_reconnect,
            max_reconnect_attempts,
        )) = row
        else {
            return Ok(None);
        };

        let subscriptions = load_subscriptions(&conn, id)?;

        Ok(Some(BrokerConnection {
            id,
            name,
            host,
            port,
            client_id,
            username,
            password,
            use_tls,
            keep_alive_secs,
            auto_reconnect,
            max_reconnect_attempts,
            subscriptions,
        }))
    }

    fn list(&self) -> Result<Vec<BrokerConnection>, StorageError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, host, port, client_id, username, password, use_tls, keep_alive_secs,
                    auto_reconnect, max_reconnect_attempts
             FROM broker_connections ORDER BY name",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, Uuid>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, u16>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, bool>(7)?,
                    row.get::<_, u16>(8)?,
                    row.get::<_, bool>(9)?,
                    row.get::<_, u32>(10)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut connections = Vec::with_capacity(rows.len());
        for (
            id,
            name,
            host,
            port,
            client_id,
            username,
            password,
            use_tls,
            keep_alive_secs,
            auto_reconnect,
            max_reconnect_attempts,
        ) in rows
        {
            let subscriptions = load_subscriptions(&conn, id)?;
            connections.push(BrokerConnection {
                id,
                name,
                host,
                port,
                client_id,
                username,
                password,
                use_tls,
                keep_alive_secs,
                auto_reconnect,
                max_reconnect_attempts,
                subscriptions,
            });
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
                 password = ?6, use_tls = ?7, keep_alive_secs = ?8,
                 auto_reconnect = ?9, max_reconnect_attempts = ?10
             WHERE id = ?11",
            params![
                update.name,
                update.host,
                update.port,
                update.client_id,
                update.username,
                update.password,
                update.use_tls,
                update.keep_alive_secs,
                update.auto_reconnect,
                update.max_reconnect_attempts,
                id,
            ],
        )?;

        if rows_changed == 0 {
            return Ok(None);
        }

        let subscriptions = load_subscriptions(&conn, id)?;

        Ok(Some(BrokerConnection {
            id,
            name: update.name,
            host: update.host,
            port: update.port,
            client_id: update.client_id,
            username: update.username,
            password: update.password,
            use_tls: update.use_tls,
            keep_alive_secs: update.keep_alive_secs,
            auto_reconnect: update.auto_reconnect,
            max_reconnect_attempts: update.max_reconnect_attempts,
            subscriptions,
        }))
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
    use crate::models::QoS;
    use crate::storage::open_in_memory;

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
            use_tls: false,
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
                    (id, name, host, port, client_id, username, password, use_tls, keep_alive_secs)
                 VALUES (?1, 'Legacy', 'legacy.local', 1883, 'bme-legacy', NULL, NULL, 0, 60)",
                params![id],
            )
            .unwrap();

        let fetched = repo.get(id).unwrap().expect("connection to exist");

        assert!(fetched.auto_reconnect);
        assert_eq!(fetched.max_reconnect_attempts, 10);
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
                    use_tls: true,
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
        assert!(updated.use_tls);
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
                    use_tls: false,
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
