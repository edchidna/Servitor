
const Database = require('./database');
const { EmbedBuilder } = require('discord.js');

// ==========================================
// LEADERBOARD CONFIGURATION
// ==========================================

const LEADERBOARD_SETTING_KEY = 'leaderboard_message_id';
const LEADERBOARD_LIMIT = 10;

// ==========================================
// FORMAT POINTS
// ==========================================

function formatPoints(points) {
  return Number(points).toLocaleString('en-US', {
    maximumFractionDigits: 2
  });
}

// ==========================================
// GET COMBINED LEADERBOARD SCORES
// ==========================================


function getLeaderboardScores() {
  return Database.prepare(`
    SELECT
      user_id,
      SUM(points) AS total_points
    FROM (
      -- Approved AAR reports
      SELECT
        sl.user_id,
        sl.points
      FROM score_ledger sl
      INNER JOIN reports r
        ON r.id = sl.report_id
      WHERE r.status = 'approved'

      UNION ALL

      -- Approved Unproven Trial submissions
      SELECT
        tsl.user_id,
        tsl.points
      FROM trial_score_ledger tsl
      INNER JOIN trial_submissions ts
        ON ts.id = tsl.submission_id
      WHERE ts.status = 'approved'
    )
    GROUP BY user_id
    ORDER BY total_points DESC, user_id ASC
    LIMIT ?
  `).all(LEADERBOARD_LIMIT);
}


// ==========================================
// BUILD LEADERBOARD EMBED
// ==========================================

function createLeaderboardEmbed(scores) {
  let description;

  if (scores.length === 0) {
    description =
      'No approved AAR or Unproven Trial points have been awarded yet.';
  } else {
    let previousPoints = null;
    let currentRank = 0;

    description = scores.map((member, index) => {
      const points = Number(member.total_points);

      if (previousPoints === null || points !== previousPoints) {
        currentRank = index + 1;
      }

      previousPoints = points;

      return (
        `**${currentRank}.** <@${member.user_id}>` +
        ` — **${formatPoints(points)} points**`
      );
    }).join('\n');
  }

  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('SPACE MARINE 2 — AAR LEADERBOARD')
    .setDescription(description)
    .setFooter({
      text: 'All-time rankings | Approved AAR Reports + Unproven Trials'
    })
    .setTimestamp();
}

// ==========================================
// REFRESH PERSISTENT LEADERBOARD
// ==========================================

async function refreshLeaderboard(client) {

  const channelId = process.env.LEADERBOARD_CHANNEL_ID;

  if (!channelId) {
    throw new Error(
      'LEADERBOARD_CHANNEL_ID is missing from .env'
    );
  }

  // ----------------------------------------
  // FETCH LEADERBOARD CHANNEL
  // ----------------------------------------

  const channel = await client.channels.fetch(channelId);

  if (
    !channel ||
    !channel.isTextBased() ||
    !channel.isSendable()
  ) {
    throw new Error(
      'The configured leaderboard channel is unavailable or cannot receive messages.'
    );
  }

  // ----------------------------------------
  // BUILD CURRENT LEADERBOARD
  // ----------------------------------------

  const scores = getLeaderboardScores();
  const leaderboardEmbed = createLeaderboardEmbed(scores);

  // ----------------------------------------
  // GET SAVED MESSAGE ID
  // ----------------------------------------

  const savedSetting = Database.prepare(`
    SELECT setting_value
    FROM bot_settings
    WHERE setting_key = ?
  `).get(LEADERBOARD_SETTING_KEY);

  let leaderboardMessage = null;

  // ----------------------------------------
  // FIND EXISTING LEADERBOARD MESSAGE
  // ----------------------------------------

  if (savedSetting) {

    try {
      leaderboardMessage = await channel.messages.fetch(
        savedSetting.setting_value
      );

    } catch (error) {

      // Discord error 10008 means the saved message
      // no longer exists.

      if (Number(error.code) === 10008) {

        console.log(
          'Previous leaderboard message was deleted. Creating a new one.'
        );

      } else {
        throw error;
      }
    }
  }

  // ----------------------------------------
  // UPDATE EXISTING MESSAGE
  // ----------------------------------------

  if (leaderboardMessage) {

    await leaderboardMessage.edit({
      embeds: [leaderboardEmbed],
      allowedMentions: {
        parse: []
      }
    });

    console.log('Leaderboard updated successfully.');

    return leaderboardMessage;
  }

  // ----------------------------------------
  // CREATE NEW LEADERBOARD MESSAGE
  // ----------------------------------------

  leaderboardMessage = await channel.send({
    embeds: [leaderboardEmbed],
    allowedMentions: {
      parse: []
    }
  });

  // ----------------------------------------
  // SAVE MESSAGE ID
  // ----------------------------------------

  Database.prepare(`
    INSERT INTO bot_settings (
      setting_key,
      setting_value
    )
    VALUES (?, ?)
    ON CONFLICT(setting_key)
    DO UPDATE SET setting_value = excluded.setting_value
  `).run(
    LEADERBOARD_SETTING_KEY,
    leaderboardMessage.id
  );

  console.log('Leaderboard message created successfully.');

  return leaderboardMessage;
}

// ==========================================
// EXPORT LEADERBOARD FUNCTION
// ==========================================

module.exports = {
  refreshLeaderboard
};
