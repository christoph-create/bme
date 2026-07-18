use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::models::{FavoriteMessage, NewFavoriteMessage, UpdateFavoriteMessage};
use crate::storage::StorageError;

pub trait FavoritesRepository {
    fn create(&self, new: NewFavoriteMessage) -> Result<FavoriteMessage, StorageError>;
    fn get(&self, id: Uuid) -> Result<Option<FavoriteMessage>, StorageError>;
    fn list(&self) -> Result<Vec<FavoriteMessage>, StorageError>;
    fn list_by_collection(&self, collection_id: Uuid)
        -> Result<Vec<FavoriteMessage>, StorageError>;
    fn update(
        &self,
        id: Uuid,
        update: UpdateFavoriteMessage,
    ) -> Result<Option<FavoriteMessage>, StorageError>;
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
                (id, collection_id, name, description, topic, payload, format, qos, retain, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                id,
                new.collection_id,
                new.name,
                new.description,
                new.topic,
                new.payload,
                new.format,
                new.qos,
                new.retain,
                created_at,
            ],
        )?;

        Ok(FavoriteMessage {
            id,
            collection_id: new.collection_id,
            name: new.name,
            description: new.description,
            topic: new.topic,
            payload: new.payload,
            format: new.format,
            qos: new.qos,
            retain: new.retain,
            created_at,
        })
    }

    fn get(&self, id: Uuid) -> Result<Option<FavoriteMessage>, StorageError> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, collection_id, name, description, topic, payload, format, qos, retain, created_at
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
            "SELECT id, collection_id, name, description, topic, payload, format, qos, retain, created_at
             FROM favorite_messages ORDER BY created_at DESC",
        )?;
        let favorites = stmt
            .query_map([], row_to_favorite)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(favorites)
    }

    fn list_by_collection(
        &self,
        collection_id: Uuid,
    ) -> Result<Vec<FavoriteMessage>, StorageError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, collection_id, name, description, topic, payload, format, qos, retain, created_at
             FROM favorite_messages WHERE collection_id = ?1 ORDER BY created_at DESC",
        )?;
        let favorites = stmt
            .query_map(params![collection_id], row_to_favorite)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(favorites)
    }

    fn update(
        &self,
        id: Uuid,
        update: UpdateFavoriteMessage,
    ) -> Result<Option<FavoriteMessage>, StorageError> {
        let conn = self.conn.lock().unwrap();
        let rows_changed = conn.execute(
            "UPDATE favorite_messages
             SET collection_id = ?1, name = ?2, description = ?3,
                 topic = ?4, payload = ?5, format = ?6, qos = ?7, retain = ?8
             WHERE id = ?9",
            params![
                update.collection_id,
                update.name,
                update.description,
                update.topic,
                update.payload,
                update.format,
                update.qos,
                update.retain,
                id,
            ],
        )?;

        if rows_changed == 0 {
            return Ok(None);
        }

        let created_at: DateTime<Utc> = conn.query_row(
            "SELECT created_at FROM favorite_messages WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;

        Ok(Some(FavoriteMessage {
            id,
            collection_id: update.collection_id,
            name: update.name,
            description: update.description,
            topic: update.topic,
            payload: update.payload,
            format: update.format,
            qos: update.qos,
            retain: update.retain,
            created_at,
        }))
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
        collection_id: row.get(1)?,
        name: row.get(2)?,
        description: row.get(3)?,
        topic: row.get(4)?,
        payload: row.get(5)?,
        format: row.get(6)?,
        qos: row.get(7)?,
        retain: row.get(8)?,
        created_at: row.get(9)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{MessageFormat, QoS};
    use crate::storage::connections_repo::SqliteConnectionsRepository;
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
            collection_id: None,
            name: Some("Temperature reading".to_string()),
            description: Some("A sample sensor payload".to_string()),
            topic: "sensors/temperature".to_string(),
            payload: r#"{"celsius": 21.5}"#.to_string(),
            format: MessageFormat::Json,
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
        assert_eq!(created.name.as_deref(), Some("Temperature reading"));
        assert_eq!(
            created.description.as_deref(),
            Some("A sample sensor payload")
        );
        let fetched = favorites
            .get(created.id)
            .unwrap()
            .expect("favorite to exist");
        assert_eq!(fetched, created);
    }

    #[test]
    fn create_allows_omitting_name_and_description() {
        let (_connections, favorites) = repos();
        let mut new = sample_favorite();
        new.name = None;
        new.description = None;

        let created = favorites.create(new).unwrap();

        assert_eq!(created.name, None);
        assert_eq!(created.description, None);
    }

    #[test]
    fn update_changes_the_stored_fields() {
        let (_connections, favorites) = repos();
        let created = favorites.create(sample_favorite()).unwrap();

        let updated = favorites
            .update(
                created.id,
                UpdateFavoriteMessage {
                    collection_id: None,
                    name: Some("Renamed".to_string()),
                    description: None,
                    topic: "sensors/humidity".to_string(),
                    payload: r#"{"pct": 55}"#.to_string(),
                    format: MessageFormat::Raw,
                    qos: QoS::ExactlyOnce,
                    retain: true,
                },
            )
            .unwrap()
            .expect("favorite to exist");

        assert_eq!(updated.id, created.id);
        assert_eq!(updated.name.as_deref(), Some("Renamed"));
        assert_eq!(updated.description, None);
        assert_eq!(updated.topic, "sensors/humidity");
        assert_eq!(updated.payload, r#"{"pct": 55}"#);
        assert_eq!(updated.format, MessageFormat::Raw);
        assert_eq!(updated.qos, QoS::ExactlyOnce);
        assert!(updated.retain);
        assert_eq!(updated.created_at, created.created_at);

        let fetched = favorites
            .get(created.id)
            .unwrap()
            .expect("favorite to exist");
        assert_eq!(fetched, updated);
    }

    #[test]
    fn update_returns_none_for_unknown_id() {
        let (_connections, favorites) = repos();

        let result = favorites
            .update(
                Uuid::new_v4(),
                UpdateFavoriteMessage {
                    collection_id: None,
                    name: None,
                    description: None,
                    topic: "ghost".to_string(),
                    payload: "{}".to_string(),
                    format: MessageFormat::Json,
                    qos: QoS::AtMostOnce,
                    retain: false,
                },
            )
            .unwrap();

        assert_eq!(result, None);
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
    fn list_by_collection_only_returns_matching_favorites() {
        use crate::models::NewFavoriteCollection;
        use crate::storage::favorite_collections_repo::{
            FavoriteCollectionsRepository, SqliteFavoriteCollectionsRepository,
        };

        let (_connections, favorites) = repos();
        let collections = SqliteFavoriteCollectionsRepository::new(Arc::clone(&favorites.conn));
        let collection = collections
            .create(NewFavoriteCollection {
                name: "Sensors".to_string(),
                description: None,
            })
            .unwrap();

        let mut linked = sample_favorite();
        linked.collection_id = Some(collection.id);
        let linked = favorites.create(linked).unwrap();
        let unrelated = favorites.create(sample_favorite()).unwrap();

        let in_collection = favorites.list_by_collection(collection.id).unwrap();

        assert_eq!(in_collection, vec![linked]);
        assert!(!in_collection.contains(&unrelated));
    }

    #[test]
    fn delete_removes_the_favorite() {
        let (_connections, favorites) = repos();
        let created = favorites.create(sample_favorite()).unwrap();

        favorites.delete(created.id).unwrap();

        assert_eq!(favorites.get(created.id).unwrap(), None);
    }
}
