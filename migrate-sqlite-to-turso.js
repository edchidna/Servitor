'use strict';

// One-time, explicit legacy SQLite -> Turso data transfer.
// Run only after taking a separate copy of aar-database.db and configuring
// TURSO_DATABASE_URL / TURSO_AUTH_TOKEN. This script refuses to merge into a
// non-empty target so it cannot silently duplicate points or submissions.

require('dotenv').config();
const path = require('node:path');
const Database = require('better-sqlite3');
const database = require('./turso-database');
const { initializeCoreSchema } = require('./core-database-schema');
const {
  initializeTrialSchema,
  initializeHonorSchema
} = require('./feature-database-schemas');

const TABLES_IN_INSERT_ORDER = [
  'reports',
  'report_participants',
  'score_ledger',
  'audit_log',
  'bot_settings',
  'ordeal_submissions',
  'ordeal_audit_log',
  'ordeal_score_ledger',
  'iron_wolves_tenure',
  'saga_point_adjustments',
  'trial_submissions',
  'trial_completers',
  'trial_pack_members',
  'trial_progress',
  'trial_score_ledger',
  'trial_audit_log',
  'honors',
  'honor_awards',
  'honor_settings'
];

function quoteIdentifier(identifier) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

async function main() {
  const sourcePath = process.env.SQLITE_DATABASE_PATH
    ? path.resolve(process.env.SQLITE_DATABASE_PATH)
    : path.join(__dirname, 'aar-database.db');

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error('TURSO_DATABASE_URL is required.');
  if (!url.startsWith('file:') && !authToken) {
    throw new Error('TURSO_AUTH_TOKEN is required for a remote Turso database.');
  }

  let source = null;
  let databaseReady = false;

  try {
    await database.initializeDatabase();
    databaseReady = true;
    const target = database.getClient();
    source = new Database(sourcePath, { readonly: true, fileMustExist: true });
    source.exec('BEGIN'); // Hold one consistent read snapshot for the full export.

    await target.execute('PRAGMA foreign_keys = ON');
    await target.execute('SELECT 1 AS connected');
    await initializeCoreSchema();
    await initializeTrialSchema();
    await initializeHonorSchema();

    const integrity = source.prepare('PRAGMA integrity_check').get();
    if (integrity?.integrity_check !== 'ok') {
      throw new Error(`Source SQLite integrity check failed: ${integrity?.integrity_check || 'no result'}`);
    }

    const sourceTables = new Set(
      source.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      `).all().map(row => row.name)
    );
    const missingTables = TABLES_IN_INSERT_ORDER.filter(table => !sourceTables.has(table));
    if (missingTables.length) {
      throw new Error(
        `Source SQLite database is missing expected tables: ${missingTables.join(', ')}. Review the source schema before transferring.`
      );
    }

    for (const table of TABLES_IN_INSERT_ORDER) {
      if (!sourceTables.has(table)) continue;
      const quoted = quoteIdentifier(table);
      const sourceRows = source.prepare(`SELECT * FROM ${quoted}`).all();

      if (table === 'honors') {
        // Schema initialization seeds the ten standard rows. Update those
        // rows from SQLite rather than treating the seed as conflicting data.
        const tx = await target.transaction('write');
        try {
          for (const row of sourceRows) {
            const columns = Object.keys(row);
            const names = columns.map(quoteIdentifier).join(', ');
            const placeholders = columns.map(() => '?').join(', ');
            const updates = columns
              .filter(column => column !== 'honor_id')
              .map(column => `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`)
              .join(', ');
            await tx.execute({
              sql: `INSERT INTO ${quoted} (${names}) VALUES (${placeholders})
                    ON CONFLICT(honor_id) DO UPDATE SET ${updates}`,
              args: columns.map(column => row[column])
            });
          }
          await tx.commit();
        } catch (error) {
          await tx.rollback();
          throw error;
        } finally {
          tx.close();
        }
        for (const row of sourceRows) {
          const exists = await target.execute({
            sql: 'SELECT 1 FROM honors WHERE honor_id = ?',
            args: [row.honor_id]
          });
          if (!exists.rows.length) {
            throw new Error(`Honor row verification failed for ${row.honor_id}.`);
          }
        }
        console.log(`Verified ${sourceRows.length} Honor rows.`);
        continue;
      }

      const existing = await target.execute(`SELECT COUNT(*) AS count FROM ${quoted}`);
      if (Number(existing.rows[0]?.count || 0) !== 0) {
        throw new Error(
          `Target table ${table} is not empty. Refusing to merge or duplicate records.`
        );
      }

      if (sourceRows.length === 0) {
        console.log(`Skipped empty table ${table}.`);
        continue;
      }

      const columns = Object.keys(sourceRows[0]);
      const names = columns.map(quoteIdentifier).join(', ');
      const placeholders = columns.map(() => '?').join(', ');
      const statements = sourceRows.map(row => ({
        sql: `INSERT INTO ${quoted} (${names}) VALUES (${placeholders})`,
        args: columns.map(column => row[column])
      }));

      // Keep each table atomic: if any row fails, none of that table's rows
      // are committed. Earlier complete tables remain and require target reset
      // before a full retry; this script deliberately never merges partial data.
      const tx = await target.transaction('write');
      try {
        for (const statement of statements) await tx.execute(statement);
        await tx.commit();
      } catch (error) {
        await tx.rollback();
        throw error;
      } finally {
        tx.close();
      }
      const targetCountResult = await target.execute(
        `SELECT COUNT(*) AS count FROM ${quoted}`
      );
      const targetCount = Number(targetCountResult.rows[0]?.count || 0);
      if (targetCount !== sourceRows.length) {
        throw new Error(
          `Row-count verification failed for ${table}: source=${sourceRows.length}, target=${targetCount}.`
        );
      }

      console.log(`Verified ${sourceRows.length} rows from ${table}.`);
    }

    source.exec('COMMIT');
    console.log('SQLite to Turso transfer completed. Verify key records before switching the bot.');
  } finally {
    if (source) source.close();
    if (databaseReady) await database.closeDatabase();
  }
}

main().catch(error => {
  console.error('SQLite to Turso transfer failed:', error);
  process.exitCode = 1;
});
