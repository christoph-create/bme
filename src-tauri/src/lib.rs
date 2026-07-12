mod commands;

use std::sync::{Arc, Mutex};

use bme_core::mqtt::manager::MqttClientManager;
use bme_core::mqtt::rumqttc_adapter::RumqttcAdapter;
use bme_core::storage;
use bme_core::storage::connections_repo::SqliteConnectionsRepository;
use bme_core::storage::favorites_repo::SqliteFavoritesRepository;
use tauri::{Emitter, Manager};
use tokio::sync::mpsc;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            let db_path = app_data_dir.join("bme.sqlite3");
            let conn = Arc::new(Mutex::new(storage::open_at(&db_path)?));

            app.manage(SqliteConnectionsRepository::new(Arc::clone(&conn)));
            app.manage(SqliteFavoritesRepository::new(conn));

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
            commands::list_connections,
            commands::create_connection,
            commands::delete_connection,
            commands::get_connection,
            commands::connect_broker,
            commands::disconnect_broker,
            commands::test_connection,
            commands::publish_message,
            commands::subscribe_topic,
            commands::unsubscribe_topic,
            commands::list_favorites,
            commands::save_favorite,
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
                commands::list_connections,
                commands::connect_broker,
                commands::subscribe_topic,
                commands::unsubscribe_topic,
                commands::test_connection,
            ])
            .build(tauri::generate_context!())
            .expect("failed to build mock app");

        let conn = Arc::new(Mutex::new(storage::open_in_memory()));
        app.manage(SqliteConnectionsRepository::new(Arc::clone(&conn)));
        app.manage(SqliteFavoritesRepository::new(conn));

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
