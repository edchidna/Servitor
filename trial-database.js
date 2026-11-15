// ==========================================
// UNPROVEN TRIALS DATABASE TABLES
// ==========================================

const db = require('./database');

db.exec(`
  CREATE TABLE IF NOT EXISTS trial_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submitter_id TEXT NOT NULL,
    trial_key TEXT NOT NULL
      CHECK (trial_key IN ('trial_1', 'trial_2', 'trial_3')),
    evidence TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'approved', 'rejected')),
    review_message_id TEXT,
    evidence_thread_id TEXT,
    reviewed_by TEXT,
    reviewed_at TEXT,
    review_reason TEXT,
    suspicious_flag INTEGER NOT NULL DEFAULT 0,
    suspicious_details TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS trial_completers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    unproven_role_at_submission INTEGER NOT NULL DEFAULT 0,

    FOREIGN KEY (submission_id)
      REFERENCES trial_submissions(id),

    UNIQUE (submission_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS trial_pack_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    unproven_role_at_submission INTEGER NOT NULL DEFAULT 0,
    unproven_role_at_review INTEGER,
    points_awarded REAL NOT NULL DEFAULT 0,

    FOREIGN KEY (submission_id)
      REFERENCES trial_submissions(id),

    UNIQUE (submission_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS trial_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    trial_key TEXT NOT NULL
      CHECK (trial_key IN ('trial_1', 'trial_2', 'trial_3')),
    submission_id INTEGER NOT NULL,
    completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (submission_id)
      REFERENCES trial_submissions(id),

    UNIQUE (user_id, trial_key)
  );

  CREATE TABLE IF NOT EXISTS trial_score_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    base_points REAL NOT NULL DEFAULT 2,
    bonus_points REAL NOT NULL DEFAULT 0,
    points REAL NOT NULL DEFAULT 2,
    awarded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (submission_id)
      REFERENCES trial_submissions(id),

    UNIQUE (submission_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS trial_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL UNIQUE,
    reviewer_id TEXT NOT NULL,
    reviewer_name TEXT NOT NULL,
    decision TEXT NOT NULL
      CHECK (decision IN ('approved', 'rejected')),
    progression_awards TEXT NOT NULL DEFAULT '[]',
    points_awards TEXT NOT NULL DEFAULT '[]',
    reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (submission_id)
      REFERENCES trial_submissions(id)
  );

  CREATE INDEX IF NOT EXISTS idx_trial_submissions_status
  ON trial_submissions(status);

  CREATE INDEX IF NOT EXISTS idx_trial_submissions_submitter
  ON trial_submissions(submitter_id);

  CREATE INDEX IF NOT EXISTS idx_trial_completers_user
  ON trial_completers(user_id);

  CREATE INDEX IF NOT EXISTS idx_trial_pack_members_user
  ON trial_pack_members(user_id);

  CREATE INDEX IF NOT EXISTS idx_trial_progress_user
  ON trial_progress(user_id);

  CREATE INDEX IF NOT EXISTS idx_trial_score_ledger_user
  ON trial_score_ledger(user_id);
`);

console.log('Unproven Trials database tables initialized.');

function validateUserId(userId, fieldName) {
  if (typeof userId !== 'string' || userId.trim().length === 0) {
    throw new TypeError(`${fieldName} must be a non-empty string.`);
  }

  return userId.trim();
}

function validateParticipants(participants, fieldName) {
  if (!Array.isArray(participants) || participants.length < 1 || participants.length > 2) {
    throw new RangeError(`${fieldName} must contain 1 or 2 participants.`);
  }

  const seenUserIds = new Set();

  return participants.map((participant, index) => {
    if (
      participant === null ||
      typeof participant !== 'object' ||
      Array.isArray(participant)
    ) {
      throw new TypeError(
        `${fieldName}[${index}] must be an object with user_id and unproven_role_at_submission.`
      );
    }

    const userId = validateUserId(
      participant.user_id,
      `${fieldName}[${index}].user_id`
    );

    if (seenUserIds.has(userId)) {
      throw new RangeError(`${fieldName} must not contain duplicate user IDs.`);
    }
    seenUserIds.add(userId);

    const roleStatus = participant.unproven_role_at_submission;
    if (
      roleStatus !== true &&
      roleStatus !== false &&
      roleStatus !== 0 &&
      roleStatus !== 1
    ) {
      throw new TypeError(
        `${fieldName}[${index}].unproven_role_at_submission must be a boolean or 0/1.`
      );
    }

    return {
      user_id: userId,
      unproven_role_at_submission: roleStatus === true || roleStatus === 1
        ? 1
        : 0
    };
  });
}

function assertJsonSafe(value, fieldName, ancestors = new Set(), valuePath = fieldName) {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${valuePath} must be a finite number.`);
    }
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
  if (
    !isArray &&
    prototype !== Object.prototype &&
    prototype !== null
  ) {
    throw new TypeError(`${valuePath} must contain only plain objects.`);
  }

  ancestors.add(value);

  try {
    const ownKeys = Reflect.ownKeys(value);

    for (const key of ownKeys) {
      if (typeof key === 'symbol') {
        throw new TypeError(`${valuePath} cannot contain symbol keys.`);
      }

      if (isArray) {
        if (key === 'length') {
          continue;
        }

        const index = Number(key);
        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >= value.length ||
          String(index) !== key
        ) {
          throw new TypeError(`${valuePath} cannot contain non-index array properties.`);
        }
      }

      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw new TypeError(`${valuePath}.${key} must be an enumerable data property.`);
      }

      assertJsonSafe(
        descriptor.value,
        fieldName,
        ancestors,
        `${valuePath}.${key}`
      );
    }

    if (isArray && ownKeys.filter(key => key !== 'length').length !== value.length) {
      throw new TypeError(`${valuePath} cannot contain sparse array entries.`);
    }
  } finally {
    ancestors.delete(value);
  }
}

function serializeJson(value, fieldName) {
  assertJsonSafe(value, fieldName);

  let serialized;

  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new TypeError(`${fieldName} must contain valid JSON data.`, {
      cause: error
    });
  }

  if (typeof serialized !== 'string') {
    throw new TypeError(`${fieldName} must contain valid JSON data.`);
  }

  try {
    JSON.parse(serialized);
  } catch (error) {
    throw new TypeError(`${fieldName} could not be serialized as valid JSON.`, {
      cause: error
    });
  }

  return serialized;
}

function parseJsonArray(value, fieldName) {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      throw new TypeError('Stored value is not a JSON array.');
    }
    return parsed;
  } catch (error) {
    console.error(`Could not parse ${fieldName}:`, error.message);
    return [];
  }
}

function createTrialSubmission(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError('Trial submission data must be an object.');
  }

  const submitterId = validateUserId(data.submitterId, 'submitterId');
  const allowedTrialKeys = ['trial_1', 'trial_2', 'trial_3'];
  if (!allowedTrialKeys.includes(data.trialKey)) {
    throw new RangeError('trialKey must be trial_1, trial_2, or trial_3.');
  }

  if (!Array.isArray(data.evidence) || data.evidence.length < 1 || data.evidence.length > 6) {
    throw new RangeError('evidence must contain 1 to 6 items.');
  }

  const evidenceJson = serializeJson(data.evidence, 'evidence');
  const suspiciousFlag = data.suspiciousFlag === undefined
    ? 0
    : data.suspiciousFlag;

  if (
    suspiciousFlag !== true &&
    suspiciousFlag !== false &&
    suspiciousFlag !== 0 &&
    suspiciousFlag !== 1
  ) {
    throw new TypeError('suspiciousFlag must be a boolean or 0/1.');
  }

  const suspiciousDetails = data.suspiciousDetails === undefined
    ? []
    : data.suspiciousDetails;
  if (!Array.isArray(suspiciousDetails)) {
    throw new TypeError('suspiciousDetails must be an array.');
  }
  const suspiciousDetailsJson = serializeJson(
    suspiciousDetails,
    'suspiciousDetails'
  );

  const completers = validateParticipants(data.completers, 'completers');
  const packMembers = validateParticipants(data.packMembers, 'packMembers');

  if (completers.length + packMembers.length > 3) {
    throw new RangeError(
      'The combined completer and Pack Member count cannot exceed 3.'
    );
  }

  const completerIds = new Set(
    completers.map(participant => participant.user_id)
  );
  if (packMembers.some(participant => completerIds.has(participant.user_id))) {
    throw new RangeError(
      'A person cannot appear as both a completer and a Pack Member.'
    );
  }

  const insertSubmission = db.prepare(`
    INSERT INTO trial_submissions (
      submitter_id,
      trial_key,
      evidence,
      suspicious_flag,
      suspicious_details
    )
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertCompleter = db.prepare(`
    INSERT INTO trial_completers (
      submission_id,
      user_id,
      unproven_role_at_submission
    )
    VALUES (?, ?, ?)
  `);

  const insertPackMember = db.prepare(`
    INSERT INTO trial_pack_members (
      submission_id,
      user_id,
      unproven_role_at_submission
    )
    VALUES (?, ?, ?)
  `);

  const saveSubmission = db.transaction(() => {
    const result = insertSubmission.run(
      submitterId,
      data.trialKey,
      evidenceJson,
      suspiciousFlag === true || suspiciousFlag === 1 ? 1 : 0,
      suspiciousDetailsJson
    );
    const submissionId = Number(result.lastInsertRowid);

    for (const completer of completers) {
      insertCompleter.run(
        submissionId,
        completer.user_id,
        completer.unproven_role_at_submission
      );
    }

    for (const packMember of packMembers) {
      insertPackMember.run(
        submissionId,
        packMember.user_id,
        packMember.unproven_role_at_submission
      );
    }

    return submissionId;
  });

  return saveSubmission();
}

function getTrialSubmission(submissionId) {
  if (!Number.isSafeInteger(submissionId) || submissionId <= 0) {
    throw new TypeError('submissionId must be a positive safe integer.');
  }

  const submission = db.prepare(`
    SELECT *
    FROM trial_submissions
    WHERE id = ?
  `).get(submissionId);

  if (!submission) {
    return null;
  }

  const completers = db.prepare(`
    SELECT user_id, unproven_role_at_submission
    FROM trial_completers
    WHERE submission_id = ?
    ORDER BY id
  `).all(submissionId);

  const packMembers = db.prepare(`
    SELECT
      user_id,
      unproven_role_at_submission,
      unproven_role_at_review,
      points_awarded
    FROM trial_pack_members
    WHERE submission_id = ?
    ORDER BY id
  `).all(submissionId);

  return {
    ...submission,
    evidence: parseJsonArray(
      submission.evidence,
      `evidence for Trial submission #${submissionId}`
    ),
    suspicious_details: parseJsonArray(
      submission.suspicious_details,
      `suspicious details for Trial submission #${submissionId}`
    ),
    completers,
    pack_members: packMembers
  };
}

function getMemberTrialProgress(userId) {
  validateUserId(userId, 'userId');

  const completedTrialKeys = db.prepare(`
    SELECT DISTINCT trial_key
    FROM trial_progress
    WHERE user_id = ?
    ORDER BY trial_key
  `).all(userId).map(row => row.trial_key);

  const totalCount = 3;
  const completedCount = completedTrialKeys.length;

  return {
    completedTrialKeys,
    completedCount,
    totalCount,
    graduated: completedCount === totalCount
  };
}

function reviewTrialSubmission(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError('Trial review data must be an object.');
  }

  const { submissionId } = data;
  if (!Number.isSafeInteger(submissionId) || submissionId <= 0) {
    throw new TypeError('submissionId must be a positive safe integer.');
  }

  const reviewerId = validateUserId(data.reviewerId, 'reviewerId');
  if (
    typeof data.reviewerName !== 'string' ||
    data.reviewerName.trim().length === 0
  ) {
    throw new TypeError('reviewerName must be a non-empty string.');
  }
  const reviewerName = data.reviewerName.trim();

  if (data.decision !== 'approved' && data.decision !== 'rejected') {
    throw new RangeError("decision must be 'approved' or 'rejected'.");
  }

  const roleStatuses = data.packMemberRoleStatuses;
  if (
    roleStatuses === null ||
    typeof roleStatuses !== 'object' ||
    Array.isArray(roleStatuses)
  ) {
    throw new TypeError('packMemberRoleStatuses must be an object.');
  }
  const roleStatusesPrototype = Object.getPrototypeOf(roleStatuses);
  if (
    roleStatusesPrototype !== Object.prototype &&
    roleStatusesPrototype !== null
  ) {
    throw new TypeError('packMemberRoleStatuses must be a plain object.');
  }

  const roleStatusByUserId = new Map();
  for (const key of Reflect.ownKeys(roleStatuses)) {
    if (typeof key !== 'string') {
      throw new TypeError('packMemberRoleStatuses cannot contain symbol keys.');
    }

    const descriptor = Object.getOwnPropertyDescriptor(roleStatuses, key);
    if (
      !descriptor.enumerable ||
      !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ) {
      throw new TypeError(
        'packMemberRoleStatuses entries must be enumerable boolean values.'
      );
    }

    const userId = validateUserId(
      key,
      'packMemberRoleStatuses user ID'
    );
    if (roleStatusByUserId.has(userId)) {
      throw new RangeError(
        'packMemberRoleStatuses cannot contain duplicate user IDs.'
      );
    }
    if (typeof descriptor.value !== 'boolean') {
      throw new TypeError(
        `packMemberRoleStatuses[${userId}] must be a boolean.`
      );
    }

    roleStatusByUserId.set(userId, descriptor.value);
  }

  const review = db.transaction(() => {
    const submission = db.prepare(`
      SELECT id, trial_key, status
      FROM trial_submissions
      WHERE id = ?
    `).get(submissionId);

    if (!submission) {
      throw new Error(`Trial submission #${submissionId} was not found.`);
    }
    if (submission.status !== 'pending') {
      throw new Error(
        `Trial submission #${submissionId} has already been reviewed.`
      );
    }

    const completers = db.prepare(`
      SELECT user_id
      FROM trial_completers
      WHERE submission_id = ?
      ORDER BY id
    `).all(submissionId);

    const packMembers = db.prepare(`
      SELECT user_id
      FROM trial_pack_members
      WHERE submission_id = ?
      ORDER BY id
    `).all(submissionId);

    if (data.decision === 'approved') {
      const packMemberIds = new Set(
        packMembers.map(packMember => packMember.user_id)
      );

      for (const userId of packMemberIds) {
        if (!roleStatusByUserId.has(userId)) {
          throw new TypeError(
            `Current Unproven role status is missing for Pack Member ${userId}.`
          );
        }
      }

      for (const userId of roleStatusByUserId.keys()) {
        if (!packMemberIds.has(userId)) {
          throw new TypeError(
            `Role status was supplied for non-Pack Member ${userId}.`
          );
        }
      }
    }

    const updateSubmission = db.prepare(`
      UPDATE trial_submissions
      SET
        status = ?,
        reviewed_by = ?,
        reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND status = 'pending'
    `).run(
      data.decision,
      reviewerId,
      submissionId
    );

    if (updateSubmission.changes !== 1) {
      throw new Error(
        `Trial submission #${submissionId} is no longer pending review.`
      );
    }

    let progressionAwards = [];
    let pointsAwards = [];
    let zeroPointPackMembers = [];

    if (data.decision === 'approved') {
      const insertProgress = db.prepare(`
        INSERT OR IGNORE INTO trial_progress (
          user_id,
          trial_key,
          submission_id,
          completed_at
        )
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `);

      const getProgressCount = db.prepare(`
        SELECT COUNT(DISTINCT trial_key) AS completed_count
        FROM trial_progress
        WHERE user_id = ?
      `);

      progressionAwards = completers.map(completer => {
        const progressInsert = insertProgress.run(
          completer.user_id,
          submission.trial_key,
          submissionId
        );
        const completedTrialCount = getProgressCount.get(
          completer.user_id
        ).completed_count;

        return {
          userId: completer.user_id,
          trialKey: submission.trial_key,
          awarded: progressInsert.changes === 1,
          completedTrialCount,
          graduated: progressInsert.changes === 1 && completedTrialCount === 3
        };
      });

      const updatePackMember = db.prepare(`
        UPDATE trial_pack_members
        SET
          unproven_role_at_review = ?,
          points_awarded = ?
        WHERE submission_id = ?
          AND user_id = ?
      `);

      const insertScore = db.prepare(`
        INSERT INTO trial_score_ledger (
          submission_id,
          user_id,
          base_points,
          bonus_points,
          points
        )
        VALUES (?, ?, 2, 0, 2)
      `);

      pointsAwards = packMembers.map(packMember => {
        const hasUnprovenRole = roleStatusByUserId.get(packMember.user_id);
        const pointsAwarded = hasUnprovenRole ? 0 : 2;
        const updateResult = updatePackMember.run(
          hasUnprovenRole ? 1 : 0,
          pointsAwarded,
          submissionId,
          packMember.user_id
        );

        if (updateResult.changes !== 1) {
          throw new Error(
            `Could not save review details for Pack Member ${packMember.user_id}.`
          );
        }

        if (pointsAwarded > 0) {
          insertScore.run(
            submissionId,
            packMember.user_id
          );
        } else {
          zeroPointPackMembers.push(packMember.user_id);
        }

        return {
          userId: packMember.user_id,
          pointsAwarded,
          unprovenRoleAtReview: hasUnprovenRole,
          zeroPointReason: hasUnprovenRole
            ? 'Currently has the Unproven role.'
            : null
        };
      });
    }

    db.prepare(`
      INSERT INTO trial_audit_log (
        submission_id,
        reviewer_id,
        reviewer_name,
        decision,
        progression_awards,
        points_awards
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      submissionId,
      reviewerId,
      reviewerName,
      data.decision,
      JSON.stringify(progressionAwards),
      JSON.stringify(pointsAwards)
    );

    return {
      submissionId,
      decision: data.decision,
      progressionAwards,
      pointsAwards,
      zeroPointPackMembers
    };
  });

  return review();
}

function setTrialDiscordReferences(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError('Trial Discord reference data must be an object.');
  }

  const { submissionId } = data;

  if (!Number.isSafeInteger(submissionId) || submissionId <= 0) {
    throw new TypeError('submissionId must be a positive safe integer.');
  }

  const reviewMessageId = validateUserId(
    data.reviewMessageId,
    'reviewMessageId'
  );

  const evidenceThreadId = data.evidenceThreadId === null
    ? null
    : validateUserId(data.evidenceThreadId, 'evidenceThreadId');

  const result = db.prepare(`
    UPDATE trial_submissions
    SET
      review_message_id = ?,
      evidence_thread_id = ?
    WHERE id = ?
      AND status = 'pending'
  `).run(
    reviewMessageId,
    evidenceThreadId,
    submissionId
  );

  if (result.changes !== 1) {
    throw new Error(
      `Could not save Discord references for pending Trial submission #${submissionId}.`
    );
  }

  return {
    submissionId,
    reviewMessageId,
    evidenceThreadId
  };
}

// ==========================================
// DELETE FAILED PENDING TRIAL SUBMISSION
// ==========================================

function deletePendingTrialSubmission(submissionId) {
  if (!Number.isSafeInteger(submissionId) || submissionId <= 0) {
    throw new TypeError('submissionId must be a positive safe integer.');
  }

  const deleteSubmission = db.transaction(() => {
    const submission = db.prepare(`
      SELECT status
      FROM trial_submissions
      WHERE id = ?
    `).get(submissionId);

    if (!submission) {
      return false;
    }

    if (submission.status !== 'pending') {
      throw new Error(
        `Cannot delete Trial submission #${submissionId}: it has already been reviewed.`
      );
    }

    db.prepare(`
      DELETE FROM trial_completers
      WHERE submission_id = ?
    `).run(submissionId);

    db.prepare(`
      DELETE FROM trial_pack_members
      WHERE submission_id = ?
    `).run(submissionId);

    db.prepare(`
      DELETE FROM trial_submissions
      WHERE id = ? AND status = 'pending'
    `).run(submissionId);

    return true;
  });

  return deleteSubmission();
}

module.exports = {
  db,
  createTrialSubmission,
  getTrialSubmission,
  getMemberTrialProgress,
  reviewTrialSubmission,
  setTrialDiscordReferences,
  deletePendingTrialSubmission
};
