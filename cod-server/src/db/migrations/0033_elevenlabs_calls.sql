CREATE TABLE IF NOT EXISTS elevenlabs_calls (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT REFERENCES orders(id) ON DELETE CASCADE,
  provider_call_id TEXT,
  event_id TEXT UNIQUE,
  conversation_id TEXT,
  outcome TEXT,
  status TEXT NOT NULL,
  raw_payload TEXT,
  reason TEXT,
  created_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE INDEX IF NOT EXISTS elevenlabs_calls_order_id_idx
  ON elevenlabs_calls(order_id);

CREATE UNIQUE INDEX IF NOT EXISTS elevenlabs_calls_request_order_unique
  ON elevenlabs_calls(order_id)
  WHERE status IN ('requested', 'in_progress', 'started', 'provider_ambiguous');
