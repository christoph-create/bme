-- Transport becomes a scheme rather than a TLS on/off flag: TLS is a property
-- of how you reach the broker, and ws:// carries a URL path a bool had nowhere
-- to put. Every connection that had TLS switched on was MQTT-over-TLS, so it
-- maps straight onto mqtts; everything else was plain TCP.
ALTER TABLE broker_connections ADD COLUMN scheme TEXT NOT NULL DEFAULT 'mqtt';
UPDATE broker_connections SET scheme = 'mqtts' WHERE use_tls = 1;
ALTER TABLE broker_connections DROP COLUMN use_tls;

-- Certificates are stored as paths rather than contents, so a renewed cert is
-- picked up on the next connect without being re-imported. All nullable: the
-- overwhelmingly common case is a broker with a publicly trusted certificate,
-- which needs none of them.
ALTER TABLE broker_connections ADD COLUMN ws_path TEXT;
ALTER TABLE broker_connections ADD COLUMN ca_cert_path TEXT;
ALTER TABLE broker_connections ADD COLUMN client_cert_path TEXT;
ALTER TABLE broker_connections ADD COLUMN client_key_path TEXT;
ALTER TABLE broker_connections ADD COLUMN alpn TEXT;

-- Off, and deliberately not backfilled from anything: every existing
-- connection was checking its certificate chain, and quietly switching that
-- off on upgrade would be the worst default in the file.
ALTER TABLE broker_connections ADD COLUMN skip_cert_verification INTEGER NOT NULL DEFAULT 0;
