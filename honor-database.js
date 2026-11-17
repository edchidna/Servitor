
const db = require('./database');

// ==========================================
// HONOR SYSTEM DATABASE
// ==========================================

db.exec(`
  CREATE TABLE IF NOT EXISTS honors (
    honor_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    display_order INTEGER NOT NULL UNIQUE,
    icon_path TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

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

    FOREIGN KEY (honor_id)
      REFERENCES honors(honor_id)
  );

  CREATE INDEX IF NOT EXISTS idx_honor_awards_member
  ON honor_awards(guild_id, user_id);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_honor_active_unique
  ON honor_awards(guild_id, user_id, honor_id)
  WHERE is_active = 1;

  CREATE TABLE IF NOT EXISTS honor_settings (
    guild_id TEXT PRIMARY KEY,
    layout_mode TEXT NOT NULL DEFAULT 'fixed'
      CHECK (layout_mode IN ('fixed', 'sequential'))
  );
`);

// ==========================================
// DATABASE MIGRATION
// ==========================================

// Add icon_path to existing databases if it is missing.
const honorColumns = db.pragma('table_info(honors)');
const hasIconPath = honorColumns.some(
  column => column.name === 'icon_path'
);

if (!hasIconPath) {
  db.exec(`
    ALTER TABLE honors
    ADD COLUMN icon_path TEXT
  `);
}

// ==========================================
// INITIAL HONORS
// ==========================================

const insertHonor = db.prepare(`
  INSERT OR IGNORE INTO honors (
    honor_id,
    display_name,
    display_order
  )
  VALUES (?, ?, ?)
`);

const initializeHonors = db.transaction(() => {
  for (let i = 1; i <= 10; i++) {
    insertHonor.run(
      `honor_${i}`,
      `Honor ${i}`,
      i
    );
  }
});

initializeHonors();

// ==========================================
// HONOR ICON ASSIGNMENTS
// ==========================================

const honorIcons = [
  {
    honorId: 'honor_1',
    iconPath: 'assets/honors/Conversion ward.png'
  },
  {
    honorId: 'honor_2',
    iconPath: 'assets/honors/Crux Terminatus.png'
  },
  {
    honorId: 'honor_3',
    iconPath: 'assets/honors/Fang Necklace.png'
  },
  {
    honorId: 'honor_4',
    iconPath: 'assets/honors/Gem.png'
  },
  {
    honorId: 'honor_5',
    iconPath: 'assets/honors/Rune.png'
  }
];

const updateHonorIcon = db.prepare(`
  UPDATE honors
  SET icon_path = ?
  WHERE honor_id = ?
`);

const assignHonorIcons = db.transaction(() => {
  for (const icon of honorIcons) {
    updateHonorIcon.run(
      icon.iconPath,
      icon.honorId
    );
  }
});

assignHonorIcons();

console.log('Honor database initialized successfully.');

module.exports = {
  db
};
