use std::sync::LazyLock;

use bme_core::models::{
    BrokerConnection, FavoriteCollection, FavoriteMessage, NewBrokerConnection,
    NewFavoriteCollection, NewFavoriteMessage, NewSubscription, QoS, Subscription,
    UpdateBrokerConnection, UpdateCheck, UpdateFavoriteCollection, UpdateFavoriteMessage,
};
use bme_core::mqtt::manager::MqttClientManager;
use bme_core::mqtt::port::MqttError;
use bme_core::mqtt::rumqttc_adapter::RumqttcAdapter;
use bme_core::storage::app_settings_repo::SqliteAppSettingsRepository;
use bme_core::storage::connections_repo::{ConnectionsRepository, SqliteConnectionsRepository};
use bme_core::storage::favorite_collections_repo::{
    FavoriteCollectionsRepository, SqliteFavoriteCollectionsRepository,
};
use bme_core::storage::favorites_repo::{FavoritesRepository, SqliteFavoritesRepository};
use bme_core::update::checker::UpdateChecker;
use bme_core::update::github::GithubReleaseSource;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

pub type MqttManagerState = MqttClientManager<RumqttcAdapter>;
pub type UpdateCheckerState = UpdateChecker<GithubReleaseSource, SqliteAppSettingsRepository>;

/// The version the app reports and compares against the newest release.
///
/// `CARGO_PKG_VERSION` rather than `app.package_info().version` (which reads
/// `tauri.conf.json`) because `src-tauri/Cargo.toml` is the file the release
/// job checks the pushed tag against - so this is the number that can't be
/// wrong without CI failing.
///
/// `BME_UPDATE_VERSION` overrides it. That exists for one reason: the update
/// dialog is otherwise untestable without publishing a release, since you can
/// only see it while running something older than the newest tag. Set it lower
/// than the latest release and the popup appears against the real release
/// notes. `run()` logs a warning whenever it's set, so it can never be quietly
/// on in a build someone is trusting.
pub fn effective_version() -> &'static str {
    static VERSION: LazyLock<String> = LazyLock::new(|| {
        std::env::var("BME_UPDATE_VERSION")
            .unwrap_or_else(|_| env!("CARGO_PKG_VERSION").to_string())
    });
    &VERSION
}

#[tauri::command]
pub fn get_app_version() -> String {
    effective_version().to_string()
}

/// The first async command in this file, and it has to be: a network call in a
/// plain `#[tauri::command]` runs on the main thread and would freeze the
/// window for the length of the request timeout. Async commands need the
/// explicit `State<'_, _>` lifetime and a `Result` return.
///
/// Returns facts, never a verdict - whether any of this is worth interrupting
/// the user over is decided in the frontend, which knows whether they asked.
#[tauri::command]
pub async fn check_for_updates(
    checker: State<'_, UpdateCheckerState>,
    force: bool,
) -> Result<UpdateCheck, String> {
    checker
        .check(force, chrono::Utc::now())
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn skip_update_version(
    checker: State<'_, UpdateCheckerState>,
    version: String,
) -> Result<(), String> {
    checker
        .skip_version(&version)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn open_log_dir(app: AppHandle) -> Result<(), String> {
    let log_dir = app.path().app_log_dir().map_err(|err| err.to_string())?;
    tauri_plugin_opener::open_path(log_dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn list_connections(
    repo: State<SqliteConnectionsRepository>,
) -> Result<Vec<BrokerConnection>, String> {
    repo.list().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn create_connection(
    repo: State<SqliteConnectionsRepository>,
    new_connection: NewBrokerConnection,
) -> Result<BrokerConnection, String> {
    repo.create(new_connection).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn update_connection(
    repo: State<SqliteConnectionsRepository>,
    id: Uuid,
    update: UpdateBrokerConnection,
) -> Result<BrokerConnection, String> {
    repo.update(id, update)
        .map_err(|err| err.to_string())?
        .ok_or_else(|| format!("connection {id} not found"))
}

#[tauri::command]
pub fn delete_connection(repo: State<SqliteConnectionsRepository>, id: Uuid) -> Result<(), String> {
    repo.delete(id).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn get_connection(
    repo: State<SqliteConnectionsRepository>,
    id: Uuid,
) -> Result<Option<BrokerConnection>, String> {
    repo.get(id).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn connect_broker(
    repo: State<SqliteConnectionsRepository>,
    manager: State<MqttManagerState>,
    id: Uuid,
) -> Result<(), String> {
    let connection = repo
        .get(id)
        .map_err(|err| err.to_string())?
        .ok_or_else(|| format!("connection {id} not found"))?;
    // Subscriptions aren't replayed here: the connection task does it after
    // every ConnAck, which is the only way they survive a reconnect (the
    // session is clean, so the broker forgets them on each drop). Doing it
    // here as well would just send every SUBSCRIBE twice.
    manager
        .connect(id, &connection)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn disconnect_broker(manager: State<MqttManagerState>, id: Uuid) -> Result<(), String> {
    manager.disconnect(id).map_err(|err| err.to_string())
}

/// Kicks off a connection attempt for form data that hasn't been saved yet,
/// so the frontend can offer a "Test Connection" button before creating a
/// connection. Returns a throwaway id the frontend can watch for
/// `Connected`/`Disconnected` events on, then clean up via
/// `disconnect_broker` regardless of the outcome - this never touches the
/// database.
#[tauri::command]
pub fn test_connection(
    manager: State<MqttManagerState>,
    connection: NewBrokerConnection,
) -> Result<Uuid, String> {
    let id = Uuid::new_v4();
    let broker = BrokerConnection {
        id,
        name: connection.name,
        host: connection.host,
        port: connection.port,
        client_id: connection.client_id,
        username: connection.username,
        password: connection.password,
        use_tls: connection.use_tls,
        keep_alive_secs: connection.keep_alive_secs,
        // A connectivity check should report what happened once. Retrying for
        // minutes behind a "Test Connection" button would be baffling, and the
        // form gives up waiting after a few seconds anyway.
        auto_reconnect: false,
        max_reconnect_attempts: 0,
        subscriptions: Vec::new(),
    };
    manager
        .connect(id, &broker)
        .map_err(|err| err.to_string())?;
    Ok(id)
}

#[tauri::command]
pub fn publish_message(
    manager: State<MqttManagerState>,
    connection_id: Uuid,
    topic: String,
    payload: Vec<u8>,
    qos: QoS,
    retain: bool,
) -> Result<(), String> {
    manager
        .publish(connection_id, &topic, payload, qos, retain)
        .map_err(|err| err.to_string())
}

/// Managing the subscription *list* (add/remove) should always work, even
/// when not currently connected - it's persisted config that gets replayed
/// on the next connect (see `connect_broker`). Only a real MQTT-level
/// failure should block that; "there's no live session right now" just
/// means there's nothing to tell the broker yet, which is fine.
fn ignore_if_unknown_connection(result: Result<(), MqttError>) -> Result<(), String> {
    match result {
        Ok(()) | Err(MqttError::UnknownConnection(_)) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
pub fn subscribe_topic(
    repo: State<SqliteConnectionsRepository>,
    manager: State<MqttManagerState>,
    connection_id: Uuid,
    topic: String,
    qos: QoS,
) -> Result<Subscription, String> {
    ignore_if_unknown_connection(manager.subscribe(connection_id, &topic, qos))?;
    repo.add_subscription(connection_id, NewSubscription { topic, qos })
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn unsubscribe_topic(
    repo: State<SqliteConnectionsRepository>,
    manager: State<MqttManagerState>,
    connection_id: Uuid,
    subscription_id: Uuid,
    topic: String,
) -> Result<(), String> {
    ignore_if_unknown_connection(manager.unsubscribe(connection_id, &topic))?;
    repo.remove_subscription(subscription_id)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn list_favorites(
    repo: State<SqliteFavoritesRepository>,
) -> Result<Vec<FavoriteMessage>, String> {
    repo.list().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn create_favorite(
    repo: State<SqliteFavoritesRepository>,
    new_favorite: NewFavoriteMessage,
) -> Result<FavoriteMessage, String> {
    repo.create(new_favorite).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn get_favorite(
    repo: State<SqliteFavoritesRepository>,
    id: Uuid,
) -> Result<Option<FavoriteMessage>, String> {
    repo.get(id).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn update_favorite(
    repo: State<SqliteFavoritesRepository>,
    id: Uuid,
    update: UpdateFavoriteMessage,
) -> Result<FavoriteMessage, String> {
    repo.update(id, update)
        .map_err(|err| err.to_string())?
        .ok_or_else(|| format!("favorite {id} not found"))
}

#[tauri::command]
pub fn delete_favorite(repo: State<SqliteFavoritesRepository>, id: Uuid) -> Result<(), String> {
    repo.delete(id).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn list_favorite_collections(
    repo: State<SqliteFavoriteCollectionsRepository>,
) -> Result<Vec<FavoriteCollection>, String> {
    repo.list().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn create_favorite_collection(
    repo: State<SqliteFavoriteCollectionsRepository>,
    new_collection: NewFavoriteCollection,
) -> Result<FavoriteCollection, String> {
    repo.create(new_collection).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn get_favorite_collection(
    repo: State<SqliteFavoriteCollectionsRepository>,
    id: Uuid,
) -> Result<Option<FavoriteCollection>, String> {
    repo.get(id).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn update_favorite_collection(
    repo: State<SqliteFavoriteCollectionsRepository>,
    id: Uuid,
    update: UpdateFavoriteCollection,
) -> Result<FavoriteCollection, String> {
    repo.update(id, update)
        .map_err(|err| err.to_string())?
        .ok_or_else(|| format!("favorite collection {id} not found"))
}

#[tauri::command]
pub fn delete_favorite_collection(
    repo: State<SqliteFavoriteCollectionsRepository>,
    id: Uuid,
) -> Result<(), String> {
    repo.delete(id).map_err(|err| err.to_string())
}
