use std::collections::HashSet;
use std::sync::Mutex;

use uuid::Uuid;

use crate::models::{BrokerConnection, QoS};
use crate::mqtt::port::{MqttError, MqttPort};

/// Tracks which connections are live on top of a raw `MqttPort`, so callers
/// get a clear error instead of silently talking to a broker they never
/// connected to.
pub struct MqttClientManager<P: MqttPort> {
    port: P,
    connected: Mutex<HashSet<Uuid>>,
}

impl<P: MqttPort> MqttClientManager<P> {
    pub fn new(port: P) -> Self {
        Self {
            port,
            connected: Mutex::new(HashSet::new()),
        }
    }

    pub fn connect(&self, connection_id: Uuid, broker: &BrokerConnection) -> Result<(), MqttError> {
        self.port.connect(connection_id, broker)?;
        self.connected.lock().unwrap().insert(connection_id);
        Ok(())
    }

    pub fn publish(
        &self,
        connection_id: Uuid,
        topic: &str,
        payload: Vec<u8>,
        qos: QoS,
        retain: bool,
    ) -> Result<(), MqttError> {
        self.ensure_connected(connection_id)?;
        self.port
            .publish(connection_id, topic, payload, qos, retain)
    }

    pub fn subscribe(&self, connection_id: Uuid, topic: &str, qos: QoS) -> Result<(), MqttError> {
        self.ensure_connected(connection_id)?;
        self.port.subscribe(connection_id, topic, qos)
    }

    pub fn unsubscribe(&self, connection_id: Uuid, topic: &str) -> Result<(), MqttError> {
        self.ensure_connected(connection_id)?;
        self.port.unsubscribe(connection_id, topic)
    }

    pub fn disconnect(&self, connection_id: Uuid) -> Result<(), MqttError> {
        self.port.disconnect(connection_id)?;
        self.connected.lock().unwrap().remove(&connection_id);
        Ok(())
    }

    pub fn is_connected(&self, connection_id: Uuid) -> bool {
        self.connected.lock().unwrap().contains(&connection_id)
    }

    fn ensure_connected(&self, connection_id: Uuid) -> Result<(), MqttError> {
        if self.connected.lock().unwrap().contains(&connection_id) {
            Ok(())
        } else {
            Err(MqttError::UnknownConnection(connection_id))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, PartialEq)]
    enum Call {
        Connect(Uuid),
        Publish {
            connection_id: Uuid,
            topic: String,
            payload: Vec<u8>,
            qos: QoS,
            retain: bool,
        },
        Subscribe {
            connection_id: Uuid,
            topic: String,
            qos: QoS,
        },
        Unsubscribe {
            connection_id: Uuid,
            topic: String,
        },
        Disconnect(Uuid),
    }

    #[derive(Default)]
    struct FakeMqttPort {
        calls: Mutex<Vec<Call>>,
    }

    impl FakeMqttPort {
        fn calls(&self) -> Vec<Call> {
            self.calls.lock().unwrap().drain(..).collect()
        }
    }

    impl MqttPort for FakeMqttPort {
        fn connect(
            &self,
            connection_id: Uuid,
            _broker: &BrokerConnection,
        ) -> Result<(), MqttError> {
            self.calls
                .lock()
                .unwrap()
                .push(Call::Connect(connection_id));
            Ok(())
        }

        fn publish(
            &self,
            connection_id: Uuid,
            topic: &str,
            payload: Vec<u8>,
            qos: QoS,
            retain: bool,
        ) -> Result<(), MqttError> {
            self.calls.lock().unwrap().push(Call::Publish {
                connection_id,
                topic: topic.to_string(),
                payload,
                qos,
                retain,
            });
            Ok(())
        }

        fn subscribe(&self, connection_id: Uuid, topic: &str, qos: QoS) -> Result<(), MqttError> {
            self.calls.lock().unwrap().push(Call::Subscribe {
                connection_id,
                topic: topic.to_string(),
                qos,
            });
            Ok(())
        }

        fn unsubscribe(&self, connection_id: Uuid, topic: &str) -> Result<(), MqttError> {
            self.calls.lock().unwrap().push(Call::Unsubscribe {
                connection_id,
                topic: topic.to_string(),
            });
            Ok(())
        }

        fn disconnect(&self, connection_id: Uuid) -> Result<(), MqttError> {
            self.calls
                .lock()
                .unwrap()
                .push(Call::Disconnect(connection_id));
            Ok(())
        }
    }

    fn sample_broker() -> BrokerConnection {
        BrokerConnection {
            id: Uuid::new_v4(),
            name: "Local".to_string(),
            host: "localhost".to_string(),
            port: 1883,
            client_id: "bme".to_string(),
            username: None,
            password: None,
            use_tls: false,
            keep_alive_secs: 30,
            auto_reconnect: true,
            max_reconnect_attempts: 10,
            subscriptions: vec![],
        }
    }

    #[test]
    fn connect_marks_the_connection_as_connected_and_delegates_to_the_port() {
        let manager = MqttClientManager::new(FakeMqttPort::default());
        let broker = sample_broker();

        manager.connect(broker.id, &broker).unwrap();

        assert!(manager.is_connected(broker.id));
        assert_eq!(manager.port.calls(), vec![Call::Connect(broker.id)]);
    }

    #[test]
    fn publish_before_connect_is_rejected() {
        let manager = MqttClientManager::new(FakeMqttPort::default());
        let unknown_id = Uuid::new_v4();

        let result = manager.publish(unknown_id, "topic", vec![1], QoS::AtMostOnce, false);

        assert_eq!(result, Err(MqttError::UnknownConnection(unknown_id)));
        assert!(manager.port.calls().is_empty());
    }

    #[test]
    fn publish_after_connect_delegates_to_the_port() {
        let manager = MqttClientManager::new(FakeMqttPort::default());
        let broker = sample_broker();
        manager.connect(broker.id, &broker).unwrap();
        manager.port.calls(); // drain the Connect call

        manager
            .publish(
                broker.id,
                "sensors/temp",
                vec![1, 2, 3],
                QoS::AtLeastOnce,
                true,
            )
            .unwrap();

        assert_eq!(
            manager.port.calls(),
            vec![Call::Publish {
                connection_id: broker.id,
                topic: "sensors/temp".to_string(),
                payload: vec![1, 2, 3],
                qos: QoS::AtLeastOnce,
                retain: true,
            }]
        );
    }

    #[test]
    fn subscribe_after_connect_delegates_to_the_port() {
        let manager = MqttClientManager::new(FakeMqttPort::default());
        let broker = sample_broker();
        manager.connect(broker.id, &broker).unwrap();
        manager.port.calls();

        manager
            .subscribe(broker.id, "sensors/#", QoS::ExactlyOnce)
            .unwrap();

        assert_eq!(
            manager.port.calls(),
            vec![Call::Subscribe {
                connection_id: broker.id,
                topic: "sensors/#".to_string(),
                qos: QoS::ExactlyOnce,
            }]
        );
    }

    #[test]
    fn unsubscribe_before_connect_is_rejected() {
        let manager = MqttClientManager::new(FakeMqttPort::default());
        let unknown_id = Uuid::new_v4();

        let result = manager.unsubscribe(unknown_id, "sensors/#");

        assert_eq!(result, Err(MqttError::UnknownConnection(unknown_id)));
        assert!(manager.port.calls().is_empty());
    }

    #[test]
    fn unsubscribe_after_connect_delegates_to_the_port() {
        let manager = MqttClientManager::new(FakeMqttPort::default());
        let broker = sample_broker();
        manager.connect(broker.id, &broker).unwrap();
        manager.port.calls();

        manager.unsubscribe(broker.id, "sensors/#").unwrap();

        assert_eq!(
            manager.port.calls(),
            vec![Call::Unsubscribe {
                connection_id: broker.id,
                topic: "sensors/#".to_string(),
            }]
        );
    }

    #[test]
    fn disconnect_forgets_the_connection_and_rejects_further_publishes() {
        let manager = MqttClientManager::new(FakeMqttPort::default());
        let broker = sample_broker();
        manager.connect(broker.id, &broker).unwrap();

        manager.disconnect(broker.id).unwrap();

        assert!(!manager.is_connected(broker.id));
        let result = manager.publish(broker.id, "t", vec![], QoS::AtMostOnce, false);
        assert_eq!(result, Err(MqttError::UnknownConnection(broker.id)));
    }
}
