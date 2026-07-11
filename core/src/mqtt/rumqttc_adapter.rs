use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use rumqttc::{AsyncClient, Event, EventLoop, MqttOptions, Packet, Transport};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::models::{BrokerConnection, QoS};
use crate::mqtt::port::{MqttError, MqttEvent, MqttPort};

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

enum Command {
    Publish {
        topic: String,
        payload: Vec<u8>,
        qos: rumqttc::QoS,
        retain: bool,
    },
    Subscribe {
        topic: String,
        qos: rumqttc::QoS,
    },
    Unsubscribe {
        topic: String,
    },
    Disconnect,
}

/// Drives real MQTT connections with `rumqttc`. Each connected broker gets
/// its own background task, spawned on an owned tokio runtime, that owns
/// the actual network connection and event loop; this struct only keeps a
/// channel to talk to that task. That's what lets every `MqttPort` method
/// below stay a plain, non-async function.
pub struct RumqttcAdapter {
    runtime: tokio::runtime::Runtime,
    events_tx: mpsc::UnboundedSender<MqttEvent>,
    connections: Mutex<HashMap<Uuid, mpsc::UnboundedSender<Command>>>,
}

impl RumqttcAdapter {
    pub fn new(events_tx: mpsc::UnboundedSender<MqttEvent>) -> Self {
        Self {
            runtime: tokio::runtime::Runtime::new().expect("failed to start tokio runtime"),
            events_tx,
            connections: Mutex::new(HashMap::new()),
        }
    }

    fn send_command(&self, connection_id: Uuid, command: Command) -> Result<(), MqttError> {
        let connections = self.connections.lock().unwrap();
        let command_tx = connections
            .get(&connection_id)
            .ok_or(MqttError::UnknownConnection(connection_id))?;
        command_tx
            .send(command)
            .map_err(|_| MqttError::Other("connection task has already stopped".to_string()))
    }
}

impl MqttPort for RumqttcAdapter {
    fn connect(&self, connection_id: Uuid, broker: &BrokerConnection) -> Result<(), MqttError> {
        let mut options =
            MqttOptions::new(broker.client_id.clone(), broker.host.clone(), broker.port);
        options.set_keep_alive(Duration::from_secs(broker.keep_alive_secs as u64));
        if let (Some(username), Some(password)) = (&broker.username, &broker.password) {
            options.set_credentials(username.clone(), password.clone());
        }
        if broker.use_tls {
            options.set_transport(Transport::tls_with_default_config());
        }

        let (client, eventloop) = AsyncClient::new(options, 64);
        let (command_tx, command_rx) = mpsc::unbounded_channel();

        self.runtime.spawn(run_connection(
            connection_id,
            client,
            eventloop,
            command_rx,
            self.events_tx.clone(),
        ));

        self.connections
            .lock()
            .unwrap()
            .insert(connection_id, command_tx);
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
        self.send_command(
            connection_id,
            Command::Publish {
                topic: topic.to_string(),
                payload,
                qos: qos.into(),
                retain,
            },
        )
    }

    fn subscribe(&self, connection_id: Uuid, topic: &str, qos: QoS) -> Result<(), MqttError> {
        self.send_command(
            connection_id,
            Command::Subscribe {
                topic: topic.to_string(),
                qos: qos.into(),
            },
        )
    }

    fn unsubscribe(&self, connection_id: Uuid, topic: &str) -> Result<(), MqttError> {
        self.send_command(
            connection_id,
            Command::Unsubscribe {
                topic: topic.to_string(),
            },
        )
    }

    fn disconnect(&self, connection_id: Uuid) -> Result<(), MqttError> {
        self.send_command(connection_id, Command::Disconnect)?;
        self.connections.lock().unwrap().remove(&connection_id);
        Ok(())
    }
}

async fn run_connection(
    connection_id: Uuid,
    client: AsyncClient,
    mut eventloop: EventLoop,
    mut command_rx: mpsc::UnboundedReceiver<Command>,
    events_tx: mpsc::UnboundedSender<MqttEvent>,
) {
    loop {
        tokio::select! {
            event = eventloop.poll() => {
                match event {
                    Ok(Event::Incoming(Packet::ConnAck(_))) => {
                        let _ = events_tx.send(MqttEvent::Connected { connection_id });
                    }
                    Ok(Event::Incoming(Packet::Publish(publish))) => {
                        let _ = events_tx.send(MqttEvent::MessageReceived {
                            connection_id,
                            topic: publish.topic,
                            payload: publish.payload.to_vec(),
                            qos: publish.qos.into(),
                            retain: publish.retain,
                        });
                    }
                    Ok(_) => {}
                    Err(_) => {
                        let _ = events_tx.send(MqttEvent::Disconnected { connection_id });
                        return;
                    }
                }
            }
            command = command_rx.recv() => {
                match command {
                    Some(Command::Publish { topic, payload, qos, retain }) => {
                        let _ = client.publish(topic, qos, retain, payload).await;
                    }
                    Some(Command::Subscribe { topic, qos }) => {
                        let _ = client.subscribe(topic, qos).await;
                    }
                    Some(Command::Unsubscribe { topic }) => {
                        let _ = client.unsubscribe(topic).await;
                    }
                    Some(Command::Disconnect) | None => {
                        let _ = client.disconnect().await;
                        let _ = events_tx.send(MqttEvent::Disconnected { connection_id });
                        return;
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::time::timeout;

    fn sample_broker(host: &str, port: u16) -> BrokerConnection {
        BrokerConnection {
            id: Uuid::new_v4(),
            name: "Integration test broker".to_string(),
            host: host.to_string(),
            port,
            client_id: format!("bme-test-{}", Uuid::new_v4()),
            username: None,
            password: None,
            use_tls: false,
            keep_alive_secs: 5,
            subscriptions: vec![],
        }
    }

    async fn wait_for(
        rx: &mut mpsc::UnboundedReceiver<MqttEvent>,
        matches: impl Fn(&MqttEvent) -> bool,
    ) -> MqttEvent {
        timeout(Duration::from_secs(10), async {
            loop {
                let event = rx.recv().await.expect("event channel closed");
                if matches(&event) {
                    return event;
                }
            }
        })
        .await
        .expect("timed out waiting for expected MQTT event")
    }

    /// Requires network access to a real broker. Defaults to the public
    /// test.mosquitto.org sandbox; point `sample_broker` at "localhost" for
    /// a local Mosquitto instead (e.g. `docker run -p 1883:1883 eclipse-mosquitto`).
    /// Run explicitly with: cargo test -p bme-core -- --ignored rumqttc
    #[test]
    #[ignore]
    fn connects_publishes_and_receives_from_a_real_broker() {
        let (events_tx, mut events_rx) = mpsc::unbounded_channel();
        let adapter = RumqttcAdapter::new(events_tx);
        let broker = sample_broker("test.mosquitto.org", 1883);
        let topic = format!("bme/tests/{}", broker.id);

        adapter.connect(broker.id, &broker).unwrap();

        adapter.runtime.block_on(async {
            wait_for(&mut events_rx, |event| {
                matches!(event, MqttEvent::Connected { .. })
            })
            .await;
        });

        adapter
            .subscribe(broker.id, &topic, QoS::AtLeastOnce)
            .unwrap();
        adapter
            .publish(
                broker.id,
                &topic,
                b"hello from bme".to_vec(),
                QoS::AtLeastOnce,
                false,
            )
            .unwrap();

        adapter.runtime.block_on(async {
            let received = wait_for(
                &mut events_rx,
                |event| matches!(event, MqttEvent::MessageReceived { topic: t, .. } if t == &topic),
            )
            .await;
            match received {
                MqttEvent::MessageReceived { payload, .. } => {
                    assert_eq!(payload, b"hello from bme");
                }
                _ => unreachable!(),
            }
        });

        adapter.disconnect(broker.id).unwrap();
    }
}
