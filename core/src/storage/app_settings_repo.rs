use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection, OptionalExtension};

use crate::storage::StorageError;

/// Free-form app-level settings, keyed by a namespaced string.
///
/// Not domain data: no `models.rs` type, no id, no timestamps. A key either
/// has a string value or it doesn't, and the caller owns how that string is
/// encoded (see `crate::update` for the `update.*` keys and their formats).
///
/// `Send + Sync` because this is held inside Tauri's managed state, the same
/// reason `MqttPort` carries the bound.
pub trait AppSettingsRepository: Send + Sync {
    fn get(&self, key: &str) -> Result<Option<String>, StorageError>;
    fn set(&self, key: &str, value: &str) -> Result<(), StorageError>;
    fn remove(&self, key: &str) -> Result<(), StorageError>;
}

/// `Clone` is an `Arc` bump: the update checker owns a handle to the same
/// database the separately-managed repository uses.
#[derive(Clone)]
pub struct SqliteAppSettingsRepository {
    conn: Arc<Mutex<Connection>>,
}

impl SqliteAppSettingsRepository {
    /// Takes a shared connection handle so it can coexist with the other
    /// repositories over the same physical SQLite database.
    pub fn new(conn: Arc<Mutex<Connection>>) -> Self {
        Self { conn }
    }
}

impl AppSettingsRepository for SqliteAppSettingsRepository {
    fn get(&self, key: &str) -> Result<Option<String>, StorageError> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(StorageError::from)
    }

    fn set(&self, key: &str, value: &str) -> Result<(), StorageError> {
        let conn = self.conn.lock().unwrap();
        // Upsert rather than insert: a setting has no identity beyond its
        // key, so overwriting is the only sane meaning of `set`.
        conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    fn remove(&self, key: &str) -> Result<(), StorageError> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM app_settings WHERE key = ?1", params![key])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::open_in_memory;

    fn repo() -> SqliteAppSettingsRepository {
        SqliteAppSettingsRepository::new(Arc::new(Mutex::new(open_in_memory())))
    }

    #[test]
    fn get_returns_none_for_an_unset_key() {
        assert_eq!(repo().get("update.skipped_version").unwrap(), None);
    }

    #[test]
    fn set_then_get_round_trips() {
        let repo = repo();
        repo.set("update.skipped_version", "0.8.0").unwrap();
        assert_eq!(
            repo.get("update.skipped_version").unwrap(),
            Some("0.8.0".to_string())
        );
    }

    #[test]
    fn set_twice_overwrites_rather_than_failing() {
        let repo = repo();
        repo.set("update.skipped_version", "0.8.0").unwrap();

        // A plain INSERT would trip the primary key here.
        repo.set("update.skipped_version", "0.9.0").unwrap();

        assert_eq!(
            repo.get("update.skipped_version").unwrap(),
            Some("0.9.0".to_string())
        );
    }

    #[test]
    fn an_empty_value_is_stored_and_is_not_the_same_as_absent() {
        let repo = repo();
        repo.set("update.skipped_version", "").unwrap();
        assert_eq!(
            repo.get("update.skipped_version").unwrap(),
            Some(String::new())
        );
    }

    #[test]
    fn remove_deletes_only_the_named_key() {
        let repo = repo();
        repo.set("update.skipped_version", "0.8.0").unwrap();
        repo.set("update.last_checked_at", "2026-08-06T10:00:00Z")
            .unwrap();

        repo.remove("update.skipped_version").unwrap();

        assert_eq!(repo.get("update.skipped_version").unwrap(), None);
        assert_eq!(
            repo.get("update.last_checked_at").unwrap(),
            Some("2026-08-06T10:00:00Z".to_string())
        );
    }

    #[test]
    fn remove_is_a_no_op_for_an_unset_key() {
        let repo = repo();
        repo.remove("nothing.here").unwrap();
        assert_eq!(repo.get("nothing.here").unwrap(), None);
    }

    #[test]
    fn keys_are_independent() {
        let repo = repo();
        repo.set("a.one", "first").unwrap();
        repo.set("b.two", "second").unwrap();

        repo.set("a.one", "changed").unwrap();

        assert_eq!(repo.get("a.one").unwrap(), Some("changed".to_string()));
        assert_eq!(repo.get("b.two").unwrap(), Some("second".to_string()));
    }
}
