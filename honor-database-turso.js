'use strict';

const database = require('./turso-database');

const honorIcons = [
  { honorId: 'honor_1', iconPath: 'assets/honors/Conversion ward.png' },
  { honorId: 'honor_2', iconPath: 'assets/honors/Crux Terminatus.png' },
  { honorId: 'honor_3', iconPath: 'assets/honors/Fang Necklace.png' },
  { honorId: 'honor_4', iconPath: 'assets/honors/Gem.png' },
  { honorId: 'honor_5', iconPath: 'assets/honors/Rune.png' }
];

async function initializeSchema() {
  await database.execute(`
    CREATE TABLE IF NOT EXISTS honors (
      honor_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      display_order INTEGER NOT NULL UNIQUE,
      icon_path TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await database.execute(`
    CREATE TABLE IF NOT EXISTS honor_awards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      honor_id TEXT NOT NULL,
      awarded_by TEXT NOT NULL,
      awarded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      removed_by TEXT,
      removed_at TEXT,
      FOREIGN KEY (honor_id) REFERENCES honors(honor_id)
    )
  `);
  await database.execute(`
    CREATE INDEX IF NOT EXISTS idx_honor_awards_member
    ON honor_awards(guild_id, user_id)
  `);
  await database.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_honor_active_unique
    ON honor_awards(guild_id, user_id, honor_id)
    WHERE is_active = 1
  `);
  await database.execute(`
    CREATE TABLE IF NOT EXISTS honor_settings (
      guild_id TEXT PRIMARY KEY,
      layout_mode TEXT NOT NULL DEFAULT 'fixed'
        CHECK (layout_mode IN ('fixed', 'sequential'))
    )
  `);

  const columns = await database.execute('PRAGMA table_info(honors)');
  if (!columns.rows.some(column => column.name === 'icon_path')) {
    await database.execute('ALTER TABLE honors ADD COLUMN icon_path TEXT');
  }

  await database.withTransaction(async tx => {
    for (let i = 1; i <= 10; i++) {
      await tx.execute({
        sql: 'INSERT OR IGNORE INTO honors (honor_id, display_name, display_order) VALUES (?, ?, ?)',
        args: [`honor_${i}`, `Honor ${i}`, i]
      });
    }
    for (const icon of honorIcons) {
      await tx.execute({
        sql: 'UPDATE honors SET icon_path = ? WHERE honor_id = ?',
        args: [icon.iconPath, icon.honorId]
      });
    }
  });
  console.log('Honor Turso schema initialized successfully.');
}

module.exports = { initializeSchema };
