'use strict';

const database = require('./turso-database');

function validateUserId(userId, fieldName) {
  if (typeof userId !== 'string' || !userId.trim()) {
    throw new TypeError(`${fieldName} must be a non-empty string.`);
  }
  return userId.trim();
}

function validateSubmissionId(id) {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new TypeError('submissionId must be a positive safe integer.');
  }
}

function parseJsonArray(value, fieldName) {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new TypeError('Stored value is not an array.');
    return parsed;
  } catch (error) {
    console.error(`Could not parse ${fieldName}:`, error.message);
    return [];
  }
}

function assertJsonSafe(value, fieldName, ancestors = new Set(), valuePath = fieldName) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${valuePath} must be a finite number.`);
    return;
  }

  if (typeof value !== 'object') {
    throw new TypeError(`${valuePath} is not a JSON-safe value.`);
  }
  if (ancestors.has(value)) {
    throw new TypeError(`${valuePath} contains a circular reference.`);
  }

  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (!isArray && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${valuePath} must contain only plain objects.`);
  }

  ancestors.add(value);
  try {
    const ownKeys = Reflect.ownKeys(value);
    for (const key of ownKeys) {
      if (isArray && key === 'length') continue;
      if (typeof key === 'symbol') {
        throw new TypeError(`${valuePath} cannot contain symbol keys.`);
      }
      if (isArray) {
        const index = Number(key);
        if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key) {
          throw new TypeError(`${valuePath} cannot contain non-index array properties.`);
        }
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw new TypeError(`${valuePath}.${key} must be an enumerable data property.`);
      }
      assertJsonSafe(descriptor.value, fieldName, ancestors, `${valuePath}.${key}`);
    }
    if (isArray && ownKeys.filter(key => key !== 'length').length !== value.length) {
      throw new TypeError(`${valuePath} cannot contain sparse array entries.`);
    }
  } finally {
    ancestors.delete(value);
  }
}

function serializeJson(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array.`);
  assertJsonSafe(value, fieldName);

  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new TypeError(`${fieldName} must contain valid JSON data.`, { cause: error });
  }
  if (typeof serialized !== 'string') {
    throw new TypeError(`${fieldName} must contain valid JSON data.`);
  }
  try {
    JSON.parse(serialized);
  } catch (error) {
    throw new TypeError(`${fieldName} could not be serialized as valid JSON.`, { cause: error });
  }
  return serialized;
}

function validateParticipants(participants, fieldName) {
  if (!Array.isArray(participants) || participants.length < 1 || participants.length > 2) {
    throw new RangeError(`${fieldName} must contain 1 or 2 participants.`);
  }

  const seen = new Set();
  return participants.map((participant, index) => {
    if (!participant || typeof participant !== 'object' || Array.isArray(participant)) {
      throw new TypeError(`${fieldName}[${index}] must be a participant object.`);
    }

    const user_id = validateUserId(participant.user_id, `${fieldName}[${index}].user_id`);
    if (seen.has(user_id)) throw new RangeError(`${fieldName} must not contain duplicate user IDs.`);
    seen.add(user_id);

    const role = participant.unproven_role_at_submission;
    if (![true, false, 0, 1].includes(role)) {
      throw new TypeError(`${fieldName}[${index}].unproven_role_at_submission must be boolean or 0/1.`);
    }

    return {
      user_id,
      unproven_role_at_submission: role === true || role === 1 ? 1 : 0
    };
  });
}

function normalizeLastInsertId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error('Database returned an invalid Trial submission ID.');
  }
  return id;
}

async function createTrialSubmission(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError('Trial submission data must be an object.');
  }

  const submitterId = validateUserId(data.submitterId, 'submitterId');
  if (!['trial_1', 'trial_2', 'trial_3'].includes(data.trialKey)) {
    throw new RangeError('trialKey must be trial_1, trial_2, or trial_3.');
  }
  if (!Array.isArray(data.evidence) || data.evidence.length < 1 || data.evidence.length > 6) {
    throw new RangeError('evidence must contain 1 to 6 items.');
  }

  const evidenceJson = serializeJson(data.evidence, 'evidence');
  const suspiciousFlag = data.suspiciousFlag === undefined ? 0 : data.suspiciousFlag;
  if (![true, false, 0, 1].includes(suspiciousFlag)) {
    throw new TypeError('suspiciousFlag must be a boolean or 0/1.');
  }
  const suspiciousDetails = data.suspiciousDetails === undefined ? [] : data.suspiciousDetails;
  const suspiciousDetailsJson = serializeJson(suspiciousDetails, 'suspiciousDetails');
  const completers = validateParticipants(data.completers, 'completers');
  const packMembers = validateParticipants(data.packMembers, 'packMembers');

  if (completers.length + packMembers.length > 3) {
    throw new RangeError('The combined completer and Pack Member count cannot exceed 3.');
  }
  const completerIds = new Set(completers.map(item => item.user_id));
  if (packMembers.some(item => completerIds.has(item.user_id))) {
    throw new RangeError('A person cannot appear as both a completer and a Pack Member.');
  }

  return database.withTransaction(async tx => {
    const inserted = await tx.execute({
      sql: `
        INSERT INTO trial_submissions (
          submitter_id, trial_key, evidence, suspicious_flag, suspicious_details
        ) VALUES (?, ?, ?, ?, ?)
      `,
      args: [
        submitterId,
        data.trialKey,
        evidenceJson,
        suspiciousFlag === true || suspiciousFlag === 1 ? 1 : 0,
        suspiciousDetailsJson
      ]
    });

    const submissionId = normalizeLastInsertId(inserted.lastInsertRowid);

    for (const member of completers) {
      await tx.execute({
        sql: `
          INSERT INTO trial_completers (
            submission_id, user_id, unproven_role_at_submission
          ) VALUES (?, ?, ?)
        `,
        args: [submissionId, member.user_id, member.unproven_role_at_submission]
      });
    }

    for (const member of packMembers) {
      await tx.execute({
        sql: `
          INSERT INTO trial_pack_members (
            submission_id, user_id, unproven_role_at_submission
          ) VALUES (?, ?, ?)
        `,
        args: [submissionId, member.user_id, member.unproven_role_at_submission]
      });
    }

    return submissionId;
  });
}

async function getTrialSubmission(submissionId) {
  validateSubmissionId(submissionId);

  const result = await database.execute({
    sql: 'SELECT * FROM trial_submissions WHERE id = ?',
    args: [submissionId]
  });
  const submission = result.rows[0];
  if (!submission) return null;

  const [completersResult, packMembersResult] = await Promise.all([
    database.execute({
      sql: `
        SELECT user_id, unproven_role_at_submission
        FROM trial_completers WHERE submission_id = ? ORDER BY id
      `,
      args: [submissionId]
    }),
    database.execute({
      sql: `
        SELECT user_id, unproven_role_at_submission,
          unproven_role_at_review, points_awarded
        FROM trial_pack_members WHERE submission_id = ? ORDER BY id
      `,
      args: [submissionId]
    })
  ]);

  return {
    ...submission,
    id: Number(submission.id),
    evidence: parseJsonArray(submission.evidence, `evidence for Trial submission #${submissionId}`),
    suspicious_details: parseJsonArray(
      submission.suspicious_details,
      `suspicious details for Trial submission #${submissionId}`
    ),
    completers: completersResult.rows,
    pack_members: packMembersResult.rows
  };
}

async function getGraduatedMemberIds() {
  const result = await database.execute({
    sql: `
      SELECT user_id
      FROM trial_progress
      GROUP BY user_id
      HAVING COUNT(DISTINCT trial_key) = 3
      ORDER BY user_id
    `
  });

  return result.rows.map(row => validateUserId(row.user_id, 'graduated user ID'));
}

async function getMemberTrialProgress(userId) {
  userId = validateUserId(userId, 'userId');
  const result = await database.execute({
    sql: `
      SELECT DISTINCT trial_key
      FROM trial_progress
      WHERE user_id = ?
      ORDER BY trial_key
    `,
    args: [userId]
  });

  const completedTrialKeys = result.rows.map(row => row.trial_key);
  const completedCount = completedTrialKeys.length;
  return {
    completedTrialKeys,
    completedCount,
    totalCount: 3,
    graduated: completedCount === 3
  };
}

async function reviewTrialSubmission(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError('Trial review data must be an object.');
  }
  const { submissionId } = data;
  validateSubmissionId(submissionId);
  const reviewerId = validateUserId(data.reviewerId, 'reviewerId');
  if (typeof data.reviewerName !== 'string' || !data.reviewerName.trim()) {
    throw new TypeError('reviewerName must be a non-empty string.');
  }
  const reviewerName = data.reviewerName.trim();
  if (!['approved', 'rejected'].includes(data.decision)) {
    throw new RangeError("decision must be 'approved' or 'rejected'.");
  }

  const roleStatuses = data.packMemberRoleStatuses;
  if (!roleStatuses || typeof roleStatuses !== 'object' || Array.isArray(roleStatuses)) {
    throw new TypeError('packMemberRoleStatuses must be an object.');
  }
  const prototype = Object.getPrototypeOf(roleStatuses);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('packMemberRoleStatuses must be a plain object.');
  }

  const roleStatusByUserId = new Map();
  for (const key of Reflect.ownKeys(roleStatuses)) {
    if (typeof key !== 'string') throw new TypeError('packMemberRoleStatuses cannot contain symbol keys.');
    const descriptor = Object.getOwnPropertyDescriptor(roleStatuses, key);
    if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new TypeError('packMemberRoleStatuses entries must be enumerable boolean values.');
    }
    const userId = validateUserId(key, 'packMemberRoleStatuses user ID');
    if (typeof descriptor.value !== 'boolean') {
      throw new TypeError(`packMemberRoleStatuses[${userId}] must be a boolean.`);
    }
    if (roleStatusByUserId.has(userId)) {
      throw new RangeError('packMemberRoleStatuses cannot contain duplicate user IDs.');
    }
    roleStatusByUserId.set(userId, descriptor.value);
  }

  return database.withTransaction(async tx => {
    const submissionResult = await tx.execute({
      sql: 'SELECT id, trial_key, status FROM trial_submissions WHERE id = ?',
      args: [submissionId]
    });
    const submission = submissionResult.rows[0];
    if (!submission) throw new Error(`Trial submission #${submissionId} was not found.`);
    if (submission.status !== 'pending') {
      throw new Error(`Trial submission #${submissionId} has already been reviewed.`);
    }

    const completersResult = await tx.execute({
      sql: 'SELECT user_id FROM trial_completers WHERE submission_id = ? ORDER BY id',
      args: [submissionId]
    });
    const packMembersResult = await tx.execute({
      sql: 'SELECT user_id FROM trial_pack_members WHERE submission_id = ? ORDER BY id',
      args: [submissionId]
    });
    const completers = completersResult.rows;
    const packMembers = packMembersResult.rows;

    if (data.decision === 'approved') {
      const packIds = new Set(packMembers.map(member => member.user_id));
      for (const userId of packIds) {
        if (!roleStatusByUserId.has(userId)) {
          throw new TypeError(`Current Unproven role status is missing for Pack Member ${userId}.`);
        }
      }
      for (const userId of roleStatusByUserId.keys()) {
        if (!packIds.has(userId)) {
          throw new TypeError(`Role status was supplied for non-Pack Member ${userId}.`);
        }
      }
    }

    const statusUpdate = await tx.execute({
      sql: `
        UPDATE trial_submissions
        SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'pending'
      `,
      args: [data.decision, reviewerId, submissionId]
    });
    if (Number(statusUpdate.rowsAffected) !== 1) {
      throw new Error(`Trial submission #${submissionId} is no longer pending review.`);
    }

    const progressionAwards = [];
    const pointsAwards = [];
    const zeroPointPackMembers = [];

    if (data.decision === 'approved') {
      for (const completer of completers) {
        const progressInsert = await tx.execute({
          sql: `
            INSERT OR IGNORE INTO trial_progress (
              user_id, trial_key, submission_id, completed_at
            ) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          `,
          args: [completer.user_id, submission.trial_key, submissionId]
        });
        const countResult = await tx.execute({
          sql: 'SELECT COUNT(DISTINCT trial_key) AS completed_count FROM trial_progress WHERE user_id = ?',
          args: [completer.user_id]
        });
        const completedTrialCount = Number(countResult.rows[0].completed_count);
        progressionAwards.push({
          userId: completer.user_id,
          trialKey: submission.trial_key,
          awarded: Number(progressInsert.rowsAffected) === 1,
          completedTrialCount,
          graduated: completedTrialCount === 3
        });
      }

      for (const packMember of packMembers) {
        const hasUnprovenRole = roleStatusByUserId.get(packMember.user_id);
        const pointsAwarded = hasUnprovenRole ? 0 : 2;
        const updateResult = await tx.execute({
          sql: `
            UPDATE trial_pack_members
            SET unproven_role_at_review = ?, points_awarded = ?
            WHERE submission_id = ? AND user_id = ?
          `,
          args: [hasUnprovenRole ? 1 : 0, pointsAwarded, submissionId, packMember.user_id]
        });
        if (Number(updateResult.rowsAffected) !== 1) {
          throw new Error(`Could not save review details for Pack Member ${packMember.user_id}.`);
        }

        if (pointsAwarded > 0) {
          await tx.execute({
            sql: `
              INSERT INTO trial_score_ledger (
                submission_id, user_id, base_points, bonus_points, points
              ) VALUES (?, ?, 2, 0, 2)
            `,
            args: [submissionId, packMember.user_id]
          });
        } else {
          zeroPointPackMembers.push(packMember.user_id);
        }

        pointsAwards.push({
          userId: packMember.user_id,
          pointsAwarded,
          unprovenRoleAtReview: hasUnprovenRole,
          zeroPointReason: hasUnprovenRole ? 'Currently has the Unproven role.' : null
        });
      }
    }

    await tx.execute({
      sql: `
        INSERT INTO trial_audit_log (
          submission_id, reviewer_id, reviewer_name, decision,
          progression_awards, points_awards
        ) VALUES (?, ?, ?, ?, ?, ?)
      `,
      args: [
        submissionId,
        reviewerId,
        reviewerName,
        data.decision,
        JSON.stringify(progressionAwards),
        JSON.stringify(pointsAwards)
      ]
    });

    return {
      submissionId,
      decision: data.decision,
      progressionAwards,
      pointsAwards,
      zeroPointPackMembers
    };
  });
}

async function setTrialDiscordReferences(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError('Trial Discord reference data must be an object.');
  }
  const { submissionId } = data;
  validateSubmissionId(submissionId);
  const reviewMessageId = validateUserId(data.reviewMessageId, 'reviewMessageId');
  const evidenceThreadId = data.evidenceThreadId === null
    ? null
    : validateUserId(data.evidenceThreadId, 'evidenceThreadId');

  const result = await database.execute({
    sql: `
      UPDATE trial_submissions
      SET review_message_id = ?, evidence_thread_id = ?
      WHERE id = ? AND status = 'pending'
    `,
    args: [reviewMessageId, evidenceThreadId, submissionId]
  });
  if (Number(result.rowsAffected) !== 1) {
    throw new Error(`Could not save Discord references for pending Trial submission #${submissionId}.`);
  }
  return { submissionId, reviewMessageId, evidenceThreadId };
}

async function deletePendingTrialSubmission(submissionId) {
  validateSubmissionId(submissionId);

  return database.withTransaction(async tx => {
    const result = await tx.execute({
      sql: 'SELECT status FROM trial_submissions WHERE id = ?',
      args: [submissionId]
    });
    const submission = result.rows[0];
    if (!submission) return false;
    if (submission.status !== 'pending') {
      throw new Error(`Cannot delete Trial submission #${submissionId}: it has already been reviewed.`);
    }

    await tx.execute({
      sql: 'DELETE FROM trial_completers WHERE submission_id = ?',
      args: [submissionId]
    });
    await tx.execute({
      sql: 'DELETE FROM trial_pack_members WHERE submission_id = ?',
      args: [submissionId]
    });
    const deleted = await tx.execute({
      sql: "DELETE FROM trial_submissions WHERE id = ? AND status = 'pending'",
      args: [submissionId]
    });
    if (Number(deleted.rowsAffected) !== 1) {
      throw new Error(`Trial submission #${submissionId} changed while cleanup was running.`);
    }
    return true;
  });
}

module.exports = {
  createTrialSubmission,
  getTrialSubmission,
  getMemberTrialProgress,
  getGraduatedMemberIds,
  reviewTrialSubmission,
  setTrialDiscordReferences,
  deletePendingTrialSubmission
};
