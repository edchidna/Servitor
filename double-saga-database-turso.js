'use strict';

const database = require('./turso-database');

async function getActiveEvent(now = Date.now(), guildId = null) {
  const result = await database.execute({
    sql: `SELECT * FROM double_saga_events
          WHERE starts_at_ms <= ? AND ends_at_ms > ?
            ${guildId ? 'AND guild_id = ?' : ''}
          ORDER BY id DESC LIMIT 1`,
    args: guildId ? [now, now, guildId] : [now, now]
  });
  return result.rows[0] || null;
}

async function isActiveAt(timestamp = Date.now(), guildId = null) {
  return Boolean(await getActiveEvent(timestamp, guildId));
}

async function createEvent({ guildId, activatedBy, channelId, durationHours, startsAtMs, endsAtMs }) {
  return database.withTransaction(async tx => {
    const existing = await tx.execute({
      sql: `SELECT id FROM double_saga_events
            WHERE guild_id = ? AND starts_at_ms <= ? AND ends_at_ms > ?
            LIMIT 1`,
      args: [guildId, startsAtMs, startsAtMs]
    });
    if (existing.rows.length > 0) {
      throw new Error('A Double Saga event is already active in this server.');
    }

    const result = await tx.execute({
      sql: `INSERT INTO double_saga_events (
              guild_id, activated_by, channel_id, duration_hours,
              starts_at_ms, ends_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [guildId, activatedBy, channelId, durationHours, startsAtMs, endsAtMs]
    });
    return Number(result.lastInsertRowid);
  });
}

async function cancelEvent(eventId) {
  await database.execute({
    sql: 'DELETE FROM double_saga_events WHERE id = ?',
    args: [eventId]
  });
}

module.exports = { getActiveEvent, isActiveAt, createEvent, cancelEvent };
