import { HttpError } from './http.js';

export const normalizeEmail = (value) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const isNonemptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const isValidEmail = (value) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;

const isTimestamp = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) &&
  Number.isFinite(Date.parse(value));

export function validateSlots(slots) {
  if (!Array.isArray(slots) || slots.length > 1000) {
    throw new HttpError(400, 'slots must be an array with at most 1000 entries');
  }
  const seen = new Set();
  for (const slot of slots) {
    if (
      !slot ||
      !isNonemptyString(slot.id) ||
      !isNonemptyString(slot.provider) ||
      !isTimestamp(slot.start) ||
      !isTimestamp(slot.end) ||
      Date.parse(slot.end) <= Date.parse(slot.start) ||
      seen.has(slot.id)
    ) {
      throw new HttpError(400, 'invalid or duplicate slot');
    }
    seen.add(slot.id);
  }
  return slots;
}

export function normalizeBooking(body) {
  const booking = {
    slotId: typeof body.slot_id === 'string' ? body.slot_id : '',
    name: typeof body.name === 'string' ? body.name.trim() : '',
    email: normalizeEmail(body.email),
  };
  // Validation failures still enter the transaction so failed attempts are counted.
  return {
    ...booking,
    valid:
      isNonemptyString(booking.slotId) &&
      isNonemptyString(booking.name) &&
      isValidEmail(booking.email) &&
      booking.name.length <= 200 &&
      booking.slotId.length <= 200,
  };
}

export function validateIdempotencyKey(key) {
  if (key !== null && (!key.trim() || key.length > 256)) {
    throw new HttpError(400, 'invalid Idempotency-Key');
  }
  return key;
}

export function parseBookingPage(params) {
  const email = normalizeEmail(params.get('email'));
  if (!isValidEmail(email)) throw new HttpError(400, 'valid email is required');

  const rawLimit = params.get('limit') ?? '10';
  const limit = Number(rawLimit);
  if (!/^\d+$/.test(rawLimit) || limit < 1 || limit > 50) {
    throw new HttpError(400, 'limit must be an integer from 1 to 50');
  }

  let after = 0;
  if (params.has('cursor')) {
    try {
      const cursor = JSON.parse(atob(params.get('cursor')));
      if (cursor.email !== email || !Number.isSafeInteger(cursor.seq) || cursor.seq < 1) {
        throw new Error('invalid cursor');
      }
      after = cursor.seq;
    } catch {
      throw new HttpError(400, 'invalid cursor');
    }
  }
  return { email, limit, after };
}

export function parseBookingId(encodedId) {
  try {
    return decodeURIComponent(encodedId);
  } catch {
    throw new HttpError(400, 'invalid booking id');
  }
}
