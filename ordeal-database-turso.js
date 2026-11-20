'use strict';

const database = require('./turso-database');

async function getSubmissionByReviewMessage(messageId) {
  const result = await database.execute({
    sql: 'SELECT id FROM ordeal_submissions WHERE review_message_id = ?',
    args: [messageId]
  });
  return result.rows[0] || null;
}

async function getSubmissionById(submissionId) {
  const result = await database.execute({
    sql: 'SELECT * FROM ordeal_submissions WHERE id = ?',
    args: [submissionId]
  });
  return result.rows[0] || null;
}

async function saveDecision(submissionId, moderatorId, decision) {
  return database.withTransaction(async tx => {
    const updated = await tx.execute({
      sql: `UPDATE ordeal_submissions
            SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'pending'`,
      args: [decision, moderatorId, submissionId]
    });
    if (Number(updated.rowsAffected) !== 1) return false;

    await tx.execute({
      sql: `INSERT INTO ordeal_audit_log (submission_id, moderator_id, decision)
            VALUES (?, ?, ?)`,
      args: [submissionId, moderatorId, decision]
    });
    return true;
  });
}

module.exports = { getSubmissionByReviewMessage, getSubmissionById, saveDecision };
