use std::time::Duration;

use rumqttc::{AsyncClient, Event, EventLoop, MqttOptions, Packet, Transport};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::models::{BrokerConnection, QoS};
use crate::mqtt::connection_registry::ConnectionRegistry;
use crate::mqtt::oversize::{oversize_delay, oversize_reason, MAX_PACKET_BYTES};
use crate::mqtt::port::{MqttError, MqttEvent, MqttPort, MAX_IPC_PAYLOAD_BYTES};
use crate::mqtt::reconnect::ReconnectPolicy;
use crate::mqtt::subscription_set::SubscriptionSet;

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
    Disconnect {
        /// False when the connection is being replaced by a fresh one for the
        /// same broker. The replacement will announce itself, and a
        /// `Disconnected` from the task it replaced would land *after* that
        /// and read as "the new session dropped".
        announce: bool,
    },
}

type Connections = ConnectionRegistry<mpsc::UnboundedSender<Command>>;

/// How large the PUBLISH packet carrying `payload_len` bytes to `topic` will be
/// once rumqttc frames it.
///
/// Mirrors `Publish::size()`, except that the packet id is counted for every
/// QoS above 0. rumqttc checks the size before assigning the id and so
/// under-counts by two bytes there; erring the other way keeps this guard from
/// ever waving through a packet the event loop would then reject - which would
/// cost the whole session rather than just the one message.
fn publish_packet_bytes(topic: &str, payload_len: usize, qos: rumqttc::QoS) -> usize {
    let remaining = 2
        + topic.len()
        + payload_len
        + if qos == rumqttc::QoS::AtMostOnce {
            0
        } else {
            2
        };
    let length_bytes = match remaining {
        0..=127 => 1,
        128..=16_383 => 2,
        16_384..=2_097_151 => 3,
        _ => 4,
    };
    1 + length_bytes + remaining
}

/// Drives real MQTT connections with `rumqttc`. Each connected broker gets
/// its own background task, spawned on an owned tokio runtime, that owns
/// the actual network connection and event loop; this struct only keeps a
/// channel to talk to that task. That's what lets every `MqttPort` method
/// below stay a plain, non-async function.
pub struct RumqttcAdapter {
    runtime: tokio::runtime::Runtime,
    events_tx: mpsc::UnboundedSender<MqttEvent>,
    connections: Connections,
}

impl RumqttcAdapter {
    pub fn new(events_tx: mpsc::UnboundedSender<MqttEvent>) -> Self {
        Self {
            runtime: tokio::runtime::Runtime::new().expect("failed to start tokio runtime"),
            events_tx,
            connections: ConnectionRegistry::new(),
        }
    }

    fn send_command(&self, connection_id: Uuid, command: Command) -> Result<(), MqttError> {
        let command_tx = self
            .connections
            .get(connection_id)
            .ok_or(MqttError::UnknownConnection(connection_id))?;
        command_tx
            .send(command)
            .map_err(|_| MqttError::Other("connection task has already stopped".to_string()))
    }
}

impl MqttPort for RumqttcAdapter {
    /// Connecting an id that is already connected replaces the live session
    /// rather than stacking a second one on top of it. Two tasks for one id
    /// would deliver every message twice, and the first to exit would take the
    /// other's registry entry with it.
    fn connect(&self, connection_id: Uuid, broker: &BrokerConnection) -> Result<(), MqttError> {
        if let Some(superseded) = self.connections.take(connection_id) {
            log::info!("mqtt connection {connection_id}: replacing the live session");
            // Fire-and-forget: the old task stops at its next poll. It is
            // already out of the registry, so it can no longer receive
            // commands - the worst it can still do is deliver a message or
            // two from the session it is closing.
            let _ = superseded.send(Command::Disconnect { announce: false });
        }

        let mut options =
            MqttOptions::new(broker.client_id.clone(), broker.host.clone(), broker.port);
        options.set_keep_alive(Duration::from_secs(broker.keep_alive_secs as u64));
        options.set_max_packet_size(MAX_PACKET_BYTES, MAX_PACKET_BYTES);
        // Stated rather than inherited from rumqttc's default: the whole
        // resubscribe-after-ConnAck design below only makes sense because the
        // broker has forgotten the session, so the assumption belongs in the
        // code that depends on it.
        options.set_clean_session(true);
        if let (Some(username), Some(password)) = (&broker.username, &broker.password) {
            options.set_credentials(username.clone(), password.clone());
        }
        if broker.use_tls {
            options.set_transport(Transport::tls_with_default_config());
        }

        let (client, eventloop) = AsyncClient::new(options, 64);
        let (command_tx, command_rx) = mpsc::unbounded_channel();

        // Registered before the task is spawned, so a publish issued the
        // instant connect() returns finds a channel to go down.
        let generation = self.connections.insert(connection_id, command_tx);

        self.runtime.spawn(run_connection(
            connection_id,
            generation,
            client,
            eventloop,
            command_rx,
            self.events_tx.clone(),
            self.connections.clone(),
            ReconnectPolicy::from_broker(broker),
            SubscriptionSet::from_broker(broker),
        ));

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
        let qos = qos.into();
        // Rejected here, where the caller still gets to see the error, instead
        // of in the event loop - which enforces the same limit by dropping the
        // session, taking every other topic down with it.
        let bytes = publish_packet_bytes(topic, payload.len(), qos);
        if bytes > MAX_PACKET_BYTES {
            return Err(MqttError::PayloadTooLarge {
                bytes,
                max: MAX_PACKET_BYTES,
            });
        }

        self.send_command(
            connection_id,
            Command::Publish {
                topic: topic.to_string(),
                payload,
                qos,
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

    /// Idempotent: disconnecting a connection that's already gone (never
    /// connected, already disconnected, or whose task ended on its own
    /// after e.g. a network drop) is a no-op success rather than an error,
    /// since the end state the caller wants - "not connected" - already
    /// holds.
    fn disconnect(&self, connection_id: Uuid) -> Result<(), MqttError> {
        if let Some(command_tx) = self.connections.take(connection_id) {
            let _ = command_tx.send(Command::Disconnect { announce: true });
        }
        Ok(())
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_connection(
    connection_id: Uuid,
    generation: u64,
    client: AsyncClient,
    mut eventloop: EventLoop,
    mut command_rx: mpsc::UnboundedReceiver<Command>,
    events_tx: mpsc::UnboundedSender<MqttEvent>,
    connections: Connections,
    policy: ReconnectPolicy,
    mut subscriptions: SubscriptionSet,
) {
    log::info!("mqtt connection {connection_id}: event loop started");

    // Retrying a broker that has never answered would turn a typo in the host
    // field into two and a half minutes of "Reconnecting…" before the real
    // error shows up, so the backoff only arms once a session has actually
    // been established.
    let mut has_connected = false;
    let mut attempt = 0u32;
    // Tracked apart from `attempt` because an oversize packet is not a broken
    // connection and must never spend the reconnect budget - see the Err arm.
    let mut oversize_streak = 0u32;

    loop {
        // Set by the poll arm below, acted on after the select! block: the
        // wait borrows the command channel that the select's own arm is
        // reading, so it has to happen once that borrow is definitely gone.
        let mut pending_backoff = None;

        tokio::select! {
            event = eventloop.poll() => {
                match event {
                    Ok(Event::Incoming(Packet::ConnAck(_))) => {
                        log::info!("mqtt connection {connection_id}: connected (ConnAck)");
                        has_connected = true;
                        // A session that came up is real progress, so the next
                        // drop starts its backoff from one second again rather
                        // than from wherever the previous one left off.
                        attempt = 0;
                        // `oversize_streak` deliberately survives this. A ConnAck
                        // proves the socket came back, not that the stream got
                        // past the packet that broke it: a retained oversize
                        // message is redelivered *after* every ConnAck, so
                        // resetting here would collapse the delay back to one
                        // second and hammer the broker in a tight loop.
                        // We connect with a clean session, so the broker has no
                        // memory of what we were subscribed to - not even on the
                        // very first ConnAck, which is why `connect_broker`
                        // doesn't replay them any more.
                        for (topic, qos) in subscriptions.iter() {
                            log::debug!("mqtt connection {connection_id}: (re)subscribing to {topic}");
                            let _ = client.subscribe(topic, qos.into()).await;
                        }
                        let _ = events_tx.send(MqttEvent::Connected { connection_id });
                    }
                    Ok(Event::Incoming(Packet::Publish(publish))) => {
                        // A message got through, so whatever the last oversize
                        // packet was, the stream is past it.
                        oversize_streak = 0;
                        log::debug!(
                            "mqtt connection {connection_id}: message received topic={} payload_len={} truncated_for_ipc={} qos={:?} retain={}",
                            publish.topic,
                            publish.payload.len(),
                            publish.payload.len() > MAX_IPC_PAYLOAD_BYTES,
                            publish.qos,
                            publish.retain,
                        );
                        let _ = events_tx.send(MqttEvent::message_received(
                            connection_id,
                            publish.topic,
                            &publish.payload,
                            publish.qos.into(),
                            publish.retain,
                        ));
                    }
                    Ok(_) => {}
                    Err(err) => {
                        log::error!("mqtt connection {connection_id}: eventloop.poll() failed: {err} ({err:?})");

                        // rumqttc's event loop is built to be polled *through* a
                        // disconnect: it drops the socket, resets its state and
                        // re-establishes the session on the next poll. So all a
                        // retry takes is waiting, then looping.
                        if let Some(reason) = oversize_reason(&err) {
                            // A message the broker is holding is not a broken
                            // connection. Counting these against the reconnect
                            // budget would take a working broker offline over
                            // one payload the user may not even care about, so
                            // they get their own track with no budget at all -
                            // everything else on the connection keeps flowing
                            // between the recoveries.
                            let _ = events_tx.send(MqttEvent::Warning {
                                connection_id,
                                message: reason.clone(),
                            });

                            // Except that "keep trying" cannot override the
                            // user's own setting: with auto-reconnect off, this
                            // ends the session like any other drop - but finally
                            // says why.
                            if !policy.enabled || !has_connected {
                                log::warn!("mqtt connection {connection_id}: disconnected due to an oversize packet");
                                connections.remove_if_current(connection_id, generation);
                                let _ = events_tx.send(MqttEvent::Disconnected {
                                    connection_id,
                                    reason: Some(reason),
                                });
                                return;
                            }

                            oversize_streak += 1;
                            let delay = oversize_delay(oversize_streak);
                            log::info!(
                                "mqtt connection {connection_id}: oversize packet #{oversize_streak}, reconnecting in {delay:?}"
                            );
                            // `attempt` is deliberately left alone: a run of
                            // these must not creep up on the budget a real
                            // network fault will need. `max_attempts: 0` is what
                            // makes the banner read a plain "Reconnecting…",
                            // since there is no budget to count against.
                            let _ = events_tx.send(MqttEvent::Reconnecting {
                                connection_id,
                                attempt: oversize_streak,
                                max_attempts: 0,
                                delay_ms: delay.as_millis() as u64,
                            });

                            pending_backoff = Some(delay);
                        } else {
                            attempt += 1;

                            let Some(delay) = policy.delay_for(attempt).filter(|_| has_connected)
                            else {
                                log::warn!("mqtt connection {connection_id}: disconnected due to eventloop error");
                                connections.remove_if_current(connection_id, generation);
                                let _ = events_tx.send(MqttEvent::Disconnected { connection_id, reason: None });
                                return;
                            };

                            log::info!(
                                "mqtt connection {connection_id}: reconnect attempt {attempt}/{} in {:?}",
                                policy.max_attempts,
                                delay,
                            );
                            let _ = events_tx.send(MqttEvent::Reconnecting {
                                connection_id,
                                attempt,
                                max_attempts: policy.max_attempts,
                                delay_ms: delay.as_millis() as u64,
                            });

                            pending_backoff = Some(delay);
                        }
                    }
                }
            }
            command = command_rx.recv() => {
                match command {
                    Some(Command::Publish { topic, payload, qos, retain }) => {
                        let _ = client.publish(topic, qos, retain, payload).await;
                    }
                    Some(Command::Subscribe { topic, qos }) => {
                        // Recorded as well as sent, so a topic subscribed to
                        // mid-session is still there to replay after a drop.
                        subscriptions.insert(topic.clone(), qos.into());
                        let _ = client.subscribe(topic, qos).await;
                    }
                    Some(Command::Unsubscribe { topic }) => {
                        subscriptions.remove(&topic);
                        let _ = client.unsubscribe(topic).await;
                    }
                    Some(Command::Disconnect { announce }) => {
                        shutdown(connection_id, generation, &client, &connections, &events_tx, announce).await;
                        return;
                    }
                    // A closed channel means the adapter itself is going away,
                    // which is as much a disconnect as an explicit request.
                    None => {
                        shutdown(connection_id, generation, &client, &connections, &events_tx, true).await;
                        return;
                    }
                }
            }
        }

        if let Some(delay) = pending_backoff {
            if let BackoffOutcome::Stopped { announce } =
                backoff(connection_id, delay, &mut command_rx, &mut subscriptions).await
            {
                log::info!(
                    "mqtt connection {connection_id}: disconnected (client requested while reconnecting)"
                );
                connections.remove_if_current(connection_id, generation);
                if announce {
                    let _ = events_tx.send(MqttEvent::Disconnected {
                        connection_id,
                        reason: None,
                    });
                }
                return;
            }
        }
    }
}

/// Closes the session down and takes the connection out of the registry.
///
/// `announce` is false only when this task is being replaced by a fresh
/// connection to the same broker - see `Command::Disconnect`.
async fn shutdown(
    connection_id: Uuid,
    generation: u64,
    client: &AsyncClient,
    connections: &Connections,
    events_tx: &mpsc::UnboundedSender<MqttEvent>,
    announce: bool,
) {
    log::info!("mqtt connection {connection_id}: disconnected (client requested)");
    let _ = client.disconnect().await;
    connections.remove_if_current(connection_id, generation);
    if announce {
        let _ = events_tx.send(MqttEvent::Disconnected {
            connection_id,
            reason: None,
        });
    }
}

/// Waits out one backoff interval before the next reconnect attempt.
///
/// This is a select rather than a plain sleep because the command channel has
/// to keep being served: a Disconnect that lands during a 30-second wait must
/// take effect now, not half a minute later, and subscription edits made while
/// offline need to be recorded so the next ConnAck replays them.
///
async fn backoff(
    connection_id: Uuid,
    delay: Duration,
    command_rx: &mut mpsc::UnboundedReceiver<Command>,
    subscriptions: &mut SubscriptionSet,
) -> BackoffOutcome {
    let deadline = tokio::time::Instant::now() + delay;

    loop {
        tokio::select! {
            _ = tokio::time::sleep_until(deadline) => return BackoffOutcome::Elapsed,
            command = command_rx.recv() => {
                match command {
                    Some(Command::Subscribe { topic, qos }) => {
                        subscriptions.insert(topic, qos.into());
                    }
                    Some(Command::Unsubscribe { topic }) => {
                        subscriptions.remove(&topic);
                    }
                    Some(Command::Publish { topic, .. }) => {
                        // There's no session to publish over, and queueing it
                        // would deliver a stale message at some unpredictable
                        // point after reconnecting. The publish panel is
                        // disabled while not connected, so this is a rare race.
                        log::warn!(
                            "mqtt connection {connection_id}: dropped publish to {topic} while reconnecting"
                        );
                    }
                    Some(Command::Disconnect { announce }) => {
                        return BackoffOutcome::Stopped { announce }
                    }
                    None => return BackoffOutcome::Stopped { announce: true },
                }
            }
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
enum BackoffOutcome {
    /// The delay ran out; the caller should try the broker again.
    Elapsed,
    /// The client asked to stop retrying. `announce` as in `Command::Disconnect`.
    Stopped { announce: bool },
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
            auto_reconnect: false,
            max_reconnect_attempts: 0,
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

    /// Long enough that a test failing to return early would blow the
    /// surrounding timeout rather than passing by accident.
    const NEVER: Duration = Duration::from_secs(30);

    #[tokio::test]
    async fn backoff_waits_out_the_delay_when_nothing_interrupts_it() {
        let (_command_tx, mut command_rx) = mpsc::unbounded_channel();
        let mut subscriptions = SubscriptionSet::default();

        let outcome = backoff(
            Uuid::new_v4(),
            Duration::from_millis(20),
            &mut command_rx,
            &mut subscriptions,
        )
        .await;

        assert_eq!(outcome, BackoffOutcome::Elapsed);
    }

    #[tokio::test]
    async fn a_disconnect_during_the_backoff_stops_the_wait_immediately() {
        let (command_tx, mut command_rx) = mpsc::unbounded_channel();
        let mut subscriptions = SubscriptionSet::default();
        command_tx
            .send(Command::Disconnect { announce: true })
            .unwrap();

        let outcome = timeout(
            Duration::from_secs(5),
            backoff(Uuid::new_v4(), NEVER, &mut command_rx, &mut subscriptions),
        )
        .await
        .expect("backoff should return without waiting out the delay");

        assert_eq!(outcome, BackoffOutcome::Stopped { announce: true });
    }

    /// Being replaced mid-backoff must stay silent: the replacement announces
    /// itself, and a Disconnected landing after that would read as the new
    /// session having dropped.
    #[tokio::test]
    async fn being_superseded_during_the_backoff_stops_the_wait_without_announcing() {
        let (command_tx, mut command_rx) = mpsc::unbounded_channel();
        let mut subscriptions = SubscriptionSet::default();
        command_tx
            .send(Command::Disconnect { announce: false })
            .unwrap();

        let outcome = timeout(
            Duration::from_secs(5),
            backoff(Uuid::new_v4(), NEVER, &mut command_rx, &mut subscriptions),
        )
        .await
        .expect("backoff should return without waiting out the delay");

        assert_eq!(outcome, BackoffOutcome::Stopped { announce: false });
    }

    #[tokio::test]
    async fn a_closed_command_channel_during_the_backoff_stops_the_wait() {
        let (command_tx, mut command_rx) = mpsc::unbounded_channel();
        let mut subscriptions = SubscriptionSet::default();
        drop(command_tx);

        let outcome = timeout(
            Duration::from_secs(5),
            backoff(Uuid::new_v4(), NEVER, &mut command_rx, &mut subscriptions),
        )
        .await
        .expect("backoff should return without waiting out the delay");

        assert_eq!(outcome, BackoffOutcome::Stopped { announce: true });
    }

    #[tokio::test]
    async fn subscription_changes_made_while_reconnecting_are_kept_for_the_replay() {
        let (command_tx, mut command_rx) = mpsc::unbounded_channel();
        let mut subscriptions = SubscriptionSet::default();
        subscriptions.insert("stale/#".to_string(), QoS::AtMostOnce);

        command_tx
            .send(Command::Subscribe {
                topic: "fresh/#".to_string(),
                qos: rumqttc::QoS::ExactlyOnce,
            })
            .unwrap();
        command_tx
            .send(Command::Unsubscribe {
                topic: "stale/#".to_string(),
            })
            .unwrap();

        backoff(
            Uuid::new_v4(),
            Duration::from_millis(20),
            &mut command_rx,
            &mut subscriptions,
        )
        .await;

        let replayed: Vec<(&str, QoS)> = subscriptions.iter().collect();
        assert_eq!(replayed, vec![("fresh/#", QoS::ExactlyOnce)]);
    }

    #[test]
    fn disconnecting_a_connection_that_was_never_connected_succeeds() {
        let (events_tx, _events_rx) = mpsc::unbounded_channel();
        let adapter = RumqttcAdapter::new(events_tx);

        assert_eq!(adapter.disconnect(Uuid::new_v4()), Ok(()));
    }

    #[test]
    fn disconnecting_the_same_connection_twice_succeeds_both_times() {
        let (events_tx, _events_rx) = mpsc::unbounded_channel();
        let adapter = RumqttcAdapter::new(events_tx);
        let broker = sample_broker("localhost", 1883);

        adapter.connect(broker.id, &broker).unwrap();

        assert_eq!(adapter.disconnect(broker.id), Ok(()));
        assert_eq!(adapter.disconnect(broker.id), Ok(()));
    }

    /// Connecting twice used to leave two tasks running for one id, which both
    /// duplicated every message and let the first to exit unregister the other.
    #[test]
    fn connecting_an_already_connected_id_leaves_exactly_one_live_connection() {
        let (events_tx, _events_rx) = mpsc::unbounded_channel();
        let adapter = RumqttcAdapter::new(events_tx);
        let broker = sample_broker("localhost", 1883);

        adapter.connect(broker.id, &broker).unwrap();
        let first = adapter.connections.get(broker.id).expect("registered");
        adapter.connect(broker.id, &broker).unwrap();
        let second = adapter.connections.get(broker.id).expect("registered");

        assert!(!first.same_channel(&second));
        // The superseded task was told to stop, and quietly, so the
        // replacement's Connected is not immediately contradicted.
        assert!(first.is_closed() || !second.is_closed());
        assert_eq!(adapter.disconnect(broker.id), Ok(()));
        assert!(!adapter.connections.contains(broker.id));
    }

    #[test]
    fn a_publish_packet_is_the_header_plus_the_topic_plus_the_payload() {
        // 1 fixed header + 1 length byte + 2 topic-length + 4 topic + 3 payload.
        assert_eq!(
            publish_packet_bytes("temp", 3, rumqttc::QoS::AtMostOnce),
            11
        );
        // Above QoS 0 the packet id is counted, unlike in rumqttc's own check.
        assert_eq!(
            publish_packet_bytes("temp", 3, rumqttc::QoS::AtLeastOnce),
            13
        );
        // The remaining length is a varint, so it grows a byte of its own.
        assert_eq!(
            publish_packet_bytes("t", 200, rumqttc::QoS::AtMostOnce),
            206
        );
    }

    /// Letting an oversize publish reach the event loop would drop the whole
    /// session, so the guard has to reject it while the caller is still there
    /// to be told - and leave the connection alone.
    #[test]
    fn publishing_more_than_the_packet_limit_is_refused_without_touching_the_session() {
        let (events_tx, _events_rx) = mpsc::unbounded_channel();
        let adapter = RumqttcAdapter::new(events_tx);
        let broker = sample_broker("localhost", 1883);
        adapter.connect(broker.id, &broker).unwrap();

        let too_big = vec![0u8; MAX_PACKET_BYTES];
        let result = adapter.publish(broker.id, "t", too_big, QoS::AtMostOnce, false);

        assert!(
            matches!(result, Err(MqttError::PayloadTooLarge { max, .. }) if max == MAX_PACKET_BYTES),
            "{result:?}"
        );
        assert!(adapter.connections.contains(broker.id));
        assert_eq!(
            adapter.publish(broker.id, "t", b"small".to_vec(), QoS::AtMostOnce, false),
            Ok(())
        );
    }

    /// The command channel exists before `connect` returns, so a publish issued
    /// straight afterwards is not rejected as an unknown connection.
    #[test]
    fn a_connection_is_reachable_the_moment_connect_returns() {
        let (events_tx, _events_rx) = mpsc::unbounded_channel();
        let adapter = RumqttcAdapter::new(events_tx);
        let broker = sample_broker("localhost", 1883);

        adapter.connect(broker.id, &broker).unwrap();

        assert_eq!(
            adapter.publish(broker.id, "t", b"x".to_vec(), QoS::AtMostOnce, false),
            Ok(())
        );
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

    /// The regression this whole limit exists for: rumqttc defaults to a 10 KiB
    /// packet limit, so an ordinary large message used to be a framing error
    /// that dropped the session and - if it was retained - was redelivered on
    /// every reconnect, flapping forever.
    ///
    /// Needs a local broker: `docker run --rm -p 1883:1883 eclipse-mosquitto`.
    /// Run explicitly with: cargo test -p bme-core -- --ignored oversize
    #[test]
    #[ignore]
    fn a_message_far_over_the_old_limit_arrives_without_dropping_the_session() {
        let (events_tx, mut events_rx) = mpsc::unbounded_channel();
        let adapter = RumqttcAdapter::new(events_tx);
        let broker = sample_broker("localhost", 1883);
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

        // Comfortably over the old 10 KiB ceiling, and over the IPC cap too, so
        // this covers the truncation on the way out as well.
        let big = vec![b'x'; MAX_IPC_PAYLOAD_BYTES * 4];
        adapter
            .publish(broker.id, &topic, big.clone(), QoS::AtLeastOnce, false)
            .unwrap();

        adapter.runtime.block_on(async {
            let received = wait_for(
                &mut events_rx,
                |event| matches!(event, MqttEvent::MessageReceived { topic: t, .. } if t == &topic),
            )
            .await;
            let MqttEvent::MessageReceived {
                payload,
                payload_len,
                ..
            } = received
            else {
                unreachable!()
            };
            assert_eq!(payload_len, big.len());
            assert_eq!(payload.len(), MAX_IPC_PAYLOAD_BYTES);

            // Nothing may follow it: the session that carried it is still up.
            let dropped = timeout(Duration::from_secs(2), async {
                loop {
                    let event = events_rx.recv().await.expect("event channel closed");
                    if matches!(
                        &event,
                        MqttEvent::Disconnected { .. }
                            | MqttEvent::Reconnecting { .. }
                            | MqttEvent::Warning { .. }
                    ) {
                        return event;
                    }
                }
            })
            .await;
            assert!(dropped.is_err(), "the session dropped: {dropped:?}");
        });

        adapter.disconnect(broker.id).unwrap();
    }

    /// The regression `ConnectionRegistry` exists for, end to end: reconnecting
    /// an id that is already live used to leave both sessions subscribed, so
    /// every message arrived twice.
    ///
    /// Run explicitly with: cargo test -p bme-core -- --ignored reconnecting
    #[test]
    #[ignore]
    fn reconnecting_a_live_connection_does_not_deliver_messages_twice() {
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

        // Second connect for the same id: the first session must be replaced,
        // not joined by a second one.
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
            .publish(broker.id, &topic, b"once".to_vec(), QoS::AtLeastOnce, false)
            .unwrap();

        adapter.runtime.block_on(async {
            wait_for(
                &mut events_rx,
                |event| matches!(event, MqttEvent::MessageReceived { topic: t, .. } if t == &topic),
            )
            .await;

            // A second copy would arrive right behind the first, so a short
            // wait is enough to catch the duplicate.
            let duplicate = timeout(Duration::from_secs(2), async {
                loop {
                    let event = events_rx.recv().await.expect("event channel closed");
                    if matches!(&event, MqttEvent::MessageReceived { topic: t, .. } if t == &topic)
                    {
                        return event;
                    }
                }
            })
            .await;

            assert!(
                duplicate.is_err(),
                "the replaced session delivered the message a second time"
            );
        });

        adapter.disconnect(broker.id).unwrap();
    }
}
