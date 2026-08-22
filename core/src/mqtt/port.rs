use serde::Serialize;
use uuid::Uuid;

use crate::models::{BrokerConnection, QoS};

/// How much of a received payload is handed to the UI.
///
/// Payloads cross the IPC boundary as a JSON array of numbers - roughly three
/// and a half characters per byte - so a 16 MiB message would be a ~56 MB string
/// to serialize, ship and parse on the UI thread, and the message store keeps
/// hundreds of them per topic. This is far more than anything the stream panel
/// displays, and the true size travels alongside so nothing has to lie about it.
pub const MAX_IPC_PAYLOAD_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum MqttError {
    #[error("Not connected to the broker")]
    UnknownConnection(Uuid),
    #[error("Message too large to publish: {bytes} bytes is over the {max} byte packet limit")]
    PayloadTooLarge { bytes: usize, max: usize },
    /// A connection that cannot be set up at all, as opposed to one that
    /// fails on the wire: an unreadable certificate file, a client cert
    /// without its key. Known before a packet is sent, so it comes back from
    /// `connect` rather than arriving later as a `Disconnected` event.
    #[error("{0}")]
    Config(String),
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
        /// Why, when the connection knows something more useful than "the
        /// session ended" - currently only an oversize packet on a broker with
        /// auto-reconnect switched off. Skipped rather than serialized as null
        /// so the TypeScript mirror can declare it optional.
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    /// The session dropped but the connection is retrying rather than giving
    /// up. `attempt` is 1-based and `delay_ms` is how long the wait before
    /// this attempt will be, so the UI can show real progress instead of an
    /// indefinite spinner. A `Connected` (recovered) or `Disconnected` (budget
    /// spent) always follows.
    Reconnecting {
        connection_id: Uuid,
        attempt: u32,
        max_attempts: u32,
        delay_ms: u64,
    },
    /// Something worth telling the user about that the session survived, so
    /// the connection's status must not change on it - see
    /// `crate::mqtt::oversize`.
    Warning {
        connection_id: Uuid,
        message: String,
    },
    MessageReceived {
        connection_id: Uuid,
        topic: String,
        /// Capped at `MAX_IPC_PAYLOAD_BYTES`, so this may be shorter than
        /// `payload_len`. Build the variant with `MqttEvent::message_received`
        /// rather than by hand, which keeps the two consistent.
        payload: Vec<u8>,
        /// The payload's real length on the wire, whatever made it across.
        payload_len: usize,
        qos: QoS,
        retain: bool,
    },
}

impl MqttEvent {
    /// Truncating here rather than at the call site means no future caller can
    /// forget to, and `payload_len` still reports what actually arrived - the UI
    /// needs the real size for its "3.4 MB" labels, and a zero-length retained
    /// publish (MQTT's way of clearing a topic) stays recognisable.
    pub fn message_received(
        connection_id: Uuid,
        topic: String,
        payload: &[u8],
        qos: QoS,
        retain: bool,
    ) -> Self {
        Self::MessageReceived {
            connection_id,
            topic,
            payload: payload[..payload.len().min(MAX_IPC_PAYLOAD_BYTES)].to_vec(),
            payload_len: payload.len(),
            qos,
            retain,
        }
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn received(payload: &[u8], retain: bool) -> MqttEvent {
        MqttEvent::message_received(
            Uuid::new_v4(),
            "sensors/temp".to_string(),
            payload,
            QoS::AtMostOnce,
            retain,
        )
    }

    #[test]
    fn a_payload_within_the_cap_crosses_whole() {
        let MqttEvent::MessageReceived {
            payload,
            payload_len,
            ..
        } = received(b"23.5", false)
        else {
            unreachable!()
        };

        assert_eq!(payload, b"23.5");
        assert_eq!(payload_len, 4);
    }

    #[test]
    fn a_payload_over_the_cap_is_truncated_but_still_reports_its_real_size() {
        let big = vec![7u8; MAX_IPC_PAYLOAD_BYTES + 1];

        let MqttEvent::MessageReceived {
            payload,
            payload_len,
            ..
        } = received(&big, false)
        else {
            unreachable!()
        };

        assert_eq!(payload.len(), MAX_IPC_PAYLOAD_BYTES);
        assert_eq!(payload_len, MAX_IPC_PAYLOAD_BYTES + 1);
    }

    /// A zero-length retained publish is how MQTT clears a topic, and the UI
    /// reads that off `payload_len` - so it has to survive the cap untouched.
    #[test]
    fn an_empty_retained_payload_reports_zero_length() {
        let MqttEvent::MessageReceived {
            payload,
            payload_len,
            ..
        } = received(b"", true)
        else {
            unreachable!()
        };

        assert!(payload.is_empty());
        assert_eq!(payload_len, 0);
    }
}
