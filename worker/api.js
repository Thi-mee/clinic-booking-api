import { HttpError, json, readJsonObject } from './http.js';
import { createRepository } from './repository.js';
import { fingerprintBody, isAuthorized } from './security.js';
import {
  normalizeBooking,
  parseBookingId,
  parseBookingPage,
  validateIdempotencyKey,
  validateSlots,
} from './validation.js';

async function route(request, url, repository) {
  const { pathname: path, searchParams } = url;
  const { method } = request;

  if (path === '/reset' && method === 'POST') {
    const body = await readJsonObject(request);
    await repository.replaceSlots(validateSlots(body.slots));
    return json({ ok: true });
  }

  if (path === '/slots' && method === 'GET') {
    return json({ slots: await repository.listSlots(searchParams.get('provider')) });
  }

  if (path === '/bookings' && method === 'POST') {
    const body = await readJsonObject(request);
    const key = validateIdempotencyKey(request.headers.get('Idempotency-Key'));
    const fingerprint = await fingerprintBody(body);
    const result = await repository.createBooking(normalizeBooking(body), {
      key,
      fingerprint,
    });
    return json(result.body, result.status, result.headers);
  }

  if (path === '/bookings' && method === 'GET') {
    return json(await repository.listBookings(parseBookingPage(searchParams)));
  }

  const bookingPath = path.match(/^\/bookings\/([^/]+)$/);
  if (bookingPath && (method === 'GET' || method === 'DELETE')) {
    const id = parseBookingId(bookingPath[1]);
    if (method === 'GET') {
      const booking = await repository.findBooking(id);
      if (!booking) throw new HttpError(404, 'booking not found');
      return json(booking);
    }
    const { booking, exists } = await repository.cancelBooking(id);
    if (booking) return json(booking);
    throw new HttpError(
      exists ? 409 : 404,
      exists ? 'already cancelled' : 'booking not found',
    );
  }

  throw new HttpError(404, 'endpoint not found');
}

export async function api(request, env) {
  try {
    if (!(await isAuthorized(request, env.API_KEY))) {
      throw new HttpError(401, 'unauthorized');
    }
    return await route(request, new URL(request.url), createRepository(env.DB));
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error('API request failed', error.message);
    return json({ error: 'internal server error' }, 500);
  }
}
