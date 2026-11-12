# Careline clinic booking

Persistent appointment API and responsive booking page implementing Levels 1–5 of the [Koya contract](https://koyaacademy.com/assessment-api). JavaScript Cloudflare Worker, Cloudflare D1 (SQLite), and embedded HTML/CSS/JavaScript. No runtime package dependencies.

API base and web page: https://careline-clinic-booking.tech-growth-8721.chatgpt.site

The API key is supplied privately and is never committed. Exact upstream contract: `openapi.json`. API routes live at `/slots`, `/reset`, `/bookings`, and `/bookings/{id}`.

## Local use

Requires Node.js 22.13+ with node:sqlite (Node 24 recommended).

```sh
npm test
npm run dev
```

Open http://127.0.0.1:5173 and enter `local-demo-key`. Override with the `API_KEY` process environment variable. Local records persist in ignored `local.sqlite`. Seed via the authenticated `/reset` endpoint:

```sh
curl http://127.0.0.1:5173/reset \
  -H 'X-API-Key: local-demo-key' -H 'Content-Type: application/json' \
  --data '{"slots":[{"id":"s1","provider":"Dr Ade","start":"2099-12-10T09:00:00Z","end":"2099-12-10T09:30:00Z"}]}'
```

## HTTP contract

All API requests require `X-API-Key`. The public page requires the visitor to enter the key; it never embeds or stores it. Unauthorized calls return 401. Errors always have `{"error":"message"}`. This assessment demo uses fictional patient details. The shared API key is not production patient authorization; it also permits the destructive assessment reset endpoint as required.

- POST `/reset`: validates the entire replacement before atomically deleting bookings, slots, rate attempts and idempotency records. Accepts past slots; returns 200.
- GET `/slots?provider=...`: exact provider match, earliest start first, availability boolean.
- POST `/bookings`: trims names/emails, lowercases email, validates fields and start time; returns 201/400/404/409/422/429 as specified.
- GET `/bookings/{id}`: persisted booking or 404.
- DELETE `/bookings/{id}`: atomically cancels, frees slot; repeat cancellation is 409.
- GET `/bookings?email=...&limit=10&cursor=...`: case-insensitive email, oldest insertion first, stable cursor pagination, 1–50 limit, null final cursor; cancelled bookings included.

## Reliability

Creation decisions, rate accounting, booking insertion and stored idempotency response run in one atomic D1 batch transaction. Transactions cannot interleave. A partial UNIQUE index on `bookings(slot_id) WHERE status='confirmed'` additionally prevents duplicate confirmed bookings. Cancellation uses a conditional UPDATE RETURNING in an atomic batch. Reset is atomic.

Optional `Idempotency-Key` stores the status, JSON body and retry header with a SHA-256 fingerprint of canonical JSON. Object key order does not affect the fingerprint. Simultaneous identical requests replay the original result, including errors; different bodies return 422. Matching replays are handled before rate limiting to preserve the original response and avoid counting transport retries as new booking attempts. Records last until reset, preventing late retries from duplicating cancelled bookings too.

A database-backed sliding 60-second window allows five new attempts per normalized email, including invalid bookings and unavailable/unknown slots. The sixth returns 429 and integer Retry-After. Counters work across serverless instances; expired attempts are removed transactionally. Matching idempotent replays retain the original result. This implements the spec's per-email limit, not a general defense against clients changing email addresses.

API_KEY is a hosted runtime secret. The hosting manifest binds D1 as DB. Schema-only migrations and migration journal live in `drizzle/` and are applied before Worker publication. Production requests never create schema or use an in-memory store. `npm run build` bundles the Worker and embedded page. The site is public for assessment clients to access with the API key alone.

## Tests

`npm test` exercises actual Worker handlers against real SQLite transactions through a small D1-compatible test adapter: authentication on all routes, validation, field normalization, availability, 40 competing bookings, cancellation/rebooking, 20 concurrent identical retries, error replay, pagination, rate expiry/independent emails, and reset atomicity. `scripts/check-live.mjs` performs destructive pre-submission HTTPS verification and leaves 12 demo slots. Do not rerun reset or change the deployment after submission.

The page uses the API for listing, booking, confirmation, lookup, pagination and cancellation; network retries reuse an idempotency key. It escapes patient text, prevents duplicate form submission, reports server failures and shows appointment times in the visitor's timezone.

See WALKTHROUGH.md for a recording outline under five minutes. The submitter must record and upload the Loom.
