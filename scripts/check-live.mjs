import assert from 'node:assert/strict';
const base = process.env.BASE_URL,
  key = process.env.API_KEY;
if (!base || !key) throw Error('BASE_URL and API_KEY required');
const call = (p, m = 'GET', b, h = {}) =>
  fetch(base + p, {
    method: m,
    headers: { 'Content-Type': 'application/json', 'X-API-Key': key, ...h },
    ...(b ? { body: JSON.stringify(b) } : {}),
  });
const slots = Array.from({ length: 12 }, (_, i) => {
  const start = new Date(Date.now() + (i + 2) * 86400000);
  start.setUTCHours(9 + (i % 3), 0, 0, 0);
  return {
    id: 'demo-' + (i + 1),
    provider: i % 2 ? 'Dr Obi' : 'Dr Ade',
    start: start.toISOString(),
    end: new Date(+start + 1800000).toISOString(),
  };
});
const book = (s = 'demo-1', email = 'live@example.com') => ({
  slot_id: s,
  name: ' Demo Patient ',
  email,
});
assert.equal((await call('/reset', 'POST', { slots })).status, 200);
assert.equal((await call('/slots', 'GET', null, { 'X-API-Key': 'wrong' })).status, 401);
assert.equal((await call('/bookings', 'POST', {})).status, 400);
const races = await Promise.all(
  Array.from({ length: 20 }, (_, i) =>
    call('/bookings', 'POST', book('demo-1', 'race' + i + '@example.com')),
  ),
);
assert.equal(races.filter((r) => r.status === 201).length, 1);
assert.equal(races.filter((r) => r.status === 409).length, 19);
const winner = await races.find((r) => r.status === 201).json();
assert.equal((await call('/bookings/' + winner.id)).status, 200);
assert.equal((await call('/bookings/' + winner.id, 'DELETE')).status, 200);
assert.equal((await call('/bookings/' + winner.id, 'DELETE')).status, 409);
const retries = await Promise.all(
  Array.from({ length: 10 }, () =>
    call('/bookings', 'POST', book('demo-2', ' SAME@example.com '), {
      'Idempotency-Key': 'live-replay',
    }),
  ),
);
assert.ok(retries.every((r) => r.status === 201));
const bodies = await Promise.all(retries.map((r) => r.json()));
assert.equal(new Set(bodies.map((b) => b.id)).size, 1);
assert.equal(bodies[0].email, 'same@example.com');
assert.equal(
  (
    await call('/bookings', 'POST', book('demo-3', 'same@example.com'), {
      'Idempotency-Key': 'live-replay',
    })
  ).status,
  422,
);
for (let i = 0; i < 5; i++)
  assert.equal(
    (await call('/bookings', 'POST', book('missing', 'limited@example.com'))).status,
    404,
  );
const limit = await call('/bookings', 'POST', book('demo-3', 'limited@example.com'));
assert.equal(limit.status, 429);
assert.match(limit.headers.get('Retry-After'), /^\d+$/);
for (let i = 3; i <= 5; i++)
  assert.equal(
    (await call('/bookings', 'POST', book('demo-' + i, 'pages@example.com'))).status,
    201,
  );
const first = await (await call('/bookings?email=PAGES@example.com&limit=2')).json();
assert.equal(first.bookings.length, 2);
assert.ok(first.next_cursor);
const last = await (
  await call(
    '/bookings?email=pages@example.com&limit=2&cursor=' +
      encodeURIComponent(first.next_cursor),
  )
).json();
assert.equal(last.bookings.length, 1);
assert.equal(last.next_cursor, null);
assert.equal((await call('/reset', 'POST', { slots })).status, 200);
console.log(
  'Live HTTPS checks passed: authentication, validation, 20-way race, lookup, cancellation, 10-way retry, mismatch, rate limiting, pagination. Seeded 12 demo slots.',
);
