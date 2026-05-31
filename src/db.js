import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = process.env.DATABASE_URL || './data/signals.db';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_created ON signals(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS rate_limits (
  user_id TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
`);

function maybeFail() {
  const rate = Number(process.env.DB_FAIL_RATE || 0);
  if (rate > 0 && Math.random() < rate) {
    const err = new Error('simulated_db_failure');
    err.code = 'SQLITE_BUSY';
    throw err;
  }
}

function normalizeRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    payload: row.payload,
    idempotencyKey: row.idempotencyKey ?? null,
    createdAt: row.createdAt,
  };
}

export function insertSignal(userId, type, payload, idemKey, nowMs) {
  maybeFail();

  const insertStmt = db.prepare(
    `INSERT INTO signals (user_id, type, payload, idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(idempotency_key) DO NOTHING`
  );

  const selectStmt = db.prepare(
    `SELECT id, user_id AS userId, type, payload, idempotency_key AS idempotencyKey, created_at AS createdAt
     FROM signals
     WHERE idempotency_key = ?`
  );

  const tx = db.transaction((userIdParam, typeParam, payloadParam, idemParam, createdAtParam) => {
    const info = insertStmt.run(userIdParam, typeParam, String(payloadParam), idemParam || null, createdAtParam);
    if (info.changes === 1) {
      return {
        created: true,
        row: {
          id: Number(info.lastInsertROWID || info.lastInsertRowid || info.lastInsertID),
          userId: userIdParam,
          type: typeParam,
          payload: String(payloadParam),
          idempotencyKey: idemParam || null,
          createdAt: createdAtParam,
        },
      };
    }
    if (!idemParam) {
      throw new Error('failed_to_insert_signal');
    }
    return { created: false, row: normalizeRow(selectStmt.get(idemParam)) };
  });

  return tx(userId, type, payload, idemKey, nowMs);
}

export function getByIdemKey(idemKey) {
  maybeFail();
  const stmt = db.prepare(
    `SELECT id, user_id AS userId, type, payload, idempotency_key AS idempotencyKey, created_at AS createdAt
     FROM signals WHERE idempotency_key = ?`
  );
  return normalizeRow(stmt.get(idemKey));
}

export function listSignals(userId, limit) {
  maybeFail();
  const stmt = db.prepare(
    `SELECT id, user_id AS userId, type, payload, idempotency_key AS idempotencyKey, created_at AS createdAt
     FROM signals
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`
  );
  return stmt.all(userId, limit).map(normalizeRow);
}

export function consumeRateLimit(userId, nowMs) {
  maybeFail();

  const windowStart = Math.floor(nowMs / 60_000) * 60_000;
  const upsert = db.prepare(
    `INSERT INTO rate_limits (user_id, window_start, count)
     VALUES (?, ?, 1)
     ON CONFLICT(user_id) DO UPDATE SET
       count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END,
       window_start = CASE WHEN window_start = excluded.window_start THEN window_start ELSE excluded.window_start END`
  );
  const select = db.prepare(
    `SELECT window_start AS windowStart, count FROM rate_limits WHERE user_id = ?`
  );

  const tx = db.transaction((userIdParam, windowStartParam) => {
    upsert.run(userIdParam, windowStartParam);
    return select.get(userIdParam);
  });

  return tx(userId, windowStart);
}

export function pingDb() {
  maybeFail();
  const stmt = db.prepare('SELECT 1 AS ok');
  return stmt.get();
}
