/**
 * Creates the database (if missing) and applies schema.sql.
 * Safe to re-run: every statement is CREATE TABLE IF NOT EXISTS.
 *
 *   npm --workspace server run migrate
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function splitStatements(sql) {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  const { host, port, user, password, database } = env.db;

  // 1. connect without a database so we can create it
  const root = await mysql.createConnection({ host, port, user, password, multipleStatements: false });
  await root.query(
    `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  console.log(`database \`${database}\` ready`);
  await root.end();

  // 2. apply the schema
  const conn = await mysql.createConnection({ host, port, user, password, database });
  const sql = await fs.readFile(path.join(here, 'schema.sql'), 'utf8');
  const statements = splitStatements(sql);

  for (const statement of statements) {
    const name = statement.match(/CREATE TABLE IF NOT EXISTS (\w+)/i)?.[1] ?? statement.slice(0, 40);
    try {
      await conn.query(statement);
      console.log(`  ok  ${name}`);
    } catch (err) {
      console.error(`  FAIL ${name}: ${err.message}`);
      await conn.end();
      process.exit(1);
    }
  }

  // 3. additive column changes
  //
  // schema.sql is CREATE TABLE IF NOT EXISTS, which does nothing for a table
  // that already exists. Columns added after the first release go here and are
  // applied only when missing, so this stays safe to re-run.
  const ADDITIVE_COLUMNS = [
    {
      table: 'resumes',
      column: 'accent',
      definition: `VARCHAR(9) DEFAULT NULL COMMENT 'hex accent override for the chosen template'`,
      after: 'template',
    },
    // Moderation. Existing rows default to 'approved' because everything already
    // in the table was posted by a staff member — only the nightly ingester
    // inserts 'pending', and it does so explicitly.
    {
      table: 'jobs',
      column: 'status',
      definition: `ENUM('pending','approved','rejected') NOT NULL DEFAULT 'approved'
        COMMENT 'sourced jobs wait here until a placement officer approves them'`,
      after: 'active',
    },
    { table: 'jobs', column: 'source_url',  definition: `VARCHAR(500) DEFAULT NULL COMMENT 'the listing this row was built from'`, after: 'status' },
    { table: 'jobs', column: 'ctc_source',  definition: `ENUM('listed','estimated','unknown') NOT NULL DEFAULT 'unknown'
        COMMENT 'was the package published, or inferred from a role band?'`, after: 'max_ctc' },
    { table: 'jobs', column: 'reviewed_by', definition: `BIGINT UNSIGNED DEFAULT NULL`, after: 'source_url' },
    { table: 'jobs', column: 'reviewed_at', definition: `DATETIME DEFAULT NULL`, after: 'reviewed_by' },
    { table: 'jobs', column: 'review_note', definition: `VARCHAR(500) DEFAULT NULL`, after: 'reviewed_at' },
    { table: 'jobs', column: 'ingested_at', definition: `DATETIME DEFAULT NULL`, after: 'review_note' },
    // What the model read out of the description, as opposed to what the
    // regex guessed from the title. Kept separate from the heuristic columns
    // so an officer can see the two disagree.
    { table: 'jobs', column: 'ai_fresher_ok', definition: `TINYINT(1) DEFAULT NULL COMMENT 'model: open to a no-experience candidate'`, after: 'ingested_at' },
    { table: 'jobs', column: 'ai_years_required', definition: `TINYINT UNSIGNED DEFAULT NULL`, after: 'ai_fresher_ok' },
    { table: 'jobs', column: 'ai_core_subjects', definition: `JSON DEFAULT NULL COMMENT 'DSA, OS, DBMS, System Design ...'`, after: 'ai_years_required' },
    { table: 'jobs', column: 'ai_summary', definition: `VARCHAR(255) DEFAULT NULL`, after: 'ai_core_subjects' },
    { table: 'jobs', column: 'ai_confidence', definition: `ENUM('high','medium','low') DEFAULT NULL`, after: 'ai_summary' },
    { table: 'jobs', column: 'ai_checked_at', definition: `DATETIME DEFAULT NULL`, after: 'ai_confidence' },
    // When this student was emailed an invitation to claim their record, so a
    // second send can target only the people who never responded.
    { table: 'student_records', column: 'invited_at', definition: `DATETIME DEFAULT NULL`, after: 'claimed_at' },
    { table: 'student_records', column: 'invite_count', definition: `TINYINT UNSIGNED NOT NULL DEFAULT 0`, after: 'invited_at' },
    // Whether the apply link actually resolves. A sourced posting can be taken
    // down between the sweep and the morning review, and an officer clearing a
    // 200-row queue cannot click every link — so the queue reports it.
    {
      table: 'jobs',
      column: 'link_status',
      definition: `ENUM('unchecked','live','redirect','dead','blocked') NOT NULL DEFAULT 'unchecked'
        COMMENT 'result of the last apply-link check'`,
      after: 'apply_url',
    },
    { table: 'jobs', column: 'link_code', definition: `SMALLINT UNSIGNED DEFAULT NULL COMMENT 'HTTP status from the last check'`, after: 'link_status' },
    { table: 'jobs', column: 'link_checked_at', definition: `DATETIME DEFAULT NULL`, after: 'link_code' },
    { table: 'jobs', column: 'link_final_url', definition: `VARCHAR(500) DEFAULT NULL COMMENT 'where the link ended up after redirects'`, after: 'link_checked_at' },
    // Set when the student has seen the placement cell's record of them and
    // said "yes, that is me". Until then the onboarding flow leads with it.
    {
      table: 'users',
      column: 'record_confirmed_at',
      definition: `DATETIME DEFAULT NULL COMMENT 'student confirmed their imported placement record'`,
      after: 'onboarded',
    },
  ];

  for (const { table, column, definition, after } of ADDITIVE_COLUMNS) {
    const [[exists]] = await conn.query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [database, table, column]
    );
    if (exists.n) continue;

    const [[tableExists]] = await conn.query(
      `SELECT COUNT(*) AS n FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [database, table]
    );
    if (!tableExists.n) continue; // freshly created by schema.sql already

    try {
      await conn.query(
        `ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}${after ? ` AFTER \`${after}\`` : ''}`
      );
      console.log(`  ok  ${table}.${column} added`);
    } catch (err) {
      console.error(`  FAIL ${table}.${column}: ${err.message}`);
      await conn.end();
      process.exit(1);
    }
  }

  const [tables] = await conn.query('SHOW TABLES');
  console.log(`\nmigration complete — ${tables.length} tables in \`${database}\``);
  await conn.end();
}

main().catch((err) => {
  console.error('migration failed:', err.message);
  process.exit(1);
});
