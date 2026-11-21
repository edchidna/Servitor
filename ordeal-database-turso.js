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

async function getPreviousSubmissions(challengeKey) {
  const result = await database.execute({
    sql: `SELECT id, challenge_name, game_mode, difficulty,
                 challenge_completers, participants, operation_name,
                 review_message_id
          FROM ordeal_submissions
          WHERE challenge_key = ? AND status IN ('pending', 'approved')
          ORDER BY id DESC`,
    args: [challengeKey]
  });
  return result.rows;
}

async function createSubmission(data) {
  return database.withTransaction(async tx => {
    const result = await tx.execute({
      sql: `INSERT INTO ordeal_submissions (
              submitter_id, challenge_key, challenge_name, game_mode,
              difficulty, reward_role_id, operation_name,
              challenge_completers, participants, gene_seed, armoury_data,
              base_points, bonus_points, total_points, suspicious_flag,
              suspicious_details, status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, 'pending')`,
      args: [
        data.submitterId, data.challengeKey, data.challengeName,
        data.gameMode, data.difficulty, data.rewardRoleId,
        data.operationName, JSON.stringify(data.completers),
        JSON.stringify(data.participants), data.geneSeed, data.armouryData,
        data.suspiciousFlag, JSON.stringify(data.suspiciousDetails)
      ]
    });
    const id = Number(result.lastInsertRowid);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Database did not return a valid Ordeal submission ID.');
    return id;
  });
}

async function attachReviewMessage(submissionId, messageId) {
  const result = await database.execute({
    sql: `UPDATE ordeal_submissions SET review_message_id = ?
          WHERE id = ? AND status = 'pending' AND review_message_id IS NULL`,
    args: [messageId, submissionId]
  });
  if (Number(result.rowsAffected) !== 1) {
    throw new Error(`Could not persist review message for Ordeal #${submissionId}.`);
  }
}

async function saveEvidence(submissionId, evidence) {
  const result = await database.execute({
    sql: `UPDATE ordeal_submissions
          SET evidence = ?, evidence_thread_id = NULL
          WHERE id = ? AND status = 'pending'`,
    args: [JSON.stringify(evidence), submissionId]
  });
  if (Number(result.rowsAffected) !== 1) {
    throw new Error(`Could not persist evidence for Ordeal #${submissionId}.`);
  }
}

async function getNcoAlertMessageId(submissionId) {
  const result = await database.execute({
    sql: 'SELECT nco_alert_message_id FROM ordeal_submissions WHERE id = ?',
    args: [submissionId]
  });
  return result.rows[0]?.nco_alert_message_id || null;
}

async function attachNcoAlertMessage(submissionId, messageId) {
  const result = await database.execute({
    sql: `UPDATE ordeal_submissions SET nco_alert_message_id = ?
          WHERE id = ? AND nco_alert_message_id IS NULL`,
    args: [messageId, submissionId]
  });
  return Number(result.rowsAffected) === 1;
}

async function deletePendingSubmission(submissionId) {
  return database.withTransaction(async tx => {
    const result = await tx.execute({
      sql: `DELETE FROM ordeal_submissions WHERE id = ? AND status = 'pending'`,
      args: [submissionId]
    });
    return Number(result.rowsAffected) === 1;
  });
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

module.exports = {
  getSubmissionByReviewMessage, getSubmissionById, getPreviousSubmissions,
  createSubmission, attachReviewMessage, saveEvidence,
  getNcoAlertMessageId, attachNcoAlertMessage, deletePendingSubmission,
  saveDecision
};
