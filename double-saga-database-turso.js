'use strict';

const database = require('./turso-database');

async function getActiveEvent(now = Date.now()) {
  const result = await database.execute({
    sql: `SELECT * FROM double_saga_events
          WHERE starts_at_ms <= ? AND ends_at_ms > ?
          ORDER BY id DESC LIMIT 1`,
    args: [now, now]
  });
  return result.rows[0] || null;
}

async function isActiveAt(timestamp = Date.now()) {
  return Boolean(await getActiveEvent(timestamp));
}

async function createEvent({ guildId, activatedBy, channelId, durationHours, startsAtMs, endsAtMs }) {
  const result = await database.execute({
    sql: `INSERT INTO double_saga_events (
            guild_id, activated_by, channel_id, duration_hours,
            starts_at_ms, ends_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [guildId, activatedBy, channelId, durationHours, startsAtMs, endsAtMs]
  });
  return Number(result.lastInsertRowid);
}

async function cancelEvent(eventId) {
  await database.execute({
    sql: 'DELETE FROM double_saga_events WHERE id = ?',
    args: [eventId]
  });
}

module.exports = { getActiveEvent, isActiveAt, createEvent, cancelEvent };
