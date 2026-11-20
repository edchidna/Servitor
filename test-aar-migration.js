const Database = require('better-sqlite3');

const db = new Database('aar-database-migration-test.db');

function snapshot() {
  const tables = [
    'reports',
    'report_participants',
    'score_ledger',
    'audit_log'
  ];

  const result = {};

  for (const table of tables) {
    const exists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(table);

    if (exists) {
      result[table] = db.prepare(
        `SELECT COUNT(*) AS count FROM "${table}"`
      ).get().count;
    }
  }

  return result;
}

function runMigration() {
  const existingReportColumns = db.prepare(
    'PRAGMA table_info(reports)'
  ).all().map(column => column.name);

  if (!existingReportColumns.includes('evidence_thread_id')) {
    db.exec(`
      ALTER TABLE reports
      ADD COLUMN evidence_thread_id TEXT
    `);
  }

  if (!existingReportColumns.includes('review_message_id')) {
    db.exec(`
      ALTER TABLE reports
      ADD COLUMN review_message_id TEXT
    `);
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_review_message_id
    ON reports(review_message_id)
    WHERE review_message_id IS NOT NULL
  `);
}

try {
  const before = snapshot();

  runMigration();
  console.log('First migration: OK');

  runMigration();
  console.log('Second migration: OK');

  const after = snapshot();

  const columns = db.prepare(
    'PRAGMA table_info(reports)'
  ).all().map(column => column.name);

  const index = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'index'
      AND name = 'idx_reports_review_message_id'
  `).get();

  const integrity = db.pragma('integrity_check');

  console.log('Before:', before);
  console.log('After:', after);
  console.log('review_message_id exists:', columns.includes('review_message_id'));
  console.log('Unique index exists:', Boolean(index));
  console.log('Integrity check:', integrity[0].integrity_check);
  console.log(
    'Existing record counts preserved:',
    JSON.stringify(before) === JSON.stringify(after)
  );
} catch (error) {
  console.error('MIGRATION TEST FAILED:', error);
  process.exitCode = 1;
} finally {
  db.close();
}
