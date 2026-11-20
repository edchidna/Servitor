'use strict';

// One-time, explicit legacy SQLite -> Turso data transfer.
// Run only after taking a separate copy of aar-database.db and configuring
// TURSO_DATABASE_URL / TURSO_AUTH_TOKEN. This script refuses to merge into a
// non-empty target so it cannot silently duplicate points or submissions.

require('dotenv').config();
const path = require('node:path');
const Database = require('better-sqlite3');
const { createClient } = require('@libsql/client');
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

  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  const target = createClient({
    url,
    ...(url.startsWith('file:') ? {} : { authToken })
  });

  try {
    await target.execute('PRAGMA foreign_keys = ON');
    await target.execute('SELECT 1 AS connected');
    await initializeCoreSchema();
    await initializeTrialSchema();
    await initializeHonorSchema();

    const sourceTables = new Set(
      source.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      `).all().map(row => row.name)
    );

    for (const table of TABLES_IN_INSERT_ORDER) {
      if (!sourceTables.has(table)) continue;
      const quoted = quoteIdentifier(table);
      const sourceRows = source.prepare(`SELECT * FROM ${quoted}`).all();

      if (table === 'honors') {
        // Schema initialization seeds the ten standard rows. Update those
        // rows from SQLite rather than treating the seed as conflicting data.
        for (const row of sourceRows) {
          const columns = Object.keys(row);
          const names = columns.map(quoteIdentifier).join(', ');
          const placeholders = columns.map(() => '?').join(', ');
          const updates = columns
            .filter(column => column !== 'honor_id')
            .map(column => `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`)
            .join(', ');
          await target.execute({
            sql: `INSERT INTO ${quoted} (${names}) VALUES (${placeholders})
                  ON CONFLICT(honor_id) DO UPDATE SET ${updates}`,
            args: columns.map(column => row[column])
          });
        }
        console.log(`Migrated ${sourceRows.length} rows from ${table}.`);
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

      // Chunk the table into bounded batches. A failure aborts this table's
      // transaction; the next run will stop if any rows have already landed.
      const chunkSize = 250;
      for (let offset = 0; offset < statements.length; offset += chunkSize) {
        const chunk = statements.slice(offset, offset + chunkSize);
        const tx = await target.transaction('write');
        try {
          for (const statement of chunk) await tx.execute(statement);
          await tx.commit();
        } catch (error) {
          await tx.rollback();
          throw error;
        } finally {
          tx.close();
        }
      }
      console.log(`Migrated ${sourceRows.length} rows from ${table}.`);
    }

    console.log('SQLite to Turso transfer completed. Verify row counts before switching the bot.');
  } finally {
    source.close();
    target.close();
  }
}

main().catch(error => {
  console.error('SQLite to Turso transfer failed:', error);
  process.exitCode = 1;
});
