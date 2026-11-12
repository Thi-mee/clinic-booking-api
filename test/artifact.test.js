import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import worker from '../dist/server/index.js';
import { database } from '../scripts/lib/sqlite.js';

test('bundled Worker serves the generated page and handles persisted booking requests', async () => {
  const db = database();
  const env = { DB: db, API_KEY: 'artifact-key' };
  const call = (path, method = 'GET', body) =>
    worker.fetch(
      new Request(`https://test.local${path}`, {
        method,
        headers: { 'X-API-Key': env.API_KEY },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      env,
    );
  try {
    const html = await (await call('/')).text();
    assert.equal(
      html,
      await readFile(new URL('../docs/index.html', import.meta.url), 'utf8'),
    );
    assert.ok(!html.includes('CARELINE_SCRIPT'));
    assert.ok(!html.includes('artifact-key'));
    const slots = [
      {
        id: 'artifact',
        provider: 'Dr Ade',
        start: '2099-12-10T09:00:00Z',
        end: '2099-12-10T09:30:00Z',
      },
    ];
    assert.equal((await call('/reset', 'POST', { slots })).status, 200);
    const created = await call('/bookings', 'POST', {
      slot_id: 'artifact',
      name: 'Ada',
      email: 'ada@example.com',
    });
    assert.equal(created.status, 201);
    const booking = await created.json();
    assert.deepEqual(await (await call(`/bookings/${booking.id}`)).json(), booking);
  } finally {
    db.close();
  }
});
