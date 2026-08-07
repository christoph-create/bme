pub mod app_settings_repo;
pub mod connections_repo;
pub mod favorite_collections_repo;
pub mod favorites_repo;

use std::sync::LazyLock;

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};

use crate::models::{MessageFormat, QoS};

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("migration error: {0}")]
    Migration(#[from] rusqlite_migration::Error),
    #[error("a collection named \"{0}\" already exists")]
    DuplicateCollectionName(String),
}

/// True when `err` is a SQLite `UNIQUE`/`PRIMARY KEY` constraint violation,
/// as opposed to any other database error.
pub fn is_unique_violation(err: &rusqlite::Error) -> bool {
    matches!(
        err,
        rusqlite::Error::SqliteFailure(inner, _)
            if inner.code == rusqlite::ErrorCode::ConstraintViolation
    )
}

// QoS is a domain type (models.rs has no idea rusqlite exists); this is the
// one place that teaches it how to read/write itself as a SQLite integer.
impl ToSql for QoS {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::from(i64::from(*self)))
    }
}

impl FromSql for QoS {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let raw = i64::column_result(value)?;
        QoS::try_from(raw).map_err(|_| FromSqlError::OutOfRange(raw))
    }
}

// Same reasoning as QoS above, but stored as TEXT ("json"/"raw") rather than
// an integer - a couple of fixed strings are more legible directly in the
// sqlite file, and there's no wire-protocol encoding to match here.
impl ToSql for MessageFormat {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::from(String::from(*self)))
    }
}

impl FromSql for MessageFormat {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let raw = value.as_str()?;
        MessageFormat::try_from(raw).map_err(|_| FromSqlError::InvalidType)
    }
}

static MIGRATIONS: LazyLock<Migrations<'static>> = LazyLock::new(|| {
    Migrations::new(vec![
        M::up(include_str!("migrations/0001_broker_connections.sql")),
        M::up(include_str!("migrations/0002_favorite_messages.sql")),
        M::up(include_str!(
            "migrations/0003_favorite_message_name_and_description.sql"
        )),
        M::up(include_str!("migrations/0004_favorite_collections.sql")),
        M::up(include_str!("migrations/0005_favorite_message_format.sql")),
        M::up(include_str!(
            "migrations/0006_favorite_message_drop_connection_id.sql"
        )),
        M::up(include_str!(
            "migrations/0007_favorite_collections_unique_name.sql"
        )),
        M::up(include_str!("migrations/0008_reconnect_settings.sql")),
        M::up(include_str!("migrations/0009_app_settings.sql")),
    ])
});

/// Opens a fresh in-memory database with all migrations applied.
/// Each call is a brand-new, isolated database - handy for tests.
pub fn open_in_memory() -> Connection {
    let mut conn = Connection::open_in_memory().expect("failed to open in-memory sqlite db");
    conn.pragma_update(None, "foreign_keys", true)
        .expect("failed to enable foreign key enforcement");
    MIGRATIONS
        .to_latest(&mut conn)
        .expect("failed to run migrations");
    conn
}

/// Opens (creating if necessary) a file-backed database at `path` with all
/// migrations applied - what the real app uses, as opposed to
/// `open_in_memory`'s disposable databases for tests.
pub fn open_at(path: &std::path::Path) -> Result<Connection, StorageError> {
    let mut conn = Connection::open(path)?;
    conn.pragma_update(None, "foreign_keys", true)?;
    MIGRATIONS.to_latest(&mut conn)?;
    Ok(conn)
}
