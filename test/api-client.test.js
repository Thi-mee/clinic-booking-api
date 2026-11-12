import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiClient } from '../web/api-client.js';

test('browser API client authenticates requests and preserves retry keys', async (context) => {
  const requests = [];
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return Response.json({ id: 'booking' }, { status: 201 });
  });
  const client = createApiClient('https://api.example');
  client.setKey('private-key');
  const body = JSON.stringify({ slot_id: 'slot' });
  await client.book(body, 'retry-key');
  await client.book(body, 'retry-key');
  assert.equal(requests[0].url, 'https://api.example/bookings');
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(requests[0].options.headers['X-API-Key'], 'private-key');
  assert.equal(requests[0].options.headers['Idempotency-Key'], 'retry-key');
  assert.equal(requests[0].options.body, body);
});

test('browser API client exposes rate-limit feedback and encodes query values', async (context) => {
  context.mock.method(globalThis, 'fetch', async (url) => {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('email'), 'ada+clinic@example.com');
    assert.equal(parsed.searchParams.get('cursor'), 'cursor+/=');
    return Response.json(
      { error: 'too many booking attempts' },
      {
        status: 429,
        headers: { 'Retry-After': '42' },
      },
    );
  });
  const client = createApiClient('https://api.example');
  await assert.rejects(
    client.listBookings('ada+clinic@example.com', 'cursor+/='),
    /too many booking attempts.*42 seconds/,
  );
});
