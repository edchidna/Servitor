'use strict';

const database = require('./turso-database');

async function applySagaAdjustment({
  guildId, userId, moderatorId, action, requestedPoints, reason
}) {
  return database.withTransaction(async tx => {
    const balanceResult = await tx.execute({
      sql: `SELECT COALESCE(SUM(points), 0) AS total_points
            FROM (
              SELECT sl.points
              FROM score_ledger sl
              INNER JOIN reports r ON r.id = sl.report_id
              WHERE r.status = 'approved' AND sl.user_id = ?
              UNION ALL
              SELECT tsl.points
              FROM trial_score_ledger tsl
              INNER JOIN trial_submissions ts ON ts.id = tsl.submission_id
              WHERE ts.status = 'approved' AND tsl.user_id = ?
              UNION ALL
              SELECT spa.points_delta AS points
              FROM saga_point_adjustments spa
              WHERE spa.guild_id = ? AND spa.user_id = ?
            )`,
      args: [userId, userId, guildId, userId]
    });
    const currentBalance = Math.max(0, Number(balanceResult.rows[0]?.total_points || 0));
    const appliedPoints = action === 'deduct'
      ? Math.min(requestedPoints, currentBalance)
      : requestedPoints;
    const pointsDelta = action === 'deduct' ? -appliedPoints : appliedPoints;
    const inserted = await tx.execute({
      sql: `INSERT INTO saga_point_adjustments (
              guild_id, user_id, moderator_id, action,
              requested_points, applied_points, points_delta, reason
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [guildId, userId, moderatorId, action, requestedPoints, appliedPoints, pointsDelta, reason]
    });
    return {
      auditId: Number(inserted.lastInsertRowid),
      currentBalance,
      appliedPoints,
      newBalance: Math.max(0, currentBalance + pointsDelta)
    };
  });
}


async function getSagaPoints(guildId, userId) {
  const result = await database.execute({
    sql: `SELECT COALESCE(SUM(points), 0) AS total_points
          FROM (
            SELECT sl.points FROM score_ledger sl
            INNER JOIN reports r ON r.id = sl.report_id
            WHERE r.status = 'approved' AND sl.user_id = ?
            UNION ALL
            SELECT tsl.points FROM trial_score_ledger tsl
            INNER JOIN trial_submissions ts ON ts.id = tsl.submission_id
            WHERE ts.status = 'approved' AND tsl.user_id = ?
            UNION ALL
            SELECT points_delta AS points FROM saga_point_adjustments
            WHERE guild_id = ? AND user_id = ?
          )`,
    args: [userId, userId, guildId, userId]
  });
  return Number(result.rows[0]?.total_points || 0);
}

async function getApprovedRegularReports(userId) {
  const result = await database.execute({
    sql: `SELECT r.report_data FROM reports r
          INNER JOIN report_participants rp ON rp.report_id = r.id
          WHERE rp.user_id = ? AND r.status = 'approved'
            AND r.game_mode IN ('Operations', 'Stratagems')`,
    args: [userId]
  });
  return result.rows;
}

async function getApprovedOrdeals() {
  const result = await database.execute({
    sql: `SELECT participants, gene_seed, armoury_data
          FROM ordeal_submissions WHERE status = 'approved'`
  });
  return result.rows;
}

module.exports = {
  applySagaAdjustment, getSagaPoints, getApprovedRegularReports, getApprovedOrdeals
};
