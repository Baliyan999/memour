-- Per-device binding to a single (event, table) pair, with upload counters
-- so we can enforce strict quotas per phone. One guest_devices row per
-- (device_id, event_id). The device_id is a UUID generated client-side
-- and persisted in the browser's localStorage — not perfect (a guest
-- can clear storage to reset), but good enough as a soft anti-abuse and
-- to make sure a single phone can't drift from table to table by
-- re-scanning different QRs.

CREATE TABLE IF NOT EXISTS guest_devices (
  device_id     TEXT        NOT NULL,
  event_id      UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  table_number  INTEGER     NOT NULL CHECK (table_number > 0),
  guest_name    TEXT,
  photo_count   INTEGER     NOT NULL DEFAULT 0 CHECK (photo_count >= 0),
  video_count   INTEGER     NOT NULL DEFAULT 0 CHECK (video_count >= 0),
  voice_count   INTEGER     NOT NULL DEFAULT 0 CHECK (voice_count >= 0),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, event_id)
);

CREATE INDEX IF NOT EXISTS guest_devices_event_idx
  ON guest_devices(event_id);

-- RLS: only the service role touches this table from the guest upload
-- endpoint. No public read/write policies — RLS denies by default.
ALTER TABLE guest_devices ENABLE ROW LEVEL SECURITY;