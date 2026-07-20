use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::models::{FavoriteCollection, NewFavoriteCollection, UpdateFavoriteCollection};
use crate::storage::{is_unique_violation, StorageError};

pub trait FavoriteCollectionsRepository {
    fn create(&self, new: NewFavoriteCollection) -> Result<FavoriteCollection, StorageError>;
    fn get(&self, id: Uuid) -> Result<Option<FavoriteCollection>, StorageError>;
    fn list(&self) -> Result<Vec<FavoriteCollection>, StorageError>;
    fn update(
        &self,
        id: Uuid,
        update: UpdateFavoriteCollection,
    ) -> Result<Option<FavoriteCollection>, StorageError>;
    fn delete(&self, id: Uuid) -> Result<(), StorageError>;
}

pub struct SqliteFavoriteCollectionsRepository {
    conn: Arc<Mutex<Connection>>,
}

impl SqliteFavoriteCollectionsRepository {
    /// Takes a shared connection handle so it can coexist with the other
    /// repositories (e.g. `SqliteFavoritesRepository`) over the same
    /// physical SQLite database.
    pub fn new(conn: Arc<Mutex<Connection>>) -> Self {
        Self { conn }
    }
}

impl FavoriteCollectionsRepository for SqliteFavoriteCollectionsRepository {
    fn create(&self, new: NewFavoriteCollection) -> Result<FavoriteCollection, StorageError> {
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4();
        let created_at = Utc::now();
        conn.execute(
            "INSERT INTO favorite_collections (id, name, description, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![id, new.name, new.description, created_at],
        )
        .map_err(|err| duplicate_name_error(err, &new.name))?;

        Ok(FavoriteCollection {
            id,
            name: new.name,
            description: new.description,
            created_at,
        })
    }

    fn get(&self, id: Uuid) -> Result<Option<FavoriteCollection>, StorageError> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, name, description, created_at
             FROM favorite_collections WHERE id = ?1",
            params![id],
            row_to_collection,
        )
        .optional()
        .map_err(StorageError::from)
    }

    fn list(&self) -> Result<Vec<FavoriteCollection>, StorageError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, description, created_at
             FROM favorite_collections ORDER BY name",
        )?;
        let collections = stmt
            .query_map([], row_to_collection)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(collections)
    }

    fn update(
        &self,
        id: Uuid,
        update: UpdateFavoriteCollection,
    ) -> Result<Option<FavoriteCollection>, StorageError> {
        let conn = self.conn.lock().unwrap();
        let rows_changed = conn
            .execute(
                "UPDATE favorite_collections SET name = ?1, description = ?2 WHERE id = ?3",
                params![update.name, update.description, id],
            )
            .map_err(|err| duplicate_name_error(err, &update.name))?;

        if rows_changed == 0 {
            return Ok(None);
        }

        let created_at: DateTime<Utc> = conn.query_row(
            "SELECT created_at FROM favorite_collections WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;

        Ok(Some(FavoriteCollection {
            id,
            name: update.name,
            description: update.description,
            created_at,
        }))
    }

    fn delete(&self, id: Uuid) -> Result<(), StorageError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM favorite_collections WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }
}

/// Turns a `UNIQUE` constraint violation on `favorite_collections.name` into
/// the dedicated `DuplicateCollectionName` error; passes any other error
/// through unchanged.
fn duplicate_name_error(err: rusqlite::Error, name: &str) -> StorageError {
    if is_unique_violation(&err) {
        StorageError::DuplicateCollectionName(name.to_string())
    } else {
        StorageError::from(err)
    }
}

fn row_to_collection(row: &rusqlite::Row<'_>) -> rusqlite::Result<FavoriteCollection> {
    Ok(FavoriteCollection {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        created_at: row.get(3)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::open_in_memory;

    fn repo() -> SqliteFavoriteCollectionsRepository {
        SqliteFavoriteCollectionsRepository::new(Arc::new(Mutex::new(open_in_memory())))
    }

    fn sample_collection() -> NewFavoriteCollection {
        NewFavoriteCollection {
            name: "Sensor payloads".to_string(),
            description: Some("Common sensor test messages".to_string()),
        }
    }

    #[test]
    fn create_then_get_returns_the_same_collection() {
        let repo = repo();
        let before = Utc::now();

        let created = repo.create(sample_collection()).unwrap();

        assert!(created.created_at >= before);
        let fetched = repo.get(created.id).unwrap().expect("collection to exist");
        assert_eq!(fetched, created);
    }

    #[test]
    fn get_returns_none_for_unknown_id() {
        let repo = repo();
        assert_eq!(repo.get(Uuid::new_v4()).unwrap(), None);
    }

    #[test]
    fn list_returns_all_collections_alphabetically() {
        let repo = repo();
        let mut first = sample_collection();
        first.name = "Zebra".to_string();
        let first = repo.create(first).unwrap();
        let mut second = sample_collection();
        second.name = "Alpha".to_string();
        let second = repo.create(second).unwrap();

        let all = repo.list().unwrap();

        assert_eq!(all, vec![second, first]);
    }

    #[test]
    fn update_changes_the_stored_fields() {
        let repo = repo();
        let created = repo.create(sample_collection()).unwrap();

        let updated = repo
            .update(
                created.id,
                UpdateFavoriteCollection {
                    name: "Renamed".to_string(),
                    description: None,
                },
            )
            .unwrap()
            .expect("collection to exist");

        assert_eq!(updated.id, created.id);
        assert_eq!(updated.name, "Renamed");
        assert_eq!(updated.description, None);
        assert_eq!(updated.created_at, created.created_at);
    }

    #[test]
    fn update_returns_none_for_unknown_id() {
        let repo = repo();

        let result = repo
            .update(
                Uuid::new_v4(),
                UpdateFavoriteCollection {
                    name: "Ghost".to_string(),
                    description: None,
                },
            )
            .unwrap();

        assert_eq!(result, None);
    }

    #[test]
    fn create_rejects_a_case_insensitive_duplicate_name() {
        let repo = repo();
        repo.create(sample_collection()).unwrap();

        let mut duplicate = sample_collection();
        duplicate.name = "SENSOR PAYLOADS".to_string();
        let err = repo.create(duplicate).unwrap_err();

        assert!(
            matches!(err, StorageError::DuplicateCollectionName(name) if name == "SENSOR PAYLOADS")
        );
    }

    #[test]
    fn update_rejects_a_case_insensitive_duplicate_name() {
        let repo = repo();
        repo.create(sample_collection()).unwrap();
        let mut other = sample_collection();
        other.name = "Actuators".to_string();
        let other = repo.create(other).unwrap();

        let err = repo
            .update(
                other.id,
                UpdateFavoriteCollection {
                    name: "sensor payloads".to_string(),
                    description: None,
                },
            )
            .unwrap_err();

        assert!(
            matches!(err, StorageError::DuplicateCollectionName(name) if name == "sensor payloads")
        );
    }

    #[test]
    fn delete_removes_the_collection() {
        let repo = repo();
        let created = repo.create(sample_collection()).unwrap();

        repo.delete(created.id).unwrap();

        assert_eq!(repo.get(created.id).unwrap(), None);
    }
}
