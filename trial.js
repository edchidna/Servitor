require('dotenv').config();

const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    ModalBuilder,
    LabelBuilder,
    StringSelectMenuBuilder,
    UserSelectMenuBuilder,
    FileUploadBuilder,
    AttachmentBuilder

} = require('discord.js');

const trialDatabase = require('./trial-database');
const db = trialDatabase.db;
const { refreshLeaderboard } = require('./leaderboard');

// ==========================================
// UNPROVEN TRIAL CONFIGURATION
// ==========================================

const TRIAL_PANEL_CHANNEL_ID = process.env.TRIAL_PANEL_CHANNEL_ID;
const TRIAL_REVIEW_CHANNEL_ID = process.env.TRIAL_REVIEW_CHANNEL_ID;
const NCO_REVIEW_CHANNEL_ID = process.env.NCO_REVIEW_CHANNEL_ID;

const UNPROVEN_ROLE_ID = process.env.UNPROVEN_ROLE_ID;
const NCO_ROLE_ID = process.env.NCO_ROLE_ID;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
const MODERATOR_ROLE_ID = process.env.MODERATOR_ROLE_ID;
const IRON_WOLVES_ROLE_ID = process.env.IRON_WOLVES_ROLE_ID;

const TRIAL_BUTTON_ID = 'trial_open_form';
const TRIAL_MODAL_ID = 'trial_submission_form';

// ==========================================
// TRIAL CONFIGURATION VALIDATION
// ==========================================

const requiredTrialVariables = [
    'TRIAL_PANEL_CHANNEL_ID',
    'TRIAL_REVIEW_CHANNEL_ID',
    'NCO_REVIEW_CHANNEL_ID',
    'UNPROVEN_ROLE_ID',
    'NCO_ROLE_ID',
    'ADMIN_ROLE_ID',
    'MODERATOR_ROLE_ID',
    'IRON_WOLVES_ROLE_ID'
];

for (const variable of requiredTrialVariables) {
    if (!process.env[variable]) {
        throw new Error(`${variable} is missing from .env`);
    }
}

// ==========================================
// TRIAL PANEL
// ==========================================

function createTrialPanelPayload() {
    const embed = new EmbedBuilder()
        .setTitle('Unproven Trial')
        .setDescription(
            [
                'Complete the Unproven Trials and prove your worth.',
                '',
                '**Submission requirements:**',
                '• Select 1–2 Trial Completers.',
                '• Select the Trial completed.',
                '• Select 1–2 Pack Members.',
                '• Upload 1–6 evidence files.',
                '',
                '**Important:**',
                'At least one NCO must be selected as a Pack Member.',
                'Trial Completers and Pack Members must be different members.',
                '',
                'Each approved Trial contributes to a member’s progression.'
            ].join('\n')
        );

    const button = new ButtonBuilder()
        .setCustomId(TRIAL_BUTTON_ID)
        .setLabel('Unproven Trial')
        .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder()
        .addComponents(button);

    return {
        embeds: [embed],
        components: [row]
    };
}

// ==========================================
// TRIAL SUBMISSION MODAL
// ==========================================

function createTrialSubmissionModal() {
    const completerSelector = new UserSelectMenuBuilder()
        .setCustomId('trial_completers')
        .setPlaceholder('Select 1–2 Trial Completers')
        .setMinValues(1)
        .setMaxValues(2)
        .setRequired(true);

    const trialSelector = new StringSelectMenuBuilder()
        .setCustomId('trial_selection')
        .setPlaceholder('Select the completed Trial')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(
            { label: 'Trial 1', value: 'trial_1' },
            { label: 'Trial 2', value: 'trial_2' },
            { label: 'Trial 3', value: 'trial_3' }
        );

    const packMemberSelector = new UserSelectMenuBuilder()
        .setCustomId('trial_pack_members')
        .setPlaceholder('Select 1–2 Pack Members')
        .setMinValues(1)
        .setMaxValues(2)
        .setRequired(true);

    const evidenceUpload = new FileUploadBuilder()
        .setCustomId('trial_evidence')
        .setMinValues(1)
        .setMaxValues(6)
        .setRequired(true);

    return new ModalBuilder()
        .setCustomId(TRIAL_MODAL_ID)
        .setTitle('Unproven Trial Submission')
        .addLabelComponents(

            new LabelBuilder()
                .setLabel('Trial Completers')
                .setDescription('Select 1–2 members who completed the Trial.')
                .setUserSelectMenuComponent(completerSelector),

            new LabelBuilder()
                .setLabel('Trial Selection')
                .setDescription('Choose which Trial was completed.')
                .setStringSelectMenuComponent(trialSelector),

            new LabelBuilder()
                .setLabel('Pack Members')
                .setDescription('Select 1–2 supporting Pack Members.')
                .setUserSelectMenuComponent(packMemberSelector),

            new LabelBuilder()
                .setLabel('Evidence Files')
                .setDescription('Upload 1–6 proof images or files.')
                .setFileUploadComponent(evidenceUpload)

        );
}

// ==========================================
// TRIAL INTERACTION HANDLER
// ==========================================

async function handleTrialPanelInteraction(interaction) {
    if (
        !interaction.isButton() ||
        interaction.customId !== TRIAL_BUTTON_ID
    ) {
        return false;
    }

    await interaction.showModal(createTrialSubmissionModal());

    return true;
}

// ==========================================
// PUBLISH TRIAL PANEL
// ==========================================


async function publishTrialPanel(client) {
    if (!TRIAL_PANEL_CHANNEL_ID) {
        throw new Error('TRIAL_PANEL_CHANNEL_ID is missing from .env.');
    }

    const channel = await client.channels.fetch(
        TRIAL_PANEL_CHANNEL_ID
    );

    if (
        !channel ||
        !channel.isTextBased() ||
        !channel.isSendable()
    ) {
        throw new Error('Unproven Trial panel channel is unavailable.');
    }

    // Check the channel's latest 100 messages for an existing panel.
    const recentMessages = await channel.messages.fetch({
        limit: 100
    });

    const existingPanel = recentMessages.find(message =>
        message.author.id === client.user.id &&
        message.embeds.some(embed =>
            embed.title === 'Unproven Trial'
        ) &&
        message.components.some(row =>
            row.components.some(component =>
                component.customId === TRIAL_BUTTON_ID
            )
        )
    );

    // Reuse the existing panel instead of creating a duplicate.
    if (existingPanel) {
        console.log(
            `Unproven Trial panel already exists. Message ID: ${existingPanel.id}`
        );

        return existingPanel;
    }

    // No existing panel found. Publish a new one.
    const newPanel = await channel.send(
        createTrialPanelPayload()
    );

    console.log(
        `Unproven Trial panel published. Message ID: ${newPanel.id}`
    );

    return newPanel;
}


// ==========================================
// TRIAL MEMBER ROLE HELPERS
// ==========================================

function memberHasRole(member, roleId) {
    return member.roles.cache.has(roleId);
}
// ==========================================
// TRIAL DISCREPANCY ALERT
// ==========================================


async function sendTrialDiscrepancyAlert(client, details) {
    const channel = await client.channels.fetch(
        NCO_REVIEW_CHANNEL_ID
    );

    if (
        !channel ||
        !channel.isTextBased() ||
        !channel.isSendable()
    ) {
        throw new Error('NCO review channel is unavailable.');
    }

    const embed = new EmbedBuilder()
        .setTitle(
            details.title || 'Unproven Trial — Eligibility Discrepancy'
        )
        .setColor(0xE67E22)
        .setDescription(details.description || 'No description provided.')
        .addFields(
            {
                name: 'Affected Member',
                value: details.userId ? `<@${details.userId}>` : 'Not specified',
                inline: true
            },
            {
                name: 'Discrepancy',
                value: details.reason || 'Operational issue',
                inline: true
            }
        )
        .setTimestamp();

    return channel.send({
        embeds: [embed]
    });
}


// ==========================================
// FETCH TRIAL MEMBERS
// ==========================================

async function fetchTrialMembers(guild, userIds) {
    const members = [];

    for (const userId of userIds) {
        const member = await guild.members.fetch(userId);

        if (!member || member.user.bot) {
            throw new Error(
                `Invalid Trial participant: ${userId}`
            );
        }

        members.push(member);
    }

    return members;
}

// ==========================================
// VALIDATE TRIAL PARTICIPANTS
// ==========================================

function validateTrialParticipants(
    submitterId,
    completers,
    packMembers
) {
    if (completers.length < 1 || completers.length > 2) {
        throw new Error(
            'Select between 1 and 2 Trial Completers.'
        );
    }

    if (packMembers.length < 1 || packMembers.length > 2) {
        throw new Error(
            'Select between 1 and 2 Pack Members.'
        );
    }

    if (completers.length + packMembers.length > 3) {
        throw new Error(
            'A Trial squad cannot exceed 3 participants.'
        );
    }

    const completerIds = new Set(
        completers.map(member => member.id)
    );

    const packMemberIds = new Set(
        packMembers.map(member => member.id)
    );


    for (const userId of completerIds) {
        if (packMemberIds.has(userId)) {
            throw new Error(
                'Trial Completers and Pack Members must be different people.'
            );
        }
    }


    const hasNCO = packMembers.some(member =>
        memberHasRole(member, NCO_ROLE_ID)
    );

    if (!hasNCO) {
        throw new Error(
            'At least one NCO must be selected as a Pack Member.'
        );
    }

    return true;
}

// ==========================================
// CHECK UNPROVEN ROLE DISCREPANCIES
// ==========================================

function checkTrialRoleDiscrepancies(
    completers,
    packMembers
) {
    return {
        completers: completers.map(member => ({
            user_id: member.id,
            unproven_role_at_submission: memberHasRole(
                member,
                UNPROVEN_ROLE_ID
            ) ? 1 : 0
        })),

        packMembers: packMembers.map(member => ({
            user_id: member.id,
            unproven_role_at_submission: memberHasRole(
                member,
                UNPROVEN_ROLE_ID
            ) ? 1 : 0
        }))
    };
}

// ==========================================
// SEND TRIAL ROLE DISCREPANCY ALERTS
// ==========================================

async function sendTrialRoleDiscrepancyAlerts(
    client,
    submissionId,
    completers,
    packMembers
) {
    const alerts = [];

    for (const member of completers) {
        if (!memberHasRole(member, UNPROVEN_ROLE_ID)) {
            alerts.push({
                userId: member.id,
                reason: 'Trial Completer does not have the Unproven role.'
            });
        }
    }

    for (const member of packMembers) {
        if (memberHasRole(member, UNPROVEN_ROLE_ID)) {
            alerts.push({
                userId: member.id,
                reason: 'Pack Member currently has the Unproven role and is ineligible for Saga Points.'
            });
        }
    }

    for (const alert of alerts) {
        try {
            await sendTrialDiscrepancyAlert(client, {
                userId: alert.userId,
                reason: alert.reason,
                description: `Submission ID: **${submissionId}**`
            });
        } catch (error) {
            console.error(
                `Could not send Trial discrepancy alert for submission #${submissionId}:`,
                error
            );
        }
    }
}

// ==========================================
// DOWNLOAD TRIAL EVIDENCE
// ==========================================

async function downloadTrialEvidence(uploadedFiles) {
    if (!uploadedFiles || uploadedFiles.size < 1 ||
        uploadedFiles.size > 6) {
        throw new Error(
            'You must upload between 1 and 6 evidence files.'
        );
    }

    const evidenceFiles = [];

    for (const file of uploadedFiles.values()) {

        // Check individual file size (10 MB maximum)
        if (file.size > 10 * 1024 * 1024) {
            throw new Error(
                `Evidence file "${file.name}" exceeds the 10 MB limit.`
            );
        }

        // Check content type
        if (!file.contentType) {
            throw new Error(
                `Evidence file "${file.name}" has no valid content type.`
            );
        }

        const response = await fetch(file.url);

        if (!response.ok) {
            throw new Error(
                `Failed to download evidence file: ${file.name}`
            );
        }

        const buffer = Buffer.from(
            await response.arrayBuffer()
        );

        evidenceFiles.push({
            name: file.name,
            url: file.url,
            contentType: file.contentType,
            buffer
        });
    }

    return evidenceFiles;
}

// ==========================================
// PREPARE TRIAL EVIDENCE FOR DATABASE
// ==========================================

function prepareTrialEvidenceRecords(evidenceFiles) {
    return evidenceFiles.map(file => ({
        name: file.name,
        url: file.url,
        contentType: file.contentType
    }));
}

// ==========================================
// TRIAL REVIEW BUTTONS
// ==========================================

function createTrialReviewButtons(submissionId) {
    const approveButton = new ButtonBuilder()
        .setCustomId(`trial_approve_${submissionId}`)
        .setLabel('Approve Trial')
        .setStyle(ButtonStyle.Success);

    const rejectButton = new ButtonBuilder()
        .setCustomId(`trial_reject_${submissionId}`)
        .setLabel('Reject Trial')
        .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder()
        .addComponents(
            approveButton,
            rejectButton
        );

    return [row];
}

// ==========================================
// CREATE PENDING TRIAL REPORT EMBED
// ==========================================

function createPendingTrialReportEmbed(data) {
    const embed = new EmbedBuilder()
        .setTitle(`Unproven Trial Report #${data.submissionId}`)
        .setColor(0xF1C40F)
        .setDescription(
            [
                '**Status:** Pending Review',
                '',
                `**Submitted by:** <@${data.submitterId}>`,
                `**Trial:** ${data.trialKey.replace('_', ' ').toUpperCase()}`,
                '',
                '**Trial Completers**',
                ...data.completers.map(member =>
                    `• <@${member.id}> — Progression: ${member.progress.completedCount}/3`
                ),
                '',
                '**Pack Members**',
                ...data.packMembers.map(member =>
                    `• <@${member.id}> — ${member.hasUnprovenRole
                        ? '0 Saga Points (Unproven)'
                        : '+2 Saga Points (Projected)'
                    }`
                ),
                '',
                `**Evidence:** ${data.evidenceCount} file(s) attached`,
                '',
                '*Saga Points are recalculated at approval. Pack Members receive no bonus points.*'
            ].join('\n')
        )
        .setTimestamp();

    return embed;
}

// ==========================================
// GET TRIAL COMPLETER PROGRESSION
// ==========================================

function getTrialCompleterProgress(completers) {
    return completers.map(member => {
        const progress = trialDatabase.getMemberTrialProgress(
            member.id
        );

        return {
            id: member.id,
            progress
        };
    });
}

// ==========================================
// HANDLE TRIAL FORM SUBMISSION
// ==========================================

async function handleTrialSubmission(interaction) {
    if (
        !interaction.isModalSubmit() ||
        interaction.customId !== TRIAL_MODAL_ID
    ) {
        return false;
    }

    let submissionId = null;
    let reviewMessage = null;

    try {
        // ----------------------------------
        // READ FORM ANSWERS
        // ----------------------------------

        const completerIds = [
            ...new Set(
                interaction.fields
                    .getSelectedUsers('trial_completers')
                    .keys()
            )
        ];

        const trialKey = interaction.fields
            .getStringSelectValues('trial_selection')[0];

        const packMemberIds = [
            ...new Set(
                interaction.fields
                    .getSelectedUsers('trial_pack_members')
                    .keys()
            )
        ];

        const uploadedFiles = interaction.fields
            .getUploadedFiles('trial_evidence');

        if (!['trial_1', 'trial_2', 'trial_3'].includes(trialKey)) {
            throw new Error('Please select a valid Trial.');
        }

        // ----------------------------------
        // FETCH AND VALIDATE PARTICIPANTS
        // ----------------------------------

        const guild = interaction.guild;

        if (!guild) {
            throw new Error('Trial submissions must be made inside the server.');
        }

        const completers = await fetchTrialMembers(
            guild,
            completerIds
        );

        const packMembers = await fetchTrialMembers(
            guild,
            packMemberIds
        );

        validateTrialParticipants(
            interaction.user.id,
            completers,
            packMembers
        );

        // ----------------------------------
        // DEFER RESPONSE
        // ----------------------------------

        await interaction.deferReply({
            flags: 64
        });

        // ----------------------------------
        // DOWNLOAD EVIDENCE
        // ----------------------------------

        const evidenceFiles = await downloadTrialEvidence(
            uploadedFiles
        );

        const evidenceRecords = prepareTrialEvidenceRecords(
            evidenceFiles
        );

        // ----------------------------------
        // CREATE DATABASE SUBMISSION
        // ----------------------------------

        const roleStatuses = checkTrialRoleDiscrepancies(
            completers,
            packMembers
        );

        submissionId = trialDatabase.createTrialSubmission({
            submitterId: interaction.user.id,
            trialKey,
            evidence: evidenceRecords,
            completers: roleStatuses.completers,
            packMembers: roleStatuses.packMembers
        });


        // ----------------------------------
        // FETCH REVIEW CHANNEL
        // ----------------------------------

        const reviewChannel = await interaction.client.channels.fetch(
            TRIAL_REVIEW_CHANNEL_ID
        );

        if (
            !reviewChannel ||
            !reviewChannel.isTextBased() ||
            !reviewChannel.isSendable()
        ) {
            throw new Error('Trial review channel is unavailable.');
        }

        // ----------------------------------
        // GET COMPLETER PROGRESSION
        // ----------------------------------

        const completerProgress = getTrialCompleterProgress(
            completers
        );

        const packMemberDetails = packMembers.map(member => ({
            id: member.id,
            hasUnprovenRole: memberHasRole(
                member,
                UNPROVEN_ROLE_ID
            )
        }));

        const embed = createPendingTrialReportEmbed({
            submissionId,
            submitterId: interaction.user.id,
            trialKey,
            completers: completerProgress,
            packMembers: packMemberDetails,
            evidenceCount: evidenceFiles.length
        });

        // ----------------------------------
        // PREPARE ORIGINAL EVIDENCE ATTACHMENTS
        // ----------------------------------

        const evidenceAttachments = evidenceFiles.map(file =>
            new AttachmentBuilder(
                file.buffer,
                { name: file.name }
            )
        );

        // ----------------------------------
        // SEND REVIEW REPORT WITH ORIGINAL EVIDENCE
        // ----------------------------------

        const reportPayload = {
            embeds: [embed],
            components: createTrialReviewButtons(submissionId),
            files: evidenceAttachments
        };

        reviewMessage = await reviewChannel.send(reportPayload);

        // ----------------------------------
        // SAVE DISCORD REFERENCES
        // ----------------------------------

        trialDatabase.setTrialDiscordReferences({
            submissionId,
            reviewMessageId: reviewMessage.id,
            evidenceThreadId: null
        });

        // ----------------------------------
        // SEND NCO DISCREPANCY ALERTS
        // ----------------------------------
        await sendTrialRoleDiscrepancyAlerts(
            interaction.client,
            submissionId,
            completers,
            packMembers
        );

        await interaction.editReply({
            content: `Your Unproven Trial submission **#${submissionId}** has been submitted successfully and is awaiting review.`
        });

        return true;

    } catch (error) {
        console.error('Trial submission failed:', error);


        if (reviewMessage) {
            await reviewMessage.delete().catch(console.error);
        }

        // ----------------------------------
        // CLEAN UP DATABASE RECORD
        // ----------------------------------

        if (submissionId !== null) {
            try {
                trialDatabase.deletePendingTrialSubmission(
                    submissionId
                );
            } catch (cleanupError) {
                console.error(
                    'Trial database cleanup failed:',
                    cleanupError
                );
            }
        }

        const errorMessage =
            error.message || 'An unexpected error occurred.';

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({
                content: `Your Trial submission could not be completed: ${errorMessage}`
            }).catch(console.error);
        } else {
            await interaction.reply({
                content: `Your Trial submission could not be completed: ${errorMessage}`,
                flags: 64
            }).catch(console.error);
        }

        return true;
    }
}

async function handleTrialReviewInteraction(interaction) {
    // Only handle Trial review buttons.
    if (!interaction.isButton()) return false;

    const match = interaction.customId.match(/^trial_(approve|reject)_(\d+)$/);
    if (!match) return false;

    const decision = match[1] === 'approve' ? 'approved' : 'rejected';
    const submissionId = Number(match[2]);

    let reviewResult = null;

    try {
        if (!interaction.guild) {
            await interaction.reply({
                content: 'Trial reviews can only be performed inside the server.',
                ephemeral: true
            });
            return true;
        }

        // Fetch the reviewer as a full GuildMember.
        const reviewer = await interaction.guild.members.fetch(interaction.user.id);

        // Only Administrators, configured Admins, NCOs, and AAR Moderators may review.
        const isAuthorized =
            reviewer.permissions.has(PermissionFlagsBits.Administrator) ||
            memberHasRole(reviewer, ADMIN_ROLE_ID) ||
            memberHasRole(reviewer, NCO_ROLE_ID) ||
            memberHasRole(reviewer, MODERATOR_ROLE_ID);

        if (!isAuthorized) {
            await interaction.reply({
                content: 'You do not have permission to review Unproven Trial submissions.',
                ephemeral: true
            });
            return true;
        }

        // Reviews must take place in the configured Trial review channel.
        if (interaction.channelId !== TRIAL_REVIEW_CHANNEL_ID) {
            await interaction.reply({
                content: 'Trial submissions must be reviewed in the designated Trial review channel.',
                ephemeral: true
            });
            return true;
        }

        // Confirm that this is a genuine, pending submission and its original review message.
        const submission = trialDatabase.getTrialSubmission(submissionId);

        if (!submission) {
            await interaction.reply({
                content: 'This Trial submission could not be found.',
                ephemeral: true
            });
            return true;
        }

        if (submission.status !== 'pending') {
            await interaction.reply({
                content: `This submission has already been ${submission.status}.`,
                ephemeral: true
            });
            return true;
        }

        if (String(submission.review_message_id) !== String(interaction.message.id)) {
            await interaction.reply({
                content: 'This button does not belong to the original Trial review message.',
                ephemeral: true
            });
            return true;
        }

        await interaction.deferReply({ ephemeral: true });

        // Check Pack Members' current Unproven role status at review time.
        const packMemberRoleStatuses = {};

        if (decision === 'approved') {
            for (const packMember of submission.pack_members) {
                const userId = typeof packMember === 'string'
                    ? packMember
                    : packMember.user_id || packMember.userId;

                if (!userId) {
                    throw new Error('A Pack Member record is missing its user ID.');
                }

                const member = await interaction.guild.members.fetch(userId);

                packMemberRoleStatuses[userId] = memberHasRole(
                    member,
                    UNPROVEN_ROLE_ID
                );
            }
        }

        // Record the decision and calculate progression and points in the database.
        reviewResult = await trialDatabase.reviewTrialSubmission({
            submissionId,
            reviewerId: interaction.user.id,
            reviewerName: reviewer.displayName || interaction.user.username,
            decision,
            packMemberRoleStatuses
        });

        // The database decision is now recorded. Follow-up failures must not undo it.
        const followUpIssues = [];

        if (decision === 'approved') {
            // Process members who have completed all three Unproven Trials.
            for (const award of reviewResult.progressionAwards || []) {
                if (!award.graduated) continue;

                // ------------------------------------------
                // REMOVE UNPROVEN ROLE
                // ------------------------------------------

                try {
                    const member = await interaction.guild.members.fetch(award.userId);

                    if (memberHasRole(member, UNPROVEN_ROLE_ID)) {
                        await member.roles.remove(
                            UNPROVEN_ROLE_ID,
                            'Completed all three Unproven Trials'
                        );
                    }

                } catch (error) {
                    console.error(
                        `[Trial Review] Could not remove Unproven role from ${award.userId}:`,
                        error
                    );

                    followUpIssues.push(
                        `Could not remove the Unproven role from <@${award.userId}>.`
                    );

                    try {
                        await sendTrialDiscrepancyAlert(interaction.client, {
                            title: 'Trial Graduation Role Removal Failed',
                            description:
                                `The member <@${award.userId}> has completed all three Unproven Trials, ` +
                                'but the bot could not remove their Unproven role.',
                            userId: award.userId,
                            reason: 'Failed to remove Unproven role after graduation.'
                        });
                    } catch (alertError) {
                        console.error(
                            `[Trial Review] Could not send graduation failure alert for ${award.userId}:`,
                            alertError
                        );
                    }
                }

                // ------------------------------------------
                // GRANT IRON WOLVES ROLE
                // ------------------------------------------

                try {
                    const member = await interaction.guild.members.fetch(award.userId);

                    const alreadyHasIronWolves = memberHasRole(
                        member,
                        IRON_WOLVES_ROLE_ID
                    );

                    // Grant the role only if the member does not already have it.
                    if (!alreadyHasIronWolves) {
                        await member.roles.add(
                            IRON_WOLVES_ROLE_ID,
                            'Graduated from all three Unproven Trials'
                        );
                    }

                    // Record tenure only if no record already exists.
                    // This prevents accidentally resetting existing tenure.
                    db.prepare(`
                INSERT OR IGNORE INTO iron_wolves_tenure (
                    guild_id,
                    user_id,
                    assigned_at
                )
                VALUES (?, ?, ?)
            `).run(
                        interaction.guild.id,
                        member.id,
                        new Date().toISOString()
                    );

                    console.log(
                        `[Iron Wolves] Graduation reward processed for ${member.user.tag}.`
                    );

                } catch (error) {
                    console.error(
                        `[Trial Review] Could not grant Iron Wolves role to ${award.userId}:`,
                        error
                    );

                    followUpIssues.push(
                        `Could not grant the Iron Wolves role to <@${award.userId}>.`
                    );

                    try {
                        await sendTrialDiscrepancyAlert(interaction.client, {
                            title: 'Trial Graduation Iron Wolves Role Grant Failed',
                            description:
                                `The member <@${award.userId}> completed all three Unproven Trials, ` +
                                'but the bot could not grant their Iron Wolves role or record their tenure.',
                            userId: award.userId,
                            reason: 'Failed to grant Iron Wolves role or record graduation tenure.'
                        });
                    } catch (alertError) {
                        console.error(
                            `[Trial Review] Could not send Iron Wolves failure alert for ${award.userId}:`,
                            alertError
                        );
                    }
                }
            }

            // Refresh the combined Saga Points leaderboard.
            try {
                await refreshLeaderboard(interaction.client);
            } catch (error) {
                console.error('[Trial Review] Leaderboard refresh failed:', error);

                followUpIssues.push('The leaderboard could not be refreshed.');

                try {
                    await sendTrialDiscrepancyAlert(interaction.client, {
                        title: 'Trial Leaderboard Refresh Failed',
                        description:
                            `Trial submission #${submissionId} was approved, ` +
                            'but the combined Saga Points leaderboard could not be refreshed.',
                        userId: submission.submitter_id,
                        reason: 'Failed to refresh the combined Saga Points leaderboard.'
                    });
                } catch (alertError) {
                    console.error(
                        `[Trial Review] Could not send leaderboard failure alert for submission #${submissionId}:`,
                        alertError
                    );
                }
            }
        }



        // Update the original report and remove its review buttons.
        try {
            const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0]);

            updatedEmbed
                .setColor(decision === 'approved' ? 0x2ecc71 : 0xe74c3c)
                .setTitle(
                    decision === 'approved'
                        ? `Unproven Trial #${submissionId} — APPROVED`
                        : `Unproven Trial #${submissionId} — REJECTED`
                )
                .addFields({
                    name: 'Review Decision',
                    value:
                        `**Decision:** ${decision.toUpperCase()}\n` +
                        `**Reviewer:** ${reviewer.displayName} (<@${reviewer.id}>)\n` +
                        `**Reviewed:** <t:${Math.floor(Date.now() / 1000)}:F>`,
                    inline: false
                });

            if (decision === 'approved') {
                const progressionLines = (reviewResult.progressionAwards || []).map(award => {
                    const progress = `${award.completedTrialCount}/3`;
                    const graduation = award.graduated ? ' — **GRADUATED**' : '';

                    return `<@${award.userId}>: **${progress} Trials completed**${graduation}`;
                });

                const pointLines = (reviewResult.pointsAwards || []).map(award => {
                    const points = Number(award.pointsAwarded || 0);

                    return `<@${award.userId}>: **+${points} Saga Points**`;
                });

                if (progressionLines.length > 0) {
                    updatedEmbed.addFields({
                        name: 'Trial Progression Awarded',
                        value: progressionLines.join('\n'),
                        inline: false
                    });
                }

                if (pointLines.length > 0) {
                    updatedEmbed.addFields({
                        name: 'Pack Member Rewards',
                        value: pointLines.join('\n'),
                        inline: false
                    });
                }
            }

            if (followUpIssues.length > 0) {
                updatedEmbed.addFields({
                    name: 'Follow-up Issues',
                    value: followUpIssues.join('\n'),
                    inline: false
                });
            }

            updatedEmbed.setTimestamp();

            await interaction.message.edit({
                embeds: [updatedEmbed],
                components: []
            });

        } catch (error) {
            console.error('[Trial Review] Could not update the original report:', error);

            followUpIssues.push('The original Trial report could not be updated.');

            try {
                await sendTrialDiscrepancyAlert(interaction.client, {
                    title: 'Trial Review Report Update Failed',
                    description:
                        `Trial submission #${submissionId} has been reviewed, ` +
                        'but the original Discord report could not be updated.',
                    userId: submission.submitter_id,
                    reason: 'Failed to update the original Trial review message.'
                });
            } catch (alertError) {
                console.error(
                    `[Trial Review] Could not send report update failure alert for submission #${submissionId}:`,
                    alertError
                );
            }
        }


        const decisionText = decision === 'approved'
            ? 'The Trial submission has been approved.'
            : 'The Trial submission has been rejected.';

        await interaction.editReply({
            content: followUpIssues.length > 0
                ? `${decisionText}\n\n**Please note:** Some follow-up actions need attention:\n${followUpIssues.join('\n')}`
                : decisionText
        });

    } catch (error) {
        console.error('[Trial Review] Review handler error:', error);

        if (reviewResult) {
            await interaction.editReply({
                content:
                    `The submission was successfully ${decision}, but an unexpected follow-up error occurred. ` +
                    `Please check the bot console and the Trial report.`
            }).catch(console.error);

            return true;
        }

        const errorMessage =
            'Something went wrong while processing this Trial review. Check the bot console for details.';

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({
                content: errorMessage
            }).catch(console.error);
        } else {
            await interaction.reply({
                content: errorMessage,
                ephemeral: true
            }).catch(console.error);
        }
    }

    return true;
}

async function handleTrialMemberUpdate(oldMember, newMember) {
    try {
        // Only act when the Unproven role has just been added.
        const previouslyHadRole = oldMember.roles.cache.has(UNPROVEN_ROLE_ID);
        const currentlyHasRole = newMember.roles.cache.has(UNPROVEN_ROLE_ID);

        if (previouslyHadRole || !currentlyHasRole) {
            return;
        }

        // Check permanent Trial progression.
        const progress = trialDatabase.getMemberTrialProgress(newMember.id);

        if (!progress || !progress.graduated) {
            return;
        }

        // Graduated members must not retain the Unproven role.
        await newMember.roles.remove(
            UNPROVEN_ROLE_ID,
            'Member has already completed all three Unproven Trials'
        );

        console.log(
            `[Trial Graduation] Removed re-added Unproven role from ${newMember.user.tag}`
        );

    } catch (error) {
        console.error(
            `[Trial Graduation] Failed to enforce graduation for ${newMember.id}:`,
            error
        );

        try {
            await sendTrialDiscrepancyAlert(newMember.client, {
                title: 'Trial Graduation Role Removal Failed',
                description:
                    `Could not remove the Unproven role from <@${newMember.id}>.\n` +
                    `The member has already completed all three Trials.`,
                userId: newMember.id
            });
        } catch (alertError) {
            console.error('[Trial Graduation] Could not send discrepancy alert:', alertError);
        }
    }
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
    createTrialPanelPayload,
    createTrialSubmissionModal,
    handleTrialPanelInteraction,
    handleTrialSubmission,
    handleTrialReviewInteraction,
    handleTrialMemberUpdate,
    publishTrialPanel,

};
