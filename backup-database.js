'use strict';

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const database = require('./turso-database');

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) =>
    typeof item === 'bigint' ? item.toString() : item
  ));
}

async function backupDatabase() {
  await database.initializeDatabase();

  try {
    const client = database.getClient();
    const tablesResult = await client.execute(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `);

    const tables = {};
    for (const row of tablesResult.rows) {
      const tableName = row.name;
      // Names come from sqlite_master, but still quote defensively.
      const quotedName = `"${String(tableName).replace(/"/g, '""')}"`;
      const result = await client.execute(`SELECT * FROM ${quotedName}`);
      tables[tableName] = jsonSafe(result.rows);
    }

    const backup = {
      format: 'servitor-turso-logical-backup',
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      databaseUrl: process.env.TURSO_DATABASE_URL.startsWith('file:')
        ? process.env.TURSO_DATABASE_URL
        : 'remote-turso',
      tables
    };

    const backupDirectory = path.join(__dirname, 'backups');
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

backupDatabase().catch(error => {
  console.error('Turso database backup failed:', error);
  process.exitCode = 1;
});
