# Careline clinic booking

Persistent appointment API and responsive booking page implementing Levels 1–5 of the [Koya contract](https://koyaacademy.com/assessment-api). JavaScript Cloudflare Worker, Cloudflare D1 (SQLite), and embedded HTML/CSS/JavaScript. No runtime package dependencies.

API base: https://careline-clinic-booking.tech-growth-8721.chatgpt.site

Web page (GitHub Pages): https://thi-mee.github.io/clinic-booking-api/

The API key is supplied privately and is never committed. Exact upstream contract: `openapi.json`. API routes live at `/slots`, `/reset`, `/bookings`, and `/bookings/{id}`.

## Local use

Requires Node.js 22.13+ with node:sqlite (Node 24 recommended).

```sh
npm ci
npm test
npm run dev
```

Open http://127.0.0.1:5173 and enter `local-demo-key`. Override with the `API_KEY` process environment variable. Local records persist in ignored `local.sqlite`. Seed via the authenticated `/reset` endpoint:

```sh
curl http://127.0.0.1:5173/reset \
  -H 'X-API-Key: local-demo-key' -H 'Content-Type: application/json' \
  --data '{"slots":[{"id":"s1","provider":"Dr Ade","start":"2099-12-10T09:00:00Z","end":"2099-12-10T09:30:00Z"}]}'
```

## Code organization

- `worker/api.js`: HTTP routing and response mapping.
- `worker/http.js`, `security.js`, `validation.js`: bounded JSON parsing, typed HTTP errors, authentication, fingerprints, and input validation.
- `worker/repository.js`: persistence operations; `worker/bookings/` keeps the atomic creation transaction and its SQL together.
- `web/`: editable HTML, CSS, browser controller, API client, and DOM utilities.
- `shared/config.js`: API origin and frontend origin shared by browser and Worker builds.
- `scripts/build.mjs`: esbuild bundles browser modules and Worker modules, producing `docs/index.html` and `dist/server/index.js`. `worker/page.js` is generated and ignored; edit `web/` instead.
- `scripts/lib/sqlite.js`: local/test D1 adapter; never included in the hosted Worker.

The repository factory provides the persistence boundary without a class hierarchy. HTTP handlers own protocol concerns; database transactions own decisions that must remain atomic. No process-local cache or lock is used for booking correctness. Queries use bound parameters and indexed access; booking lists use keyset pagination rather than increasing offsets. Adding capacity still depends on database write throughput; this design does not imply unlimited throughput.

Run `npm run format` to format source, and `npm run check` for formatting, contract tests and bundled-artifact validation. Prettier and esbuild are pinned development dependencies only. CI runs the same checks on pushes and pull requests. Builds are required before direct imports of the Worker because the embedded page is generated; `npm test` and `npm run dev` build automatically.

Publish assessment changes only before submission or after the assessor authorizes changes. This refactor is prepared on a separate branch so the submitted API and GitHub Pages deployment stay unchanged until merged and redeployed.

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

API_KEY is a hosted runtime secret. The hosting manifest binds D1 as DB. Schema-only migrations and migration journal live in `drizzle/` and are applied before Worker publication. Production requests never create schema or use an in-memory store. `npm run build` bundles the Worker and embedded page. The API is public for assessment clients to access with the API key alone. The frontend is published from docs/ to GitHub Pages; explicit CORS permits that origin and exposes Retry-After. OPTIONS preflight is allowed for that origin without an API key, while every API operation remains authenticated.

## Tests

`npm test` exercises actual Worker handlers against real SQLite transactions through a small D1-compatible test adapter: authentication on all routes, validation, field normalization, availability, 40 competing bookings, cancellation/rebooking, 20 concurrent identical retries, error replay, pagination, rate expiry/independent emails, and reset atomicity. `scripts/check-live.mjs` performs destructive pre-submission HTTPS verification and leaves 12 demo slots. Do not rerun reset or change the deployment after submission.

The page uses the API for listing, booking, confirmation, lookup, pagination and cancellation; network retries reuse an idempotency key. It escapes patient text, prevents duplicate form submission, reports server failures and shows appointment times in the visitor's timezone.
