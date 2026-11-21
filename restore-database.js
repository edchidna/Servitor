'use strict';

// Restore a Servitor logical JSON backup into a clean Turso/libSQL database.
// This never merges into existing application data.
require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const database = require('./turso-database');
const { initializeCoreSchema, CORE_SCHEMA_VERSION } = require('./core-database-schema');
const {
  initializeTrialSchema,
  initializeHonorSchema
} = require('./feature-database-schemas');
const {
  TABLES_IN_INSERT_ORDER,
  rowsDigest,
  getPrimaryKeyColumns
} = require('./migrate-sqlite-to-turso');

const BACKUP_FORMAT = 'servitor-turso-logical-backup';
const BACKUP_FORMAT_VERSION = 2;
const EXPECTED_MIGRATION_NAME = 'core-aar-ordeals-saga-schema';

function quoteIdentifier(identifier) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function decodeBackupValue(value, column) {
  if (value === null || value === undefined) return null;

  if (
    value &&
    typeof value === 'object' &&
    value.type === 'Buffer' &&
    Array.isArray(value.data) &&
    value.data.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  ) {
    return Uint8Array.from(value.data);
  }

  if (typeof value === 'string' && /INT/i.test(column.type) && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
      throw new Error(
        `Backup contains an integer outside JavaScript's safe range in column ${column.name}; refusing a potentially lossy restore.`
      );
    }
    return parsed;
  }

  if (Array.isArray(value)) {
    return value.map(item => decodeBackupValue(item, { type: 'TEXT', name: column.name }));
  }

  if (value && typeof value === 'object') {
    const decoded = {};
    for (const [key, nested] of Object.entries(value)) {
      decoded[key] = decodeBackupValue(nested, { type: 'TEXT', name: key });
    }
    return decoded;
  }

  return value;
}

function validateAutoIncrementSequences(state) {
  if (!state || !Array.isArray(state.tables) || !Array.isArray(state.sequences)) {
    throw new Error('Backup does not contain valid AUTOINCREMENT sequence metadata.');
  }

  const tableNames = state.tables;
  if (tableNames.some(name =>
    typeof name !== 'string' ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
    !TABLES_IN_INSERT_ORDER.includes(name)
  )) {
    throw new Error('Backup contains an invalid AUTOINCREMENT table name.');
  }
  if (new Set(tableNames).size !== tableNames.length ||
      JSON.stringify([...tableNames].sort()) !== JSON.stringify([...tableNames].sort())) {
    throw new Error('Backup contains duplicate AUTOINCREMENT table names.');
  }

  const allowed = new Set(tableNames);
  const seen = new Set();
  for (const row of state.sequences) {
    if (!row || typeof row.name !== 'string' ||
        !allowed.has(row.name) || seen.has(row.name) ||
        !Number.isSafeInteger(Number(row.seq)) || Number(row.seq) < 0) {
      throw new Error('Backup contains invalid AUTOINCREMENT sequence values.');
    }
    seen.add(row.name);
  }
}

async function restoreAutoIncrementSequences(target, state) {
  validateAutoIncrementSequences(state);

  const targetTables = await target.execute(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND sql LIKE '%AUTOINCREMENT%'
    ORDER BY name
  `);
  const targetNames = targetTables.rows.map(row => row.name);
  if (JSON.stringify(targetNames) !== JSON.stringify([...state.tables].sort())) {
    throw new Error(
      `AUTOINCREMENT table inventory mismatch: backup=[${[...state.tables].sort().join(', ')}], target=[${targetNames.join(', ')}].`
    );
  }

  const tx = await target.transaction('write');
  try {
    for (const name of targetNames) {
      await tx.execute({
        sql: 'DELETE FROM sqlite_sequence WHERE name = ?',
        args: [name]
      });
    }
    for (const row of state.sequences) {
      await tx.execute({
        sql: 'INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)',
        args: [row.name, Number(row.seq)]
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
  const actualRows = actual.rows.map(row => ({
    name: row.name,
    seq: Number(row.seq)
  }));
  const expectedRows = [...state.sequences]
    .map(row => ({ name: row.name, seq: Number(row.seq) }))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (JSON.stringify(actualRows) !== JSON.stringify(expectedRows)) {
    throw new Error('AUTOINCREMENT sequence verification failed after restore.');
  }
}

function validateBackup(backup) {
  if (!backup || backup.format !== BACKUP_FORMAT) {
    throw new Error('Unrecognized Servitor logical backup format.');
  }
  if (backup.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error(`Unsupported backup format version: ${backup.formatVersion}`);
  }
  validateAutoIncrementSequences(backup.autoIncrementSequences);
  if (!backup.tables || typeof backup.tables !== 'object' || Array.isArray(backup.tables)) {
    throw new Error('Backup does not contain a valid tables object.');
  }

  const expectedTables = [...TABLES_IN_INSERT_ORDER, 'servitor_schema_migrations'].sort();
  const actualTables = Object.keys(backup.tables).sort();
  if (JSON.stringify(expectedTables) !== JSON.stringify(actualTables)) {
    throw new Error(
      `Backup table inventory mismatch. Expected [${expectedTables.join(', ')}], received [${actualTables.join(', ')}].`
    );
  }

  for (const table of TABLES_IN_INSERT_ORDER) {
    if (!Array.isArray(backup.tables[table])) {
      throw new Error(`Backup table ${table} is not an array.`);
    }
  }

  const migrations = backup.tables.servitor_schema_migrations;
  if (
    !Array.isArray(migrations) ||
    migrations.length !== 1 ||
    Number(migrations[0]?.version) !== CORE_SCHEMA_VERSION ||
    migrations[0]?.name !== EXPECTED_MIGRATION_NAME
  ) {
    throw new Error('Backup schema migration version does not match this Servitor build.');
  }
}

async function verifyRestoredTable(target, table, backupRows, columns) {
  const names = columns.map(column => column.name);
  const primaryKey = getPrimaryKeyColumns(columns);
  if (primaryKey.length === 0) {
    throw new Error(`Cannot verify restored table ${table}: no primary key exists.`);
  }

  const orderBy = primaryKey.map(quoteIdentifier).join(', ');
  const quoted = quoteIdentifier(table);
  const result = await target.execute(`SELECT * FROM ${quoted} ORDER BY ${orderBy}`);
  if (result.rows.length !== backupRows.length) {
    throw new Error(
      `Restore row-count mismatch for ${table}: backup=${backupRows.length}, target=${result.rows.length}.`
    );
  }

  const sortedBackupRows = [...backupRows].sort((left, right) => {
    for (const columnName of primaryKey) {
      const a = left[columnName];
      const b = right[columnName];
      if (a === b) continue;
      if (a === null || a === undefined) return -1;
      if (b === null || b === undefined) return 1;
      return a < b ? -1 : 1;
    }
    return 0;
  });
  const expectedDigest = rowsDigest(sortedBackupRows, names);
  const actualDigest = rowsDigest(result.rows, names);
  if (expectedDigest !== actualDigest) {
    throw new Error(`Restore content verification failed for ${table}.`);
  }
}

async function restoreDatabase(backupFilePath) {
  const selectedPath = backupFilePath || process.env.BACKUP_FILE;
  if (!selectedPath || typeof selectedPath !== 'string') {
    throw new Error('Set BACKUP_FILE or pass the backup JSON file path as the first argument.');
  }

  const resolvedPath = path.resolve(selectedPath);
  const backup = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  validateBackup(backup);

  await database.initializeDatabase();

  try {
    await initializeCoreSchema();
    await initializeTrialSchema();
    await initializeHonorSchema();

    const target = database.getClient();

    // Preflight all tables before importing a single row.
    const honorIds = Array.from({ length: 10 }, (_, index) => `honor_${index + 1}`);
    const defaultHonorIcons = [
      'assets/honors/Conversion ward.png',
      'assets/honors/Crux Terminatus.png',
      'assets/honors/Fang Necklace.png',
      'assets/honors/Gem.png',
      'assets/honors/Rune.png',
      null, null, null, null, null
    ];
    const targetHonors = await target.execute(
      'SELECT honor_id, display_name, display_order, icon_path FROM honors ORDER BY display_order'
    );
    const targetHonorsAreCleanSeed = targetHonors.rows.length === honorIds.length &&
      targetHonors.rows.every((row, index) =>
        row.honor_id === honorIds[index] &&
        row.display_name === `Honor ${index + 1}` &&
        Number(row.display_order) === index + 1 &&
        (row.icon_path ?? null) === defaultHonorIcons[index]
      );
    if (!targetHonorsAreCleanSeed) {
      throw new Error('Target honors table is not in its expected clean seeded state.');
    }

    for (const table of TABLES_IN_INSERT_ORDER) {
      if (table === 'honors') continue;
      const count = await target.execute(
        `SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`
      );
      if (Number(count.rows[0]?.count || 0) !== 0) {
        throw new Error(`Target table ${table} is not empty. Refusing to merge backup data.`);
      }
    }

    const migrationRows = await target.execute(
      'SELECT version, name FROM servitor_schema_migrations'
    );
    if (
      migrationRows.rows.length !== 1 ||
      Number(migrationRows.rows[0].version) !== CORE_SCHEMA_VERSION ||
      migrationRows.rows[0].name !== EXPECTED_MIGRATION_NAME
    ) {
      throw new Error('Target schema migration metadata is not in the expected clean state.');
    }

    for (const table of TABLES_IN_INSERT_ORDER) {
      const quoted = quoteIdentifier(table);
      const columnResult = await target.execute(`PRAGMA table_info(${quoted})`);
      const columns = columnResult.rows;
      const columnNames = columns.map(column => column.name);
      const backupRows = backup.tables[table];

      for (const row of backupRows) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
          throw new Error(`Backup contains an invalid row in table ${table}.`);
        }
        const rowNames = Object.keys(row);
        if (
          rowNames.length !== columnNames.length ||
          columnNames.some(name => !Object.prototype.hasOwnProperty.call(row, name))
        ) {
          throw new Error(`Backup columns do not match the target schema for table ${table}.`);
        }
      }

      const decodedRows = backupRows.map(row => {
        const decoded = {};
        for (const column of columns) {
          decoded[column.name] = decodeBackupValue(row[column.name], column);
        }
        return decoded;
      });

      if (table === 'honors') {
        const backupHonorIds = decodedRows.map(row => row.honor_id);
        if (
          backupHonorIds.length !== honorIds.length ||
          honorIds.some(id => !backupHonorIds.includes(id))
        ) {
          throw new Error('Backup honors table does not contain exactly the ten permanent Honor IDs.');
        }
      }

      if (decodedRows.length > 0) {
        const names = columnNames.map(quoteIdentifier).join(', ');
        const placeholders = columnNames.map(() => '?').join(', ');
        const tx = await target.transaction('write');
        let committed = false;
        try {
          if (table === 'honors') {
            // The target was preflighted to contain only clean seed rows, and
            // honor_awards is empty. Replace seeds atomically so unique custom
            // display_order values cannot collide during sequential upserts.
            await tx.execute('DELETE FROM honors');
          }
          for (const row of decodedRows) {
            await tx.execute({
              sql: `INSERT INTO ${quoted} (${names}) VALUES (${placeholders})`,
              args: columnNames.map(name => row[name])
            });
          }
          await tx.commit();
          committed = true;
        } catch (error) {
          if (!committed) {
            try {
              await tx.rollback();
            } catch (rollbackError) {
              error.rollbackError = rollbackError;
            }
          }
          throw error;
        } finally {
          tx.close();
        }
      }

      await verifyRestoredTable(target, table, decodedRows, columns);
      console.log(`Restored and verified ${decodedRows.length} rows from ${table}.`);
    }

    await restoreAutoIncrementSequences(target, backup.autoIncrementSequences);
    console.log('Servitor logical backup restore completed and verified, including AUTOINCREMENT sequence state.');
  } finally {
    await database.closeDatabase();
  }
}

if (require.main === module) {
  restoreDatabase(process.argv[2]).catch(error => {
    console.error('Servitor database restore failed:', error);
    process.exitCode = 1;
  });
}

module.exports = {
  restoreDatabase,
  validateBackup,
  decodeBackupValue,
  validateAutoIncrementSequences,
  restoreAutoIncrementSequences,
  verifyRestoredTable
};
