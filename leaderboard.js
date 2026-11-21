'use strict';

const database = require('./turso-database');
const { EmbedBuilder } = require('discord.js');

const LEADERBOARD_SETTING_KEY = 'leaderboard_message_id';
const LEADERBOARD_LIMIT = 10;

function formatPoints(points) {
  return Number(points).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

async function getLeaderboardScores() {
  const result = await database.execute({
    sql: `SELECT user_id, SUM(points) AS total_points
          FROM (
            SELECT sl.user_id, sl.points
            FROM score_ledger sl
            INNER JOIN reports r ON r.id = sl.report_id
            WHERE r.status = 'approved'
            UNION ALL
            SELECT tsl.user_id, tsl.points
            FROM trial_score_ledger tsl
            INNER JOIN trial_submissions ts ON ts.id = tsl.submission_id
            WHERE ts.status = 'approved'
            UNION ALL
            SELECT user_id, points_delta AS points
            FROM saga_point_adjustments
          )
          GROUP BY user_id
          ORDER BY total_points DESC, user_id ASC
          LIMIT ?`,
    args: [LEADERBOARD_LIMIT]
  });
  return result.rows;
}

function createLeaderboardEmbed(scores) {
  let description;
  if (!scores.length) description = 'No Saga Points have been recorded yet.';
  else {
    let previousPoints = null;
    let currentRank = 0;
    description = scores.map((member, index) => {
      const points = Number(member.total_points);
      if (previousPoints === null || points !== previousPoints) currentRank = index + 1;
      previousPoints = points;
      return `**${currentRank}.** <@${member.user_id}> — **${formatPoints(points)} points**`;
    }).join('\n');
  }
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('SPACE MARINE 2 — SAGA POINTS LEADERBOARD')
    .setDescription(description)
    .setFooter({ text: 'All-time Saga Points | AAR + Trials + Manual Adjustments' })
    .setTimestamp();
}

let leaderboardRefreshQueue = Promise.resolve();

function refreshLeaderboard(client) {
  // Serialize refreshes so simultaneous approvals cannot create duplicate
  // leaderboard messages or overwrite a newer score snapshot with an older one.
  const refresh = leaderboardRefreshQueue.then(
    () => refreshLeaderboardInternal(client)
  );
  leaderboardRefreshQueue = refresh.catch(() => {});
  return refresh;
}

async function refreshLeaderboardInternal(client) {
  const channelId = process.env.LEADERBOARD_CHANNEL_ID;
  if (!channelId) throw new Error('LEADERBOARD_CHANNEL_ID is missing from .env');
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased() || !channel.isSendable()) {
    throw new Error('The configured leaderboard channel is unavailable or cannot receive messages.');
  }

  const scores = await getLeaderboardScores();
  const embed = createLeaderboardEmbed(scores);
  const saved = await database.execute({
    sql: 'SELECT setting_value FROM bot_settings WHERE setting_key = ?',
    args: [LEADERBOARD_SETTING_KEY]
  });
  let message = null;
  if (saved.rows[0]) {
    try {
      message = await channel.messages.fetch(saved.rows[0].setting_value);
    } catch (error) {
      if (Number(error.code) === 10008) {
        console.log('Previous leaderboard message was deleted. Creating a new one.');
      } else throw error;
    }
  }

  if (message) {
    await message.edit({ embeds: [embed], allowedMentions: { parse: [] } });
    console.log('Leaderboard updated successfully.');
    return message;
  }

  message = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  await database.execute({
    sql: `INSERT INTO bot_settings (setting_key, setting_value) VALUES (?, ?)
          ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
    args: [LEADERBOARD_SETTING_KEY, message.id]
  });
  console.log('Leaderboard message created successfully.');
  return message;
}

module.exports = { refreshLeaderboard };
