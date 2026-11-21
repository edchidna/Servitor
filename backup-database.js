'use strict';

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const database = require('./turso-database');

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => {
    if (typeof item === 'bigint') return item.toString();

    // libSQL may return BLOBs as Uint8Array rather than Node Buffers.
    // Preserve the exact bytes in a portable JSON representation.
    if (Buffer.isBuffer(item)) return item.toJSON();
    if (ArrayBuffer.isView(item)) {
      return {
        type: 'Buffer',
        data: Array.from(
          new Uint8Array(item.buffer, item.byteOffset, item.byteLength)
        )
      };
    }
    if (item instanceof ArrayBuffer) {
      return { type: 'Buffer', data: Array.from(new Uint8Array(item)) };
    }

    return item;
  }));
}

async function backupDatabase() {
  await database.initializeDatabase();

  try {
    const client = database.getClient();
    const tx = await client.transaction('read');
    let committed = false;
    let tables;
    let autoIncrementTableNames;
    let sequences;

    try {
      const tablesResult = await tx.execute(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `);

      tables = {};
      for (const row of tablesResult.rows) {
        const tableName = row.name;
        // Names come from sqlite_master, but still quote defensively.
        const quotedName = `"${String(tableName).replace(/"/g, '""')}"`;
        const result = await tx.execute(`SELECT * FROM ${quotedName}`);
        tables[tableName] = jsonSafe(result.rows);
      }

      const autoIncrementTables = await tx.execute(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND sql LIKE '%AUTOINCREMENT%'
        ORDER BY name
      `);
      const autoIncrementSequences = await tx.execute(
        'SELECT name, seq FROM sqlite_sequence ORDER BY name'
      );
      autoIncrementTableNames = autoIncrementTables.rows.map(row => row.name);
      const allowedAutoIncrementTables = new Set(autoIncrementTableNames);
      sequences = autoIncrementSequences.rows.map(row => {
        const sequence = Number(row.seq);
        if (!allowedAutoIncrementTables.has(row.name) ||
            !Number.isSafeInteger(sequence) || sequence < 0) {
          throw new Error('Database contains invalid AUTOINCREMENT sequence metadata.');
        }
        return { name: row.name, seq: sequence };
      });

      await tx.commit();
      committed = true;
    } catch (error) {
      if (!committed) await tx.rollback();
      throw error;
    } finally {
      tx.close();
    }

    const backup = {
      format: 'servitor-turso-logical-backup',
      formatVersion: 2,
      createdAt: new Date().toISOString(),
      databaseType: process.env.TURSO_DATABASE_URL.startsWith('file:')
        ? 'local-file'
        : 'remote-turso',
      tables,
      autoIncrementSequences: {
        tables: autoIncrementTableNames,
        sequences
      }
    };

    const backupDirectory = process.env.BACKUP_OUTPUT_DIR
      ? path.resolve(process.env.BACKUP_OUTPUT_DIR)
      : path.join(__dirname, 'backups');
    fs.mkdirSync(backupDirectory, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join(
      backupDirectory,
      `servitor-turso-backup-${timestamp}.json`
    );

    fs.writeFileSync(outputPath, JSON.stringify(backup, null, 2), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    });

    console.log(`Turso logical backup written to ${outputPath}`);
    console.log(`Exported ${Object.keys(tables).length} tables.`);
  } finally {
    await database.closeDatabase();
  }
}

if (require.main === module) {
  backupDatabase().catch(error => {
    console.error('Turso database backup failed:', error);
    process.exitCode = 1;
  });
}

module.exports = { backupDatabase, jsonSafe };
