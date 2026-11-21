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
    hash.update('\n');
  }
  return hash.digest('hex');
}

function getPrimaryKeyColumns(columns) {
  return columns
    .filter(column => Number(column.pk) > 0)
    .sort((left, right) => Number(left.pk) - Number(right.pk))
    .map(column => column.name);
}

function getAutoIncrementState(source) {
  const tables = source.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND sql LIKE '%AUTOINCREMENT%'
    ORDER BY name
  `).all().map(row => row.name);

  const sequences = source.prepare(
    'SELECT name, seq FROM sqlite_sequence ORDER BY name'
  ).all();

  const allowed = new Set(tables);
  const state = sequences.map(row => {
    if (!allowed.has(row.name)) {
      throw new Error(`SQLite sequence references an unexpected table: ${row.name}`);
    }
    const sequence = Number(row.seq);
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      throw new Error(`SQLite sequence for ${row.name} is not a safe non-negative integer.`);
    }
    return { name: row.name, seq: sequence };
  });

  return { tables, sequences: state };
}

async function restoreAutoIncrementState(target, state) {
  const targetTables = await target.execute(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND sql LIKE '%AUTOINCREMENT%'
    ORDER BY name
  `);
  const names = targetTables.rows.map(row => row.name);
  if (JSON.stringify(names) !== JSON.stringify(state.tables)) {
    throw new Error(
      `AUTOINCREMENT table inventory mismatch: source=[${state.tables.join(', ')}], target=[${names.join(', ')}].`
    );
  }

  const tx = await target.transaction('write');
  try {
    for (const table of names) {
      await tx.execute({
        sql: 'DELETE FROM sqlite_sequence WHERE name = ?',
        args: [table]
      });
    }
    for (const row of state.sequences) {
      await tx.execute({
        sql: 'INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)',
        args: [row.name, row.seq]
      });
    }
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }

  const actual = await target.execute(
    'SELECT name, seq FROM sqlite_sequence ORDER BY name'
  );
  const actualState = actual.rows.map(row => ({
    name: row.name,
    seq: Number(row.seq)
  }));
  if (JSON.stringify(actualState) !== JSON.stringify(state.sequences)) {
    throw new Error('AUTOINCREMENT sequence verification failed after migration.');
  }
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

    const foreignKeyViolations = source.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeyViolations.length > 0) {
      throw new Error(
        `Source SQLite database contains ${foreignKeyViolations.length} foreign-key violation(s). Refusing to transfer inconsistent data.`
      );
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

    const autoIncrementState = getAutoIncrementState(source);
    const unexpectedAutoIncrementTables = autoIncrementState.tables.filter(
      table => !TABLES_IN_INSERT_ORDER.includes(table)
    );
    if (unexpectedAutoIncrementTables.length > 0) {
      throw new Error(
        `Source SQLite contains unrecognized AUTOINCREMENT tables: ${unexpectedAutoIncrementTables.join(', ')}.`
      );
    }

    const unexpectedTables = [...sourceTables].filter(
      table => !TABLES_IN_INSERT_ORDER.includes(table)
    );
    if (unexpectedTables.length) {
      throw new Error(
        `Source SQLite database contains unrecognized tables: ${unexpectedTables.join(', ')}. Review and explicitly account for this data before transferring.`
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

    const defaultHonorIcons = [
      'assets/honors/Conversion ward.png',
      'assets/honors/Crux Terminatus.png',
      'assets/honors/Fang Necklace.png',
      'assets/honors/Gem.png',
      'assets/honors/Rune.png',
      null, null, null, null, null
    ];
    const targetHonorResult = await target.execute(
      'SELECT honor_id, display_name, display_order, icon_path FROM honors ORDER BY display_order'
    );
    const targetHonorsAreCleanSeed = targetHonorResult.rows.length === seededHonorIds.length &&
      targetHonorResult.rows.every((row, index) =>
        row.honor_id === seededHonorIds[index] &&
        row.display_name === `Honor ${index + 1}` &&
        Number(row.display_order) === index + 1 &&
        (row.icon_path ?? null) === defaultHonorIcons[index]
      );
    if (!targetHonorsAreCleanSeed) {
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
        // The target contains only the ten clean schema seeds and the
        // honor_awards table was preflighted empty. Replace the seed rows in
        // one transaction so custom UNIQUE display_order values cannot collide
        // with other seed rows during sequential upserts.
        const tx = await target.transaction('write');
        try {
          await tx.execute('DELETE FROM honors');
          for (const row of sourceRows) {
            const columns = Object.keys(row);
            const names = columns.map(quoteIdentifier).join(', ');
            const placeholders = columns.map(() => '?').join(', ');
            await tx.execute({
              sql: `INSERT INTO honors (${names}) VALUES (${placeholders})`,
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

    await restoreAutoIncrementState(target, autoIncrementState);
    source.exec('COMMIT');
    console.log('SQLite to Turso transfer completed, including AUTOINCREMENT sequence state. Verify key records before switching the bot.');
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
  getAutoIncrementState,
  restoreAutoIncrementState,
  verifyTransferredTable,
  TABLES_IN_INSERT_ORDER
};
