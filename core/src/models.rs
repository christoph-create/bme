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

/// How the client reaches the broker. This replaced a plain TLS on/off
/// flag: TLS is a property of the transport rather than a switch alongside
/// it, and the WebSocket schemes carry a URL path a bool had nowhere to put.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BrokerScheme {
    Mqtt,
    Mqtts,
    Ws,
    Wss,
}

impl BrokerScheme {
    pub fn is_tls(self) -> bool {
        matches!(self, BrokerScheme::Mqtts | BrokerScheme::Wss)
    }

    pub fn is_websocket(self) -> bool {
        matches!(self, BrokerScheme::Ws | BrokerScheme::Wss)
    }

    /// What the port field starts at for a freshly picked scheme. 8083/8084 are
    /// the WebSocket listeners Mosquitto's and EMQX's own docs use; managed
    /// brokers vary (HiveMQ Cloud is 8884), so this is a starting point the
    /// user is expected to overwrite, not a rule.
    pub fn default_port(self) -> u16 {
        match self {
            BrokerScheme::Mqtt => 1883,
            BrokerScheme::Mqtts => 8883,
            BrokerScheme::Ws => 8083,
            BrokerScheme::Wss => 8084,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            BrokerScheme::Mqtt => "mqtt",
            BrokerScheme::Mqtts => "mqtts",
            BrokerScheme::Ws => "ws",
            BrokerScheme::Wss => "wss",
        }
    }
}

impl TryFrom<&str> for BrokerScheme {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "mqtt" => Ok(BrokerScheme::Mqtt),
            "mqtts" => Ok(BrokerScheme::Mqtts),
            "ws" => Ok(BrokerScheme::Ws),
            "wss" => Ok(BrokerScheme::Wss),
            other => Err(format!("invalid BrokerScheme value: {other}")),
        }
    }
}

impl From<BrokerScheme> for String {
    fn from(scheme: BrokerScheme) -> Self {
        scheme.as_str().to_string()
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
    pub scheme: BrokerScheme,
    /// The URL path of a WebSocket endpoint, `ws`/`wss` only. Empty or unset
    /// means `/mqtt`, which is what nearly every broker serves it on.
    pub ws_path: Option<String>,
    /// Paths to PEM files on disk, read fresh on every connect so a renewed
    /// certificate needs no re-import. `ca_cert_path` is added *on top of* the
    /// system trust store rather than replacing it; the client pair is mutual
    /// TLS and only takes effect when both halves are set.
    pub ca_cert_path: Option<String>,
    pub client_cert_path: Option<String>,
    pub client_key_path: Option<String>,
    /// Comma-separated ALPN protocols, so a second one needs no migration.
    /// AWS IoT is the reason this exists: it wants `x-amzn-mqtt-ca`.
    pub alpn: Option<String>,
    /// Accept any server certificate. A dev escape hatch for self-signed
    /// brokers, and the one setting here that trades away security.
    pub skip_cert_verification: bool,
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
    pub scheme: BrokerScheme,
    pub ws_path: Option<String>,
    pub ca_cert_path: Option<String>,
    pub client_cert_path: Option<String>,
    pub client_key_path: Option<String>,
    pub alpn: Option<String>,
    pub skip_cert_verification: bool,
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
    pub scheme: BrokerScheme,
    pub ws_path: Option<String>,
    pub ca_cert_path: Option<String>,
    pub client_cert_path: Option<String>,
    pub client_key_path: Option<String>,
    pub alpn: Option<String>,
    pub skip_cert_verification: bool,
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

/// How a payload variable produces its value.
///
/// Internally tagged, and this one serde shape is used *both* as the
/// `payload_variables.generator` column and as the IPC representation - so
/// there is a single encoding to keep in sync with the frontend, not two.
/// Every generator is fully parameterised here, which is what lets the
/// reference syntax stay a bare `{{name}}` with no call arguments.
///
/// Expansion itself happens in the frontend (it has to run live, per
/// keystroke, for the preview); the backend only stores definitions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum VariableGenerator {
    FixedText { value: String },
    Counter { start: i64, step: i64 },
    RandomInt { min: i64, max: i64 },
    RandomFloat { min: f64, max: f64, decimals: u8 },
    Uuid,
    Timestamp { format: TimestampFormat },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TimestampFormat {
    /// Milliseconds since the epoch, as a bare JSON number.
    UnixMillis,
    /// RFC 3339 / ISO 8601, as a string.
    Iso8601,
}

/// A named `{{placeholder}}` and the generator behind it. App-wide: variables
/// are deliberately not scoped to a connection or a template, so one defined
/// fleet is usable everywhere.
///
/// `PartialEq` but not `Eq`, because `RandomFloat` carries `f64`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PayloadVariable {
    pub id: Uuid,
    pub name: String,
    pub generator: VariableGenerator,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NewPayloadVariable {
    pub name: String,
    pub generator: VariableGenerator,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpdatePayloadVariable {
    pub name: String,
    pub generator: VariableGenerator,
}

/// The result of one update check. `Serialize` only - nothing sends this in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct UpdateCheck {
    /// What this build reports, so the caller never has to ask twice.
    pub current_version: String,
    /// `None` when the daily throttle skipped the network call, or when there
    /// is simply nothing published.
    pub latest: Option<AvailableRelease>,
    /// True when the throttle short-circuited the check, which is how the
    /// caller tells "nothing new" apart from "didn't look".
    pub throttled: bool,
}

/// The newest published release, with the facts needed to decide what to do
/// about it. Deliberately *facts* and not a verdict: whether to show a popup
/// also depends on whether the user asked, which is a UI concern.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AvailableRelease {
    /// Normalised, without the `v` prefix: "0.8.0".
    pub version: String,
    /// The release title GitHub shows, when it isn't just the tag again.
    pub name: Option<String>,
    /// Markdown, truncated. Rendered as plain text - see the update dialog.
    pub notes: Option<String>,
    /// Built from the tag, never taken from the API response.
    pub url: String,
    pub published_at: Option<String>,
    pub is_newer: bool,
    pub is_skipped: bool,
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
    fn broker_scheme_roundtrips_through_str() {
        for scheme in [
            BrokerScheme::Mqtt,
            BrokerScheme::Mqtts,
            BrokerScheme::Ws,
            BrokerScheme::Wss,
        ] {
            let as_str: String = scheme.into();
            assert_eq!(BrokerScheme::try_from(as_str.as_str()), Ok(scheme));
        }
    }

    #[test]
    fn broker_scheme_rejects_invalid_values() {
        assert!(BrokerScheme::try_from("tcp").is_err());
    }

    /// The scheme is the SQLite column, the IPC field *and* the first segment
    /// of the URL shown in the UI, so the exact strings are pinned here.
    #[test]
    fn broker_scheme_serializes_as_lowercase_json() {
        assert_eq!(
            serde_json::to_string(&BrokerScheme::Mqtt).unwrap(),
            "\"mqtt\""
        );
        assert_eq!(
            serde_json::to_string(&BrokerScheme::Mqtts).unwrap(),
            "\"mqtts\""
        );
        assert_eq!(serde_json::to_string(&BrokerScheme::Ws).unwrap(), "\"ws\"");
        assert_eq!(
            serde_json::to_string(&BrokerScheme::Wss).unwrap(),
            "\"wss\""
        );
    }

    #[test]
    fn only_the_tls_schemes_are_tls_and_only_the_ws_schemes_are_websockets() {
        assert!(!BrokerScheme::Mqtt.is_tls() && !BrokerScheme::Mqtt.is_websocket());
        assert!(BrokerScheme::Mqtts.is_tls() && !BrokerScheme::Mqtts.is_websocket());
        assert!(!BrokerScheme::Ws.is_tls() && BrokerScheme::Ws.is_websocket());
        assert!(BrokerScheme::Wss.is_tls() && BrokerScheme::Wss.is_websocket());
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

    /// The generator JSON is both the SQLite column *and* the IPC shape the
    /// TypeScript union mirrors, so the exact wire text is pinned here - a
    /// rename that only happens on one side is otherwise silent.
    #[test]
    fn variable_generator_serializes_with_a_camel_case_kind_tag() {
        assert_eq!(
            serde_json::to_string(&VariableGenerator::Uuid).unwrap(),
            r#"{"kind":"uuid"}"#
        );
        assert_eq!(
            serde_json::to_string(&VariableGenerator::Counter { start: 1, step: 2 }).unwrap(),
            r#"{"kind":"counter","start":1,"step":2}"#
        );
        assert_eq!(
            serde_json::to_string(&VariableGenerator::RandomFloat {
                min: 18.0,
                max: 24.0,
                decimals: 1
            })
            .unwrap(),
            r#"{"kind":"randomFloat","min":18.0,"max":24.0,"decimals":1}"#
        );
        assert_eq!(
            serde_json::to_string(&VariableGenerator::Timestamp {
                format: TimestampFormat::UnixMillis
            })
            .unwrap(),
            r#"{"kind":"timestamp","format":"unixMillis"}"#
        );
    }

    #[test]
    fn variable_generator_roundtrips_through_json() {
        let generators = [
            VariableGenerator::FixedText {
                value: "dev-42".to_string(),
            },
            VariableGenerator::Counter { start: 1, step: 1 },
            VariableGenerator::RandomInt { min: 0, max: 100 },
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

        for generator in generators {
            let json = serde_json::to_string(&generator).unwrap();
            let parsed: VariableGenerator = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed, generator);
        }
    }

    #[test]
    fn variable_generator_rejects_an_unknown_kind() {
        let result = serde_json::from_str::<VariableGenerator>(r#"{"kind":"script"}"#);
        assert!(result.is_err());
    }
}
