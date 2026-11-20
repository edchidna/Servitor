'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'servitor-libsql-'));
const databasePath = path.join(tempDirectory, 'servitor-smoke.db');
const remoteTestUrl = process.env.TURSO_TEST_DATABASE_URL;
const remoteTestToken = process.env.TURSO_TEST_AUTH_TOKEN;
const usingRemoteTestDatabase = Boolean(remoteTestUrl);

if (usingRemoteTestDatabase) {
  if (!remoteTestToken) {
    throw new Error('TURSO_TEST_AUTH_TOKEN is required with TURSO_TEST_DATABASE_URL.');
  }
  process.env.TURSO_DATABASE_URL = remoteTestUrl;
  process.env.TURSO_AUTH_TOKEN = remoteTestToken;
} else {
  process.env.TURSO_DATABASE_URL = `file:${databasePath}`;
  delete process.env.TURSO_AUTH_TOKEN;
}

let ownsRemoteTestDatabase = false;
const database = require('../turso-database');
const { initializeCoreSchema } = require('../core-database-schema');
const {
  initializeTrialSchema,
  initializeHonorSchema
} = require('../feature-database-schemas');
const aarDatabase = require('../aar-database-turso');

before(async () => {
  await database.initializeDatabase();

  if (usingRemoteTestDatabase) {
    const existingTables = await database.execute(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    `);
    if (existingTables.rows.length > 0) {
      throw new Error(
        'Remote smoke tests require a dedicated empty Turso database. Refusing to touch existing tables.'
      );
    }
    ownsRemoteTestDatabase = true;
  }

  await initializeCoreSchema();
  await initializeTrialSchema();
  await initializeHonorSchema();
});

after(async () => {
  try {
    if (usingRemoteTestDatabase && ownsRemoteTestDatabase) {
      const tablesInDropOrder = [
        'trial_audit_log',
        'trial_score_ledger',
        'trial_progress',
        'trial_pack_members',
        'trial_completers',
        'honor_awards',
        'honor_settings',
        'ordeal_audit_log',
        'ordeal_score_ledger',
        'report_participants',
        'score_ledger',
        'audit_log',
        'saga_point_adjustments',
        'ordeal_submissions',
        'trial_submissions',
        'honors',
        'bot_settings',
        'iron_wolves_tenure',
        'reports',
        'servitor_schema_migrations'
      ];
      for (const table of tablesInDropOrder) {
        await database.execute(`DROP TABLE IF EXISTS "${table}"`);
      }
    }
  } finally {
    await database.closeDatabase();
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
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


const trialDatabase = require('../trial-database-turso');
const ordealDatabase = require('../ordeal-database-turso');
const sagaDatabase = require('../saga-database-turso');
const honor = require('../honor');

test('Trial approval preserves progression and Pack Member scoring rules', async () => {
  const submissionId = await trialDatabase.createTrialSubmission({
    submitterId: 'trial-smoke-submitter',
    trialKey: 'trial_1',
    evidence: [{ name: 'trial-proof.png' }],
    completers: [
      { user_id: 'trial-smoke-completer', unproven_role_at_submission: false }
    ],
    packMembers: [
      { user_id: 'smoke-member-a', unproven_role_at_submission: false }
    ]
  });

  const pending = await trialDatabase.getTrialSubmission(submissionId);
  assert.equal(pending.status, 'pending');
  assert.equal(pending.completers.length, 1);
  assert.equal(pending.pack_members.length, 1);

  const review = await trialDatabase.reviewTrialSubmission({
    submissionId,
    reviewerId: 'trial-smoke-moderator',
    reviewerName: 'Smoke Moderator',
    decision: 'approved',
    packMemberRoleStatuses: { 'smoke-member-a': false }
  });

  assert.equal(review.decision, 'approved');
  assert.equal(review.progressionAwards[0].awarded, true);
  assert.equal(review.progressionAwards[0].completedTrialCount, 1);
  assert.equal(review.pointsAwards[0].pointsAwarded, 2);

  const progress = await trialDatabase.getMemberTrialProgress('trial-smoke-completer');
  assert.deepEqual(progress.completedTrialKeys, ['trial_1']);
  assert.equal(progress.graduated, false);

  const score = await database.execute({
    sql: 'SELECT points FROM trial_score_ledger WHERE submission_id = ?',
    args: [submissionId]
  });
  assert.equal(Number(score.rows[0].points), 2);

  await assert.rejects(
    trialDatabase.reviewTrialSubmission({
      submissionId,
      reviewerId: 'trial-smoke-moderator',
      reviewerName: 'Smoke Moderator',
      decision: 'approved',
      packMemberRoleStatuses: { 'smoke-member-a': false }
    }),
    /already been reviewed/i
  );
});

test('Ordeal approval remains a separate zero-point challenge and records its audit', async () => {
  const submissionId = await ordealDatabase.createSubmission({
    submitterId: 'ordeal-smoke-submitter',
    challengeKey: 'smoke_challenge',
    challengeName: 'Smoke Challenge',
    gameMode: 'Operations',
    difficulty: 'Absolute',
    rewardRoleId: 'smoke-role-id',
    operationName: 'Smoke Operation',
    completers: ['ordeal-smoke-submitter'],
    participants: ['ordeal-smoke-submitter'],
    geneSeed: 'Yes',
    armouryData: 1,
    suspiciousFlag: 0,
    suspiciousDetails: []
  });

  await ordealDatabase.attachReviewMessage(submissionId, 'ordeal-smoke-review-message');
  await ordealDatabase.saveEvidence(submissionId, [{ name: 'ordeal-proof.png' }]);
  assert.equal(
    (await ordealDatabase.getSubmissionByReviewMessage('ordeal-smoke-review-message')).id,
    submissionId
  );

  const saved = await ordealDatabase.saveDecision(
    submissionId,
    'ordeal-smoke-moderator',
    'approved'
  );
  assert.equal(saved, true);

  const duplicate = await ordealDatabase.saveDecision(
    submissionId,
    'ordeal-smoke-moderator',
    'approved'
  );
  assert.equal(duplicate, false);

  const submission = await ordealDatabase.getSubmissionById(submissionId);
  assert.equal(submission.status, 'approved');

  const audit = await database.execute({
    sql: 'SELECT moderator_id, decision FROM ordeal_audit_log WHERE submission_id = ?',
    args: [submissionId]
  });
  assert.equal(audit.rows[0].moderator_id, 'ordeal-smoke-moderator');
  assert.equal(audit.rows[0].decision, 'approved');

  const ordealPoints = await database.execute({
    sql: 'SELECT COUNT(*) AS count FROM ordeal_score_ledger WHERE submission_id = ?',
    args: [submissionId]
  });
  assert.equal(Number(ordealPoints.rows[0].count), 0);
});

test('Honor award, duplicate protection, removal, and re-award remain consistent', async () => {
  const first = await honor.awardHonor(
    'smoke-guild',
    'smoke-honor-member',
    'honor_1',
    'smoke-moderator'
  );
  assert.equal(first.success, true);

  const duplicate = await honor.awardHonor(
    'smoke-guild',
    'smoke-honor-member',
    'honor_1',
    'smoke-moderator'
  );
  assert.equal(duplicate.success, false);

  const removed = await honor.removeHonor(
    'smoke-guild',
    'smoke-honor-member',
    'honor_1',
    'smoke-moderator'
  );
  assert.equal(removed.success, true);

  const reawarded = await honor.awardHonor(
    'smoke-guild',
    'smoke-honor-member',
    'honor_1',
    'smoke-moderator'
  );
  assert.equal(reawarded.success, true);

  const active = await honor.getMemberHonors('smoke-guild', 'smoke-honor-member');
  assert.equal(active.length, 1);
  assert.equal(active[0].honor_id, 'honor_1');
});

test('Saga point adjustments include approved AAR and Trial points and cap deductions', async () => {
  const balance = await sagaDatabase.getSagaPoints('smoke-guild', 'smoke-member-a');
  assert.equal(balance, 8);

  const deduction = await sagaDatabase.applySagaAdjustment({
    guildId: 'smoke-guild',
    userId: 'smoke-member-a',
    moderatorId: 'smoke-moderator',
    action: 'deduct',
    requestedPoints: 99,
    reason: 'Migration smoke test'
  });

  assert.equal(deduction.currentBalance, 8);
  assert.equal(deduction.appliedPoints, 8);
  assert.equal(deduction.newBalance, 0);

  const finalBalance = await sagaDatabase.getSagaPoints('smoke-guild', 'smoke-member-a');
  assert.equal(finalBalance, 0);
});


test('SQLite migration verification compares columns and complete row content', async () => {
  const BetterSqlite = require('better-sqlite3');
  const { verifyTransferredTable } = require('../migrate-sqlite-to-turso');
  const sourcePath = path.join(tempDirectory, 'migration-digest-source.db');
  const source = new BetterSqlite(sourcePath);
  const table = 'migration_digest_probe';

  try {
    source.exec(`
      CREATE TABLE ${table} (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        amount REAL NOT NULL,
        payload BLOB
      )
    `);
    source.prepare(
      `INSERT INTO ${table} (id, name, amount, payload) VALUES (?, ?, ?, ?)`
    ).run(1, 'alpha', 12.5, Buffer.from([1, 2, 3]));
    source.prepare(
      `INSERT INTO ${table} (id, name, amount, payload) VALUES (?, ?, ?, ?)`
    ).run(2, 'beta', 0.25, Buffer.from([4, 5]));

    await database.execute(`
      CREATE TABLE ${table} (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        amount REAL NOT NULL,
        payload BLOB
      )
    `);
    await database.execute({
      sql: `INSERT INTO ${table} (id, name, amount, payload) VALUES (?, ?, ?, ?)`,
      args: [1, 'alpha', 12.5, new Uint8Array([1, 2, 3])]
    });
    await database.execute({
      sql: `INSERT INTO ${table} (id, name, amount, payload) VALUES (?, ?, ?, ?)`,
      args: [2, 'beta', 0.25, new Uint8Array([4, 5])]
    });

    await verifyTransferredTable(source, database.getClient(), table);

    await database.execute({
      sql: `UPDATE ${table} SET amount = ? WHERE id = ?`,
      args: [99, 2]
    });
    await assert.rejects(
      verifyTransferredTable(source, database.getClient(), table),
      /Content verification failed/i
    );
  } finally {
    source.close();
    await database.execute(`DROP TABLE IF EXISTS ${table}`);
  }
});
