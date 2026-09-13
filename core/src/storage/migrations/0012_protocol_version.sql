-- Which MQTT revision to speak, per connection. Every existing connection was
-- 3.1.1 because that was all the client could do, so the backfill is exact
-- rather than a guess; MQTT 5 is opt-in from the form, never switched on by
-- an upgrade, since a broker that only speaks 3.1.1 refuses a v5 CONNECT.
ALTER TABLE broker_connections ADD COLUMN protocol_version TEXT NOT NULL DEFAULT 'v311';
