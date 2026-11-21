'use strict';

const database = require('./turso-database');

async function getAllHonors() {
  const result = await database.execute(`
    SELECT honor_id, display_name, display_order, icon_path
    FROM honors ORDER BY display_order ASC
  `);
  return result.rows;
}

async function getHonorById(honorId) {
  const result = await database.execute({
    sql: 'SELECT honor_id, display_name, display_order, icon_path FROM honors WHERE honor_id = ?',
    args: [honorId]
  });
  return result.rows[0] || null;
}

async function getMemberHonors(guildId, userId) {
  const result = await database.execute({
    sql: `SELECT ha.id, ha.honor_id, h.display_name, h.display_order, h.icon_path,
                 ha.awarded_by, ha.awarded_at
          FROM honor_awards ha
          INNER JOIN honors h ON h.honor_id = ha.honor_id
          WHERE ha.guild_id = ? AND ha.user_id = ? AND ha.is_active = 1
          ORDER BY h.display_order ASC`,
    args: [guildId, userId]
  });
  return result.rows;
}

async function awardHonor(guildId, userId, honorId, moderatorId) {
  return database.withTransaction(async tx => {
    const found = await tx.execute({
      sql: 'SELECT honor_id, display_name, display_order, icon_path FROM honors WHERE honor_id = ?',
      args: [honorId]
    });
    const honor = found.rows[0];
    if (!honor) return { success: false, message: 'This Honor does not exist.' };

    const existing = await tx.execute({
      sql: `SELECT id FROM honor_awards
            WHERE guild_id = ? AND user_id = ? AND honor_id = ? AND is_active = 1`,
      args: [guildId, userId, honorId]
    });
    if (existing.rows.length) return { success: false, message: 'This member already has this Honor.' };

    try {
      await tx.execute({
        sql: `INSERT INTO honor_awards (guild_id, user_id, honor_id, awarded_by)
              VALUES (?, ?, ?, ?)`,
        args: [guildId, userId, honorId, moderatorId]
      });
    } catch (error) {
      if (/UNIQUE constraint failed/i.test(String(error.message))) {
        return { success: false, message: 'This member already has this Honor.' };
      }
      throw error;
    }
    return { success: true, message: `${honor.display_name} awarded successfully.`, honor };
  });
}

async function removeHonor(guildId, userId, honorId, moderatorId) {
  return database.withTransaction(async tx => {
    const active = await tx.execute({
      sql: `SELECT id FROM honor_awards
            WHERE guild_id = ? AND user_id = ? AND honor_id = ? AND is_active = 1`,
      args: [guildId, userId, honorId]
    });
    if (!active.rows.length) return { success: false, message: 'This member does not have this active Honor.' };
    await tx.execute({
      sql: `UPDATE honor_awards
            SET is_active = 0, removed_by = ?, removed_at = CURRENT_TIMESTAMP
            WHERE id = ? AND is_active = 1`,
      args: [moderatorId, active.rows[0].id]
    });
    return { success: true, message: 'Honor removed successfully.' };
  });
}

async function getMemberHonorHistory(guildId, userId) {
  const result = await database.execute({
    sql: `SELECT ha.id, ha.honor_id, h.display_name, h.icon_path, ha.awarded_by,
                 ha.awarded_at, ha.is_active, ha.removed_by, ha.removed_at
          FROM honor_awards ha
          INNER JOIN honors h ON h.honor_id = ha.honor_id
          WHERE ha.guild_id = ? AND ha.user_id = ?
          ORDER BY ha.awarded_at DESC, ha.id DESC`,
    args: [guildId, userId]
  });
  return result.rows;
}

async function renameHonor(honorId, newName) {
  const displayName = typeof newName === 'string' ? newName.trim() : '';
  if (!displayName || displayName.length > 50) {
    return { success: false, message: 'Honor name must be between 1 and 50 characters.' };
  }
  return database.withTransaction(async tx => {
    const current = await tx.execute({
      sql: 'SELECT honor_id FROM honors WHERE honor_id = ?',
      args: [honorId]
    });
    if (!current.rows.length) return { success: false, message: 'This Honor does not exist.' };
    await tx.execute({
      sql: 'UPDATE honors SET display_name = ? WHERE honor_id = ?',
      args: [displayName, honorId]
    });
    const updated = await tx.execute({
      sql: 'SELECT honor_id, display_name, display_order, icon_path FROM honors WHERE honor_id = ?',
      args: [honorId]
    });
    return { success: true, message: `Honor renamed to ${displayName}.`, honor: updated.rows[0] };
  });
}

async function getHonorLayout(guildId) {
  const result = await database.execute({
    sql: 'SELECT layout_mode FROM honor_settings WHERE guild_id = ?',
    args: [guildId]
  });
  return result.rows[0]?.layout_mode || 'fixed';
}

async function setHonorLayout(guildId, layoutMode) {
  if (!['fixed', 'sequential'].includes(layoutMode)) {
    return { success: false, message: 'Invalid layout mode. Use fixed or sequential.' };
  }
  await database.execute({
    sql: `INSERT INTO honor_settings (guild_id, layout_mode) VALUES (?, ?)
          ON CONFLICT(guild_id) DO UPDATE SET layout_mode = excluded.layout_mode`,
    args: [guildId, layoutMode]
  });
  return { success: true, message: `Honor layout changed to ${layoutMode}.`, layoutMode };
}

async function getHonorDisplayLayout(guildId, userId) {
  return database.withTransaction(async tx => {
    const setting = await tx.execute({
      sql: 'SELECT layout_mode FROM honor_settings WHERE guild_id = ?',
      args: [guildId]
    });
    const layoutMode = setting.rows[0]?.layout_mode || 'fixed';
    const result = await tx.execute({
      sql: `SELECT ha.id, ha.honor_id, h.display_name, h.display_order, h.icon_path, ha.awarded_at
            FROM honor_awards ha
            INNER JOIN honors h ON h.honor_id = ha.honor_id
            WHERE ha.guild_id = ? AND ha.user_id = ? AND ha.is_active = 1
            ORDER BY ha.awarded_at ASC, ha.id ASC`,
      args: [guildId, userId]
    });
    const active = result.rows;
    const leftColumn = Array(5).fill(null);
    const rightColumn = Array(5).fill(null);
    if (layoutMode === 'fixed') {
      for (const item of active) {
        if (item.display_order >= 1 && item.display_order <= 5) leftColumn[item.display_order - 1] = item;
        else if (item.display_order >= 6 && item.display_order <= 10) rightColumn[item.display_order - 6] = item;
      }
    } else {
      active.forEach((item, index) => {
        if (index < 5) leftColumn[index] = item;
        else if (index < 10) rightColumn[index - 5] = item;
      });
    }
    return { layoutMode, leftColumn, rightColumn };
  }, 'read');
}

module.exports = {
  getAllHonors, getHonorById, getMemberHonors, awardHonor, removeHonor,
  getMemberHonorHistory, renameHonor, getHonorLayout, setHonorLayout,
  getHonorDisplayLayout
};
