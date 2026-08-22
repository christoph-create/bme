//! Turns a saved connection's scheme into the transport rumqttc needs.

use rumqttc::{TlsConfiguration, Transport};

use crate::models::{BrokerConnection, BrokerScheme};
use crate::mqtt::tls::{self, TlsConfigError};

/// Where brokers serve MQTT-over-WebSocket when nobody says otherwise.
/// Mosquitto, EMQX, HiveMQ and AWS IoT all use it.
const DEFAULT_WS_PATH: &str = "/mqtt";

/// What belongs in `MqttOptions`' host slot.
///
/// WebSockets are the odd one out. rumqttc takes the host *and* the port
/// straight out of `broker_addr` when the transport is `Ws`/`Wss`
/// (`eventloop.rs`, `split_url`), ignoring the port argument entirely, and the
/// same string becomes the HTTP request URI - so the whole URL, path included,
/// has to go here. For TCP it is the bare host, exactly as before.
pub fn broker_addr(broker: &BrokerConnection) -> String {
    if !broker.scheme.is_websocket() {
        return broker.host.clone();
    }

    format!(
        "{}://{}:{}{}",
        broker.scheme.as_str(),
        broker.host,
        broker.port,
        ws_path(broker.ws_path.as_deref()),
    )
}

/// Normalises the stored path: unset or blank means the conventional default,
/// and a path typed without its leading slash still works rather than
/// producing a URL that silently addresses the wrong endpoint.
fn ws_path(path: Option<&str>) -> String {
    let path = path.unwrap_or_default().trim();
    if path.is_empty() || path == "/" {
        return DEFAULT_WS_PATH.to_string();
    }
    if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    }
}

/// The rumqttc transport for `broker`, building its TLS configuration along the
/// way. This is the first thing in a connect attempt that can fail on its own -
/// an unreadable certificate file is knowable before a single packet is sent -
/// which is what lets the UI report it immediately instead of as a mystery
/// disconnect six seconds later.
pub fn transport_for(broker: &BrokerConnection) -> Result<Transport, TlsConfigError> {
    Ok(match broker.scheme {
        BrokerScheme::Mqtt => Transport::Tcp,
        BrokerScheme::Ws => Transport::Ws,
        BrokerScheme::Mqtts => {
            Transport::Tls(TlsConfiguration::Rustls(tls::client_config(broker)?))
        }
        BrokerScheme::Wss => Transport::Wss(TlsConfiguration::Rustls(tls::client_config(broker)?)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn broker(scheme: BrokerScheme, host: &str, port: u16) -> BrokerConnection {
        BrokerConnection {
            id: Uuid::new_v4(),
            name: "Test".to_string(),
            host: host.to_string(),
            port,
            client_id: "bme-test".to_string(),
            username: None,
            password: None,
            scheme,
            ws_path: None,
            ca_cert_path: None,
            client_cert_path: None,
            client_key_path: None,
            alpn: None,
            skip_cert_verification: false,
            keep_alive_secs: 60,
            auto_reconnect: false,
            max_reconnect_attempts: 0,
            subscriptions: Vec::new(),
        }
    }

    #[test]
    fn tcp_schemes_pass_the_host_through_untouched() {
        assert_eq!(
            broker_addr(&broker(BrokerScheme::Mqtt, "localhost", 1883)),
            "localhost"
        );
        assert_eq!(
            broker_addr(&broker(BrokerScheme::Mqtts, "mqtt.example.com", 8883)),
            "mqtt.example.com"
        );
    }

    /// The port is part of the string for WebSockets because rumqttc never
    /// looks at the port field for them.
    #[test]
    fn websocket_schemes_build_a_full_url_with_the_default_path() {
        assert_eq!(
            broker_addr(&broker(BrokerScheme::Ws, "localhost", 8083)),
            "ws://localhost:8083/mqtt"
        );
        assert_eq!(
            broker_addr(&broker(BrokerScheme::Wss, "broker.hivemq.cloud", 8884)),
            "wss://broker.hivemq.cloud:8884/mqtt"
        );
    }

    #[test]
    fn an_explicit_path_replaces_the_default() {
        let mut connection = broker(BrokerScheme::Wss, "example.com", 443);
        connection.ws_path = Some("/ws/mqtt".to_string());
        assert_eq!(broker_addr(&connection), "wss://example.com:443/ws/mqtt");
    }

    #[test]
    fn a_path_typed_without_its_leading_slash_still_works() {
        let mut connection = broker(BrokerScheme::Ws, "example.com", 80);
        connection.ws_path = Some("ws".to_string());
        assert_eq!(broker_addr(&connection), "ws://example.com:80/ws");
    }

    #[test]
    fn blank_and_bare_slash_paths_fall_back_to_the_default() {
        for path in ["", "   ", "/"] {
            let mut connection = broker(BrokerScheme::Ws, "example.com", 8083);
            connection.ws_path = Some(path.to_string());
            assert_eq!(broker_addr(&connection), "ws://example.com:8083/mqtt");
        }
    }

    /// rumqttc parses the URL with `http::Uri` and strips the brackets back
    /// off, so they have to survive into the string it is given.
    #[test]
    fn an_ipv6_host_keeps_its_brackets() {
        assert_eq!(
            broker_addr(&broker(BrokerScheme::Ws, "[::1]", 8083)),
            "ws://[::1]:8083/mqtt"
        );
    }

    #[test]
    fn plain_schemes_need_no_tls_configuration() {
        assert!(matches!(
            transport_for(&broker(BrokerScheme::Mqtt, "localhost", 1883)),
            Ok(Transport::Tcp)
        ));
        assert!(matches!(
            transport_for(&broker(BrokerScheme::Ws, "localhost", 8083)),
            Ok(Transport::Ws)
        ));
    }

    #[test]
    fn a_missing_certificate_file_fails_before_any_connection_is_attempted() {
        let mut connection = broker(BrokerScheme::Mqtts, "localhost", 8883);
        connection.ca_cert_path = Some("/nonexistent/ca.pem".to_string());

        // `Transport` has no Debug impl, so the Ok side cannot be unwrapped
        // into an assertion message.
        let Err(err) = transport_for(&connection) else {
            panic!("a missing CA file should be rejected");
        };

        assert!(
            err.to_string().contains("/nonexistent/ca.pem"),
            "the message should name the file: {err}"
        );
    }
}
