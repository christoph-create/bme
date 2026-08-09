use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::models::{
    NewPayloadVariable, PayloadVariable, UpdatePayloadVariable, VariableGenerator,
};
use crate::storage::{is_unique_violation, StorageError};

pub trait PayloadVariablesRepository: Send + Sync {
    fn create(&self, new: NewPayloadVariable) -> Result<PayloadVariable, StorageError>;
    fn get(&self, id: Uuid) -> Result<Option<PayloadVariable>, StorageError>;
    fn list(&self) -> Result<Vec<PayloadVariable>, StorageError>;
    fn update(
        &self,
        id: Uuid,
        update: UpdatePayloadVariable,
    ) -> Result<Option<PayloadVariable>, StorageError>;
    fn delete(&self, id: Uuid) -> Result<(), StorageError>;
}

pub struct SqlitePayloadVariablesRepository {
    conn: Arc<Mutex<Connection>>,
}

impl SqlitePayloadVariablesRepository {
    /// Takes a shared connection handle so it can coexist with the other
    /// repositories over the same physical SQLite database.
    pub fn new(conn: Arc<Mutex<Connection>>) -> Self {
        Self { conn }
    }
}

impl PayloadVariablesRepository for SqlitePayloadVariablesRepository {
    fn create(&self, new: NewPayloadVariable) -> Result<PayloadVariable, StorageError> {
        let generator = encode_generator(&new.generator)?;
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4();
        let created_at = Utc::now();
        conn.execute(
            "INSERT INTO payload_variables (id, name, generator, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![id, new.name, generator, created_at],
        )
        .map_err(|err| duplicate_name_error(err, &new.name))?;

        Ok(PayloadVariable {
            id,
            name: new.name,
            generator: new.generator,
            created_at,
        })
    }

    fn get(&self, id: Uuid) -> Result<Option<PayloadVariable>, StorageError> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, name, generator, created_at
             FROM payload_variables WHERE id = ?1",
            params![id],
            row_to_variable,
        )
        .optional()
        .map_err(StorageError::from)
    }

    fn list(&self) -> Result<Vec<PayloadVariable>, StorageError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, generator, created_at
             FROM payload_variables ORDER BY name COLLATE NOCASE",
        )?;
        let variables = stmt
            .query_map([], row_to_variable)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(variables)
    }

    fn update(
        &self,
        id: Uuid,
        update: UpdatePayloadVariable,
    ) -> Result<Option<PayloadVariable>, StorageError> {
        let generator = encode_generator(&update.generator)?;
        let conn = self.conn.lock().unwrap();
        let rows_changed = conn
            .execute(
                "UPDATE payload_variables SET name = ?1, generator = ?2 WHERE id = ?3",
                params![update.name, generator, id],
            )
            .map_err(|err| duplicate_name_error(err, &update.name))?;

        if rows_changed == 0 {
            return Ok(None);
        }

        let created_at: DateTime<Utc> = conn.query_row(
            "SELECT created_at FROM payload_variables WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;

        Ok(Some(PayloadVariable {
            id,
            name: update.name,
            generator: update.generator,
            created_at,
        }))
    }

    fn delete(&self, id: Uuid) -> Result<(), StorageError> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM payload_variables WHERE id = ?1", params![id])?;
        Ok(())
    }
}

fn encode_generator(generator: &VariableGenerator) -> Result<String, StorageError> {
    serde_json::to_string(generator).map_err(StorageError::from)
}

/// Turns a `UNIQUE` constraint violation on `payload_variables.name` into the
/// dedicated `DuplicateVariableName` error; passes any other error through
/// unchanged.
fn duplicate_name_error(err: rusqlite::Error, name: &str) -> StorageError {
    if is_unique_violation(&err) {
        StorageError::DuplicateVariableName(name.to_string())
    } else {
        StorageError::from(err)
    }
}

fn row_to_variable(row: &rusqlite::Row<'_>) -> rusqlite::Result<PayloadVariable> {
    let generator: String = row.get(2)?;
    Ok(PayloadVariable {
        id: row.get(0)?,
        name: row.get(1)?,
        // A `generator` that doesn't deserialize means the column was written
        // by a newer build (or hand-edited); surface it as a column decode
        // error rather than silently substituting a default that would then be
        // saved back over the real definition.
        generator: serde_json::from_str(&generator).map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Text, Box::new(err))
        })?,
        created_at: row.get(3)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::TimestampFormat;
    use crate::storage::open_in_memory;

    fn repo() -> SqlitePayloadVariablesRepository {
        SqlitePayloadVariablesRepository::new(Arc::new(Mutex::new(open_in_memory())))
    }

    fn sample_variable() -> NewPayloadVariable {
        NewPayloadVariable {
            name: "tempC".to_string(),
            generator: VariableGenerator::RandomFloat {
                min: 18.0,
                max: 24.0,
                decimals: 1,
            },
        }
    }

    /// Also proves the seeded `created_at` text is a format rusqlite's chrono
    /// support can read back - a migration-authored timestamp isn't written by
    /// the same code path as `Utc::now()`.
    #[test]
    fn a_fresh_database_is_seeded_with_the_four_built_in_variables() {
        let names: Vec<String> = repo().list().unwrap().into_iter().map(|v| v.name).collect();

        assert_eq!(names, vec!["counter", "isoDate", "timestamp", "uuid"]);
    }

    #[test]
    fn seeded_generators_decode_to_the_expected_variants() {
        let all = repo().list().unwrap();
        let by_name = |name: &str| {
            all.iter()
                .find(|v| v.name == name)
                .map(|v| v.generator.clone())
                .expect("seeded variable to exist")
        };

        assert_eq!(by_name("uuid"), VariableGenerator::Uuid);
        assert_eq!(
            by_name("counter"),
            VariableGenerator::Counter { start: 1, step: 1 }
        );
        assert_eq!(
            by_name("timestamp"),
            VariableGenerator::Timestamp {
                format: TimestampFormat::UnixMillis
            }
        );
        assert_eq!(
            by_name("isoDate"),
            VariableGenerator::Timestamp {
                format: TimestampFormat::Iso8601
            }
        );
    }

    #[test]
    fn create_then_get_returns_the_same_variable() {
        let repo = repo();
        let before = Utc::now();

        let created = repo.create(sample_variable()).unwrap();

        assert!(created.created_at >= before);
        let fetched = repo.get(created.id).unwrap().expect("variable to exist");
        assert_eq!(fetched, created);
    }

    #[test]
    fn get_returns_none_for_unknown_id() {
        assert_eq!(repo().get(Uuid::new_v4()).unwrap(), None);
    }

    #[test]
    fn every_generator_variant_survives_a_storage_roundtrip() {
        let repo = repo();
        let generators = [
            VariableGenerator::FixedText {
                value: "dev-42".to_string(),
            },
            VariableGenerator::Counter { start: 10, step: 5 },
            VariableGenerator::RandomInt { min: -5, max: 100 },
            VariableGenerator::RandomFloat {
                min: 18.5,
                max: 24.5,
                decimals: 2,
            },
            VariableGenerator::Uuid,
            VariableGenerator::Timestamp {
                format: TimestampFormat::Iso8601,
            },
        ];

        for (index, generator) in generators.into_iter().enumerate() {
            let created = repo
                .create(NewPayloadVariable {
                    name: format!("var{index}"),
                    generator: generator.clone(),
                })
                .unwrap();

            let fetched = repo.get(created.id).unwrap().expect("variable to exist");
            assert_eq!(fetched.generator, generator);
        }
    }

    #[test]
    fn list_orders_by_name_case_insensitively() {
        let repo = repo();
        for name in ["zebra", "Alpha"] {
            let mut variable = sample_variable();
            variable.name = name.to_string();
            repo.create(variable).unwrap();
        }

        let names: Vec<String> = repo.list().unwrap().into_iter().map(|v| v.name).collect();

        // Plain ASCII ordering would put "Alpha" and "zebra" either side of the
        // lowercase seeds; NOCASE interleaves them the way a reader expects.
        assert_eq!(
            names,
            vec!["Alpha", "counter", "isoDate", "timestamp", "uuid", "zebra"]
        );
    }

    #[test]
    fn update_changes_the_stored_fields() {
        let repo = repo();
        let created = repo.create(sample_variable()).unwrap();

        let updated = repo
            .update(
                created.id,
                UpdatePayloadVariable {
                    name: "tempF".to_string(),
                    generator: VariableGenerator::RandomInt { min: 60, max: 80 },
                },
            )
            .unwrap()
            .expect("variable to exist");

        assert_eq!(updated.id, created.id);
        assert_eq!(updated.name, "tempF");
        assert_eq!(
            updated.generator,
            VariableGenerator::RandomInt { min: 60, max: 80 }
        );
        assert_eq!(updated.created_at, created.created_at);
        assert_eq!(repo.get(created.id).unwrap(), Some(updated));
    }

    #[test]
    fn update_returns_none_for_unknown_id() {
        let result = repo()
            .update(
                Uuid::new_v4(),
                UpdatePayloadVariable {
                    name: "ghost".to_string(),
                    generator: VariableGenerator::Uuid,
                },
            )
            .unwrap();

        assert_eq!(result, None);
    }

    #[test]
    fn create_rejects_a_case_insensitive_duplicate_name() {
        let repo = repo();
        repo.create(sample_variable()).unwrap();

        let mut duplicate = sample_variable();
        duplicate.name = "TEMPC".to_string();
        let err = repo.create(duplicate).unwrap_err();

        assert!(matches!(err, StorageError::DuplicateVariableName(name) if name == "TEMPC"));
    }

    #[test]
    fn create_rejects_a_name_that_collides_with_a_seeded_variable() {
        let mut clash = sample_variable();
        clash.name = "UUID".to_string();

        let err = repo().create(clash).unwrap_err();

        assert!(matches!(err, StorageError::DuplicateVariableName(name) if name == "UUID"));
    }

    #[test]
    fn update_rejects_a_case_insensitive_duplicate_name() {
        let repo = repo();
        repo.create(sample_variable()).unwrap();
        let mut other = sample_variable();
        other.name = "humidity".to_string();
        let other = repo.create(other).unwrap();

        let err = repo
            .update(
                other.id,
                UpdatePayloadVariable {
                    name: "TempC".to_string(),
                    generator: VariableGenerator::Uuid,
                },
            )
            .unwrap_err();

        assert!(matches!(err, StorageError::DuplicateVariableName(name) if name == "TempC"));
    }

    #[test]
    fn delete_removes_the_variable() {
        let repo = repo();
        let created = repo.create(sample_variable()).unwrap();

        repo.delete(created.id).unwrap();

        assert_eq!(repo.get(created.id).unwrap(), None);
    }

    #[test]
    fn a_seeded_variable_can_be_deleted() {
        let repo = repo();
        let seeded = repo
            .list()
            .unwrap()
            .into_iter()
            .find(|v| v.name == "counter")
            .expect("seeded variable to exist");

        repo.delete(seeded.id).unwrap();

        assert_eq!(repo.get(seeded.id).unwrap(), None);
    }
}
