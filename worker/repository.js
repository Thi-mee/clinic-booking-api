import { BOOKING_FIELDS } from './bookings/queries.js';
import { createBooking } from './bookings/create.js';

export function createRepository(db) {
  const query = (sql, ...args) => db.prepare(sql).bind(...args);

  return {
    createBooking: (booking, options) => createBooking(db, booking, options),

    async replaceSlots(slots) {
      await db.batch([
        query('DELETE FROM bookings'),
        query('DELETE FROM slots'),
        query('DELETE FROM idempotency'),
        query('DELETE FROM attempts'),
        ...slots.map((slot) =>
          query(
            'INSERT INTO slots(id, provider, start, end, start_ms) VALUES (?, ?, ?, ?, ?)',
            slot.id,
            slot.provider,
            slot.start,
            slot.end,
            Date.parse(slot.start),
          ),
        ),
      ]);
    },

    async listSlots(provider) {
      const { results } = await query(
        `SELECT s.id, s.provider, s.start, s.end,
          NOT EXISTS (
            SELECT 1 FROM bookings b WHERE b.slot_id = s.id AND b.status = 'confirmed'
          ) AS available
         FROM slots s
         ${provider !== null ? 'WHERE s.provider = ?' : ''}
         ORDER BY s.start_ms, s.id`,
        ...(provider !== null ? [provider] : []),
      ).all();
      return results.map((slot) => ({ ...slot, available: Boolean(slot.available) }));
    },

    findBooking(id) {
      return query(`SELECT ${BOOKING_FIELDS} FROM bookings WHERE id = ?`, id).first();
    },

    async cancelBooking(id) {
      const [updated, existing] = await db.batch([
        query(
          `UPDATE bookings SET status = 'cancelled'
           WHERE id = ? AND status = 'confirmed' RETURNING ${BOOKING_FIELDS}`,
          id,
        ),
        query(`SELECT ${BOOKING_FIELDS} FROM bookings WHERE id = ?`, id),
      ]);
      return { booking: updated.results[0] ?? null, exists: existing.results.length > 0 };
    },

    async listBookings({ email, limit, after }) {
      const { results } = await query(
        `SELECT seq, ${BOOKING_FIELDS} FROM bookings
         WHERE email = ? AND seq > ? ORDER BY seq LIMIT ?`,
        email,
        after,
        limit + 1,
      ).all();
      const page = results.slice(0, limit);
      return {
        bookings: page.map(({ seq, ...booking }) => booking),
        next_cursor:
          results.length > limit
            ? btoa(JSON.stringify({ email, seq: page.at(-1).seq }))
            : null,
      };
    },
  };
}
