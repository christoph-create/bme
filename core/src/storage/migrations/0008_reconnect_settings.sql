-- Auto-reconnect is opt-out: existing connections get it switched on, since
-- silently recovering from a dropped session is what you want by default.
-- Turning it off is for broker development, where you sometimes *want* to
-- watch the connection die.
ALTER TABLE broker_connections ADD COLUMN auto_reconnect INTEGER NOT NULL DEFAULT 1;
ALTER TABLE broker_connections ADD COLUMN max_reconnect_attempts INTEGER NOT NULL DEFAULT 10;
