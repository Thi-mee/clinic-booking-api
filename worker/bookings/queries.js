export const BOOKING_FIELDS = 'id, slot_id, name, email, status, created_at';

export const BOOKING_JSON = `json_object(
  'id', id,
  'slot_id', slot_id,
  'name', name,
  'email', email,
  'status', status,
  'created_at', created_at
)`;

// Bind inputs once; derive status and body from the same decision. This query must
// stay in the transaction with rate accounting, booking insertion and replay storage.
export const CREATE_DECISION = `
  WITH input(job_id, fingerprint, email, valid, now, slot_id, key, max_attempts, window_ms) AS (
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ), state AS (
    SELECT input.*,
      i.key AS existing_key,
      i.fingerprint AS existing_fingerprint,
      i.status AS existing_status,
      i.body AS existing_body,
      i.retry_after AS existing_retry_after,
      s.id AS existing_slot,
      s.start_ms,
      (SELECT count(*) FROM attempts WHERE email = input.email) AS attempt_count,
      (SELECT min(at) FROM attempts WHERE email = input.email) AS first_attempt,
      EXISTS (
        SELECT 1 FROM bookings
        WHERE slot_id = input.slot_id AND status = 'confirmed'
      ) AS booked
    FROM input
    LEFT JOIN slots s ON s.id = input.slot_id
    LEFT JOIN idempotency i ON i.key = input.key
  ), decision AS (
    SELECT *, CASE
      WHEN existing_key IS NOT NULL AND existing_fingerprint <> fingerprint THEN 422
      WHEN existing_key IS NOT NULL THEN existing_status
      WHEN email <> '' AND attempt_count > max_attempts THEN 429
      WHEN valid = 0 THEN 400
      WHEN existing_slot IS NULL THEN 404
      WHEN start_ms <= now THEN 400
      WHEN booked THEN 409
      ELSE 201
    END AS response_status
    FROM state
  )
  INSERT INTO jobs(id, status, body, retry_after)
  SELECT job_id, response_status,
    CASE
      WHEN existing_key IS NOT NULL AND existing_fingerprint <> fingerprint
        THEN json_object('error', 'Idempotency-Key reused with a different body')
      WHEN existing_key IS NOT NULL THEN existing_body
      WHEN response_status = 429 THEN json_object('error', 'too many booking attempts')
      WHEN valid = 0 THEN json_object('error', 'slot_id, name and a valid email are required')
      WHEN response_status = 404 THEN json_object('error', 'slot not found')
      WHEN response_status = 400 THEN json_object('error', 'slot has already started')
      WHEN response_status = 409 THEN json_object('error', 'slot already booked')
      ELSE NULL
    END,
    CASE
      WHEN existing_key IS NOT NULL THEN existing_retry_after
      WHEN response_status = 429
        THEN max(1, CAST((first_attempt + window_ms - now + 999) / 1000 AS INTEGER))
      ELSE NULL
    END
  FROM decision
`;
