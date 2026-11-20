'use strict';

// One-time, explicit legacy SQLite -> Turso data transfer.
// Run only after taking a separate copy of aar-database.db and configuring
// TURSO_DATABASE_URL / TURSO_AUTH_TOKEN. This script refuses to merge into a
// non-empty target so it cannot silently duplicate points or submissions.

require('dotenv').config();
const path = require('node:path');
const crypto = require('node:crypto');
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

function canonicalValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return { type: 'integer', value: value.toString() };
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return {
      type: 'blob',
      value: Buffer.from(
        value instanceof ArrayBuffer ? new Uint8Array(value) : value
      ).toString('base64')
    };
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot verify a non-finite database value.');
    return { type: 'number', value: Object.is(value, -0) ? '-0' : String(value) };
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return { type: typeof value, value };
  }
  throw new Error(`Cannot verify unsupported database value type: ${typeof value}`);
}

function rowsDigest(rows, columns) {
  const hash = crypto.createHash('sha256');
  for (const row of rows) {
    const canonicalRow = columns.map(column => canonicalValue(row[column]));
    hash.update(JSON.stringify(canonicalRow));
    hash.update('\\n');
  }
  return hash.digest('hex');
}

function getPrimaryKeyColumns(columns) {
  return columns
    .filter(column => Number(column.pk) > 0)
    .sort((left, right) => Number(left.pk) - Number(right.pk))
    .map(column => column.name);
}

async function verifyTransferredTable(source, target, table) {
  const quoted = quoteIdentifier(table);
  const sourceColumns = source.prepare(`PRAGMA table_info(${quoted})`).all();
  const targetColumnsResult = await target.execute(`PRAGMA table_info(${quoted})`);
  const targetColumns = targetColumnsResult.rows;

  const sourceNames = sourceColumns.map(column => column.name);
  const targetNames = targetColumns.map(column => column.name);
  if (JSON.stringify(sourceNames) !== JSON.stringify(targetNames)) {
    throw new Error(
      `Column compatibility failed for ${table}: source=[${sourceNames.join(', ')}], target=[${targetNames.join(', ')}].`
    );
  }

  const primaryKey = getPrimaryKeyColumns(sourceColumns);
  if (primaryKey.length === 0) {
    throw new Error(`Cannot deterministically verify ${table}: no primary key was found.`);
  }
  const orderBy = primaryKey.map(quoteIdentifier).join(', ');
  const sourceRows = source.prepare(`SELECT * FROM ${quoted} ORDER BY ${orderBy}`).all();
  const targetRowsResult = await target.execute(
    `SELECT * FROM ${quoted} ORDER BY ${orderBy}`
  );
  const targetRows = targetRowsResult.rows;

  if (sourceRows.length !== targetRows.length) {
    throw new Error(
      `Row-count verification failed for ${table}: source=${sourceRows.length}, target=${targetRows.length}.`
    );
  }

  const sourceDigest = rowsDigest(sourceRows, sourceNames);
  const targetDigest = rowsDigest(targetRows, targetNames);
  if (sourceDigest !== targetDigest) {
    throw new Error(
      `Content verification failed for ${table}: source and target SHA-256 digests differ.`
    );
  }

  console.log(
    `Verified ${sourceRows.length} rows, ${sourceNames.length} columns, and content digest for ${table}.`
  );
}

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

    // Preflight every target table before writing anything. Honors are the
    // only exception because schema initialization intentionally seeds them.
    const seededHonorIds = Array.from({ length: 10 }, (_, index) => `honor_${index + 1}`);
    const sourceHonorIds = source.prepare(
      'SELECT honor_id FROM honors ORDER BY honor_id'
    ).all().map(row => row.honor_id);
    if (
      sourceHonorIds.length !== seededHonorIds.length ||
      seededHonorIds.some(id => !sourceHonorIds.includes(id))
    ) {
      throw new Error(
        'Source honors table does not contain exactly the ten expected permanent Honor IDs.'
      );
    }

    const targetHonorResult = await target.execute(
      'SELECT honor_id FROM honors ORDER BY honor_id'
    );
    const targetHonorIds = targetHonorResult.rows.map(row => row.honor_id);
    if (
      targetHonorIds.length !== seededHonorIds.length ||
      seededHonorIds.some(id => !targetHonorIds.includes(id))
    ) {
      throw new Error(
        'Target honors table is not in its expected clean seeded state. Refusing to merge data.'
      );
    }

    for (const table of TABLES_IN_INSERT_ORDER) {
      if (!sourceTables.has(table)) continue;
      const quotedTable = quoteIdentifier(table);
      const sourceColumns = source.prepare(
        `PRAGMA table_info(${quotedTable})`
      ).all();
      const targetColumnsResult = await target.execute(
        `PRAGMA table_info(${quotedTable})`
      );
      const sourceColumnNames = sourceColumns.map(column => column.name);
      const targetColumnNames = targetColumnsResult.rows.map(column => column.name);
      if (JSON.stringify(sourceColumnNames) !== JSON.stringify(targetColumnNames)) {
        throw new Error(
          `Column compatibility preflight failed for ${table}: source=[${sourceColumnNames.join(', ')}], target=[${targetColumnNames.join(', ')}].`
        );
      }
      if (getPrimaryKeyColumns(sourceColumns).length === 0) {
        throw new Error(`Cannot deterministically verify ${table}: no primary key was found.`);
      }

      if (table === 'honors') continue;
      const targetCount = await target.execute(
        `SELECT COUNT(*) AS count FROM ${quotedTable}`
      );
      if (Number(targetCount.rows[0]?.count || 0) !== 0) {
        throw new Error(
          `Target table ${table} is not empty. Refusing to merge or duplicate records.`
        );
      }
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
        await verifyTransferredTable(source, target, table);
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
      await verifyTransferredTable(source, target, table);
    }

    source.exec('COMMIT');
    console.log('SQLite to Turso transfer completed. Verify key records before switching the bot.');
  } finally {
    if (source) source.close();
    if (databaseReady) await database.closeDatabase();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('SQLite to Turso transfer failed:', error);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  canonicalValue,
  rowsDigest,
  getPrimaryKeyColumns,
  verifyTransferredTable,
  TABLES_IN_INSERT_ORDER
};
