'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const BetterSqlite = require('better-sqlite3');
const { createClient } = require('@libsql/client');
const {
  verifyTransferredTable,
  TABLES_IN_INSERT_ORDER
} = require('../migrate-sqlite-to-turso');
const { jsonSafe } = require('../backup-database');
const { decodeBackupValue } = require('../restore-database');

function createLegacySchema(source) {
  const root = path.join(__dirname, '..');
  for (const filename of ['database.js', 'trial-database.js', 'honor-database.js']) {
    const sourceText = fs.readFileSync(path.join(root, filename), 'utf8');
    const blocks = sourceText.matchAll(/db\.exec\(\s*`([\s\S]*?)`\s*\);/g);
    for (const match of blocks) {
      const sql = match[1];
      if (/CREATE\s+TABLE/i.test(sql) && !sql.includes('${')) {
        source.exec(sql);
      }
    }
  }

  const reportColumns = new Set(
    source.prepare('PRAGMA table_info(reports)').all().map(column => column.name)
  );
  if (!reportColumns.has('evidence_thread_id')) {
    source.exec('ALTER TABLE reports ADD COLUMN evidence_thread_id TEXT');
  }
  if (!reportColumns.has('review_message_id')) {
    source.exec('ALTER TABLE reports ADD COLUMN review_message_id TEXT');
  }
  if (!reportColumns.has('review_update_pending')) {
    source.exec('ALTER TABLE reports ADD COLUMN review_update_pending INTEGER NOT NULL DEFAULT 0');
  }

  const ordealColumns = new Set(
    source.prepare('PRAGMA table_info(ordeal_submissions)').all().map(column => column.name)
  );
  if (!ordealColumns.has('suspicious_flag')) {
    source.exec('ALTER TABLE ordeal_submissions ADD COLUMN suspicious_flag INTEGER NOT NULL DEFAULT 0');
  }
  if (!ordealColumns.has('suspicious_details')) {
    source.exec("ALTER TABLE ordeal_submissions ADD COLUMN suspicious_details TEXT NOT NULL DEFAULT '[]'");
  }
  if (!ordealColumns.has('nco_alert_message_id')) {
    source.exec('ALTER TABLE ordeal_submissions ADD COLUMN nco_alert_message_id TEXT');
  }
}

function seedLegacyRows(source) {
  source.prepare(`
    INSERT INTO reports (
      id, submitter_id, game_mode, report_data, evidence, status,
      base_points, bonus_points, total_points, created_at, reviewed_at,
      evidence_thread_id, review_message_id, review_update_pending
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    101, 'legacy-submitter', 'Operations', '{"operation":"Legacy Test"}', '[]',
    'approved', 5, 1, 6, '2026-01-01 10:00:00', '2026-01-01 10:05:00',
    'legacy-aar-thread', 'legacy-aar-review', 0
  );
  source.prepare(
    'INSERT INTO report_participants (id, report_id, user_id) VALUES (?, ?, ?)'
  ).run(1001, 101, 'legacy-member');
  source.prepare(
    'INSERT INTO score_ledger (id, report_id, user_id, points, awarded_at) VALUES (?, ?, ?, ?, ?)'
  ).run(2001, 101, 'legacy-member', 6, '2026-01-01 10:05:00');
  source.prepare(
    'INSERT INTO audit_log (id, report_id, moderator_id, decision, reason, reviewed_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(3001, 101, 'legacy-mod', 'approved', 'Verified', '2026-01-01 10:05:00');
  source.prepare(
    'INSERT INTO bot_settings (setting_key, setting_value) VALUES (?, ?)'
  ).run('leaderboard_message_id', 'legacy-leaderboard-message');

  source.prepare(`
    INSERT INTO ordeal_submissions (
      id, submitter_id, challenge_key, challenge_name, reward_role_id,
      status, review_message_id, evidence_thread_id, reviewed_by,
      submitted_at, reviewed_at, operation_name, challenge_completers,
      participants, gene_seed, armoury_data, base_points, bonus_points,
      total_points, suspicious_flag, suspicious_details, nco_alert_message_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    401, 'legacy-ordeal-submitter', 'lone_wolf', 'Lone Wolf', 'legacy-reward-role',
    'approved', 'legacy-ordeal-review', 'legacy-ordeal-thread', 'legacy-ordeal-mod',
    '2026-01-02 10:00:00', '2026-01-02 10:05:00', 'Inferno',
    '["legacy-ordeal-submitter"]', '["legacy-ordeal-submitter"]', 'Yes', 2,
    5, 0, 5, 0, '[]', 'legacy-nco-alert'
  );
  source.prepare(
    'INSERT INTO ordeal_audit_log (id, submission_id, moderator_id, decision, reviewed_at) VALUES (?, ?, ?, ?, ?)'
  ).run(402, 401, 'legacy-ordeal-mod', 'approved', '2026-01-02 10:05:00');
  source.prepare(
    'INSERT INTO ordeal_score_ledger (id, submission_id, user_id, points, awarded_at) VALUES (?, ?, ?, ?, ?)'
  ).run(403, 401, 'legacy-ordeal-submitter', 0, '2026-01-02 10:05:00');

  source.prepare(
    'INSERT INTO iron_wolves_tenure (guild_id, user_id, assigned_at) VALUES (?, ?, ?)'
  ).run('legacy-guild', 'legacy-member', '2025-12-01 00:00:00');
  source.prepare(`
    INSERT INTO saga_point_adjustments (
      id, guild_id, user_id, moderator_id, action, requested_points,
      applied_points, points_delta, reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(701, 'legacy-guild', 'legacy-member', 'legacy-mod', 'add', 3, 3, 3, 'Legacy adjustment', '2026-01-03 00:00:00');

  source.prepare(`
    INSERT INTO trial_submissions (
      id, submitter_id, trial_key, evidence, status, review_message_id,
      evidence_thread_id, reviewed_by, reviewed_at, review_reason,
      suspicious_flag, suspicious_details, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    501, 'legacy-trial-submitter', 'trial_1', '[{"name":"trial-proof.png"}]',
    'approved', 'legacy-trial-review', 'legacy-trial-thread', 'legacy-trial-mod',
    '2026-01-04 10:05:00', 'Approved', 0, '[]', '2026-01-04 10:00:00'
  );
  source.prepare(
    'INSERT INTO trial_completers (id, submission_id, user_id, unproven_role_at_submission) VALUES (?, ?, ?, ?)'
  ).run(502, 501, 'legacy-trial-completer', 0);
  source.prepare(
    'INSERT INTO trial_pack_members (id, submission_id, user_id, unproven_role_at_submission, unproven_role_at_review, points_awarded) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(503, 501, 'legacy-member', 0, 0, 2);
  source.prepare(
    'INSERT INTO trial_progress (id, user_id, trial_key, submission_id, completed_at) VALUES (?, ?, ?, ?, ?)'
  ).run(504, 'legacy-trial-completer', 'trial_1', 501, '2026-01-04 10:05:00');
  source.prepare(
    'INSERT INTO trial_score_ledger (id, submission_id, user_id, base_points, bonus_points, points, awarded_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(505, 501, 'legacy-member', 2, 0, 2, '2026-01-04 10:05:00');
  source.prepare(
    'INSERT INTO trial_audit_log (id, submission_id, reviewer_id, reviewer_name, decision, progression_awards, points_awards, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(506, 501, 'legacy-trial-mod', 'Legacy Moderator', 'approved', '[]', '[]', '2026-01-04 10:05:00');

  const honorInsert = source.prepare(
    'INSERT INTO honors (honor_id, display_name, display_order, icon_path) VALUES (?, ?, ?, ?)'
  );
  for (let i = 1; i <= 10; i++) {
    honorInsert.run(
      `honor_${i}`,
      i === 1 ? 'Veteran Honor' : `Honor ${i}`,
      i,
      i <= 5 ? `assets/honors/legacy-${i}.png` : null
    );
  }
  // Exercise replacement rather than sequential upserts: display_order is
  // UNIQUE, and two existing Honor rows have swapped positions.
  source.exec('UPDATE honors SET display_order = display_order + 100');
  source.prepare('UPDATE honors SET display_order = ? WHERE honor_id = ?').run(2, 'honor_1');
  source.prepare('UPDATE honors SET display_order = ? WHERE honor_id = ?').run(1, 'honor_2');
  for (let i = 3; i <= 10; i++) {
    source.prepare('UPDATE honors SET display_order = ? WHERE honor_id = ?')
      .run(i, `honor_${i}`);
  }
  source.prepare(
    'INSERT INTO honor_awards (id, guild_id, user_id, honor_id, awarded_by, awarded_at, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(601, 'legacy-guild', 'legacy-member', 'honor_1', 'legacy-mod', '2026-01-05 00:00:00', 1);
  source.prepare(
    'INSERT INTO honor_settings (guild_id, layout_mode) VALUES (?, ?)'
  ).run('legacy-guild', 'sequential');
}

test('full SQLite-to-libSQL transfer preserves all legacy tables and row contents', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'servitor-migration-e2e-'));
  const sourcePath = path.join(directory, 'legacy-source.db');
  const targetPath = path.join(directory, 'turso-target.db');
  const source = new BetterSqlite(sourcePath);
  source.pragma('foreign_keys = ON');
  let targetClient;

  try {
    createLegacySchema(source);

    const legacyTableNames = new Set(
      source.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      `).all().map(row => row.name)
    );
    assert.deepEqual(
      [...TABLES_IN_INSERT_ORDER].sort(),
      [...legacyTableNames].sort()
    );

    seedLegacyRows(source);

    const migration = spawnSync(
      process.execPath,
      [path.join(__dirname, '..', 'migrate-sqlite-to-turso.js')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          TURSO_DATABASE_URL: `file:${targetPath}`,
          TURSO_AUTH_TOKEN: '',
          SQLITE_DATABASE_PATH: sourcePath
        }
      }
    );
    assert.equal(
      migration.status,
      0,
      `Migration process failed.\nSTDOUT:\n${migration.stdout}\nSTDERR:\n${migration.stderr}`
    );

    targetClient = createClient({ url: `file:${targetPath}` });
    for (const table of TABLES_IN_INSERT_ORDER) {
      await verifyTransferredTable(source, targetClient, table);
    }

    const migratedReport = await targetClient.execute(
      'SELECT submitter_id, status, total_points FROM reports WHERE id = ?',
      [101]
    );
    assert.deepEqual(
      migratedReport.rows[0],
      { submitter_id: 'legacy-submitter', status: 'approved', total_points: 6 }
    );

    const migratedHonor = await targetClient.execute(
      'SELECT display_name, icon_path FROM honors WHERE honor_id = ?',
      ['honor_1']
    );
    assert.deepEqual(
      migratedHonor.rows[0],
      { display_name: 'Veteran Honor', icon_path: 'assets/honors/legacy-1.png' }
    );

    targetClient.close();
    targetClient = null;

    const backupDirectory = path.join(directory, 'backups');
    const backupRun = spawnSync(
      process.execPath,
      [path.join(__dirname, '..', 'backup-database.js')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          TURSO_DATABASE_URL: `file:${targetPath}`,
          TURSO_AUTH_TOKEN: '',
          BACKUP_OUTPUT_DIR: backupDirectory
        }
      }
    );
    assert.equal(
      backupRun.status,
      0,
      `Backup process failed.\nSTDOUT:\n${backupRun.stdout}\nSTDERR:\n${backupRun.stderr}`
    );

    const backupFilename = fs.readdirSync(backupDirectory).find(name => name.endsWith('.json'));
    assert.ok(backupFilename, 'Backup JSON file should be created.');
    const backupFilePath = path.join(backupDirectory, backupFilename);
    const backupJson = JSON.parse(fs.readFileSync(backupFilePath, 'utf8'));
    assert.equal(backupJson.format, 'servitor-turso-logical-backup');

    const restoredPath = path.join(directory, 'restored-target.db');
    const restoreRun = spawnSync(
      process.execPath,
      [path.join(__dirname, '..', 'restore-database.js'), backupFilePath],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          TURSO_DATABASE_URL: `file:${restoredPath}`,
          TURSO_AUTH_TOKEN: '',
          BACKUP_FILE: backupFilePath
        }
      }
    );
    assert.equal(
      restoreRun.status,
      0,
      `Restore process failed.\nSTDOUT:\n${restoreRun.stdout}\nSTDERR:\n${restoreRun.stderr}`
    );

    const restoredClient = createClient({ url: `file:${restoredPath}` });
    try {
      for (const table of TABLES_IN_INSERT_ORDER) {
        await verifyTransferredTable(source, restoredClient, table);
      }
    } finally {
      restoredClient.close();
    }

    const blockedRestorePath = path.join(directory, 'blocked-restore-target.db');
    fs.copyFileSync(restoredPath, blockedRestorePath);
    const blockedTarget = new BetterSqlite(blockedRestorePath);
    // Reset only Honor data to the schema's untouched seed state so the
    // restore preflight reaches the deliberately populated reports table.
    blockedTarget.exec('DELETE FROM honor_awards');
    blockedTarget.exec('DELETE FROM honors');
    const cleanHonorInsert = blockedTarget.prepare(
      'INSERT INTO honors (honor_id, display_name, display_order, icon_path) VALUES (?, ?, ?, ?)'
    );
    const defaultIcons = [
      'assets/honors/Conversion ward.png',
      'assets/honors/Crux Terminatus.png',
      'assets/honors/Fang Necklace.png',
      'assets/honors/Gem.png',
      'assets/honors/Rune.png',
      null, null, null, null, null
    ];
    for (let i = 1; i <= 10; i++) {
      cleanHonorInsert.run(`honor_${i}`, `Honor ${i}`, i, defaultIcons[i - 1]);
    }
    blockedTarget.prepare(
      'INSERT INTO reports (id, submitter_id, game_mode, report_data) VALUES (?, ?, ?, ?)'
    ).run(999, 'existing-restore-user', 'Operations', '{"operation":"Keep me"}');
    blockedTarget.close();

    const blockedRestore = spawnSync(
      process.execPath,
      [path.join(__dirname, '..', 'restore-database.js'), backupFilePath],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          TURSO_DATABASE_URL: `file:${blockedRestorePath}`,
          TURSO_AUTH_TOKEN: '',
          BACKUP_FILE: backupFilePath
        }
      }
    );
    assert.notEqual(blockedRestore.status, 0);
    assert.match(
      blockedRestore.stderr,
      /Target table reports is not empty\. Refusing to merge backup data\./
    );

    const blockedCheck = new BetterSqlite(blockedRestorePath, { readonly: true });
    try {
      assert.equal(
        blockedCheck.prepare('SELECT COUNT(*) AS count FROM reports').get().count,
        2
      );
      assert.equal(
        blockedCheck.prepare('SELECT id FROM reports WHERE id = 999').get().id,
        999
      );
    } finally {
      blockedCheck.close();
    }
  } finally {
    if (targetClient) targetClient.close();
    source.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});


test('SQLite migration refuses a populated target before importing any tables', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'servitor-migration-preflight-'));
  const sourcePath = path.join(directory, 'legacy-source.db');
  const targetPath = path.join(directory, 'already-used-target.db');
  const source = new BetterSqlite(sourcePath);
  const targetSeed = new BetterSqlite(targetPath);

  try {
    source.pragma('foreign_keys = ON');
    createLegacySchema(source);
    seedLegacyRows(source);

    targetSeed.pragma('foreign_keys = ON');
    createLegacySchema(targetSeed);
    targetSeed.prepare(
      'INSERT INTO reports (id, submitter_id, game_mode, report_data) VALUES (?, ?, ?, ?)'
    ).run(999, 'existing-target-user', 'Operations', '{"operation":"Keep me"}');
    targetSeed.close();

    const migration = spawnSync(
      process.execPath,
      [path.join(__dirname, '..', 'migrate-sqlite-to-turso.js')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          TURSO_DATABASE_URL: `file:${targetPath}`,
          TURSO_AUTH_TOKEN: '',
          SQLITE_DATABASE_PATH: sourcePath
        }
      }
    );
    assert.notEqual(migration.status, 0);
    assert.match(
      migration.stderr,
      /Target table reports is not empty\. Refusing to merge or duplicate records\./
    );

    const target = new BetterSqlite(targetPath, { readonly: true });
    try {
      assert.equal(
        target.prepare('SELECT COUNT(*) AS count FROM reports').get().count,
        1
      );
      assert.equal(
        target.prepare('SELECT id FROM reports').get().id,
        999
      );
      assert.equal(
        target.prepare('SELECT COUNT(*) AS count FROM report_participants').get().count,
        0
      );
      assert.equal(
        target.prepare('SELECT COUNT(*) AS count FROM bot_settings').get().count,
        0
      );
    } finally {
      target.close();
    }
  } finally {
    if (source.open) source.close();
    if (targetSeed.open) targetSeed.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});


test('SQLite migration refuses unrecognized source tables before importing data', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'servitor-migration-unknown-source-'));
  const sourcePath = path.join(directory, 'legacy-source.db');
  const targetPath = path.join(directory, 'target.db');
  const source = new BetterSqlite(sourcePath);

  try {
    source.pragma('foreign_keys = ON');
    createLegacySchema(source);
    seedLegacyRows(source);
    source.exec(`
      CREATE TABLE unrecognized_extension_data (
        id INTEGER PRIMARY KEY,
        payload TEXT NOT NULL
      )
    `);
    source.prepare(
      'INSERT INTO unrecognized_extension_data (id, payload) VALUES (?, ?)'
    ).run(1, 'must not be silently omitted');

    const migration = spawnSync(
      process.execPath,
      [path.join(__dirname, '..', 'migrate-sqlite-to-turso.js')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          TURSO_DATABASE_URL: `file:${targetPath}`,
          TURSO_AUTH_TOKEN: '',
          SQLITE_DATABASE_PATH: sourcePath
        }
      }
    );

    assert.notEqual(migration.status, 0);
    assert.match(
      migration.stderr,
      /contains unrecognized tables: unrecognized_extension_data/
    );

    const target = new BetterSqlite(targetPath, { readonly: true });
    try {
      assert.equal(
        target.prepare('SELECT COUNT(*) AS count FROM reports').get().count,
        0,
        'No source rows should be imported after an unrecognized table is detected.'
      );
    } finally {
      target.close();
    }
  } finally {
    source.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});


test('logical backup preserves Buffer and Uint8Array BLOB bytes', () => {
  const backing = Uint8Array.from([99, 10, 20, 30, 88]);
  const slicedView = new Uint8Array(backing.buffer, 1, 3);
  const encoded = jsonSafe({
    nodeBuffer: Buffer.from([1, 2, 3]),
    libsqlView: slicedView,
    arrayBuffer: Uint8Array.from([7, 8]).buffer
  });

  assert.deepEqual(encoded.nodeBuffer, { type: 'Buffer', data: [1, 2, 3] });
  assert.deepEqual(encoded.libsqlView, { type: 'Buffer', data: [10, 20, 30] });
  assert.deepEqual(encoded.arrayBuffer, { type: 'Buffer', data: [7, 8] });

  for (const [key, expected] of [
    ['nodeBuffer', [1, 2, 3]],
    ['libsqlView', [10, 20, 30]],
    ['arrayBuffer', [7, 8]]
  ]) {
    const decoded = decodeBackupValue(encoded[key], { type: 'BLOB', name: key });
    assert.deepEqual(Array.from(decoded), expected);
  }
});
