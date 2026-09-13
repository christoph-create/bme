//! One reconnect loop, two rumqttc APIs.
//!
//! rumqttc implements MQTT 5 as a parallel module (`rumqttc::v5`) with its own
//! client, event loop, options, packet types, `QoS` and error enums; only the
//! transport layer is shared. Everything the connection task cares about -
//! "we got a ConnAck", "a message arrived", "the poll failed and here is why" -
//! is the same in both dialects, so this enum absorbs the difference and
//! `rumqttc_adapter::run_connection` never sees a version-specific type.

use std::fmt;
use std::time::Duration;

use bytes::Bytes;
use rumqttc::v5::mqttbytes::v5 as v5_packets;
use rumqttc::{v5, Transport};

use crate::models::{BrokerConnection, MqttVersion, QoS};
use crate::mqtt::failure::{connect_failure_reason, connect_failure_reason_v5};
use crate::mqtt::oversize::{oversize_reason, oversize_reason_v5, MAX_PACKET_BYTES};
use crate::mqtt::port::MqttError;
use crate::mqtt::transport::broker_addr;

impl From<QoS> for rumqttc::QoS {
    fn from(qos: QoS) -> Self {
        match qos {
            QoS::AtMostOnce => rumqttc::QoS::AtMostOnce,
            QoS::AtLeastOnce => rumqttc::QoS::AtLeastOnce,
            QoS::ExactlyOnce => rumqttc::QoS::ExactlyOnce,
        }
    }
}

impl From<rumqttc::QoS> for QoS {
    fn from(qos: rumqttc::QoS) -> Self {
        match qos {
            rumqttc::QoS::AtMostOnce => QoS::AtMostOnce,
            rumqttc::QoS::AtLeastOnce => QoS::AtLeastOnce,
            rumqttc::QoS::ExactlyOnce => QoS::ExactlyOnce,
        }
    }
}

impl From<QoS> for v5::mqttbytes::QoS {
    fn from(qos: QoS) -> Self {
        match qos {
            QoS::AtMostOnce => v5::mqttbytes::QoS::AtMostOnce,
            QoS::AtLeastOnce => v5::mqttbytes::QoS::AtLeastOnce,
            QoS::ExactlyOnce => v5::mqttbytes::QoS::ExactlyOnce,
        }
    }
}

impl From<v5::mqttbytes::QoS> for QoS {
    fn from(qos: v5::mqttbytes::QoS) -> Self {
        match qos {
            v5::mqttbytes::QoS::AtMostOnce => QoS::AtMostOnce,
            v5::mqttbytes::QoS::AtLeastOnce => QoS::AtLeastOnce,
            v5::mqttbytes::QoS::ExactlyOnce => QoS::ExactlyOnce,
        }
    }
}

/// rumqttc's v5 options panic below this, where v4 accepts anything from
/// zero up. Checked before the options are built so it comes back as a
/// `Config` error from `connect` rather than taking the runtime down.
const MIN_V5_KEEP_ALIVE_SECS: u16 = 5;

/// How many requests the client can queue before `publish`/`subscribe` wait
/// for the event loop to drain some.
const REQUEST_CHANNEL_CAPACITY: usize = 64;

/// A live rumqttc client and its event loop, in whichever dialect the
/// connection asked for. The loops are boxed because the v5 one is several
/// times the size of the v4 one and there is exactly one `Session` per
/// connection task, so the indirection costs nothing that matters.
pub(crate) enum Session {
    V311 {
        client: rumqttc::AsyncClient,
        eventloop: Box<rumqttc::EventLoop>,
    },
    V5 {
        client: v5::AsyncClient,
        eventloop: Box<v5::EventLoop>,
    },
}

/// What a poll produced, reduced to the three things the loop reacts to.
pub(crate) enum SessionEvent {
    ConnAck,
    Publish(ReceivedPublish),
    /// Acks, pings, outgoing echoes - the loop ignores them all.
    Other,
}

pub(crate) struct ReceivedPublish {
    pub topic: String,
    pub payload: Bytes,
    pub qos: QoS,
    pub retain: bool,
}

/// A failed poll, already classified so the loop chooses a track, not a
/// match arm over two error enums.
#[derive(Debug)]
pub(crate) enum PollError {
    /// The packet's fault rather than the network's, with the banner text -
    /// see `crate::mqtt::oversize`.
    Oversize(String),
    /// Everything else. `reason` is the user-facing explanation when there is
    /// one (see `crate::mqtt::failure`); `display` is rumqttc's own message,
    /// for the log.
    Failed {
        reason: Option<String>,
        display: String,
    },
}

impl fmt::Display for PollError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PollError::Oversize(reason) => f.write_str(reason),
            PollError::Failed { display, .. } => f.write_str(display),
        }
    }
}

impl Session {
    /// Builds the client for `broker` over an already-prepared `transport`.
    /// Nothing is connected yet; that happens on the first `poll`.
    pub(crate) fn open(broker: &BrokerConnection, transport: Transport) -> Result<Self, MqttError> {
        match broker.protocol_version {
            MqttVersion::V311 => {
                let mut options = rumqttc::MqttOptions::new(
                    broker.client_id.clone(),
                    broker_addr(broker),
                    broker.port,
                );
                options.set_keep_alive(Duration::from_secs(broker.keep_alive_secs as u64));
                options.set_max_packet_size(MAX_PACKET_BYTES, MAX_PACKET_BYTES);
                // Stated rather than inherited from rumqttc's default: the
                // whole resubscribe-after-ConnAck design in `run_connection`
                // only makes sense because the broker has forgotten the
                // session, so the assumption belongs in the code that depends
                // on it.
                options.set_clean_session(true);
                if let (Some(username), Some(password)) = (&broker.username, &broker.password) {
                    options.set_credentials(username.clone(), password.clone());
                }
                options.set_transport(transport);

                let (client, eventloop) =
                    rumqttc::AsyncClient::new(options, REQUEST_CHANNEL_CAPACITY);
                Ok(Session::V311 {
                    client,
                    eventloop: Box::new(eventloop),
                })
            }
            MqttVersion::V5 => {
                if broker.keep_alive_secs < MIN_V5_KEEP_ALIVE_SECS {
                    return Err(MqttError::Config(format!(
                        "MQTT 5 connections need a keep-alive of at least {MIN_V5_KEEP_ALIVE_SECS} seconds."
                    )));
                }

                let mut options = v5::MqttOptions::new(
                    broker.client_id.clone(),
                    broker_addr(broker),
                    broker.port,
                );
                options.set_keep_alive(Duration::from_secs(broker.keep_alive_secs as u64));
                // In v5 this is the Maximum Packet Size CONNECT property: it
                // caps what rumqttc will read, as in v4, and also tells the
                // broker our limit so it can refuse to send rather than have us
                // drop the socket on it.
                options.set_max_packet_size(Some(MAX_PACKET_BYTES as u32));
                // Clean start with no session expiry is v5's spelling of a
                // clean session, so the resubscribe-after-ConnAck design holds
                // unchanged here.
                options.set_clean_start(true);
                if let (Some(username), Some(password)) = (&broker.username, &broker.password) {
                    options.set_credentials(username.clone(), password.clone());
                }
                options.set_transport(transport);

                let (client, eventloop) = v5::AsyncClient::new(options, REQUEST_CHANNEL_CAPACITY);
                Ok(Session::V5 {
                    client,
                    eventloop: Box::new(eventloop),
                })
            }
        }
    }

    pub(crate) fn version(&self) -> MqttVersion {
        match self {
            Session::V311 { .. } => MqttVersion::V311,
            Session::V5 { .. } => MqttVersion::V5,
        }
    }

    pub(crate) async fn poll(&mut self) -> Result<SessionEvent, PollError> {
        match self {
            Session::V311 { eventloop, .. } => match eventloop.poll().await {
                Ok(rumqttc::Event::Incoming(rumqttc::Packet::ConnAck(_))) => {
                    Ok(SessionEvent::ConnAck)
                }
                Ok(rumqttc::Event::Incoming(rumqttc::Packet::Publish(publish))) => {
                    Ok(SessionEvent::Publish(ReceivedPublish {
                        topic: publish.topic,
                        payload: publish.payload,
                        qos: publish.qos.into(),
                        retain: publish.retain,
                    }))
                }
                Ok(_) => Ok(SessionEvent::Other),
                Err(err) => Err(match oversize_reason(&err) {
                    Some(reason) => PollError::Oversize(reason),
                    None => PollError::Failed {
                        reason: connect_failure_reason(&err),
                        display: format!("{err} ({err:?})"),
                    },
                }),
            },
            Session::V5 { eventloop, .. } => match eventloop.poll().await {
                Ok(v5::Event::Incoming(v5_packets::Packet::ConnAck(_))) => {
                    Ok(SessionEvent::ConnAck)
                }
                Ok(v5::Event::Incoming(v5_packets::Packet::Publish(publish))) => {
                    Ok(SessionEvent::Publish(ReceivedPublish {
                        // v5 keeps the topic as bytes; the spec requires UTF-8,
                        // so anything else is a broker bug worth surviving
                        // rather than dropping the message over.
                        topic: String::from_utf8_lossy(&publish.topic).into_owned(),
                        payload: publish.payload,
                        qos: publish.qos.into(),
                        retain: publish.retain,
                    }))
                }
                Ok(_) => Ok(SessionEvent::Other),
                Err(err) => Err(match oversize_reason_v5(&err) {
                    Some(reason) => PollError::Oversize(reason),
                    None => PollError::Failed {
                        reason: connect_failure_reason_v5(&err),
                        display: format!("{err} ({err:?})"),
                    },
                }),
            },
        }
    }

    /// Errors are dropped on purpose, as they were before this enum existed:
    /// the only failure is a closed request channel, which means the event
    /// loop is gone and the next `poll` will say so.
    ///
    /// `&mut self` on these client calls is not for mutation: rumqttc's event
    /// loops are `Send` but not `Sync`, so a `&Session` held across an await
    /// would make the connection task unspawnable, while `&mut Session` only
    /// needs `Send`.
    pub(crate) async fn publish(&mut self, topic: String, payload: Bytes, qos: QoS, retain: bool) {
        match self {
            Session::V311 { client, .. } => {
                let _ = client
                    .publish_bytes(topic, qos.into(), retain, payload)
                    .await;
            }
            Session::V5 { client, .. } => {
                let _ = client.publish(topic, qos.into(), retain, payload).await;
            }
        }
    }

    pub(crate) async fn subscribe(&mut self, topic: &str, qos: QoS) {
        match self {
            Session::V311 { client, .. } => {
                let _ = client.subscribe(topic, qos.into()).await;
            }
            Session::V5 { client, .. } => {
                let _ = client.subscribe(topic, qos.into()).await;
            }
        }
    }

    pub(crate) async fn unsubscribe(&mut self, topic: &str) {
        match self {
            Session::V311 { client, .. } => {
                let _ = client.unsubscribe(topic).await;
            }
            Session::V5 { client, .. } => {
                let _ = client.unsubscribe(topic).await;
            }
        }
    }

    pub(crate) async fn disconnect(&mut self) {
        match self {
            Session::V311 { client, .. } => {
                let _ = client.disconnect().await;
            }
            Session::V5 { client, .. } => {
                let _ = client.disconnect().await;
            }
        }
    }
}

/// How large the PUBLISH packet carrying `payload` to `topic` will be once
/// rumqttc frames it, in the given dialect.
///
/// Measured by building the packet rumqttc would build - the v5 one carries a
/// properties block a hand-rolled formula would have to track - with the
/// packet id filled in for every QoS above 0. rumqttc checks the size before
/// assigning the id and so under-counts by two bytes there; erring the other
/// way keeps the guard from ever waving through a packet the event loop would
/// then reject, which would cost the whole session rather than just the one
/// message. `Bytes` is refcounted, so nothing is copied to measure.
pub(crate) fn publish_packet_bytes(
    version: MqttVersion,
    topic: &str,
    payload: &Bytes,
    qos: QoS,
) -> usize {
    let pkid = if qos == QoS::AtMostOnce { 0 } else { 1 };
    match version {
        MqttVersion::V311 => {
            let mut packet = rumqttc::Publish::from_bytes(topic, qos.into(), payload.clone());
            packet.pkid = pkid;
            packet.size()
        }
        MqttVersion::V5 => {
            let mut packet = v5_packets::Publish::new(topic, qos.into(), payload.clone(), None);
            packet.pkid = pkid;
            packet.size()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::BrokerScheme;
    use uuid::Uuid;

    fn broker(version: MqttVersion, keep_alive_secs: u16) -> BrokerConnection {
        BrokerConnection {
            id: Uuid::new_v4(),
            name: "Test".to_string(),
            host: "localhost".to_string(),
            port: 1883,
            client_id: "bme-test".to_string(),
            username: None,
            password: None,
            scheme: BrokerScheme::Mqtt,
            protocol_version: version,
            ws_path: None,
            ca_cert_path: None,
            client_cert_path: None,
            client_key_path: None,
            alpn: None,
            skip_cert_verification: false,
            keep_alive_secs,
            auto_reconnect: false,
            max_reconnect_attempts: 0,
            subscriptions: vec![],
        }
    }

    #[test]
    fn opens_the_driver_the_connection_asked_for() {
        let v311 = Session::open(&broker(MqttVersion::V311, 60), Transport::Tcp).unwrap();
        let v5 = Session::open(&broker(MqttVersion::V5, 60), Transport::Tcp).unwrap();

        assert_eq!(v311.version(), MqttVersion::V311);
        assert_eq!(v5.version(), MqttVersion::V5);
    }

    /// rumqttc's v5 options assert on a short keep-alive; that has to come
    /// back as an error the form can show, not a panic in the runtime.
    #[test]
    fn a_short_keep_alive_is_a_config_error_on_v5_and_fine_on_v311() {
        assert!(Session::open(&broker(MqttVersion::V311, 1), Transport::Tcp).is_ok());

        let result = Session::open(&broker(MqttVersion::V5, 1), Transport::Tcp).map(|_| ());

        assert!(
            matches!(&result, Err(MqttError::Config(message)) if message.contains("keep-alive")),
            "{result:?}"
        );
    }

    #[test]
    fn a_v311_publish_packet_is_the_header_plus_the_topic_plus_the_payload() {
        let payload = Bytes::from_static(b"abc");
        // 1 fixed header + 1 length byte + 2 topic-length + 4 topic + 3 payload.
        assert_eq!(
            publish_packet_bytes(MqttVersion::V311, "temp", &payload, QoS::AtMostOnce),
            11
        );
        // Above QoS 0 the packet id is counted, unlike in rumqttc's own check.
        assert_eq!(
            publish_packet_bytes(MqttVersion::V311, "temp", &payload, QoS::AtLeastOnce),
            13
        );
        // The remaining length is a varint, so it grows a byte of its own.
        let long = Bytes::from(vec![0u8; 200]);
        assert_eq!(
            publish_packet_bytes(MqttVersion::V311, "t", &long, QoS::AtMostOnce),
            206
        );
    }

    /// v5 frames a properties length even when there are no properties, so
    /// the same message is one byte longer than its v3.1.1 twin.
    #[test]
    fn a_v5_publish_packet_carries_a_properties_length_byte() {
        let payload = Bytes::from_static(b"abc");

        assert_eq!(
            publish_packet_bytes(MqttVersion::V5, "temp", &payload, QoS::AtMostOnce),
            12
        );
        assert_eq!(
            publish_packet_bytes(MqttVersion::V5, "temp", &payload, QoS::AtLeastOnce),
            14
        );
    }
}
