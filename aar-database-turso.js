'use strict';

const database = require('./turso-database');

async function getReportById(reportId, status = null) {
  const result = await database.execute({
    sql: `SELECT * FROM reports WHERE id = ?${status ? ' AND status = ?' : ''}`,
    args: status ? [reportId, status] : [reportId]
  });
  return result.rows[0] || null;
}

async function getReportByReviewMessage(messageId) {
  const result = await database.execute({
    sql: 'SELECT * FROM reports WHERE review_message_id = ?',
    args: [messageId]
  });
  return result.rows[0] || null;
}

async function getReportByIdAndMode(reportId, gameMode) {
  const result = await database.execute({
    sql: 'SELECT * FROM reports WHERE id = ? AND game_mode = ?',
    args: [reportId, gameMode]
  });
  return result.rows[0] || null;
}

async function getReportParticipants(reportId) {
  const result = await database.execute({
    sql: 'SELECT user_id FROM report_participants WHERE report_id = ?',
    args: [reportId]
  });
  return result.rows;
}

async function getReportAudit(reportId) {
  const result = await database.execute({
    sql: 'SELECT moderator_id, decision FROM audit_log WHERE report_id = ?',
    args: [reportId]
  });
  return result.rows[0] || null;
}

async function getPendingReviewUpdates() {
  const result = await database.execute(`
    SELECT * FROM reports
    WHERE review_update_pending = 1
      AND review_message_id IS NOT NULL
      AND status IN ('approved', 'rejected')
    ORDER BY id ASC
  `);
  return result.rows;
}

async function clearRecoveryMarker(reportId, status, messageId = null) {
  const result = await database.execute({
    sql: messageId
      ? `UPDATE reports SET review_update_pending = 0
         WHERE id = ? AND status = ? AND review_message_id = ? AND review_update_pending = 1`
      : 'UPDATE reports SET review_update_pending = 0 WHERE id = ?',
    args: messageId ? [reportId, status, messageId] : [reportId]
  });
  return Number(result.rowsAffected);
}

async function attachReviewMessage(reportId, messageId, evidence) {
  return database.withTransaction(async tx => {
    const result = await tx.execute({
      sql: `UPDATE reports
            SET review_message_id = ?, evidence = ?, evidence_thread_id = NULL
            WHERE id = ? AND status = 'pending' AND review_message_id IS NULL`,
      args: [messageId, JSON.stringify(evidence), reportId]
    });
    if (Number(result.rowsAffected) !== 1) {
      throw new Error(`Could not persist the review message association for report #${reportId}.`);
    }
  });
}

async function saveAarDecision(reportId, decision, moderatorId, participants, totalPoints) {
  return database.withTransaction(async tx => {
    const update = await tx.execute({
      sql: `UPDATE reports
            SET status = ?, reviewed_at = CURRENT_TIMESTAMP,
                review_update_pending = CASE WHEN review_message_id IS NOT NULL THEN 1 ELSE 0 END
            WHERE id = ? AND status = 'pending'`,
      args: [decision, reportId]
    });
    if (Number(update.rowsAffected) !== 1) return false;

    if (decision === 'approved') {
      for (const participant of participants) {
        await tx.execute({
          sql: 'INSERT INTO score_ledger (report_id, user_id, points) VALUES (?, ?, ?)',
          args: [reportId, participant.user_id, totalPoints]
        });
      }
    }

    await tx.execute({
      sql: 'INSERT INTO audit_log (report_id, moderator_id, decision, reason) VALUES (?, ?, ?, ?)',
      args: [reportId, moderatorId, decision, null]
    });
    return true;
  });
}

async function createAarReport({ submitterId, gameMode, reportData, basePoints, bonusPoints, totalPoints, participants }) {
  return database.withTransaction(async tx => {
    const inserted = await tx.execute({
      sql: `INSERT INTO reports (submitter_id, game_mode, report_data, base_points, bonus_points, total_points)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [submitterId, gameMode, JSON.stringify(reportData), basePoints, bonusPoints, totalPoints]
    });
    const reportId = Number(inserted.lastInsertRowid);
    if (!Number.isSafeInteger(reportId) || reportId <= 0) {
      throw new Error('Database did not return a valid AAR report ID.');
    }
    for (const userId of participants) {
      await tx.execute({
        sql: 'INSERT INTO report_participants (report_id, user_id) VALUES (?, ?)',
        args: [reportId, userId]
      });
    }
    return reportId;
  });
}

async function deleteUnlinkedPendingReport(reportId) {
  return database.withTransaction(async tx => {
    const deleted = await tx.execute({
      sql: `DELETE FROM reports
            WHERE id = ? AND status = 'pending'
              AND review_message_id IS NULL`,
      args: [reportId]
    });
    if (Number(deleted.rowsAffected) !== 1) return false;
    await tx.execute({
      sql: 'DELETE FROM report_participants WHERE report_id = ?',
      args: [reportId]
    });
    return true;
  });
}

async function getMemberApprovedAarTotal(userId) {
  const result = await database.execute({
    sql: `SELECT COALESCE(SUM(sl.points), 0) AS total
          FROM score_ledger sl
          INNER JOIN reports r ON r.id = sl.report_id
          WHERE sl.user_id = ? AND r.status = 'approved'`,
    args: [userId]
  });
  return Number(result.rows[0]?.total || 0);
}

module.exports = {
  getReportById, getReportByReviewMessage, getReportByIdAndMode,
  getReportParticipants, getReportAudit, getPendingReviewUpdates,
  clearRecoveryMarker, attachReviewMessage, saveAarDecision,
  createAarReport, deleteUnlinkedPendingReport, getMemberApprovedAarTotal
};
