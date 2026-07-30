use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// MQTT quality-of-service level (0, 1, 2 on the wire).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum QoS {
    AtMostOnce,
    AtLeastOnce,
    ExactlyOnce,
}

impl TryFrom<i64> for QoS {
    type Error = String;

    fn try_from(value: i64) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(QoS::AtMostOnce),
            1 => Ok(QoS::AtLeastOnce),
            2 => Ok(QoS::ExactlyOnce),
            other => Err(format!("invalid QoS value: {other}")),
        }
    }
}

impl From<QoS> for i64 {
    fn from(qos: QoS) -> Self {
        match qos {
            QoS::AtMostOnce => 0,
            QoS::AtLeastOnce => 1,
            QoS::ExactlyOnce => 2,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Subscription {
    pub id: Uuid,
    pub connection_id: Uuid,
    pub topic: String,
    pub qos: QoS,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BrokerConnection {
    pub id: Uuid,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub client_id: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub use_tls: bool,
    pub keep_alive_secs: u16,
    /// Whether a dropped session should be re-established on its own, and how
    /// many times to try before giving up. See `crate::mqtt::reconnect`.
    pub auto_reconnect: bool,
    pub max_reconnect_attempts: u32,
    pub subscriptions: Vec<Subscription>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewSubscription {
    pub topic: String,
    pub qos: QoS,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewBrokerConnection {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub client_id: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub use_tls: bool,
    pub keep_alive_secs: u16,
    pub auto_reconnect: bool,
    pub max_reconnect_attempts: u32,
    pub subscriptions: Vec<NewSubscription>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpdateBrokerConnection {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub client_id: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub use_tls: bool,
    pub keep_alive_secs: u16,
    pub auto_reconnect: bool,
    pub max_reconnect_attempts: u32,
}

/// How a favorite message's payload should be treated when it's loaded back
/// into the publish form - pretty-printable JSON, or opaque raw text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageFormat {
    Json,
    Raw,
}

impl TryFrom<&str> for MessageFormat {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "json" => Ok(MessageFormat::Json),
            "raw" => Ok(MessageFormat::Raw),
            other => Err(format!("invalid MessageFormat value: {other}")),
        }
    }
}

impl From<MessageFormat> for String {
    fn from(format: MessageFormat) -> Self {
        match format {
            MessageFormat::Json => "json".to_string(),
            MessageFormat::Raw => "raw".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FavoriteMessage {
    pub id: Uuid,
    pub collection_id: Option<Uuid>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub topic: String,
    pub payload: String,
    pub format: MessageFormat,
    pub qos: QoS,
    pub retain: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewFavoriteMessage {
    pub collection_id: Option<Uuid>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub topic: String,
    pub payload: String,
    pub format: MessageFormat,
    pub qos: QoS,
    pub retain: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpdateFavoriteMessage {
    pub collection_id: Option<Uuid>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub topic: String,
    pub payload: String,
    pub format: MessageFormat,
    pub qos: QoS,
    pub retain: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FavoriteCollection {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewFavoriteCollection {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpdateFavoriteCollection {
    pub name: String,
    pub description: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qos_roundtrips_through_i64() {
        for qos in [QoS::AtMostOnce, QoS::AtLeastOnce, QoS::ExactlyOnce] {
            let as_int: i64 = qos.into();
            assert_eq!(QoS::try_from(as_int), Ok(qos));
        }
    }

    #[test]
    fn qos_rejects_invalid_values() {
        assert!(QoS::try_from(3).is_err());
    }

    #[test]
    fn message_format_roundtrips_through_str() {
        for format in [MessageFormat::Json, MessageFormat::Raw] {
            let as_str: String = format.into();
            assert_eq!(MessageFormat::try_from(as_str.as_str()), Ok(format));
        }
    }

    #[test]
    fn message_format_rejects_invalid_values() {
        assert!(MessageFormat::try_from("xml").is_err());
    }

    #[test]
    fn message_format_serializes_as_lowercase_json() {
        assert_eq!(
            serde_json::to_string(&MessageFormat::Json).unwrap(),
            "\"json\""
        );
        assert_eq!(
            serde_json::to_string(&MessageFormat::Raw).unwrap(),
            "\"raw\""
        );
    }
}
