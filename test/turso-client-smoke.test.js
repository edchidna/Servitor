'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'servitor-libsql-'));
const databasePath = path.join(tempDirectory, 'servitor-smoke.db');
process.env.TURSO_DATABASE_URL = `file:${databasePath}`;
delete process.env.TURSO_AUTH_TOKEN;

const database = require('../turso-database');
const { initializeCoreSchema } = require('../core-database-schema');
const {
  initializeTrialSchema,
  initializeHonorSchema
} = require('../feature-database-schemas');
const aarDatabase = require('../aar-database-turso');

before(async () => {
  await database.initializeDatabase();
  await initializeCoreSchema();
  await initializeTrialSchema();
  await initializeHonorSchema();
});

after(async () => {
  await database.closeDatabase();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

test('all core and feature schemas initialize and expose expected tables', async () => {
  const result = await database.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table'"
  );
  const names = new Set(result.rows.map(row => row.name));

  for (const table of [
    'reports',
    'report_participants',
    'score_ledger',
    'audit_log',
    'ordeal_submissions',
    'ordeal_audit_log',
    'ordeal_score_ledger',
    'trial_submissions',
    'trial_completers',
    'trial_pack_members',
    'trial_progress',
    'trial_score_ledger',
    'trial_audit_log',
    'honors',
    'honor_awards',
    'honor_settings',
    'iron_wolves_tenure',
    'saga_point_adjustments'
  ]) {
    assert.ok(names.has(table), `Expected schema table: ${table}`);
  }

  const migrations = await database.execute(
    'SELECT version FROM servitor_schema_migrations'
  );
  assert.ok(migrations.rows.some(row => Number(row.version) === 1));
});

test('foreign-key enforcement is active for standalone and transactional writes', async () => {
  const standalone = await database.execute('PRAGMA foreign_keys');
  assert.equal(Number(standalone.rows[0]?.foreign_keys), 1);

  const tx = await database.getClient().transaction('write');
  try {
    const transactional = await tx.execute('PRAGMA foreign_keys');
    assert.equal(Number(transactional.rows[0]?.foreign_keys), 1);

    await assert.rejects(
      tx.execute({
        sql: 'INSERT INTO report_participants (report_id, user_id) VALUES (?, ?)',
        args: [987654321, 'fk-smoke-test']
      }),
      /FOREIGN KEY/i
    );
    await tx.rollback();
  } finally {
    tx.close();
  }
});

test('AAR creation and approval preserve atomic status, score, and audit behavior', async () => {
  const reportId = await aarDatabase.createAarReport({
    submitterId: 'smoke-submitter',
    gameMode: 'Operations',
    reportData: { operation: 'Smoke Test' },
    basePoints: 5,
    bonusPoints: 1,
    totalPoints: 6,
    participants: ['smoke-member-a', 'smoke-member-b']
  });

  assert.ok(Number.isSafeInteger(reportId) && reportId > 0);

  const created = await aarDatabase.getReportById(reportId, 'pending');
  assert.ok(created);

  const participants = await aarDatabase.getReportParticipants(reportId);
  assert.equal(participants.length, 2);

  const approved = await aarDatabase.saveAarDecision(
    reportId,
    'approved',
    'smoke-moderator',
    participants,
    6
  );
  assert.equal(approved, true);

  const duplicateDecision = await aarDatabase.saveAarDecision(
    reportId,
    'approved',
    'smoke-moderator',
    participants,
    6
  );
  assert.equal(duplicateDecision, false);

  const finalReport = await aarDatabase.getReportById(reportId);
  assert.equal(finalReport.status, 'approved');

  const score = await database.execute({
    sql: 'SELECT COUNT(*) AS count, SUM(points) AS total FROM score_ledger WHERE report_id = ?',
    args: [reportId]
  });
  assert.equal(Number(score.rows[0].count), 2);
  assert.equal(Number(score.rows[0].total), 12);

  const audit = await aarDatabase.getReportAudit(reportId);
  assert.equal(audit.moderator_id, 'smoke-moderator');
  assert.equal(audit.decision, 'approved');
});

test('failed AAR participant insertion rolls back the report and all participants', async () => {
  const beforeCount = await database.execute(
    'SELECT COUNT(*) AS count FROM reports'
  );

  await assert.rejects(
    aarDatabase.createAarReport({
      submitterId: 'smoke-rollback',
      gameMode: 'Operations',
      reportData: { operation: 'Rollback Test' },
      basePoints: 1,
      bonusPoints: 0,
      totalPoints: 1,
      participants: ['duplicate-member', 'duplicate-member']
    }),
    /UNIQUE constraint failed/i
  );

  const afterCount = await database.execute(
    'SELECT COUNT(*) AS count FROM reports'
  );
  assert.equal(
    Number(afterCount.rows[0].count),
    Number(beforeCount.rows[0].count)
  );
});
