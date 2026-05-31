import { insertSignal, listSignals } from './db.js';
import { checkAndConsume } from './rateLimit.js';
import { withRetry } from './retry.js';

function nowMs() {
  return Date.now();
}

export async function postSignal(req, reply) {
  const idem = req.headers['idempotency-key'] || null;
  const { userId, type, payload } = req.body || {};

  if (!userId || !type || typeof payload === 'undefined') {
    return reply.code(400).send({ error: 'invalid_body' });
  }

  const { ok, remaining, resetMs } = await checkAndConsume(userId, nowMs());
  if (!ok) {
    return reply.code(429).send({ error: 'rate_limited', remaining, resetMs });
  }

  try {
    const now = nowMs();
    const result = await withRetry(() => Promise.resolve(insertSignal(userId, type, payload, idem, now)));
    const status = result.created ? 201 : 200;
    const signal = result.row;
    return reply
      .code(status)
      .send({
        id: signal.id,
        userId: signal.userId,
        type: signal.type,
        payload: signal.payload,
        idempotencyKey: signal.idempotencyKey,
        createdAt: signal.createdAt,
      });
  } catch (error) {
    req.log.error({ err: error, ctx: 'postSignal' });
    return reply.code(503).send({ error: 'db_unavailable' });
  }
}

export async function getSignals(req, reply) {
  const { userId, limit = 20 } = req.query || {};
  if (!userId) {
    return reply.code(400).send({ error: 'missing_userId' });
  }

  const lim = Math.min(Number(limit) || 20, 100);
  try {
    const rows = await withRetry(() => Promise.resolve(listSignals(userId, lim)));
    return { items: rows };
  } catch (error) {
    req.log.error({ err: error, ctx: 'getSignals' });
    return reply.code(503).send({ error: 'db_unavailable' });
  }
}
