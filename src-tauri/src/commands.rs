use bme_core::models::{
    BrokerConnection, FavoriteMessage, NewBrokerConnection, NewFavoriteMessage, NewSubscription,
    QoS, Subscription,
};
use bme_core::mqtt::manager::MqttClientManager;
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

#[tauri::command]
pub fn subscribe_topic(
    repo: State<SqliteConnectionsRepository>,
    manager: State<MqttManagerState>,
    connection_id: Uuid,
    topic: String,
    qos: QoS,
) -> Result<Subscription, String> {
    manager
        .subscribe(connection_id, &topic, qos)
        .map_err(|err| err.to_string())?;
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
    manager
        .unsubscribe(connection_id, &topic)
        .map_err(|err| err.to_string())?;
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
