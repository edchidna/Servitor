'use strict';

const database = require('./turso-database');

const CORE_SCHEMA_VERSION = 1;

async function tableColumns(tx, tableName) {
  // Table names are internal constants, never user input.
  const result = await tx.execute(`PRAGMA table_info(${tableName})`);
  return new Set(result.rows.map(column => column.name));
}

async function addMissingColumns(tx, tableName, definitions) {
  const existing = await tableColumns(tx, tableName);

  for (const [columnName, definition] of definitions) {
    if (existing.has(columnName)) continue;

    await tx.execute(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`
    );
    existing.add(columnName);
  }
}

async function initializeCoreSchema() {
  await database.withTransaction(async tx => {
    await tx.execute(`
      CREATE TABLE IF NOT EXISTS servitor_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const migration = await tx.execute({
      sql: 'SELECT version FROM servitor_schema_migrations WHERE version = ?',
      args: [CORE_SCHEMA_VERSION]
    });

    if (migration.rows.length > 0) return;

    await tx.execute(`
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        submitter_id TEXT NOT NULL,
        game_mode TEXT NOT NULL,
        report_data TEXT NOT NULL,
        evidence TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'approved', 'rejected')),
        base_points REAL NOT NULL DEFAULT 0,
        bonus_points REAL NOT NULL DEFAULT 0,
        total_points REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reviewed_at TEXT
      )
    `);

    await tx.execute(`
      CREATE TABLE IF NOT EXISTS report_participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        FOREIGN KEY (report_id) REFERENCES reports(id),
        UNIQUE (report_id, user_id)
      )
    `);

    await tx.execute(`
      CREATE TABLE IF NOT EXISTS score_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        points REAL NOT NULL,
        awarded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (report_id) REFERENCES reports(id),
        UNIQUE (report_id, user_id)
      )
    `);

    await tx.execute(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_id INTEGER NOT NULL UNIQUE,
        moderator_id TEXT NOT NULL,
        decision TEXT NOT NULL
          CHECK (decision IN ('approved', 'rejected')),
        reason TEXT,
        reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (report_id) REFERENCES reports(id)
      )
    `);

    await tx.execute(`
      CREATE TABLE IF NOT EXISTS bot_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT NOT NULL
      )
    `);

    await tx.execute(`
      CREATE INDEX IF NOT EXISTS idx_scores_user
      ON score_ledger(user_id)
    `);
    await tx.execute(`
      CREATE INDEX IF NOT EXISTS idx_reports_status
      ON reports(status)
    `);

    await tx.execute(`
      CREATE TABLE IF NOT EXISTS ordeal_submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        submitter_id TEXT NOT NULL,
        challenge_key TEXT NOT NULL,
        challenge_name TEXT NOT NULL,
        game_mode TEXT NOT NULL DEFAULT 'Operations',
        difficulty TEXT NOT NULL DEFAULT 'Absolute',
        reward_role_id TEXT NOT NULL,
        evidence TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'approved', 'rejected')),
        review_message_id TEXT,
        evidence_thread_id TEXT,
        reviewed_by TEXT,
        submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reviewed_at TEXT,
        operation_name TEXT NOT NULL DEFAULT 'Not specified',
        challenge_completers TEXT NOT NULL DEFAULT '[]',
        participants TEXT NOT NULL DEFAULT '[]',
        gene_seed TEXT NOT NULL DEFAULT 'No',
        armoury_data INTEGER NOT NULL DEFAULT 0,
        base_points REAL NOT NULL DEFAULT 5,
        bonus_points REAL NOT NULL DEFAULT 0,
        total_points REAL NOT NULL DEFAULT 0
      )
    `);

    await tx.execute(`
      CREATE TABLE IF NOT EXISTS ordeal_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        submission_id INTEGER NOT NULL,
        moderator_id TEXT NOT NULL,
        decision TEXT NOT NULL
          CHECK (decision IN ('approved', 'rejected')),
        reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (submission_id) REFERENCES ordeal_submissions(id),
        UNIQUE (submission_id)
      )
    `);

    await tx.execute(`
      CREATE INDEX IF NOT EXISTS idx_ordeals_submitter
      ON ordeal_submissions(submitter_id)
    `);
    await tx.execute(`
      CREATE INDEX IF NOT EXISTS idx_ordeals_status
      ON ordeal_submissions(status)
    `);

    await addMissingColumns(tx, 'reports', [
      ['evidence_thread_id', 'TEXT'],
      ['review_message_id', 'TEXT'],
      ['review_update_pending', 'INTEGER NOT NULL DEFAULT 0']
    ]);

    await tx.execute(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_review_message_id
      ON reports(review_message_id)
      WHERE review_message_id IS NOT NULL
    `);

    await addMissingColumns(tx, 'ordeal_submissions', [
      ['game_mode', "TEXT NOT NULL DEFAULT 'Operations'"],
      ['difficulty', "TEXT NOT NULL DEFAULT 'Absolute'"],
      ['evidence_thread_id', 'TEXT'],
      ['operation_name', "TEXT NOT NULL DEFAULT 'Not specified'"],
      ['challenge_completers', "TEXT NOT NULL DEFAULT '[]'"],
      ['participants', "TEXT NOT NULL DEFAULT '[]'"],
      ['gene_seed', "TEXT NOT NULL DEFAULT 'No'"],
      ['armoury_data', 'INTEGER NOT NULL DEFAULT 0'],
      ['base_points', 'REAL NOT NULL DEFAULT 5'],
      ['bonus_points', 'REAL NOT NULL DEFAULT 0'],
      ['total_points', 'REAL NOT NULL DEFAULT 0'],
      ['suspicious_flag', 'INTEGER NOT NULL DEFAULT 0'],
      ['suspicious_details', "TEXT NOT NULL DEFAULT '[]'"],
      ['nco_alert_message_id', 'TEXT']
    ]);

    await tx.execute(`
      UPDATE ordeal_submissions
      SET
        game_mode = CASE
          WHEN game_mode IS NULL OR TRIM(game_mode) = ''
            OR (challenge_key = 'double_trouble' AND game_mode = 'Operations')
          THEN CASE challenge_key
            WHEN 'lone_wolf' THEN 'Operations'
            WHEN 'double_trouble' THEN 'Stratagems'
          END
          ELSE game_mode
        END,
        difficulty = CASE
          WHEN difficulty IS NULL OR TRIM(difficulty) = ''
            OR (challenge_key = 'double_trouble' AND difficulty = 'Absolute')
          THEN CASE challenge_key
            WHEN 'lone_wolf' THEN 'Absolute'
            WHEN 'double_trouble' THEN 'Hard'
          END
          ELSE difficulty
        END
      WHERE challenge_key IN ('lone_wolf', 'double_trouble')
        AND (
          game_mode IS NULL OR TRIM(game_mode) = ''
          OR (challenge_key = 'double_trouble' AND game_mode = 'Operations')
          OR difficulty IS NULL OR TRIM(difficulty) = ''
          OR (challenge_key = 'double_trouble' AND difficulty = 'Absolute')
        )
    `);

    await tx.execute(`
      CREATE TABLE IF NOT EXISTS iron_wolves_tenure (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        assigned_at TEXT NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      )
    `);

    await tx.execute(`
      CREATE TABLE IF NOT EXISTS ordeal_score_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        submission_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        points REAL NOT NULL,
        awarded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (submission_id) REFERENCES ordeal_submissions(id),
        UNIQUE (submission_id, user_id)
      )
    `);
    await tx.execute(`
      CREATE INDEX IF NOT EXISTS idx_ordeal_scores_user
      ON ordeal_score_ledger(user_id)
    `);

    await tx.execute(`
      CREATE TABLE IF NOT EXISTS saga_point_adjustments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('add', 'deduct')),
        requested_points REAL NOT NULL,
        applied_points REAL NOT NULL,
        points_delta REAL NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await tx.execute(`
      CREATE INDEX IF NOT EXISTS idx_saga_adjustments_user
      ON saga_point_adjustments(guild_id, user_id)
    `);

    await tx.execute({
      sql: 'INSERT INTO servitor_schema_migrations (version, name) VALUES (?, ?)',
      args: [CORE_SCHEMA_VERSION, 'core-aar-ordeals-saga-schema']
    });
  });

  console.log(`Core database schema ready (version ${CORE_SCHEMA_VERSION}).`);
}

module.exports = {
  initializeCoreSchema,
  CORE_SCHEMA_VERSION
};
