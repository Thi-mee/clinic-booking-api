CREATE TABLE slots (id TEXT PRIMARY KEY, provider TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, start_ms INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX slots_start ON slots(start_ms, id);
--> statement-breakpoint
CREATE TABLE bookings (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, slot_id TEXT NOT NULL REFERENCES slots(id), name TEXT NOT NULL, email TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('confirmed','cancelled')), created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX one_confirmed_booking_per_slot ON bookings(slot_id) WHERE status = 'confirmed';
--> statement-breakpoint
CREATE INDEX bookings_email_seq ON bookings(email,seq);
--> statement-breakpoint
CREATE TABLE attempts (email TEXT NOT NULL, at INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX attempts_email_time ON attempts(email,at);
--> statement-breakpoint
CREATE INDEX attempts_time ON attempts(at);
--> statement-breakpoint
CREATE TABLE idempotency (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, status INTEGER NOT NULL, body TEXT NOT NULL, retry_after INTEGER);
--> statement-breakpoint
CREATE TABLE jobs (id TEXT PRIMARY KEY, status INTEGER NOT NULL, body TEXT, retry_after INTEGER);
