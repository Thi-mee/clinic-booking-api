import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { database } from '../scripts/lib/sqlite.js';
let db;
const key = 'test-key';
function call(path, method = 'GET', body, headers = {}) {
  return worker.fetch(
    new Request('https://test.local' + path, {
      method,
      headers: { 'X-API-Key': key, 'Content-Type': 'application/json', ...headers },
      ...(body !== undefined
        ? { body: typeof body === 'string' ? body : JSON.stringify(body) }
        : {}),
    }),
    { DB: db, API_KEY: key },
  );
}
const slot = (id, start = '2099-12-10T09:00:00Z', provider = 'Dr Ade') => ({
  id,
  provider,
  start,
  end: start.replace('09:00', '09:30'),
});
const book = (slot_id = 's1', email = 'ada@example.com', name = 'Ada Obi') => ({
  slot_id,
  email,
  name,
});
beforeEach(async () => {
  db = database();
  assert.equal(
    (
      await call('/reset', 'POST', {
        slots: [
          slot('s2', '2099-12-11T09:00:00Z', 'Dr Obi'),
          slot('s1'),
          slot('past', '2000-01-01T09:00:00Z'),
        ],
      })
    ).status,
    200,
  );
});
afterEach(() => db.close());
test('L1: ordered slots, provider filter, create, lookup and persistent availability', async () => {
  let r = await (await call('/slots')).json();
  assert.deepEqual(
    r.slots.map((s) => s.id),
    ['past', 's1', 's2'],
  );
  assert.equal(r.slots[1].available, true);
  assert.equal((await (await call('/slots?provider=Dr%20Obi')).json()).slots.length, 1);
  const created = await call('/bookings', 'POST', book());
  assert.equal(created.status, 201);
  const b = await created.json();
  assert.equal(b.status, 'confirmed');
  assert.deepEqual(await (await call('/bookings/' + b.id)).json(), b);
  r = await (await call('/slots')).json();
  assert.equal(r.slots.find((s) => s.id === 's1').available, false);
  assert.equal((await call('/bookings/missing')).status, 404);
});
test('L2: all API routes require key; reject invalid fields, unknown and started slots', async () => {
  for (const [path, method] of [
    ['/slots', 'GET'],
    ['/reset', 'POST'],
    ['/bookings', 'POST'],
    ['/bookings', 'GET'],
    ['/bookings/x', 'GET'],
    ['/bookings/x', 'DELETE'],
  ])
    for (const k of ['', 'wrong'])
      assert.equal((await call(path, method, undefined, { 'X-API-Key': k })).status, 401);
  for (const b of [
    {},
    book('s1', 'bad'),
    book('s1', 'a@b.com', '  '),
    book('s1', 42),
    { ...book(), slot_id: null },
  ])
    assert.equal((await call('/bookings', 'POST', b)).status, 400);
  assert.equal(
    (await call('/bookings', 'POST', book('missing', 'missing@example.com'))).status,
    404,
  );
  assert.equal(
    (await call('/bookings', 'POST', book('past', 'past@example.com'))).status,
    400,
  );
  assert.equal((await call('/bookings', 'POST', '{')).status, 400);
  const b = await (
    await call('/bookings', 'POST', book('s1', ' ADA@EXAMPLE.COM ', ' Ada Obi '))
  ).json();
  assert.equal(b.email, 'ada@example.com');
  assert.equal(b.name, 'Ada Obi');
});
test('L3: 40 concurrent requests yield one winner, cancel frees slot, repeated cancel conflicts', async () => {
  const rs = await Promise.all(
    Array.from({ length: 40 }, (_, i) =>
      call('/bookings', 'POST', book('s1', 'race' + i + '@example.com')),
    ),
  );
  assert.equal(rs.filter((r) => r.status === 201).length, 1);
  assert.equal(rs.filter((r) => r.status === 409).length, 39);
  const b = await rs.find((r) => r.status === 201).json();
  assert.equal((await call('/bookings/' + b.id, 'DELETE')).status, 200);
  assert.equal((await call('/bookings/' + b.id, 'DELETE')).status, 409);
  assert.equal((await call('/bookings/nope', 'DELETE')).status, 404);
  assert.equal(
    (await call('/bookings', 'POST', book('s1', 'next@example.com'))).status,
    201,
  );
});
test('L4: concurrent identical retries replay exactly, conflicting body 422, errors replay', async () => {
  const headers = { 'Idempotency-Key': 'same' };
  const rs = await Promise.all(
    Array.from({ length: 20 }, () => call('/bookings', 'POST', book(), headers)),
  );
  assert.ok(rs.every((r) => r.status === 201));
  const bs = await Promise.all(rs.map((r) => r.json()));
  assert.equal(new Set(bs.map((b) => b.id)).size, 1);
  assert.equal((await call('/bookings', 'POST', book('s2'), headers)).status, 422);
  const errs = await Promise.all(
    Array.from({ length: 2 }, () =>
      call('/bookings', 'POST', book('missing', 'err@example.com'), {
        'Idempotency-Key': 'error',
      }),
    ),
  );
  assert.ok(errs.every((r) => r.status === 404));
  assert.equal(
    (await db.prepare('SELECT count(*) AS n FROM bookings').bind().first()).n,
    1,
  );
});
test('L4: stable pagination includes cancelled bookings, ignores email case and validates limits', async () => {
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const r = await call('/bookings', 'POST', book());
    const b = await r.json();
    ids.push(b.id);
    await call('/bookings/' + b.id, 'DELETE');
  }
  const r = await (await call('/bookings?email=ADA%40EXAMPLE.COM&limit=2')).json();
  assert.deepEqual(
    r.bookings.map((b) => b.id),
    ids.slice(0, 2),
  );
  assert.ok(r.next_cursor);
  const next = await (
    await call(
      '/bookings?email=ada%40example.com&limit=2&cursor=' +
        encodeURIComponent(r.next_cursor),
    )
  ).json();
  assert.deepEqual(
    next.bookings.map((b) => b.id),
    ids.slice(2),
  );
  assert.equal(next.next_cursor, null);
  for (const l of ['0', '51', 'abc', '1.5', '-1', ''])
    assert.equal((await call('/bookings?email=ada@example.com&limit=' + l)).status, 400);
  assert.equal((await call('/bookings?email=ada@example.com&cursor=bad')).status, 400);
});
test('L5: failed attempts count, sixth is 429, separate emails and expiry work', async () => {
  for (let i = 0; i < 5; i++)
    assert.equal(
      (await call('/bookings', 'POST', book('missing', ' RATE@example.com '))).status,
      404,
    );
  const r = await call('/bookings', 'POST', book('s1', 'rate@example.com'));
  assert.equal(r.status, 429);
  assert.match(r.headers.get('Retry-After'), /^\d+$/);
  assert.ok(Number(r.headers.get('Retry-After')) >= 1);
  assert.equal(
    (await call('/bookings', 'POST', book('s1', 'other@example.com'))).status,
    201,
  );
  db.prepare('UPDATE attempts SET at=at-61000').bind().run();
  assert.equal(
    (await call('/bookings', 'POST', book('s2', 'rate@example.com'))).status,
    201,
  );
});
test('reset is atomic, clears bookings/counters/idempotency, accepts past slots', async () => {
  await call('/bookings', 'POST', book(), { 'Idempotency-Key': 'resettable' });
  assert.equal(
    (await call('/reset', 'POST', { slots: [slot('dupe'), slot('dupe')] })).status,
    400,
  );
  assert.equal((await (await call('/slots')).json()).slots.length, 3);
  await call('/reset', 'POST', { slots: [slot('old', '2000-01-01T09:00:00Z')] });
  assert.deepEqual(
    (await (await call('/slots')).json()).slots.map((s) => s.id),
    ['old'],
  );
  assert.equal(
    (await (await call('/bookings?email=ada@example.com')).json()).bookings.length,
    0,
  );
});

test('GitHub Pages CORS preflight and authenticated responses', async () => {
  const origin = 'https://thi-mee.github.io';
  const pre = await call('/bookings', 'OPTIONS', undefined, {
    Origin: origin,
    'X-API-Key': '',
  });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), origin);
  const unauth = await call('/slots', 'GET', undefined, {
    Origin: origin,
    'X-API-Key': '',
  });
  assert.equal(unauth.status, 401);
  assert.equal(unauth.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(
    (
      await call('/slots', 'GET', undefined, { Origin: 'https://evil.example' })
    ).headers.get('Access-Control-Allow-Origin'),
    null,
  );
});

test('idempotency fingerprints ignore object key order and retain responses after cancellation', async () => {
  const headers = { 'Idempotency-Key': 'ordered' };
  const created = await call('/bookings', 'POST', book(), headers);
  const booking = await created.json();
  const reordered = { name: 'Ada Obi', email: 'ada@example.com', slot_id: 's1' };
  const replay = await call('/bookings', 'POST', reordered, headers);
  assert.equal(replay.status, 201);
  assert.deepEqual(await replay.json(), booking);
  await call(`/bookings/${booking.id}`, 'DELETE');
  const lateReplay = await call('/bookings', 'POST', reordered, headers);
  assert.equal(lateReplay.status, 201);
  assert.deepEqual(await lateReplay.json(), booking);
  const persisted = await (await call(`/bookings/${booking.id}`)).json();
  assert.equal(persisted.status, 'cancelled');
});

test('JSON validation rejects oversized bodies and non-object payloads', async () => {
  for (const body of ['[]', 'null', '123', '"text"', '{']) {
    const response = await call('/bookings', 'POST', body);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'invalid JSON body' });
  }
  const response = await call('/bookings', 'POST', { name: 'x'.repeat(70_000) });
  assert.equal(response.status, 400);
});

test('concurrent failed attempts enforce the same per-email limit', async () => {
  const responses = await Promise.all(
    Array.from({ length: 20 }, () =>
      call('/bookings', 'POST', book('missing', 'one@example.com')),
    ),
  );
  assert.equal(responses.filter((response) => response.status === 404).length, 5);
  assert.equal(responses.filter((response) => response.status === 429).length, 15);
});

test('database failures are server errors even when their message mentions JSON', async (context) => {
  context.mock.method(console, 'error', () => {});
  const response = await worker.fetch(
    new Request('https://test.local/slots', {
      headers: { 'X-API-Key': key },
    }),
    {
      API_KEY: key,
      DB: {
        prepare() {
          throw new SyntaxError('JSON database failure');
        },
      },
    },
  );
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'internal server error' });
});
