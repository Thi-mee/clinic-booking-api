# Loom walkthrough (about four minutes)

1. 0:00–0:50: Open the deployed page, enter the API key, filter providers, select a slot, enter fictional patient details, confirm, and show the booking reference.
2. 0:50–1:20: Refresh and reconnect. Find bookings by email, look up the reference, cancel it, and show the slot is available again.
3. 1:20–2:20: Show openapi.json and worker/api.js: endpoints and HTTP response handling, then security.js and validation.js for authentication and validation.
4. 2:20–3:20: Show drizzle/0000_clinic.sql and the partial unique index; walk through worker/bookings/create.js and queries.js for the atomic batch, persisted idempotency response, and database rate limit. Show worker/repository.js for cursor pagination.
5. 3:20–4:15: Run npm test, highlighting concurrency and retry tests. Show GitHub and the HTTPS URL; explain hosted secrets and D1 persistence.

Use fictional details. Record and upload through Loom, then paste its share link into the submission. Keep the service running and do not change code/configuration after submission until contacted.
