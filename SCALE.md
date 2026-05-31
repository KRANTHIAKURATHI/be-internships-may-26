# Scale Plan (10k RPS)

## Data model and indexes

- `signals` table is indexed by `(user_id, created_at DESC)`, which supports `GET /v1/signals?userId=...&limit=...` efficiently.
- `idempotency_key` is unique, so repeated `POST` requests with the same idempotency key never produce duplicates.
- `rate_limits` table stores one row per `userId` and one active fixed window counter.

## Idempotency across instances

- Use DB-level unique constraint on `idempotency_key`.
- `INSERT ... ON CONFLICT(idempotency_key) DO NOTHING` is atomic and safe under concurrent requests.
- On conflict, the service selects the existing signal and returns it, ensuring identical responses for duplicate requests.
- In a production deployment, this should use a shared relational database such as PostgreSQL rather than a local SQLite file.

## Rate limiting across instances

- Store rate-limit state outside the process in a shared database table or Redis.
- The implementation uses a single atomic UPSERT transaction for each request, avoiding in-memory race conditions.
- A shared store ensures multiple pods see the same counts and bursts are handled correctly.

## Observability

- Emit structured logs for request flow, DB retries, and rate-limit rejections.
- Track metrics such as `requests_total`, `rate_limit_rejected_total`, `db_retries_total`, and `request_duration_ms`.
- Alert on sustained 5xx rates, DB connectivity failures, and rate-limit floods.

## Failure modes and retries

- Transient DB failures are retried with exponential backoff and random jitter.
- The idempotency guard prevents duplicate records even when retries occur.
- If the rate-limit store is unavailable, the service can fail open to avoid cascading outages while still preserving idempotency.
- For full resilience, add circuit-breaker logic around DB access and degrade gracefully when persistence is unavailable.

## 10k RPS design sketch

1. API layer:
   - Deploy stateless Fastify pods behind a load balancer.
   - Use horizontal scaling with autoscaling based on CPU and request rate.
2. Shared persistence:
   - Use PostgreSQL with connection pooling (PgBouncer) or Redis for rate-limit counters.
   - Keep writes fast by using single-row atomic operations and partial indexes.
3. Rate limit store:
   - Redis is ideal for high throughput counters.
   - If using SQL, use a shared `rate_limits` table with atomic UPSERTs.
4. Idempotency store:
   - Persist idempotency keys in the same shared DB as signals.
   - Use a unique index on `idempotency_key` for low-latency conflict detection.
5. Scaling path:
   - Start with 3–5 pods; scale to 30+ pods for 10k RPS.
   - Add read replicas for query-heavy `GET /v1/signals` traffic.
   - If writes become the bottleneck, add an ingest queue and worker pool.
