use std::sync::{Arc, Mutex};

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::models::{FavoriteMessage, NewFavoriteMessage};
use crate::storage::StorageError;

pub trait FavoritesRepository {
    fn create(&self, new: NewFavoriteMessage) -> Result<FavoriteMessage, StorageError>;
    fn get(&self, id: Uuid) -> Result<Option<FavoriteMessage>, StorageError>;
    fn list(&self) -> Result<Vec<FavoriteMessage>, StorageError>;
    fn list_by_connection(&self, connection_id: Uuid)
        -> Result<Vec<FavoriteMessage>, StorageError>;
    fn delete(&self, id: Uuid) -> Result<(), StorageError>;
}

pub struct SqliteFavoritesRepository {
    conn: Arc<Mutex<Connection>>,
}

impl SqliteFavoritesRepository {
    /// Takes a shared connection handle so it can coexist with other
    /// repositories (e.g. `SqliteConnectionsRepository`) over the same
    /// physical SQLite database.
    pub fn new(conn: Arc<Mutex<Connection>>) -> Self {
        Self { conn }
    }
}

impl FavoritesRepository for SqliteFavoritesRepository {
    fn create(&self, new: NewFavoriteMessage) -> Result<FavoriteMessage, StorageError> {
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4();
        let created_at = Utc::now();
        conn.execute(
            "INSERT INTO favorite_messages
                (id, connection_id, topic, payload, qos, retain, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                id,
                new.connection_id,
                new.topic,
                new.payload,
                new.qos,
                new.retain,
                created_at,
            ],
        )?;

        Ok(FavoriteMessage {
            id,
            connection_id: new.connection_id,
            topic: new.topic,
            payload: new.payload,
            qos: new.qos,
            retain: new.retain,
            created_at,
        })
    }

    fn get(&self, id: Uuid) -> Result<Option<FavoriteMessage>, StorageError> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, connection_id, topic, payload, qos, retain, created_at
             FROM favorite_messages WHERE id = ?1",
            params![id],
            row_to_favorite,
        )
        .optional()
        .map_err(StorageError::from)
    }

    fn list(&self) -> Result<Vec<FavoriteMessage>, StorageError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, connection_id, topic, payload, qos, retain, created_at
             FROM favorite_messages ORDER BY created_at DESC",
        )?;
        let favorites = stmt
            .query_map([], row_to_favorite)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(favorites)
    }

    fn list_by_connection(
        &self,
        connection_id: Uuid,
    ) -> Result<Vec<FavoriteMessage>, StorageError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, connection_id, topic, payload, qos, retain, created_at
             FROM favorite_messages WHERE connection_id = ?1 ORDER BY created_at DESC",
        )?;
        let favorites = stmt
            .query_map(params![connection_id], row_to_favorite)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(favorites)
    }

    fn delete(&self, id: Uuid) -> Result<(), StorageError> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM favorite_messages WHERE id = ?1", params![id])?;
        Ok(())
    }
}

fn row_to_favorite(row: &rusqlite::Row<'_>) -> rusqlite::Result<FavoriteMessage> {
    Ok(FavoriteMessage {
        id: row.get(0)?,
        connection_id: row.get(1)?,
        topic: row.get(2)?,
        payload: row.get(3)?,
        qos: row.get(4)?,
        retain: row.get(5)?,
        created_at: row.get(6)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{NewBrokerConnection, QoS};
    use crate::storage::connections_repo::{ConnectionsRepository, SqliteConnectionsRepository};
    use crate::storage::open_in_memory;

    /// Both repos share one connection, exactly like the real app will
    /// (one SQLite database, multiple repositories over it).
    fn repos() -> (SqliteConnectionsRepository, SqliteFavoritesRepository) {
        let conn = Arc::new(Mutex::new(open_in_memory()));
        (
            SqliteConnectionsRepository::new(Arc::clone(&conn)),
            SqliteFavoritesRepository::new(conn),
        )
    }

    fn sample_favorite() -> NewFavoriteMessage {
        NewFavoriteMessage {
            connection_id: None,
            topic: "sensors/temperature".to_string(),
            payload: r#"{"celsius": 21.5}"#.to_string(),
            qos: QoS::AtLeastOnce,
            retain: false,
        }
    }

    #[test]
    fn create_then_get_returns_the_same_favorite() {
        let (_connections, favorites) = repos();
        let before = Utc::now();

        let created = favorites.create(sample_favorite()).unwrap();

        assert!(created.created_at >= before);
        let fetched = favorites
            .get(created.id)
            .unwrap()
            .expect("favorite to exist");
        assert_eq!(fetched, created);
    }

    #[test]
    fn get_returns_none_for_unknown_id() {
        let (_connections, favorites) = repos();
        assert_eq!(favorites.get(Uuid::new_v4()).unwrap(), None);
    }

    #[test]
    fn list_returns_all_favorites_newest_first() {
        let (_connections, favorites) = repos();
        let first = favorites.create(sample_favorite()).unwrap();
        let mut second = sample_favorite();
        second.topic = "sensors/humidity".to_string();
        let second = favorites.create(second).unwrap();

        let all = favorites.list().unwrap();

        assert_eq!(all, vec![second, first]);
    }

    #[test]
    fn list_by_connection_only_returns_matching_favorites() {
        let (connections, favorites) = repos();
        let broker = connections
            .create(NewBrokerConnection {
                name: "Local".to_string(),
                host: "localhost".to_string(),
                port: 1883,
                client_id: "bmdp".to_string(),
                username: None,
                password: None,
                use_tls: false,
                keep_alive_secs: 30,
                subscriptions: vec![],
            })
            .unwrap();

        let mut linked = sample_favorite();
        linked.connection_id = Some(broker.id);
        let linked = favorites.create(linked).unwrap();
        let unrelated = favorites.create(sample_favorite()).unwrap();

        let for_broker = favorites.list_by_connection(broker.id).unwrap();

        assert_eq!(for_broker, vec![linked]);
        assert!(!for_broker.contains(&unrelated));
    }

    #[test]
    fn delete_removes_the_favorite() {
        let (_connections, favorites) = repos();
        let created = favorites.create(sample_favorite()).unwrap();

        favorites.delete(created.id).unwrap();

        assert_eq!(favorites.get(created.id).unwrap(), None);
    }
}
