mod commands;

use std::sync::{Arc, Mutex};

use bme_core::mqtt::manager::MqttClientManager;
use bme_core::mqtt::rumqttc_adapter::RumqttcAdapter;
use bme_core::storage;
use bme_core::storage::app_settings_repo::SqliteAppSettingsRepository;
use bme_core::storage::connections_repo::SqliteConnectionsRepository;
use bme_core::storage::favorite_collections_repo::SqliteFavoriteCollectionsRepository;
use bme_core::storage::favorites_repo::SqliteFavoritesRepository;
use bme_core::storage::payload_variables_repo::SqlitePayloadVariablesRepository;
use bme_core::update::checker::UpdateChecker;
use bme_core::update::github::GithubReleaseSource;
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
        // Only used for picking certificate files on the connection form.
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            let db_path = app_data_dir.join("bme.sqlite3");
            let conn = Arc::new(Mutex::new(storage::open_at(&db_path)?));

            app.manage(SqliteConnectionsRepository::new(Arc::clone(&conn)));
            app.manage(SqliteFavoritesRepository::new(Arc::clone(&conn)));
            app.manage(SqliteFavoriteCollectionsRepository::new(Arc::clone(&conn)));
            app.manage(SqlitePayloadVariablesRepository::new(Arc::clone(&conn)));
            app.manage(SqliteAppSettingsRepository::new(Arc::clone(&conn)));

            // Two handles onto the same settings table: the checker keeps one
            // so its throttle and skip state travel with it, and the other
            // stays managed for whatever reads settings next. Both are Arc
            // bumps over the one connection.
            if commands::effective_version() != env!("CARGO_PKG_VERSION") {
                log::warn!(
                    "BME_UPDATE_VERSION is set: reporting {} instead of the real {}. \
                     Update checks will be wrong - unset it unless you're testing the dialog.",
                    commands::effective_version(),
                    env!("CARGO_PKG_VERSION")
                );
            }
            app.manage(UpdateChecker::new(
                GithubReleaseSource::new(concat!("bme/", env!("CARGO_PKG_VERSION"))),
                SqliteAppSettingsRepository::new(conn),
                commands::effective_version(),
            ));

            let (events_tx, mut events_rx) = mpsc::unbounded_channel();
            app.manage(MqttClientManager::new(RumqttcAdapter::new(events_tx)));

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                while let Some(event) = events_rx.recv().await {
                    let _ = app_handle.emit("mqtt-event", event);
                }
            });

            // WebKitGTK (the Linux webview backend) reimplements wheel
            // scrolling as a spring-damped animation instead of native GTK
            // kinetic scrolling. That makes scrolling lag increasingly
            // behind fast input and feel "heavier" near scroll bounds -
            // most noticeable with high-resolution wheel input from
            // free-spinning mice. Disabling it falls back to WebKit's
            // immediate, unanimated scroll handling.
            #[cfg(any(
                target_os = "linux",
                target_os = "dragonfly",
                target_os = "freebsd",
                target_os = "netbsd",
                target_os = "openbsd"
            ))]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.with_webview(|webview| {
                    use webkit2gtk::{SettingsExt, WebViewExt};
                    if let Some(settings) = webview.inner().settings() {
                        settings.set_enable_smooth_scrolling(false);
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::open_log_dir,
            commands::get_app_version,
            commands::check_for_updates,
            commands::skip_update_version,
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
            commands::list_payload_variables,
            commands::create_payload_variable,
            commands::get_payload_variable,
            commands::update_payload_variable,
            commands::delete_payload_variable,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use bme_core::storage::app_settings_repo::AppSettingsRepository;
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
                commands::get_connection,
                commands::delete_connection,
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
                commands::list_payload_variables,
                commands::create_payload_variable,
                commands::get_payload_variable,
                commands::update_payload_variable,
                commands::delete_payload_variable,
                commands::get_app_version,
                commands::check_for_updates,
                commands::skip_update_version,
            ])
            .build(tauri::generate_context!())
            .expect("failed to build mock app");

        let conn = Arc::new(Mutex::new(storage::open_in_memory()));
        app.manage(SqliteConnectionsRepository::new(Arc::clone(&conn)));
        app.manage(SqliteFavoritesRepository::new(Arc::clone(&conn)));
        app.manage(SqliteFavoriteCollectionsRepository::new(Arc::clone(&conn)));
        app.manage(SqlitePayloadVariablesRepository::new(Arc::clone(&conn)));
        app.manage(SqliteAppSettingsRepository::new(Arc::clone(&conn)));

        // A real adapter aimed at a closed local port: these tests are about
        // the command wiring and the ACL, not about GitHub. The policy itself
        // is covered in core, against a fake source.
        app.manage(UpdateChecker::new(
            GithubReleaseSource::with_url("bme/test", DEAD_RELEASE_URL),
            SqliteAppSettingsRepository::new(conn),
            env!("CARGO_PKG_VERSION"),
        ));

        let (events_tx, _events_rx) = mpsc::unbounded_channel();
        app.manage(MqttClientManager::new(RumqttcAdapter::new(events_tx)));

        app
    }

    /// Port 9 is "discard" and is never listening, so a check against it fails
    /// fast and locally.
    const DEAD_RELEASE_URL: &str = "http://127.0.0.1:9/latest";

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

    /// Same call as `invoke`, but for the cases where failing *is* the point -
    /// `invoke` panics on `Err`, which is right for every other test here.
    fn invoke_err(
        webview: &tauri::WebviewWindow<MockRuntime>,
        cmd: &str,
        body: serde_json::Value,
    ) -> String {
        get_ipc_response(
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
        .expect_err("expected the command to fail")
        .as_str()
        .expect("expected the error to arrive as a string")
        .to_string()
    }

    #[test]
    fn get_app_version_returns_the_crate_version_over_ipc() {
        // Also the cheapest proof that a new command's capability entry and
        // handler registration both landed - the ACL rejects it otherwise.
        let app = build_test_app();
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        let version = invoke(&webview, "get_app_version", serde_json::json!({}));

        assert_eq!(version, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn skip_update_version_persists_the_normalised_version_over_ipc() {
        let app = build_test_app();
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        invoke(
            &webview,
            "skip_update_version",
            serde_json::json!({ "version": "v0.9.9" }),
        );

        let settings = app.state::<SqliteAppSettingsRepository>();
        assert_eq!(
            settings.get(bme_core::update::SKIPPED_VERSION_KEY).unwrap(),
            Some("0.9.9".to_string())
        );
    }

    #[test]
    fn check_for_updates_surfaces_a_failure_as_a_string_over_ipc() {
        // Proves the async command works over the same IPC path as the sync
        // ones, and that errors reach the frontend as plain strings.
        let app = build_test_app();
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        let err = invoke_err(
            &webview,
            "check_for_updates",
            serde_json::json!({ "force": true }),
        );

        assert!(
            err.contains("could not reach GitHub"),
            "unexpected error: {err}"
        );
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
                    "scheme": "mqtt",
                    "ws_path": null,
                    "ca_cert_path": null,
                    "client_cert_path": null,
                    "client_key_path": null,
                    "alpn": null,
                    "skip_cert_verification": false,
                    "keep_alive_secs": 30,
                    "auto_reconnect": true,
                    "max_reconnect_attempts": 10,
                    "subscriptions": []
                }
            }),
        );
        assert_eq!(created["name"], "Local");

        let all = invoke(&webview, "list_connections", serde_json::json!({}));
        assert_eq!(all.as_array().unwrap().len(), 1);
        assert_eq!(all[0]["id"], created["id"]);
    }

    /// Deleting reaches into the MQTT manager to drop any live session, so it
    /// takes managed state the other CRUD commands don't - which only the real
    /// IPC path proves is wired up.
    #[test]
    fn delete_connection_drops_the_row_over_ipc() {
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
                    "scheme": "mqtt",
                    "ws_path": null,
                    "ca_cert_path": null,
                    "client_cert_path": null,
                    "client_key_path": null,
                    "alpn": null,
                    "skip_cert_verification": false,
                    "keep_alive_secs": 30,
                    "auto_reconnect": true,
                    "max_reconnect_attempts": 10,
                    "subscriptions": []
                }
            }),
        );

        invoke(
            &webview,
            "delete_connection",
            serde_json::json!({ "id": created["id"] }),
        );

        let all = invoke(&webview, "list_connections", serde_json::json!({}));
        assert!(all.as_array().unwrap().is_empty());
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
                    "scheme": "mqtt",
                    "ws_path": null,
                    "ca_cert_path": null,
                    "client_cert_path": null,
                    "client_key_path": null,
                    "alpn": null,
                    "skip_cert_verification": false,
                    "keep_alive_secs": 30,
                    "auto_reconnect": true,
                    "max_reconnect_attempts": 10,
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
                    "scheme": "mqtts",
                    "ws_path": null,
                    "ca_cert_path": null,
                    "client_cert_path": null,
                    "client_key_path": null,
                    "alpn": null,
                    "skip_cert_verification": false,
                    "keep_alive_secs": 45,
                    "auto_reconnect": false,
                    "max_reconnect_attempts": 3,
                }
            }),
        );
        assert_eq!(updated["name"], "Renamed");
        assert_eq!(updated["host"], "renamed.local");

        let all = invoke(&webview, "list_connections", serde_json::json!({}));
        assert_eq!(all[0]["name"], "Renamed");
    }

    /// The transport and certificate settings cross the boundary as a
    /// hand-maintained TypeScript mirror, so the exact field names and the
    /// scheme's wire string are what this is really pinning.
    #[test]
    fn websocket_and_tls_settings_round_trip_over_ipc() {
        let app = build_test_app();
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        let created = invoke(
            &webview,
            "create_connection",
            serde_json::json!({
                "newConnection": {
                    "name": "HiveMQ Cloud",
                    "host": "broker.hivemq.cloud",
                    "port": 8884,
                    "client_id": "bme-ws-test",
                    "username": null,
                    "password": null,
                    "scheme": "wss",
                    "ws_path": "/mqtt",
                    "ca_cert_path": "/certs/AmazonRootCA1.pem",
                    "client_cert_path": "/certs/device-cert.pem",
                    "client_key_path": "/certs/device-key.pem",
                    "alpn": "x-amzn-mqtt-ca",
                    "skip_cert_verification": true,
                    "keep_alive_secs": 60,
                    "auto_reconnect": true,
                    "max_reconnect_attempts": 10,
                    "subscriptions": []
                }
            }),
        );

        assert_eq!(created["scheme"], "wss");
        assert_eq!(created["ws_path"], "/mqtt");
        assert_eq!(created["alpn"], "x-amzn-mqtt-ca");
        assert_eq!(created["skip_cert_verification"], true);

        let fetched = invoke(
            &webview,
            "get_connection",
            serde_json::json!({ "id": created["id"].clone() }),
        );
        assert_eq!(fetched["scheme"], "wss");
        assert_eq!(fetched["ws_path"], "/mqtt");
        assert_eq!(fetched["ca_cert_path"], "/certs/AmazonRootCA1.pem");
        assert_eq!(fetched["client_cert_path"], "/certs/device-cert.pem");
        assert_eq!(fetched["client_key_path"], "/certs/device-key.pem");
        assert_eq!(fetched["alpn"], "x-amzn-mqtt-ca");
        assert_eq!(fetched["skip_cert_verification"], true);
    }

    /// The reconnect settings are only useful if they survive the IPC round
    /// trip - they're read back on every connect to build the backoff policy.
    #[test]
    fn reconnect_settings_round_trip_over_ipc() {
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
                    "client_id": "bme-reconnect-test",
                    "username": null,
                    "password": null,
                    "scheme": "mqtt",
                    "ws_path": null,
                    "ca_cert_path": null,
                    "client_cert_path": null,
                    "client_key_path": null,
                    "alpn": null,
                    "skip_cert_verification": false,
                    "keep_alive_secs": 30,
                    "auto_reconnect": false,
                    "max_reconnect_attempts": 25,
                    "subscriptions": []
                }
            }),
        );

        assert_eq!(created["auto_reconnect"], false);
        assert_eq!(created["max_reconnect_attempts"], 25);

        let fetched = invoke(
            &webview,
            "get_connection",
            serde_json::json!({ "id": created["id"].clone() }),
        );
        assert_eq!(fetched["auto_reconnect"], false);
        assert_eq!(fetched["max_reconnect_attempts"], 25);
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

        let all = invoke(&webview, "list_favorite_collections", serde_json::json!({}));
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

        let all = invoke(&webview, "list_favorite_collections", serde_json::json!({}));
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

        let all = invoke(&webview, "list_favorite_collections", serde_json::json!({}));
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
                    "scheme": "mqtt",
                    "ws_path": null,
                    "ca_cert_path": null,
                    "client_cert_path": null,
                    "client_key_path": null,
                    "alpn": null,
                    "skip_cert_verification": false,
                    "keep_alive_secs": 30,
                    "auto_reconnect": true,
                    "max_reconnect_attempts": 10,
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
                    "scheme": "mqtt",
                    "ws_path": null,
                    "ca_cert_path": null,
                    "client_cert_path": null,
                    "client_key_path": null,
                    "alpn": null,
                    "skip_cert_verification": false,
                    "keep_alive_secs": 30,
                    "auto_reconnect": true,
                    "max_reconnect_attempts": 10,
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
                    "scheme": "mqtt",
                    "ws_path": null,
                    "ca_cert_path": null,
                    "client_cert_path": null,
                    "client_key_path": null,
                    "alpn": null,
                    "skip_cert_verification": false,
                    "keep_alive_secs": 30,
                    "auto_reconnect": true,
                    "max_reconnect_attempts": 10,
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

    /// The `generator` JSON is the contract the TypeScript union mirrors, so
    /// this asserts the tagged shape survives a real IPC round trip in both
    /// directions - not just that the command is reachable.
    #[test]
    fn create_payload_variable_round_trips_its_generator_over_ipc() {
        let app = build_test_app();
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        let created = invoke(
            &webview,
            "create_payload_variable",
            serde_json::json!({
                "newVariable": {
                    "name": "tempC",
                    "generator": {
                        "kind": "randomFloat", "min": 18.0, "max": 24.0, "decimals": 1
                    }
                }
            }),
        );
        assert_eq!(created["name"], "tempC");
        assert_eq!(created["generator"]["kind"], "randomFloat");
        assert_eq!(created["generator"]["decimals"], 1);

        let fetched = invoke(
            &webview,
            "get_payload_variable",
            serde_json::json!({ "id": created["id"] }),
        );
        assert_eq!(fetched, created);
    }

    #[test]
    fn list_payload_variables_returns_the_seeded_built_ins() {
        let app = build_test_app();
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        let all = invoke(&webview, "list_payload_variables", serde_json::json!({}));

        let names: Vec<&str> = all
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, vec!["counter", "isoDate", "timestamp", "uuid"]);
    }

    #[test]
    fn update_and_delete_payload_variable_round_trip_over_ipc() {
        let app = build_test_app();
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        let created = invoke(
            &webview,
            "create_payload_variable",
            serde_json::json!({
                "newVariable": {
                    "name": "state",
                    "generator": { "kind": "randomInt", "min": 0, "max": 9 }
                }
            }),
        );

        let updated = invoke(
            &webview,
            "update_payload_variable",
            serde_json::json!({
                "id": created["id"],
                "update": {
                    "name": "mode",
                    "generator": { "kind": "counter", "start": 10, "step": 5 }
                }
            }),
        );
        assert_eq!(updated["name"], "mode");
        assert_eq!(updated["generator"]["start"], 10);

        invoke(
            &webview,
            "delete_payload_variable",
            serde_json::json!({ "id": created["id"] }),
        );

        let fetched = invoke(
            &webview,
            "get_payload_variable",
            serde_json::json!({ "id": created["id"] }),
        );
        assert!(fetched.is_null());
    }

    #[test]
    fn create_payload_variable_reports_a_duplicate_name_as_a_readable_error() {
        let app = build_test_app();
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        let message = invoke_err(
            &webview,
            "create_payload_variable",
            serde_json::json!({
                "newVariable": { "name": "UUID", "generator": { "kind": "uuid" } }
            }),
        );

        assert_eq!(message, "a variable named \"UUID\" already exists");
    }
}
