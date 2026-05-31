import { consumeRateLimit } from './db.js';
import { withRetry } from './retry.js';

const RATE = Number(process.env.RATE_LIMIT_PER_MIN || 5);
const WINDOW_MS = 60_000;

export async function checkAndConsume(userId, nowMs = Date.now()) {
  if (!userId) {
    return { ok: false, remaining: 0, resetMs: nowMs + WINDOW_MS };
  }

  try {
    const row = await withRetry(() => Promise.resolve(consumeRateLimit(userId, nowMs)));
    const ok = row.count <= RATE;
    const remaining = Math.max(RATE - row.count, 0);
    const resetMs = row.windowStart + WINDOW_MS;
    return { ok, remaining, resetMs };
  } catch (err) {
    console.error('[rateLimit] DB failure, failing open:', err.message);
    return { ok: true, remaining: RATE, resetMs: nowMs + WINDOW_MS };
  }
}
