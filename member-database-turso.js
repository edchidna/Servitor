'use strict';

const database = require('./turso-database');

async function initializeTenureMembers(guildId, members, roleId) {
  return database.withTransaction(async tx => {
    for (const member of members) {
      if (member.roles.cache.has(roleId) && member.joinedAt) {
        await tx.execute({
          sql: `INSERT OR IGNORE INTO iron_wolves_tenure (guild_id, user_id, assigned_at)
                VALUES (?, ?, ?)`,
          args: [guildId, member.id, member.joinedAt.toISOString()]
        });
      }
    }
  });
}

async function setTenure(guildId, userId, assignedAt) {
  await database.execute({
    sql: `INSERT OR IGNORE INTO iron_wolves_tenure (guild_id, user_id, assigned_at)
          VALUES (?, ?, ?)`,
    args: [guildId, userId, assignedAt]
  });
}

async function clearTenure(guildId, userId) {
  await database.execute({
    sql: 'DELETE FROM iron_wolves_tenure WHERE guild_id = ? AND user_id = ?',
    args: [guildId, userId]
  });
}

async function getTenure(guildId, userId) {
  const result = await database.execute({
    sql: 'SELECT assigned_at FROM iron_wolves_tenure WHERE guild_id = ? AND user_id = ?',
    args: [guildId, userId]
  });
  return result.rows[0] || null;
}

module.exports = { initializeTenureMembers, setTenure, clearTenure, getTenure };
