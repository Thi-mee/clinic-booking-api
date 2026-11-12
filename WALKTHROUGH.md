# Loom walkthrough (about four minutes)

1. 0:00–0:50: Open the deployed page, enter the API key, filter providers, select a slot, enter fictional patient details, confirm, and show the booking reference.
2. 0:50–1:20: Refresh and reconnect. Find bookings by email, look up the reference, cancel it, and show the slot is available again.
3. 1:20–2:20: Show openapi.json and worker/api.js: authentication, validation, endpoints, and the required authenticated reset.
4. 2:20–3:20: Show drizzle/0000_clinic.sql and the partial unique index; explain the atomic booking batch, persisted idempotency response, database rate limit, and cursor pagination.
5. 3:20–4:15: Run npm test, highlighting concurrency and retry tests. Show GitHub and the HTTPS URL; explain hosted secrets and D1 persistence.

Use fictional details. Record and upload through Loom, then paste its share link into the submission. Keep the service running and do not change code/configuration after submission until contacted.
