# Signals Challenge (Node.js + Fastify)

A production-leaning ingestion API that handles load, enforces per-user rate limits, and prevents duplicate signals using atomic idempotency.

## Endpoints

- `POST /v1/signals`
  - body: `{ "userId": "string", "type": "string", "payload": "string" }`
  - headers: `X-API-Key` (required), `Idempotency-Key` (optional)
  - behaviors:
    - Rate limit per `userId`: `RATE_LIMIT_PER_MIN` per minute (default `5`)
    - Atomic idempotency when `Idempotency-Key` is present
- `GET /v1/signals?userId=...&limit=...`
- `GET /healthz`

## Getting Started

```bash
npm install
node src/server.js
```

## Environment Variables

- `API_KEY` — required API key for `X-API-Key` (no default)
- `RATE_LIMIT_PER_MIN` — requests per user per minute (default `5`)
- `DB_FAIL_RATE` — simulate transient DB failures (`0` by default)
- `DATABASE_URL` — optional SQLite path or DB connection string (`./data/signals.db` by default)
- `PORT` — server port (default `8080`)

## Implementation Highlights

### Atomic Idempotency

`POST /v1/signals` uses SQLite's `ON CONFLICT(idempotency_key) DO NOTHING` atomic upsert. Repeated requests with the same `Idempotency-Key` return the original signal and never create duplicates.

### Concurrency-Safe Rate Limiting

Rate limiting is implemented in `src/rateLimit.js` with a DB-backed window counter. Updates are applied with a single atomic UPSERT transaction in `rate_limits`, preventing races under burst and parallel requests.

### DB Retry / Backoff

Transient DB failures are retried with exponential backoff and full jitter in `src/retry.js`. The idempotency guard ensures these retries do not create duplicate records.

### Health Check

`GET /healthz` verifies DB connectivity using a lightweight query.

---

## Testing

```bash
npm test
```

The test suite covers:

- concurrent idempotent ingestion
- distinct signal creation without `Idempotency-Key`
- rate limiting and 429 behavior
- auth enforcement
- health endpoint
