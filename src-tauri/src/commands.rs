use bme_core::models::{
    BrokerConnection, FavoriteMessage, NewBrokerConnection, NewFavoriteMessage, NewSubscription,
    QoS, Subscription,
};
use bme_core::mqtt::manager::MqttClientManager;
use bme_core::mqtt::port::MqttError;
use bme_core::mqtt::rumqttc_adapter::RumqttcAdapter;
use bme_core::storage::connections_repo::{ConnectionsRepository, SqliteConnectionsRepository};
use bme_core::storage::favorites_repo::{FavoritesRepository, SqliteFavoritesRepository};
use tauri::State;
use uuid::Uuid;

pub type MqttManagerState = MqttClientManager<RumqttcAdapter>;

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
    manager
        .connect(id, &connection)
        .map_err(|err| err.to_string())?;
    for subscription in &connection.subscriptions {
        manager
            .subscribe(id, &subscription.topic, subscription.qos)
            .map_err(|err| err.to_string())?;
    }
    Ok(())
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
pub fn save_favorite(
    repo: State<SqliteFavoritesRepository>,
    new_favorite: NewFavoriteMessage,
) -> Result<FavoriteMessage, String> {
    repo.create(new_favorite).map_err(|err| err.to_string())
}
