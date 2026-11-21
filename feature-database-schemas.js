'use strict';

const database = require('./turso-database');

async function initializeTrialSchema() {
  await database.withTransaction(async tx => {
    await tx.execute(`
      CREATE TABLE IF NOT EXISTS trial_submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        submitter_id TEXT NOT NULL,
        trial_key TEXT NOT NULL
          CHECK (trial_key IN ('trial_1', 'trial_2', 'trial_3')),
        evidence TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'approved', 'rejected')),
        review_message_id TEXT,
        evidence_thread_id TEXT,
        reviewed_by TEXT,
        reviewed_at TEXT,
        review_reason TEXT,
        suspicious_flag INTEGER NOT NULL DEFAULT 0,
        suspicious_details TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await tx.execute(`
      CREATE TABLE IF NOT EXISTS trial_completers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        submission_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        unproven_role_at_submission INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (submission_id) REFERENCES trial_submissions(id),
        UNIQUE (submission_id, user_id)
      )
    `);

    await tx.execute(`
      CREATE TABLE IF NOT EXISTS trial_pack_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        submission_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        unproven_role_at_submission INTEGER NOT NULL DEFAULT 0,
        unproven_role_at_review INTEGER,
        points_awarded REAL NOT NULL DEFAULT 0,
        FOREIGN KEY (submission_id) REFERENCES trial_submissions(id),
        UNIQUE (submission_id, user_id)
      )
    `);

    await tx.execute(`
      CREATE TABLE IF NOT EXISTS trial_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        trial_key TEXT NOT NULL
          CHECK (trial_key IN ('trial_1', 'trial_2', 'trial_3')),
        submission_id INTEGER NOT NULL,
        completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (submission_id) REFERENCES trial_submissions(id),
        UNIQUE (user_id, trial_key)
      )
    `);

    await tx.execute(`
      CREATE TABLE IF NOT EXISTS trial_score_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        submission_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        base_points REAL NOT NULL DEFAULT 2,
        bonus_points REAL NOT NULL DEFAULT 0,
        points REAL NOT NULL DEFAULT 2,
        awarded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (submission_id) REFERENCES trial_submissions(id),
        UNIQUE (submission_id, user_id)
      )
    `);

    await tx.execute(`
      CREATE TABLE IF NOT EXISTS trial_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        submission_id INTEGER NOT NULL UNIQUE,
        reviewer_id TEXT NOT NULL,
        reviewer_name TEXT NOT NULL,
        decision TEXT NOT NULL
          CHECK (decision IN ('approved', 'rejected')),
        progression_awards TEXT NOT NULL DEFAULT '[]',
        points_awards TEXT NOT NULL DEFAULT '[]',
        reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (submission_id) REFERENCES trial_submissions(id)
      )
    `);

    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_trial_submissions_status ON trial_submissions(status)',
      'CREATE INDEX IF NOT EXISTS idx_trial_submissions_submitter ON trial_submissions(submitter_id)',
      'CREATE INDEX IF NOT EXISTS idx_trial_completers_user ON trial_completers(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_trial_pack_members_user ON trial_pack_members(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_trial_progress_user ON trial_progress(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_trial_score_ledger_user ON trial_score_ledger(user_id)'
    ];

    for (const sql of indexes) {
      await tx.execute(sql);
    }
  });

  console.log('Trial database schema ready.');
}

async function initializeHonorSchema() {
  await database.withTransaction(async tx => {
    await tx.execute(`
      CREATE TABLE IF NOT EXISTS honors (
        honor_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        display_order INTEGER NOT NULL UNIQUE,
        icon_path TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await tx.execute(`
      CREATE TABLE IF NOT EXISTS honor_awards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        honor_id TEXT NOT NULL,
        awarded_by TEXT NOT NULL,
        awarded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        is_active INTEGER NOT NULL DEFAULT 1
          CHECK (is_active IN (0, 1)),
        removed_by TEXT,
        removed_at TEXT,
        FOREIGN KEY (honor_id) REFERENCES honors(honor_id)
      )
    `);

    await tx.execute(`
      CREATE TABLE IF NOT EXISTS honor_settings (
        guild_id TEXT PRIMARY KEY,
        layout_mode TEXT NOT NULL DEFAULT 'fixed'
          CHECK (layout_mode IN ('fixed', 'sequential'))
      )
    `);

    const honorColumns = await tx.execute('PRAGMA table_info(honors)');
    if (!honorColumns.rows.some(column => column.name === 'icon_path')) {
      await tx.execute('ALTER TABLE honors ADD COLUMN icon_path TEXT');
    }

    await tx.execute(`
      CREATE INDEX IF NOT EXISTS idx_honor_awards_member
      ON honor_awards(guild_id, user_id)
    `);
    // Repeated active copies of the same Honor are intentionally allowed.
    await tx.execute('DROP INDEX IF EXISTS idx_honor_active_unique');

    const defaultHonors = [
      ['honor_1', 'Conversion Ward', 1],
      ['honor_2', 'Rune', 2],
      ['honor_3', 'Gem', 3],
      ['honor_4', 'Fang Necklace', 4],
      ['honor_5', 'Talisman', 5],
      ['honor_6', 'Crux Terminatus', 6],
      ['honor_7', 'Honor 7', 7],
      ['honor_8', 'Honor 8', 8],
      ['honor_9', 'Honor 9', 9],
      ['honor_10', 'Honor 10', 10]
    ];

    for (const [honorId, displayName, displayOrder] of defaultHonors) {
      await tx.execute({
        sql: `
          INSERT OR IGNORE INTO honors (
            honor_id, display_name, display_order
          ) VALUES (?, ?, ?)
        `,
        args: [honorId, displayName, displayOrder]
      });
      // Replace only the old generic seed labels; preserve user renames.
      await tx.execute({
        sql: 'UPDATE honors SET display_name = ? WHERE honor_id = ? AND display_name = ?',
        args: [displayName, honorId, `Honor ${displayOrder}`]
      });
    }

    const honorIcons = [
      ['honor_1', 'assets/honors/Conversion ward.png'],
      ['honor_2', 'assets/honors/Rune.png'],
      ['honor_3', 'assets/honors/Gem.png'],
      ['honor_4', 'assets/honors/Fang Necklace.png'],
      ['honor_5', 'assets/honors/Talisman.png'],
      ['honor_6', 'assets/honors/Crux Terminatus.png']
    ];

    for (const [honorId, iconPath] of honorIcons) {
      await tx.execute({
        sql: 'UPDATE honors SET icon_path = ? WHERE honor_id = ?',
        args: [iconPath, honorId]
      });
    }
  });

  console.log('Honor database schema ready.');
}

module.exports = {
  initializeTrialSchema,
  initializeHonorSchema
};
