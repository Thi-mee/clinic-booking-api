import { BOOKING_JSON, CREATE_DECISION } from './queries.js';

const RATE_WINDOW_MS = 60_000;
const MAX_ATTEMPTS_PER_EMAIL = 5;

export async function createBooking(db, booking, { key, fingerprint }) {
  const now = Date.now();
  const bookingId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const query = (sql, ...args) => db.prepare(sql).bind(...args);

  // D1 batches are atomic. Splitting these into separate awaited calls would race
  // across Worker instances, even with a JavaScript lock or an early slot lookup.
  const statements = [
    query('DELETE FROM attempts WHERE at <= ?', now - RATE_WINDOW_MS),
    query(
      `INSERT INTO attempts(email, at)
       SELECT ?, ? WHERE ? <> ''
       AND NOT EXISTS (SELECT 1 FROM idempotency WHERE key = ?)`,
      booking.email,
      now,
      booking.email,
      key,
    ),
    query(
      CREATE_DECISION,
      jobId,
      fingerprint,
      booking.email,
      booking.valid ? 1 : 0,
      now,
      booking.slotId,
      key,
      MAX_ATTEMPTS_PER_EMAIL,
      RATE_WINDOW_MS,
    ),
    query(
      `INSERT INTO bookings(id, slot_id, name, email, status, created_at)
       SELECT ?, ?, ?, ?, 'confirmed', ? FROM jobs
       WHERE id = ? AND status = 201 AND body IS NULL`,
      bookingId,
      booking.slotId,
      booking.name,
      booking.email,
      new Date(now).toISOString(),
      jobId,
    ),
    query(
      `UPDATE jobs SET body = (SELECT ${BOOKING_JSON} FROM bookings WHERE id = ?)
       WHERE id = ? AND body IS NULL`,
      bookingId,
      jobId,
    ),
    query(
      `INSERT INTO idempotency(key, fingerprint, status, body, retry_after)
       SELECT ?, ?, status, body, retry_after FROM jobs
       WHERE id = ? AND ? IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM idempotency WHERE key = ?)`,
      key,
      fingerprint,
      jobId,
      key,
      key,
    ),
  ];
  const responseIndex = statements.length;
  statements.push(
    query('SELECT status, body, retry_after FROM jobs WHERE id = ?', jobId),
    query('DELETE FROM jobs WHERE id = ?', jobId),
  );

  const results = await db.batch(statements);
  const response = results[responseIndex].results[0];
  return {
    status: response.status,
    body: JSON.parse(response.body),
    headers:
      response.status === 429 ? { 'Retry-After': String(response.retry_after) } : {},
  };
}
