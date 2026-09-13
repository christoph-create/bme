use std::time::Duration;

use bytes::Bytes;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::models::{BrokerConnection, MessageProperties, MqttVersion, QoS};
use crate::mqtt::connection_registry::ConnectionRegistry;
use crate::mqtt::oversize::{oversize_delay, MAX_PACKET_BYTES};
use crate::mqtt::port::{MqttError, MqttEvent, MqttPort, MAX_IPC_PAYLOAD_BYTES};
use crate::mqtt::reconnect::ReconnectPolicy;
use crate::mqtt::session::{publish_packet_bytes, PollError, Session, SessionEvent};
use crate::mqtt::subscription_set::SubscriptionSet;
use crate::mqtt::transport::transport_for;

/// Protocol-neutral on purpose: the task on the other end owns a `Session`
/// in whichever dialect the connection asked for, and translates.
enum Command {
    Publish {
        topic: String,
        payload: Bytes,
        qos: QoS,
        retain: bool,
        properties: Option<MessageProperties>,
    },
    Subscribe {
        topic: String,
        qos: QoS,
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

/// What the registry holds per live connection. The version travels with
/// the channel because the publish size guard runs on the caller's side,
/// before anything reaches the task that knows which dialect it speaks.
#[derive(Clone)]
struct Live {
    command_tx: mpsc::UnboundedSender<Command>,
    version: MqttVersion,
}

type Connections = ConnectionRegistry<Live>;

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

    fn live(&self, connection_id: Uuid) -> Result<Live, MqttError> {
        self.connections
            .get(connection_id)
            .ok_or(MqttError::UnknownConnection(connection_id))
    }

    fn send_command(&self, connection_id: Uuid, command: Command) -> Result<(), MqttError> {
        self.live(connection_id)?
            .command_tx
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
            let _ = superseded
                .command_tx
                .send(Command::Disconnect { announce: false });
        }

        // Built before anything is registered or spawned: an unusable
        // certificate is knowable now, and reporting it as a return value beats
        // reporting it as a disconnect the caller has to wait for.
        let transport = transport_for(broker).map_err(|err| MqttError::Config(err.to_string()))?;
        let session = Session::open(broker, transport)?;

        let (command_tx, command_rx) = mpsc::unbounded_channel();

        // Registered before the task is spawned, so a publish issued the
        // instant connect() returns finds a channel to go down.
        let generation = self.connections.insert(
            connection_id,
            Live {
                command_tx,
                version: session.version(),
            },
        );

        self.runtime.spawn(run_connection(
            connection_id,
            generation,
            session,
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
        properties: Option<MessageProperties>,
    ) -> Result<(), MqttError> {
        let live = self.live(connection_id)?;
        let payload = Bytes::from(payload);
        // Rejected here, where the caller still gets to see the error, instead
        // of in the event loop - which enforces the same limit by dropping the
        // session, taking every other topic down with it.
        let bytes = publish_packet_bytes(live.version, topic, &payload, qos, properties.as_ref());
        if bytes > MAX_PACKET_BYTES {
            return Err(MqttError::PayloadTooLarge {
                bytes,
                max: MAX_PACKET_BYTES,
            });
        }

        live.command_tx
            .send(Command::Publish {
                topic: topic.to_string(),
                payload,
                qos,
                retain,
                properties,
            })
            .map_err(|_| MqttError::Other("connection task has already stopped".to_string()))
    }

    fn subscribe(&self, connection_id: Uuid, topic: &str, qos: QoS) -> Result<(), MqttError> {
        self.send_command(
            connection_id,
            Command::Subscribe {
                topic: topic.to_string(),
                qos,
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
        if let Some(live) = self.connections.take(connection_id) {
            let _ = live.command_tx.send(Command::Disconnect { announce: true });
        }
        Ok(())
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_connection(
    connection_id: Uuid,
    generation: u64,
    mut session: Session,
    mut command_rx: mpsc::UnboundedReceiver<Command>,
    events_tx: mpsc::UnboundedSender<MqttEvent>,
    connections: Connections,
    policy: ReconnectPolicy,
    mut subscriptions: SubscriptionSet,
) {
    log::info!(
        "mqtt connection {connection_id}: event loop started ({})",
        session.version().display_name()
    );

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
            event = session.poll() => {
                match event {
                    Ok(SessionEvent::ConnAck) => {
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
                            session.subscribe(topic, qos).await;
                        }
                        let _ = events_tx.send(MqttEvent::Connected { connection_id });
                    }
                    Ok(SessionEvent::Publish(publish)) => {
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
                            publish.qos,
                            publish.retain,
                            publish.properties,
                        ));
                    }
                    Ok(SessionEvent::Other) => {}
                    Err(err) => {
                        log::error!("mqtt connection {connection_id}: eventloop.poll() failed: {err}");

                        // rumqttc's event loop is built to be polled *through* a
                        // disconnect: it drops the socket, resets its state and
                        // re-establishes the session on the next poll. So all a
                        // retry takes is waiting, then looping.
                        if let PollError::Oversize(reason) = err {
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
                        } else if let PollError::Failed { reason, .. } = err {
                            attempt += 1;

                            let Some(delay) = policy.delay_for(attempt).filter(|_| has_connected)
                            else {
                                log::warn!("mqtt connection {connection_id}: disconnected due to eventloop error");
                                connections.remove_if_current(connection_id, generation);
                                let _ = events_tx.send(MqttEvent::Disconnected {
                                    connection_id,
                                    reason,
                                });
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
                    Some(Command::Publish { topic, payload, qos, retain, properties }) => {
                        session.publish(topic, payload, qos, retain, properties).await;
                    }
                    Some(Command::Subscribe { topic, qos }) => {
                        // Recorded as well as sent, so a topic subscribed to
                        // mid-session is still there to replay after a drop.
                        subscriptions.insert(topic.clone(), qos);
                        session.subscribe(&topic, qos).await;
                    }
                    Some(Command::Unsubscribe { topic }) => {
                        subscriptions.remove(&topic);
                        session.unsubscribe(&topic).await;
                    }
                    Some(Command::Disconnect { announce }) => {
                        shutdown(connection_id, generation, &mut session, &connections, &events_tx, announce).await;
                        return;
                    }
                    // A closed channel means the adapter itself is going away,
                    // which is as much a disconnect as an explicit request.
                    None => {
                        shutdown(connection_id, generation, &mut session, &connections, &events_tx, true).await;
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
    session: &mut Session,
    connections: &Connections,
    events_tx: &mpsc::UnboundedSender<MqttEvent>,
    announce: bool,
) {
    log::info!("mqtt connection {connection_id}: disconnected (client requested)");
    session.disconnect().await;
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
                        subscriptions.insert(topic, qos);
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
    use crate::models::{BrokerScheme, MqttVersion};
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
            scheme: BrokerScheme::Mqtt,
            protocol_version: MqttVersion::V311,
            ws_path: None,
            ca_cert_path: None,
            client_cert_path: None,
            client_key_path: None,
            alpn: None,
            skip_cert_verification: false,
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
                qos: QoS::ExactlyOnce,
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

        assert!(!first.command_tx.same_channel(&second.command_tx));
        // The superseded task was told to stop, and quietly, so the
        // replacement's Connected is not immediately contradicted.
        assert!(first.command_tx.is_closed() || !second.command_tx.is_closed());
        assert_eq!(adapter.disconnect(broker.id), Ok(()));
        assert!(!adapter.connections.contains(broker.id));
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
        let result = adapter.publish(broker.id, "t", too_big, QoS::AtMostOnce, false, None);

        assert!(
            matches!(result, Err(MqttError::PayloadTooLarge { max, .. }) if max == MAX_PACKET_BYTES),
            "{result:?}"
        );
        assert!(adapter.connections.contains(broker.id));
        assert_eq!(
            adapter.publish(
                broker.id,
                "t",
                b"small".to_vec(),
                QoS::AtMostOnce,
                false,
                None
            ),
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
            adapter.publish(broker.id, "t", b"x".to_vec(), QoS::AtMostOnce, false, None),
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
                None,
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

    /// The MQTT 5 driver end to end. test.mosquitto.org runs Mosquitto 2.x,
    /// which negotiates v5 on the same port as v3.1.1.
    /// Run explicitly with: cargo test -p bme-core -- --ignored mqtt5
    #[test]
    #[ignore]
    fn connects_publishes_and_receives_over_mqtt5() {
        let (events_tx, mut events_rx) = mpsc::unbounded_channel();
        let adapter = RumqttcAdapter::new(events_tx);
        let mut broker = sample_broker("test.mosquitto.org", 1883);
        broker.protocol_version = MqttVersion::V5;
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
        let sent = MessageProperties {
            content_type: Some("text/plain".to_string()),
            payload_is_utf8: true,
            message_expiry_interval: Some(60),
            response_topic: Some(format!("{topic}/reply")),
            correlation_data: Some("req-1".to_string()),
            user_properties: vec![crate::models::UserProperty {
                key: "origin".to_string(),
                value: "bme-test".to_string(),
            }],
        };
        adapter
            .publish(
                broker.id,
                &topic,
                b"hello over mqtt 5".to_vec(),
                QoS::AtLeastOnce,
                false,
                Some(sent.clone()),
            )
            .unwrap();

        adapter.runtime.block_on(async {
            let received = wait_for(
                &mut events_rx,
                |event| matches!(event, MqttEvent::MessageReceived { topic: t, .. } if t == &topic),
            )
            .await;
            match received {
                MqttEvent::MessageReceived {
                    payload,
                    properties,
                    ..
                } => {
                    assert_eq!(payload, b"hello over mqtt 5");
                    // The expiry comes back as whatever is left of it, so
                    // compare it loosely and everything else exactly.
                    let mut properties = properties.expect("the properties should come back");
                    assert!(properties.message_expiry_interval.is_some_and(|s| s <= 60));
                    properties.message_expiry_interval = sent.message_expiry_interval;
                    assert_eq!(properties, sent);
                }
                _ => unreachable!(),
            }
        });

        adapter.disconnect(broker.id).unwrap();
    }

    /// A v5 broker says *why* it refused, and that has to reach the banner.
    /// test.mosquitto.org's 1884 listener requires credentials.
    /// Run explicitly with: cargo test -p bme-core -- --ignored mqtt5
    #[test]
    #[ignore]
    fn an_mqtt5_refusal_explains_itself() {
        let (events_tx, mut events_rx) = mpsc::unbounded_channel();
        let adapter = RumqttcAdapter::new(events_tx);
        let mut broker = sample_broker("test.mosquitto.org", 1884);
        broker.protocol_version = MqttVersion::V5;
        broker.username = Some("nobody".to_string());
        broker.password = Some("wrong".to_string());

        adapter.connect(broker.id, &broker).unwrap();

        adapter.runtime.block_on(async {
            let event = wait_for(&mut events_rx, |event| {
                matches!(event, MqttEvent::Disconnected { .. })
            })
            .await;
            match event {
                MqttEvent::Disconnected { reason, .. } => {
                    let reason = reason.expect("the refusal should be explained");
                    assert!(reason.contains("refused"), "{reason}");
                }
                _ => unreachable!(),
            }
        });
    }

    /// The WebSocket path end to end, against test.mosquitto.org's TLS
    /// WebSocket listener. Worth running by hand after any change to
    /// `transport::broker_addr`, since the URL assembly is the part rumqttc
    /// gives no compile-time help with.
    ///
    /// Requires network access. For a local equivalent, give Mosquitto a
    /// `listener 8083` / `protocol websockets` block and point this at
    /// ws://localhost:8083/mqtt.
    /// Run explicitly with: cargo test -p bme-core -- --ignored websocket
    #[test]
    #[ignore]
    fn connects_over_a_secure_websocket_to_a_real_broker() {
        let (events_tx, mut events_rx) = mpsc::unbounded_channel();
        let adapter = RumqttcAdapter::new(events_tx);
        let mut broker = sample_broker("test.mosquitto.org", 8081);
        broker.scheme = BrokerScheme::Wss;
        broker.ws_path = Some("/mqtt".to_string());
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
                b"hello over websockets".to_vec(),
                QoS::AtLeastOnce,
                false,
                None,
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
                    assert_eq!(payload, b"hello over websockets");
                }
                _ => unreachable!(),
            }
        });

        adapter.disconnect(broker.id).unwrap();
    }

    /// Pointing a WebSocket connection at a listener that speaks plain MQTT is
    /// the mistake the reason text exists for: it used to surface as a bare
    /// "Disconnected from broker".
    ///
    /// Run explicitly with: cargo test -p bme-core -- --ignored websocket
    #[test]
    #[ignore]
    fn a_websocket_pointed_at_a_plain_mqtt_port_explains_itself() {
        let (events_tx, mut events_rx) = mpsc::unbounded_channel();
        let adapter = RumqttcAdapter::new(events_tx);
        let mut broker = sample_broker("test.mosquitto.org", 1883);
        broker.scheme = BrokerScheme::Ws;

        adapter.connect(broker.id, &broker).unwrap();

        adapter.runtime.block_on(async {
            let event = wait_for(&mut events_rx, |event| {
                matches!(event, MqttEvent::Disconnected { .. })
            })
            .await;
            match event {
                MqttEvent::Disconnected { reason, .. } => {
                    assert!(reason.is_some(), "the failure should be explained");
                }
                _ => unreachable!(),
            }
        });
    }

    /// The regression this whole limit exists for: rumqttc defaults to a 10 KiB
    /// packet limit, so an ordinary large message used to be a framing error
    /// that dropped the session and - if it was retained - was redelivered on
    /// every reconnect, flapping forever.
    ///
    /// Needs a local broker: `docker run --rm -p 1883:1883 eclipse-mosquitto`.
    /// Run explicitly with: cargo test -p bme-core -- --ignored dropping_the_session
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
            .publish(
                broker.id,
                &topic,
                big.clone(),
                QoS::AtLeastOnce,
                false,
                None,
            )
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

    /// The v5 twin of the test above. rumqttc's v5 options default to the
    /// same 10 KiB, raised through a different knob (the Maximum Packet Size
    /// CONNECT property), so it needs proving separately.
    ///
    /// Needs a local broker; see the v3.1.1 test above.
    /// Run explicitly with: cargo test -p bme-core -- --ignored dropping_the_session
    #[test]
    #[ignore]
    fn a_large_message_arrives_over_mqtt5_without_dropping_the_session() {
        let (events_tx, mut events_rx) = mpsc::unbounded_channel();
        let adapter = RumqttcAdapter::new(events_tx);
        let mut broker = sample_broker("localhost", 1883);
        broker.protocol_version = MqttVersion::V5;
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

        let big = vec![b'x'; MAX_IPC_PAYLOAD_BYTES * 4];
        adapter
            .publish(
                broker.id,
                &topic,
                big.clone(),
                QoS::AtLeastOnce,
                false,
                None,
            )
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
            .publish(
                broker.id,
                &topic,
                b"once".to_vec(),
                QoS::AtLeastOnce,
                false,
                None,
            )
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
