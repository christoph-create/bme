use serde::Serialize;
use uuid::Uuid;

use crate::models::{BrokerConnection, QoS};

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum MqttError {
    #[error("Not connected to the broker")]
    UnknownConnection(Uuid),
    #[error("mqtt error: {0}")]
    Other(String),
}

/// An event pushed out of a connection independently of who asked for
/// anything - e.g. an incoming publish, or a state change.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub enum MqttEvent {
    Connected {
        connection_id: Uuid,
    },
    Disconnected {
        connection_id: Uuid,
    },
    MessageReceived {
        connection_id: Uuid,
        topic: String,
        payload: Vec<u8>,
        qos: QoS,
        retain: bool,
    },
}

/// A driver capable of talking to one or more MQTT brokers.
///
/// Every method is fire-and-forget: MQTT pub/sub is inherently asynchronous
/// (the broker acts on it over the network, on its own time), so success
/// here only means "the command was accepted", not "the broker has acted on
/// it". Real outcomes and incoming data surface later as `MqttEvent`s.
pub trait MqttPort: Send + Sync {
    fn connect(&self, connection_id: Uuid, broker: &BrokerConnection) -> Result<(), MqttError>;

    fn publish(
        &self,
        connection_id: Uuid,
        topic: &str,
        payload: Vec<u8>,
        qos: QoS,
        retain: bool,
    ) -> Result<(), MqttError>;

    fn subscribe(&self, connection_id: Uuid, topic: &str, qos: QoS) -> Result<(), MqttError>;

    fn unsubscribe(&self, connection_id: Uuid, topic: &str) -> Result<(), MqttError>;

    fn disconnect(&self, connection_id: Uuid) -> Result<(), MqttError>;
}
