import mysql from 'mysql2/promise';
import { env } from './env.js';

export const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4_unicode_ci',
  // Driver side: read and write DATETIME columns as UTC.
  timezone: 'Z',
  // DATE columns are calendar dates (graduation year, project month) — keeping
  // them as strings stops a timezone shift moving them by a day.
  dateStrings: ['DATE'],
  namedPlaceholders: false,
});

// Server side: make NOW() produce UTC too.
//
// Without this the two halves disagree. MySQL's NOW() returns the server's
// local time (IST here), the driver then parses that string as UTC, and every
// stored timestamp reads back 5h30m in the future — which silently breaks OTP
// expiry, refresh-token expiry and the resend cooldown. Forcing each session to
// UTC keeps writes, reads and NOW() on one clock.
pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+00:00'", (err) => {
    if (err) console.error('[db] could not set session time_zone to UTC:', err.message);
  });
});

/** SELECT helper — always returns an array of rows. */
export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/** SELECT helper for a single row (or null). */
export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] ?? null;
}

/** INSERT/UPDATE/DELETE helper — returns the raw ResultSetHeader. */
export async function execute(sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return result;
}

/** Run `fn` inside a transaction, rolling back on any throw. */
export async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function healthCheck() {
  const [rows] = await pool.query('SELECT 1 AS ok');
  return rows[0]?.ok === 1;
}
