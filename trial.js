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
    AttachmentBuilder,
    MessageFlags,
    ContainerBuilder,
    TextDisplayBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    SeparatorBuilder
} = require('discord.js');

const trialDatabase = require('./trial-database-turso');
const database = require('./turso-database');

// Prevent simultaneous Trial reviews of the same submission.
const processingTrialReviews = new Set();
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
                '• Upload 1–6 evidence files (10 MB maximum each).',
                '',
                '**Important:**',
                'At least one NCO or High Command member must be selected as a Pack Member.',
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
                .setDescription('Upload 1–6 proof images or files (10 MB maximum per file).')
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
            'At least one NCO or High Command member must be selected as a Pack Member.'
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

        // Check individual file size (10 MB maximum).
        const maxFileBytes = 10 * 1024 * 1024;
        if (
            !Number.isSafeInteger(file.size) ||
            file.size <= 0 ||
            file.size > maxFileBytes
        ) {
            throw new Error(
                `Evidence file "${file.name}" must be between 1 byte and 10 MB.`
            );
        }

        // Check content type
        if (!file.contentType) {
            throw new Error(
                `Evidence file "${file.name}" has no valid content type.`
            );
        }

        const response = await fetch(file.url, {
            signal: AbortSignal.timeout(30_000)
        });

        if (!response.ok) {
            throw new Error(
                `Failed to download evidence file: ${file.name}`
            );
        }

        const contentLength = Number(response.headers.get('content-length'));
        if (Number.isFinite(contentLength) && contentLength > maxFileBytes) {
            throw new Error(
                `Evidence file "${file.name}" exceeds the 10 MB limit.`
            );
        }

        const buffer = Buffer.from(
            await response.arrayBuffer()
        );
        if (buffer.length > maxFileBytes) {
            throw new Error(
                `Evidence file "${file.name}" exceeds the 10 MB limit.`
            );
        }

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
// CREATE PENDING TRIAL REPORT EMBED
// ==========================================

function buildTrialReviewContainer(data) {
    const statusLabel = data.reviewStatus === 'approved'
        ? 'APPROVED'
        : data.reviewStatus === 'rejected'
            ? 'REJECTED'
            : 'PENDING REVIEW';

    const evidenceItems = data.evidence.map((item, index) => {
        const fileName = typeof item === 'string' ? item : item.name;
        const mediaUrl = typeof item === 'string'
            ? `attachment://${fileName}`
            : item.url;

        if (!fileName || !mediaUrl) {
            throw new Error(`Invalid Trial evidence item ${index + 1}.`);
        }

        return new MediaGalleryItemBuilder()
            .setURL(mediaUrl)
            .setDescription(`Original Trial evidence ${index + 1}: ${fileName}`);
    });

    if (evidenceItems.length < 1 || evidenceItems.length > 6) {
        throw new Error(
            `Expected 1-6 Trial gallery items, received ${evidenceItems.length}.`
        );
    }

    const completerLines = data.completers.map(member =>
        `• <@${member.id}> • Progression: ${member.progress.completedCount}/3`
    );

    const packMemberLines = data.packMembers.map(member =>
        `• <@${member.id}> • ${member.hasUnprovenRole
            ? '0 Saga Points (Unproven)'
            : '+2 Saga Points (Projected)'
        }`
    );

    const reportDetails = [
        `**Submission:** Trial #${data.submissionId}`,
        `**Submitted by:** <@${data.submitterId}>`,
        `**Trial:** ${data.trialKey.replace('_', ' ').toUpperCase()}`,
        `### Trial Completers (${data.completers.length})`,
        completerLines.join('\n') || 'None',
        `### Pack Members (${data.packMembers.length})`,
        packMemberLines.join('\n') || 'None',
        '*Saga Points are recalculated at approval. Pack Members receive no bonus points.*'
    ].join('\n\n');

    const container = new ContainerBuilder()
        .setAccentColor(
            data.reviewStatus === 'approved'
                ? 0x2ecc71
                : data.reviewStatus === 'rejected'
                    ? 0xe74c3c
                    : 0xF1C40F
        )
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# SERVITOR // UNPROVEN TRIAL\n## ${statusLabel}`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(reportDetails)
        );



    container
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('### Trial Evidence')
        )
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(evidenceItems)
        );

    if (data.reviewResult) {
        container
            .addSeparatorComponents(new SeparatorBuilder())
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### Review Decision\n${data.reviewResult}`
                )
            );
    }

    return container;
}

// ==========================================
// GET TRIAL COMPLETER PROGRESSION
// ==========================================

async function getTrialCompleterProgress(completers) {
    return Promise.all(completers.map(async member => ({
        id: member.id,
        progress: await trialDatabase.getMemberTrialProgress(member.id)
    })));
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
        // Acknowledge immediately before any guild or database network calls.
        await interaction.deferReply({
            flags: 64
        });

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

        submissionId = await trialDatabase.createTrialSubmission({
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

        const completerProgress = await getTrialCompleterProgress(
            completers
        );

        const packMemberDetails = packMembers.map(member => ({
            id: member.id,
            hasUnprovenRole: memberHasRole(
                member,
                UNPROVEN_ROLE_ID
            )
        }));

        const trialContainer = buildTrialReviewContainer({
            submissionId,
            submitterId: interaction.user.id,
            trialKey,
            completers: completerProgress,
            packMembers: packMemberDetails,
            evidence: evidenceFiles.map(file => file.name),
            reviewStatus: 'pending'
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
        // SEND COMPONENTS V2 REVIEW REPORT
        // ----------------------------------

        reviewMessage = await reviewChannel.send({
            flags: MessageFlags.IsComponentsV2,
            components: [trialContainer],
            files: evidenceAttachments,
            allowedMentions: {
                parse: []
            }
        });

        // ----------------------------------
        // SAVE DISCORD REFERENCES
        // ----------------------------------

        await trialDatabase.setTrialDiscordReferences({
            submissionId,
            reviewMessageId: reviewMessage.id,
            evidenceThreadId: null
        });

        // ----------------------------------
        // ARCHIVE ORIGINAL GALLERY ATTACHMENTS
        // ----------------------------------

        const fetchedReviewMessage = await reviewChannel.messages.fetch(
            reviewMessage.id
        );

        const galleryItems = fetchedReviewMessage.components
            .flatMap(container => container.components || [])
            .filter(component => component.type === 12)
            .flatMap(gallery => gallery.items || []);

        if (galleryItems.length !== evidenceFiles.length) {
            throw new Error(
                `Expected ${evidenceFiles.length} Trial gallery items, found ${galleryItems.length}.`
            );
        }

        const archivedEvidence = galleryItems.map((item, index) => {
            const media = item.media?.data;
            const attachmentId = media?.attachment_id || media?.id;

            if (!attachmentId || !media?.url) {
                throw new Error(
                    `Could not retrieve Discord attachment metadata for Trial evidence ${index + 1}.`
                );
            }

            return {
                id: attachmentId,
                name: evidenceFiles[index].name,
                url: media.url,
                size: evidenceFiles[index].buffer.length,
                contentType: media.content_type || evidenceFiles[index].contentType,
                type: 'original'
            };
        });

        const evidenceUpdate = await database.execute({
            sql: 'UPDATE trial_submissions SET evidence = ? WHERE id = ? AND status = \'pending\'',
            args: [JSON.stringify(archivedEvidence), submissionId]
        });

        if (Number(evidenceUpdate.rowsAffected) !== 1) {
            throw new Error(
                `Could not archive evidence for Trial submission #${submissionId}.`
            );
        }

        // ----------------------------------
// SEND NCO DISCREPANCY ALERTS
        // ----------------------------------
        await reviewMessage.react('\u2705');
        await reviewMessage.react('\u274C');

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

        // Delete the Discord review card only after the database confirms that
        // the submission was still pending and has actually been removed.
        // A moderator may have reviewed it while the submitter's final response
        // or discrepancy alert was being sent.
        let pendingRecordRemoved = false;
        const cleanupIssues = [];

        if (submissionId !== null) {
            try {
                pendingRecordRemoved = await trialDatabase.deletePendingTrialSubmission(
                    submissionId
                );
            } catch (cleanupError) {
                console.error(
                    'Trial database cleanup failed:',
                    cleanupError
                );
                cleanupIssues.push(
                    `Could not remove pending Trial submission #${submissionId}: ${cleanupError.message}`
                );
            }
        }

        if (reviewMessage && pendingRecordRemoved) {
            try {
                await reviewMessage.delete();
            } catch (messageDeleteError) {
                console.error(
                    `Could not delete incomplete Trial review message for #${submissionId}:`,
                    messageDeleteError
                );
                cleanupIssues.push(
                    `Could not delete incomplete Discord review message ${reviewMessage.url}.`
                );
            }
        } else if (reviewMessage && !pendingRecordRemoved) {
            cleanupIssues.push(
                `Trial submission #${submissionId} was not removed as pending; its review message was retained to avoid deleting a possibly finalized review. Message: ${reviewMessage.url}`
            );
        }

        if (cleanupIssues.length > 0) {
            try {
                await sendTrialDiscrepancyAlert(interaction.client, {
                    title: 'Trial Submission Cleanup Needs Attention',
                    description: cleanupIssues.join('\n'),
                    userId: interaction.user.id,
                    reason: 'Trial submission cleanup could not safely remove all incomplete records or messages.'
                });
            } catch (alertError) {
                console.error(
                    `Could not send Trial submission cleanup alert for #${submissionId}:`,
                    alertError
                );
            }
        }

        const errorMessage =
            error.message || 'An unexpected error occurred.';
        const cleanupNote = pendingRecordRemoved
            ? '\n\nThe incomplete pending submission was removed. Please submit again.'
            : submissionId !== null
                ? '\n\nThe submission record was not removed and its review message was retained because it may already have been reviewed. Please contact an Administrator or NCO before retrying.'
                : '';

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({
                content: `Your Trial submission could not be completed: ${errorMessage}${cleanupNote}`
            }).catch(console.error);
        } else {
            await interaction.reply({
                content: `Your Trial submission could not be completed: ${errorMessage}${cleanupNote}`,
                flags: 64
            }).catch(console.error);
        }

        return true;
    }
}

async function processTrialReviewDecision(interaction) {
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

        // Acknowledge before fetching Discord members or reading the database.
        await interaction.deferReply({ ephemeral: true });

        // Fetch the reviewer as a full GuildMember.
        const reviewer = await interaction.guild.members.fetch(interaction.user.id);

        // Only Administrators, configured Admins, NCOs, and AAR Moderators may review.
        const isAuthorized =
            reviewer.permissions.has(PermissionFlagsBits.Administrator) ||
            memberHasRole(reviewer, ADMIN_ROLE_ID) ||
            memberHasRole(reviewer, NCO_ROLE_ID) ||
            memberHasRole(reviewer, MODERATOR_ROLE_ID);

        if (!isAuthorized) {
            await interaction.editReply({
                content: 'You do not have permission to review Unproven Trial submissions.'
            });
            return true;
        }

        // Reviews must take place in the configured Trial review channel.
        if (interaction.channelId !== TRIAL_REVIEW_CHANNEL_ID) {
            await interaction.editReply({
                content: 'Trial submissions must be reviewed in the designated Trial review channel.'
            });
            return true;
        }

        // Confirm that this is a genuine, pending submission and its original review message.
        const submission = await trialDatabase.getTrialSubmission(submissionId);

        if (!submission) {
            await interaction.editReply({
                content: 'This Trial submission could not be found.'
            });
            return true;
        }

        if (submission.status !== 'pending') {
            await interaction.editReply({
                content: `This submission has already been ${submission.status}.`
            });
            return true;
        }

        if (String(submission.review_message_id) !== String(interaction.message.id)) {
            await interaction.editReply({
                content: 'This button does not belong to the original Trial review message.'
            });
            return true;
        }

        // A reviewer must not approve or reject their own submission or a
        // submission in which they participated as a Trial Completer or Pack Member.
        const isSubmitter = submission.submitter_id === interaction.user.id;
        const isParticipant = [
            ...submission.completers,
            ...submission.pack_members
        ].some(member => member.user_id === interaction.user.id);

        if (isSubmitter || isParticipant) {
            await interaction.editReply({
                content: 'You cannot review a Trial submission that you submitted or participated in.'
            });
            return true;
        }

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
                    await database.execute({
                        sql: 'INSERT OR IGNORE INTO iron_wolves_tenure (guild_id, user_id, assigned_at) VALUES (?, ?, ?)',
                        args: [interaction.guild.id, member.id, new Date().toISOString()]
                    });

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



        // Update the original V2 report and remove its review buttons.
        try {
            const progressionLines = (reviewResult.progressionAwards || []).map(award => {
                const progress = `${award.completedTrialCount}/3`;
                const graduation = award.graduated ? ' • **GRADUATED**' : '';

                return `<@${award.userId}>: **${progress} Trials completed**${graduation}`;
            });

            const pointLines = (reviewResult.pointsAwards || []).map(award => {
                const points = Number(award.pointsAwarded || 0);
                return `<@${award.userId}>: **+${points} Saga Points**`;
            });

            const resultSections = [
                `**Decision:** ${decision.toUpperCase()}`,
                `**Reviewer:** ${reviewer.displayName} (<@${reviewer.id}>)`,
                `**Reviewed:** <t:${Math.floor(Date.now() / 1000)}:F>`
            ];

            if (decision === 'approved') {
                if (progressionLines.length > 0) {
                    resultSections.push(
                        '**Trial Progression Awarded**\n' +
                        progressionLines.join('\n')
                    );
                }

                if (pointLines.length > 0) {
                    resultSections.push(
                        '**Pack Member Rewards**\n' +
                        pointLines.join('\n')
                    );
                }
            } else {
                resultSections.push(
                    'No progression or Saga Points were awarded.'
                );
            }

            if (followUpIssues.length > 0) {
                resultSections.push(
                    '**Follow-up Issues**\n' +
                    followUpIssues.join('\n')
                );
            }

            const resultCompleters = await getTrialCompleterProgress(
                submission.completers.map(member => ({
                    id: member.user_id
                }))
            );

            const resultPackMembers = submission.pack_members.map(member => ({
                id: member.user_id,
                hasUnprovenRole: Boolean(member.unproven_role_at_submission)
            }));

            const resultContainer = buildTrialReviewContainer({
                submissionId,
                submitterId: submission.submitter_id,
                trialKey: submission.trial_key,
                completers: resultCompleters,
                packMembers: resultPackMembers,
                evidence: submission.evidence,
                reviewStatus: decision,
                reviewResult: resultSections.join('\n\n')
            });

            await interaction.message.edit({
                flags: MessageFlags.IsComponentsV2,
                components: [resultContainer],
                attachments: submission.evidence.map(file => ({
                    id: file.id
                })),
                allowedMentions: {
                    parse: []
                }
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

async function handleTrialReviewReaction(reaction, user) {
    if (user.bot) return false;

    let lockAcquired = false;
    let message;
    let resolvedReaction = reaction;

    try {
        if (resolvedReaction.partial) {
            resolvedReaction = await resolvedReaction.fetch();
        }

        message = resolvedReaction.message;

        if (message.partial) {
            message = await message.fetch();
        }

        if (message.channelId !== TRIAL_REVIEW_CHANNEL_ID) return false;
        if (message.author?.id !== message.client.user.id) return false;

        const emoji = resolvedReaction.emoji.name;

        let decision;

        if (emoji === '\u2705') {
            decision = 'approve';
        } else if (emoji === '\u274C') {
            decision = 'reject';
        } else {
            return false;
        }

        const submissionResult = await database.execute({
            sql: 'SELECT id FROM trial_submissions WHERE review_message_id = ?',
            args: [message.id]
        });
        const submissionRecord = submissionResult.rows[0];

        if (!submissionRecord) {
            await resolvedReaction.users.remove(user.id).catch(() => {});
            return true;
        }

        const submissionId = Number(submissionRecord.id);

        if (processingTrialReviews.has(message.id)) {
            await resolvedReaction.users.remove(user.id).catch(() => {});
            return true;
        }

        processingTrialReviews.add(message.id);
        lockAcquired = true;

        const adapter = {
            isButton: () => true,
            customId: `trial_${decision}_${submissionId}`,
            guild: message.guild,
            channelId: message.channelId,
            message,
            user,
            client: message.client,
            deferred: false,
            replied: false,

            async reply(payload) {
                this.replied = true;

                console.log(
                    `[Trial Review] ${payload.content || 'Review action declined'}`
                );

                await resolvedReaction.users.remove(user.id).catch(() => {});
            },

            async deferReply() {
                this.deferred = true;
            },

            async editReply(payload) {
                console.log(
                    `[Trial Review] ${payload.content || 'Review processing finished'}`
                );
            }
        };

        await processTrialReviewDecision(adapter);

        const updatedSubmission = await trialDatabase.getTrialSubmission(submissionId);

        if (updatedSubmission && updatedSubmission.status !== 'pending') {
            await message.reactions.removeAll().catch(error => {
                console.error(
                    '[Trial Review] Could not remove final review reactions:',
                    error
                );
            });
        }

        return true;

    } catch (error) {
        console.error('[Trial Review] Reaction handler error:', error);

        if (resolvedReaction && user?.id) {
            await resolvedReaction.users.remove(user.id).catch(() => {});
        }

        return true;

    } finally {
        if (lockAcquired && message) {
            processingTrialReviews.delete(message.id);
        }
    }
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
        const progress = await trialDatabase.getMemberTrialProgress(newMember.id);

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
    handleTrialReviewReaction,
    handleTrialMemberUpdate,
    publishTrialPanel,

};
