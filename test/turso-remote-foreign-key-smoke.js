'use strict';

// Destructive only to uniquely named temporary probe tables in the dedicated
// TURSO_TEST_DATABASE_URL database. Never point this at production.
require('dotenv').config();

const assert = require('node:assert/strict');
const database = require('../turso-database');

async function main() {
  const testUrl = process.env.TURSO_TEST_DATABASE_URL;
  const testToken = process.env.TURSO_TEST_AUTH_TOKEN;
  if (!testUrl || !testToken) {
    throw new Error('TURSO_TEST_DATABASE_URL and TURSO_TEST_AUTH_TOKEN are required.');
  }

  process.env.TURSO_DATABASE_URL = testUrl;
  process.env.TURSO_AUTH_TOKEN = testToken;

  const suffix = `${process.pid}_${Date.now()}`;
  const parentTable = `servitor_fk_probe_parent_${suffix}`;
  const childTable = `servitor_fk_probe_child_${suffix}`;
  const quote = name => `"${name}"`;

  await database.initializeDatabase();
  const client = database.getClient();

  try {
    await client.execute(`
      CREATE TABLE ${quote(parentTable)} (
        id INTEGER PRIMARY KEY
      )
    `);
    await client.execute(`
      CREATE TABLE ${quote(childTable)} (
        id INTEGER PRIMARY KEY,
        parent_id INTEGER NOT NULL,
        FOREIGN KEY (parent_id) REFERENCES ${quote(parentTable)}(id)
      )
    `);

    // Force multiple independent execute calls before probing the constraint.
    const initialPragma = await client.execute('PRAGMA foreign_keys');
    assert.equal(Number(initialPragma.rows[0]?.foreign_keys), 1,
      'Foreign keys must be enabled on the remote standalone connection');

    await client.execute('SELECT 1 AS intervening_statement');
    const laterPragma = await client.execute('PRAGMA foreign_keys');
    assert.equal(Number(laterPragma.rows[0]?.foreign_keys), 1,
      'Foreign keys must remain enabled across later standalone statements');

    await assert.rejects(
      client.execute({
        sql: `INSERT INTO ${quote(childTable)} (id, parent_id) VALUES (?, ?)`,
        args: [1, 999999]
      }),
      /FOREIGN KEY/i,
      'Remote standalone writes must reject orphan child rows'
    );

    const tx = await client.transaction('write');
    try {
      const txPragma = await tx.execute('PRAGMA foreign_keys');
      assert.equal(Number(txPragma.rows[0]?.foreign_keys), 1,
        'Foreign keys must be enabled inside remote interactive transactions');

      await assert.rejects(
        tx.execute({
          sql: `INSERT INTO ${quote(childTable)} (id, parent_id) VALUES (?, ?)`,
          args: [2, 999998]
        }),
        /FOREIGN KEY/i,
        'Remote transactional writes must reject orphan child rows'
      );
      await tx.rollback();
    } finally {
      tx.close();
    }

    console.log('Remote Turso foreign-key probe passed.');
  } finally {
    try {
      await client.execute(`DROP TABLE IF EXISTS ${quote(childTable)}`);
      await client.execute(`DROP TABLE IF EXISTS ${quote(parentTable)}`);
    } finally {
      await database.closeDatabase();
    }
  }
}

main().catch(error => {
  console.error('Remote Turso foreign-key probe failed:', error);
  process.exitCode = 1;
});
