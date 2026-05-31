/**
 retry.js — Exponential backoff with full jitter.
 Retry transient DB failures safely. Idempotent signal writes are backed by
 a DB-level unique constraint, so retries cannot create duplicate rows.
 */

const RETRYABLE_PG_CODES = new Set([
  '40001', // serialization failure
  '40P01', // deadlock detected
  '08000', // connection exception
  '08003', // connection does not exist
  '08006', // connection failure
  '08001', // sqlclient unable to establish sqlconnection
  '57P01', // admin shutdown
  '57P02', // crash shutdown
  '57P03', // cannot connect now
]);

const RETRYABLE_NODE_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'SQLITE_BUSY',
  'SQLITE_LOCKED',
]);

function isRetryable(err) {
  if (!err) return false;
  if (RETRYABLE_NODE_CODES.has(err.code)) return true;
  if (err.code && RETRYABLE_PG_CODES.has(err.code)) return true;
  if (/transient|reset|timeout|busy|locked/i.test(err.message)) return true;
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry(fn, { maxAttempts = 4, baseDelayMs = 100 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts || !isRetryable(err)) {
        throw err;
      }

      const cap = baseDelayMs * 2 ** (attempt - 1);
      const delay = Math.random() * cap;
      await sleep(delay);
    }
  }
  throw lastError;
}
