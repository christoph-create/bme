mod commands;

use std::sync::{Arc, Mutex};

use bme_core::mqtt::manager::MqttClientManager;
use bme_core::mqtt::rumqttc_adapter::RumqttcAdapter;
use bme_core::storage;
use bme_core::storage::connections_repo::SqliteConnectionsRepository;
use bme_core::storage::favorite_collections_repo::SqliteFavoriteCollectionsRepository;
use bme_core::storage::favorites_repo::SqliteFavoritesRepository;
use tauri::{Emitter, Manager};
use tokio::sync::mpsc;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

fn format_colored_line(
    out: tauri_plugin_log::fern::FormatCallback,
    message: &std::fmt::Arguments,
    record: &log::Record,
) {
    use colored::Colorize;
    use tauri_plugin_log::fern::colors::{Color, ColoredLevelConfig};

    // The level-only coloring fern defaults to (`ColoredLevelConfig::default()`)
    // colors Debug/Info/Trace white, which is indistinguishable from a
    // terminal's normal foreground - barely readable. Pick colors that are
    // visually distinct at every level instead.
    let colors = ColoredLevelConfig::new()
        .trace(Color::BrightBlack)
        .debug(Color::Cyan)
        .info(Color::Green)
        .warn(Color::Yellow)
        .error(Color::Red);

    // Timestamp and target stay in the default terminal color; only the
    // level and message are colored, so the level is recognizable at a
    // glance without the timestamp/target adding visual noise.
    let prefix = format!(
        "[{}][{}]",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
        record.target(),
    );
    let colored_suffix =
        format!("[{}] {}", record.level(), message).color(colors.get_color(&record.level()));
    out.finish(format_args!("{prefix}{colored_suffix}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    std::panic::set_hook(Box::new(|info| {
        let backtrace = std::backtrace::Backtrace::force_capture();
        log::error!("panic: {info}\nbacktrace:\n{backtrace}");
    }));

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                // `Builder::new()` already ships default Stdout + LogDir
                // targets - `.target()` appends to those rather than
                // replacing them, which would double-write every line.
                // `.targets()` replaces the list outright.
                //
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("bme".to_string()),
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                ])
                // Set at the Builder level (not per-target, which *wraps*
                // around this rather than replacing it, doubling every
                // line) so every target - including the saved log file -
                // gets the same colored formatter. Readable with
                // `cat`/`less`/`tail -f` or any ANSI-aware viewer; a
                // plain-text viewer with no ANSI support will show the raw
                // escape codes instead.
                .format(format_colored_line)
                .level(log::LevelFilter::Debug)
                .max_file_size(10 * 1024 * 1024)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            let db_path = app_data_dir.join("bme.sqlite3");
            let conn = Arc::new(Mutex::new(storage::open_at(&db_path)?));

            app.manage(SqliteConnectionsRepository::new(Arc::clone(&conn)));
            app.manage(SqliteFavoritesRepository::new(Arc::clone(&conn)));
            app.manage(SqliteFavoriteCollectionsRepository::new(conn));

            let (events_tx, mut events_rx) = mpsc::unbounded_channel();
            app.manage(MqttClientManager::new(RumqttcAdapter::new(events_tx)));

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                while let Some(event) = events_rx.recv().await {
                    let _ = app_handle.emit("mqtt-event", event);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::open_log_dir,
            commands::list_connections,
            commands::create_connection,
            commands::update_connection,
            commands::delete_connection,
            commands::get_connection,
            commands::connect_broker,
            commands::disconnect_broker,
            commands::test_connection,
            commands::publish_message,
            commands::subscribe_topic,
            commands::unsubscribe_topic,
            commands::list_favorites,
            commands::create_favorite,
            commands::get_favorite,
            commands::update_favorite,
            commands::delete_favorite,
            commands::list_favorite_collections,
            commands::create_favorite_collection,
            commands::get_favorite_collection,
            commands::update_favorite_collection,
            commands::delete_favorite_collection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::ipc::CallbackFn;
    use tauri::test::{get_ipc_response, mock_builder, MockRuntime};
    use tauri::webview::InvokeRequest;
    use tauri::WebviewWindowBuilder;

    /// Builds the same managed state as `run()`'s `setup()`, minus the real
    /// window/webview and file-backed database, so commands can be invoked
    /// exactly as the frontend would (real JSON in, real JSON out) without a
    /// display. Uses the project's real `tauri.conf.json`/capabilities (via
    /// `generate_context!()`) rather than `mock_context`, which builds a
    /// synthetic context with an empty ACL that would reject every command.
    fn build_test_app() -> tauri::App<MockRuntime> {
        let app = mock_builder()
            .invoke_handler(tauri::generate_handler![
                commands::create_connection,
                commands::update_connection,
                commands::list_connections,
                commands::connect_broker,
                commands::subscribe_topic,
                commands::unsubscribe_topic,
                commands::test_connection,
                commands::list_favorites,
                commands::create_favorite,
                commands::get_favorite,
                commands::update_favorite,
                commands::delete_favorite,
                commands::list_favorite_collections,
                commands::create_favorite_collection,
                commands::get_favorite_collection,
                commands::update_favorite_collection,
                commands::delete_favorite_collection,
            ])
            .build(tauri::generate_context!())
            .expect("failed to build mock app");

        let conn = Arc::new(Mutex::new(storage::open_in_memory()));
        app.manage(SqliteConnectionsRepository::new(Arc::clone(&conn)));
        app.manage(SqliteFavoritesRepository::new(Arc::clone(&conn)));
        app.manage(SqliteFavoriteCollectionsRepository::new(conn));

        let (events_tx, _events_rx) = mpsc::unbounded_channel();
        app.manage(MqttClientManager::new(RumqttcAdapter::new(events_tx)));

        app
    }

    fn invoke(
        webview: &tauri::WebviewWindow<MockRuntime>,
        cmd: &str,
        body: serde_json::Value,
    ) -> serde_json::Value {
        let response = get_ipc_response(
            webview,
            InvokeRequest {
                cmd: cmd.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "http://localhost:1420".parse().unwrap(),
                body: body.into(),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        )
        .unwrap_or_else(|err| panic!("ipc call to {cmd} failed: {err}"));
        response.deserialize::<serde_json::Value>().unwrap()
    }

    #[test]
    fn create_connection_then_list_connections_round_trips_over_ipc() {
        let app = build_test_app();
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        let created = invoke(
            &webview,
            "create_connection",
            serde_json::json!({
                "newConnection": {
                    "name": "Local",
                    "host": "localhost",
                    "port": 1883,
                    "client_id": "bme-smoke-test",
                    "username": null,
                    "password": null,
                    "use_tls": false,
                    "keep_alive_secs": 30,
                    "subscriptions": []
                }
            }),
        );
        assert_eq!(created["name"], "Local");

        let all = invoke(&webview, "list_connections", serde_json::json!({}));
        assert_eq!(all.as_array().unwrap().len(), 1);
        assert_eq!(all[0]["id"], created["id"]);
    }

    #[test]
    fn update_connection_persists_and_is_visible_on_the_listed_connection() {
        let app = build_test_app();
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        let created = invoke(
            &webview,
            "create_connection",
            serde_json::json!({
                "newConnection": {
                    "name": "Local",
                    "host": "localhost",
                    "port": 1883,
                    "client_id": "bme-update-test",
                    "username": null,
                    "password": null,
                    "use_tls": false,
                    "keep_alive_secs": 30,
                    "subscriptions": []
                }
            }),
        );
        let id = created["id"].clone();

        let updated = invoke(
            &webview,
            "update_connection",
            serde_json::json!({
                "id": id,
                "update": {
                    "name": "Renamed",
                    "host": "renamed.local",
                    "port": 8883,
                    "client_id": "bme-update-test",
                    "username": null,
                    "password": null,
                    "use_tls": true,
                    "keep_alive_secs": 45,
                }
            }),
        );
        assert_eq!(updated["name"], "Renamed");
        assert_eq!(updated["host"], "renamed.local");

        let all = invoke(&webview, "list_connections", serde_json::json!({}));
        assert_eq!(all[0]["name"], "Renamed");
    }

    #[test]
    fn create_favorite_then_list_favorites_round_trips_over_ipc() {
        let app = build_test_app();
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        let created = invoke(
            &webview,
            "create_favorite",
            serde_json::json!({
                "newFavorite": {
                    "name": "Temperature reading",
                    "description": "A sample sensor payload",
                    "topic": "sensors/temperature",
                    "payload": "{\"celsius\": 21.5}",
                    "format": "json",
                    "qos": "AtLeastOnce",
                    "retain": false
                }
            }),
        );
        assert_eq!(created["name"], "Temperature reading");

        let all = invoke(&webview, "list_favorites", serde_json::json!({}));
        assert_eq!(all.as_array().unwrap().len(), 1);
        assert_eq!(all[0]["id"], created["id"]);
    }

    #[test]
    fn get_favorite_returns_a_previously_created_favorite() {
        let app = build_test_app();
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        let created = invoke(
            &webview,
            "create_favorite",
            serde_json::json!({
                "newFavorite": {
                    "name": null,
                    "description": null,
                    "topic": "sensors/temperature",
                    "payload": "{}",
                    "format": "json",
                    "qos": "AtMostOnce",
                    "retain": false
                }
            }),
        );

        let fetched = invoke(
            &webview,
            "get_favorite",
            serde_json::json!({ "id": created["id"] }),
        );
        assert_eq!(fetched, created);
    }

    #[test]
    fn update_favorite_persists_and_is_visible_on_the_listed_favorite() {
        let app = build_test_app();
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        let created = invoke(
            &webview,
            "create_favorite",
            serde_json::json!({
                "newFavorite": {
                    "name": "Original",
                    "description": null,
                    "topic": "sensors/temperature",
                    "payload": "{}",
                    "format": "json",
                    "qos": "AtMostOnce",
                    "retain": false
                }
            }),
        );

        let updated = invoke(
            &webview,
            "update_favorite",
            serde_json::json!({
                "id": created["id"],
                "update": {
                    "name": "Renamed",
                    "description": "Now with a description",
                    "topic": "sensors/humidity",
                    "payload": "{\"pct\": 55}",
                    "format": "json",
                    "qos": "ExactlyOnce",
                    "retain": true
                }
            }),
        );
        assert_eq!(updated["name"], "Renamed");
        assert_eq!(updated["topic"], "sensors/humidity");

        let all = invoke(&webview, "list_favorites", serde_json::json!({}));
        assert_eq!(all[0]["name"], "Renamed");
    }

    #[test]
    fn delete_favorite_removes_it_from_the_list() {
        let app = build_test_app();
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        let created = invoke(
            &webview,
            "create_favorite",
            serde_json::json!({
                "newFavorite": {
                    "name": null,
                    "description": null,
                    "topic": "sensors/temperature",
                    "payload": "{}",
                    "format": "json",
                    "qos": "AtMostOnce",
                    "retain": false
                }
            }),
        );

        invoke(
            &webview,
            "delete_favorite",
            serde_json::json!({ "id": created["id"] }),
        );

        let all = invoke(&webview, "list_favorites", serde_json::json!({}));
        assert_eq!(all.as_array().unwrap().len(), 0);
    }

    #[test]
    fn create_favorite_collection_then_list_collections_round_trips_over_ipc() {
        let app = build_test_app();
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        let created = invoke(
            &webview,
            "create_favorite_collection",
            serde_json::json!({
                "newCollection": {
                    "name": "Sensor payloads",
                    "description": "Common sensor test messages"
                }
            }),
        );
        assert_eq!(created["name"], "Sensor payloads");

        let all = invoke(
            &webview,
            "list_favorite_collections",
            serde_json::json!({}),
        );
        assert_eq!(all.as_array().unwrap().len(), 1);
        assert_eq!(all[0]["id"], created["id"]);
    }

    #[test]
    fn get_favorite_collection_returns_a_previously_created_collection() {
        let app = build_test_app();
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        let created = invoke(
            &webview,
            "create_favorite_collection",
            serde_json::json!({
                "newCollection": { "name": "Sensor payloads", "description": null }
            }),
        );

        let fetched = invoke(
            &webview,
            "get_favorite_collection",
            serde_json::json!({ "id": created["id"] }),
        );
        assert_eq!(fetched, created);
    }

    #[test]
    fn update_favorite_collection_persists_and_is_visible_on_the_listed_collection() {
        let app = build_test_app();
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        let created = invoke(
            &webview,
            "create_favorite_collection",
            serde_json::json!({
                "newCollection": { "name": "Original", "description": null }
            }),
        );

        let updated = invoke(
            &webview,
            "update_favorite_collection",
            serde_json::json!({
                "id": created["id"],
                "update": { "name": "Renamed", "description": "Now with a description" }
            }),
        );
        assert_eq!(updated["name"], "Renamed");

        let all = invoke(
            &webview,
            "list_favorite_collections",
            serde_json::json!({}),
        );
        assert_eq!(all[0]["name"], "Renamed");
    }

    #[test]
    fn delete_favorite_collection_removes_it_from_the_list() {
        let app = build_test_app();
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        let created = invoke(
            &webview,
            "create_favorite_collection",
            serde_json::json!({
                "newCollection": { "name": "Sensor payloads", "description": null }
            }),
        );

        invoke(
            &webview,
            "delete_favorite_collection",
            serde_json::json!({ "id": created["id"] }),
        );

        let all = invoke(
            &webview,
            "list_favorite_collections",
            serde_json::json!({}),
        );
        assert_eq!(all.as_array().unwrap().len(), 0);
    }

    #[test]
    fn favorite_can_be_created_and_updated_with_a_collection_id() {
        let app = build_test_app();
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        let collection = invoke(
            &webview,
            "create_favorite_collection",
            serde_json::json!({
                "newCollection": { "name": "Sensor payloads", "description": null }
            }),
        );

        let created = invoke(
            &webview,
            "create_favorite",
            serde_json::json!({
                "newFavorite": {
                    "collection_id": collection["id"],
                    "name": null,
                    "description": null,
                    "topic": "sensors/temperature",
                    "payload": "{}",
                    "format": "json",
                    "qos": "AtMostOnce",
                    "retain": false
                }
            }),
        );
        assert_eq!(created["collection_id"], collection["id"]);

        let updated = invoke(
            &webview,
            "update_favorite",
            serde_json::json!({
                "id": created["id"],
                "update": {
                    "collection_id": null,
                    "name": null,
                    "description": null,
                    "topic": "sensors/temperature",
                    "payload": "{}",
                    "format": "json",
                    "qos": "AtMostOnce",
                    "retain": false
                }
            }),
        );
        assert_eq!(updated["collection_id"], serde_json::Value::Null);
    }

    #[test]
    fn subscribing_persists_and_is_visible_on_the_listed_connection() {
        let app = build_test_app();
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        let created = invoke(
            &webview,
            "create_connection",
            serde_json::json!({
                "newConnection": {
                    "name": "Local",
                    "host": "localhost",
                    "port": 1883,
                    "client_id": "bme-subscribe-test",
                    "username": null,
                    "password": null,
                    "use_tls": false,
                    "keep_alive_secs": 30,
                    "subscriptions": []
                }
            }),
        );
        let id = created["id"].clone();

        invoke(&webview, "connect_broker", serde_json::json!({ "id": id }));

        invoke(
            &webview,
            "subscribe_topic",
            serde_json::json!({
                "connectionId": id,
                "topic": "sensors/#",
                "qos": "AtLeastOnce",
            }),
        );

        let all = invoke(&webview, "list_connections", serde_json::json!({}));
        let subscriptions = all[0]["subscriptions"].as_array().unwrap();
        assert_eq!(subscriptions.len(), 1);
        assert_eq!(subscriptions[0]["topic"], "sensors/#");
        assert_eq!(subscriptions[0]["qos"], "AtLeastOnce");
    }

    #[test]
    fn test_connection_returns_an_id_without_persisting_anything() {
        let app = build_test_app();
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        let id = invoke(
            &webview,
            "test_connection",
            serde_json::json!({
                "connection": {
                    "name": "Scratch",
                    "host": "localhost",
                    "port": 1883,
                    "client_id": "bme-test-connection",
                    "username": null,
                    "password": null,
                    "use_tls": false,
                    "keep_alive_secs": 30,
                    "subscriptions": []
                }
            }),
        );
        assert!(id.as_str().is_some(), "expected a Uuid string, got {id}");

        let all = invoke(&webview, "list_connections", serde_json::json!({}));
        assert_eq!(all.as_array().unwrap().len(), 0);
    }

    #[test]
    fn subscribing_and_unsubscribing_work_without_ever_connecting() {
        let app = build_test_app();
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        let created = invoke(
            &webview,
            "create_connection",
            serde_json::json!({
                "newConnection": {
                    "name": "Local",
                    "host": "localhost",
                    "port": 1883,
                    "client_id": "bme-offline-test",
                    "username": null,
                    "password": null,
                    "use_tls": false,
                    "keep_alive_secs": 30,
                    "subscriptions": []
                }
            }),
        );
        let id = created["id"].clone();

        // Deliberately never invoke connect_broker - subscribe/unsubscribe
        // manage the persisted list and must work regardless.
        let subscription = invoke(
            &webview,
            "subscribe_topic",
            serde_json::json!({
                "connectionId": id,
                "topic": "sensors/#",
                "qos": "AtLeastOnce",
            }),
        );

        let all = invoke(&webview, "list_connections", serde_json::json!({}));
        assert_eq!(all[0]["subscriptions"].as_array().unwrap().len(), 1);

        invoke(
            &webview,
            "unsubscribe_topic",
            serde_json::json!({
                "connectionId": id,
                "subscriptionId": subscription["id"],
                "topic": "sensors/#",
            }),
        );

        let all = invoke(&webview, "list_connections", serde_json::json!({}));
        assert_eq!(all[0]["subscriptions"].as_array().unwrap().len(), 0);
    }
}
