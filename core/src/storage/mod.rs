pub mod connections_repo;
pub mod favorites_repo;

use std::sync::LazyLock;

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};

use crate::models::QoS;

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("migration error: {0}")]
    Migration(#[from] rusqlite_migration::Error),
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

static MIGRATIONS: LazyLock<Migrations<'static>> = LazyLock::new(|| {
    Migrations::new(vec![
        M::up(include_str!("migrations/0001_broker_connections.sql")),
        M::up(include_str!("migrations/0002_favorite_messages.sql")),
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
