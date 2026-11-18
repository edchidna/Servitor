
require('dotenv').config();

const db = require('./database');
const keep_alive = require('./keep_alive.js');
const sharp = require('sharp');
const { refreshLeaderboard } = require('./leaderboard');
const trial = require('./trial');
const honor = require('./honor');

const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  MessageFlags,
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ModalBuilder,
  LabelBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  FileUploadBuilder
} = require('discord.js');

const SAGA_RANK_PRIORITY = [
  { id: '1569256588689281105', name: 'Great Wolf' },
  { id: '1570671088290111488', name: 'High Wolf Lord' },
  { id: '1569914867035545600', name: 'High Rune Priest' },
  { id: '1569914652564000809', name: 'High Iron Priest' },
  { id: '1569914819971129374', name: 'High Wolf Priest' },
  { id: '1569517129005273108', name: 'Wolf Lord' },
  { id: '1570954587253506128', name: 'Hunt Master' },
  { id: '1571500983207333958', name: 'Fang-Breaker' },
  { id: '1571501284698234910', name: 'Warbringer' },
  { id: '1569520499246112798', name: 'Long Fang Pack-Leader' },
  { id: '1569520164087660634', name: 'Wolf Scout Pack-Leader' },
  { id: '1569520720986505287', name: 'Grey Hunter Pack-Leader' },
  { id: '1569517335989977098', name: 'Blood Claw Pack-Leader' },
  { id: '1569519400372015246', name: 'Skyclaw Pack-Leader' },
  { id: '1569517914124591224', name: 'Iron Priest' },
  { id: '1569517843937099838', name: 'Rune Priest' },
  { id: '1569517984437899325', name: 'Wolf Priest' },
  { id: '1569517265919934564', name: 'Wolf Guard' },
  { id: '1569518522302861343', name: 'Wolf Champion' },
  { id: '1569518076439957604', name: 'Wulfen' },
  { id: '1569516908447793172', name: 'Wolf Scout' },
  { id: '1569516824058535967', name: 'Long Fang' },
  { id: '1569516721709252730', name: 'Grey Hunter' },
  { id: '1569516607242506381', name: 'Skyclaw' },
  { id: '1569516542742364170', name: 'Blood Claw' }
];

function escapeSvgText(value) {
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function fetchSagaHistoryAvatar(avatarUrl) {
  const maximumAvatarBytes = 5 * 1024 * 1024;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  try {
    const response = await fetch(avatarUrl, {
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Avatar request failed with HTTP ${response.status}.`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!/^image\/(?:png|jpe?g|webp|gif)$/i.test(contentType)) {
      throw new Error(`Avatar response has unsupported type: ${contentType}.`);
    }

    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maximumAvatarBytes) {
      throw new Error('Avatar response exceeds the 5 MB size limit.');
    }

    if (!response.body) {
      throw new Error('Avatar response has no readable body.');
    }

    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        totalBytes += value.byteLength;
        if (totalBytes > maximumAvatarBytes) {
          await reader.cancel();
          throw new Error('Avatar response exceeds the 5 MB size limit.');
        }

        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }

    return Buffer.concat(chunks, totalBytes);
  } finally {
    clearTimeout(timeout);
  }
}

async function createSagaHistoryCard({
  displayName,
  rankName,
  avatarUrl,
  sagaPoints,
  geneSeedTotal,
  armouryDataTotal,
  tenure,
  honorLayout
}) {
  const width = 1600;
  const height = 1000;
  const avatarSize = 180;
  const backgroundPath = require('path').join(
    __dirname,
    'assets',
    'saga-background.png'
  );
  let backgroundBuffer;

  try {
    backgroundBuffer = await sharp(backgroundPath, {
      limitInputPixels: width * height
    })
      .resize(width, height, { fit: 'cover' })
      .png()
      .toBuffer();
  } catch (error) {
    console.error(
      `Could not load Saga History background image at ${backgroundPath}:`,
      error
    );
    throw new Error('Saga History background image could not be loaded.', {
      cause: error
    });
  }

  const darkOverlay = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect width="${width}" height="${height}" fill="#000000" opacity="0.72"/>
    </svg>
  `);
  const darkenedBackground = await sharp(backgroundBuffer)
    .composite([{ input: darkOverlay }])
    .png()
    .toBuffer();

  const safeName = Array.from(
    String(displayName).replace(/\s+/g, ' ').trim()
  );
  const maximumNameLength = 42;
  const nameText = safeName.length > maximumNameLength
    ? `${safeName.slice(0, maximumNameLength - 1).join('')}…`
    : safeName.join('');
  const nameFontSize = Math.max(
    48,
    Math.min(81, Math.floor(1120 / Math.max(1, nameText.length * 0.58)))
  );

  const text = {
    name: escapeSvgText(nameText || 'Unknown Member'),
    rankName: escapeSvgText(rankName || 'Unranked'),
    sagaPoints: escapeSvgText(sagaPoints),
    geneSeedTotal: escapeSvgText(geneSeedTotal),
    armouryDataTotal: escapeSvgText(armouryDataTotal),
    tenure: escapeSvgText(tenure)
  };


  // ==========================================
  // HONOR DISPLAY DATA
  // ==========================================


  const honorIconLayers = [];

  const createHonorColumnSvg = (items, x) => {
    return items.map((item, index) => {
      if (!item) return '';

      const y = 610 + (index * 42);

      return `
        <text x="${x + 48}" y="${y}"
              fill="#f3f0e8"
              stroke="#0a1721"
              stroke-width="1.5"
              stroke-linejoin="round"
              paint-order="stroke fill"
              font-family="Pirata One, sans-serif"
              font-size="28"
              font-weight="700"
        >${escapeSvgText(item.display_name)}</text>
      `;
    }).join('');
  };


  const createHonorIconLayers = async (items, x) => {
    const path = require('path');
    const fs = require('fs');

    const honorsDirectory = path.resolve(
      __dirname,
      'assets',
      'honors'
    );

    for (let index = 0; index < items.length; index++) {
      const item = items[index];

      if (!item?.icon_path) continue;

      const iconPath = path.resolve(__dirname, item.icon_path);

      if (
        !iconPath.startsWith(honorsDirectory + path.sep) ||
        !fs.existsSync(iconPath)
      ) {
        console.warn(
          `[Saga History] Honor icon unavailable: ${item.icon_path}`
        );
        continue;
      }

      try {
        const iconBuffer = await sharp(iconPath, {
          limitInputPixels: 4_000_000
        })
          .resize(32, 32, {
            fit: 'contain'
          })
          .png()
          .toBuffer();

        honorIconLayers.push({
          input: iconBuffer,
          left: x,
          top: 583 + (index * 42)
        });

      } catch (error) {
        console.error(
          `[Saga History] Could not load Honor icon ${item.icon_path}:`,
          error.message
        );
      }
    }
  };


  const honorLeftItems = honorLayout?.leftColumn || [];
  const honorRightItems = honorLayout?.rightColumn || [];

  const honorLeftSvg = createHonorColumnSvg(
    honorLeftItems,
    840
  );

  const honorRightSvg = createHonorColumnSvg(
    honorRightItems,
    1160
  );

  await Promise.all([
    createHonorIconLayers(honorLeftItems, 840),
    createHonorIconLayers(honorRightItems, 1160)
  ]);

  const cardSvg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="nameGradient" x1="35%" y1="35%" x2="75%" y2="75%">
          <stop offset="0%" stop-color="#A9C8E6"/>
          <stop offset="100%" stop-color="#59c5e9"/>
        </linearGradient>
      </defs>
      <path d="M0 0H1600V18H0Z" fill="#E3f2fc"/>
      <path d="M1150 0H1600V450L1400 650Z" fill="#ffffff" opacity=".025"/>
      <rect x="70" y="70" width="1460" height="230" rx="28" fill="#aeaeae" opacity=".045"/>
      <circle cx="166" cy="166" r="104" fill="#587a9d" opacity=".7"/>

      <text x="310" y="153" fill="url(#nameGradient)" font-family="Pirata One, sans-serif" font-size="${nameFontSize}" font-weight="700">${text.name}</text>
      <text x="314" y="215" fill="#b9c5bd" 
                            stroke="#0a1721"
                            stroke-width="2"
                            stroke-linejoin="round"
                            paint-order="stroke fill" font-family="Pirata One, sans-serif" font-size="49" font-weight="400"
                      >Rank: ${text.rankName}</text>

      <text x="110" y="382" fill="#b9c5bd" 
                            stroke="#0a1721"
                            stroke-width="2"
                            stroke-linejoin="round"
                            paint-order="stroke fill" font-family="Pirata One, sans-serif" font-size="31" font-weight="700" letter-spacing="3"
                      >PACK</text>
      <text x="110" y="442" fill="#f3f0e8" 
                            stroke="#0a1721"
                            stroke-width="2"
                            stroke-linejoin="round"
                            paint-order="stroke fill" font-family="Pirata One, sans-serif" font-size="49" font-weight="700"
                      >Coming Soon</text>

      <text x="840" y="382" fill="#b9c5bd" 
                            stroke="#0a1721"
                            stroke-width="2"
                            stroke-linejoin="round"
                            paint-order="stroke fill" font-family="Pirata One, sans-serif" font-size="31" font-weight="700" letter-spacing="3"
                      >SAGA POINTS</text>
      <text x="840" y="442" fill="#f3f0e8" 
                            stroke="#0a1721"
                            stroke-width="2"
                            stroke-linejoin="round"
                            paint-order="stroke fill" font-family="Pirata One, sans-serif" font-size="49" font-weight="700"
                      >${text.sagaPoints}</text>

      <path d="M110 475H1490" stroke="#71827a" stroke-width="2" opacity=".45"/>
      <text x="110" y="550" fill="#b9c5bd" 
                            stroke="#0a1721"
                            stroke-width="2"
                            stroke-linejoin="round"
                            paint-order="stroke fill" font-family="Pirata One, sans-serif" font-size="31" font-weight="700" letter-spacing="3"
                      >GENESEED</text>
      <text x="110" y="610" fill="#f3f0e8" 
                            stroke="#0a1721"
                            stroke-width="2"
                            stroke-linejoin="round"
                            paint-order="stroke fill" font-family="Pirata One, sans-serif" font-size="49" font-weight="700"
                      >${text.geneSeedTotal}</text>
      
      <rect x="90" y="690" width="1420" height="145" rx="24" fill="#aeaeae" opacity=".045"/>                
      <text x="110" y="748" fill="#b9c5bd" 
                            stroke="#0a1721"
                            stroke-width="2"
                            stroke-linejoin="round"
                            paint-order="stroke fill" font-family="Pirata One, sans-serif" font-size="31" font-weight="700" letter-spacing="3"
                      >ARMOURY DATA</text>
      <text x="110" y="798" fill="#f3f0e8" 
                            stroke="#0a1721"
                            stroke-width="2"
                            stroke-linejoin="round"
                            paint-order="stroke fill" font-family="Pirata One, sans-serif" font-size="49" font-weight="700"
                      >${text.armouryDataTotal}</text>
      
      <text x="840" y="550" fill="#A9C8E6"
                            stroke="#0a1721"
                            stroke-width="2"
                            stroke-linejoin="round"
                           paint-order="stroke fill" font-family="Pirata One, sans-serif" font-size="31" font-weight="700" letter-spacing="3"
                      >HONORS</text>
                          ${honorLeftSvg}
                          ${honorRightSvg}

      <path d="M90 875H1510" stroke="#71827a" stroke-width="2" opacity=".55"/>
      <text x="1110" y="85" fill="#A9C8E6" 
                            stroke="#0a1721"
                            stroke-width="2"
                            stroke-linejoin="round"
                            paint-order="stroke fill" font-family="Pirata One, sans-serif" font-size="31" font-weight="700" letter-spacing="2"
                      >IRON WOLVES · SAGA HISTORY</text>

      <text x="1180" y="920" fill="#b9c5bd" 
                            stroke="#0a1721"
                            stroke-width="2"
                            stroke-linejoin="round"
                            paint-order="stroke fill" font-family="Pirata One, sans-serif" font-size="25" font-weight="700" letter-spacing="2"
                      >TENURE</text>
      <text x="1180" y="960" fill="#f3f0e8" 
                            stroke="#0a1721"
                            stroke-width="2"
                            stroke-linejoin="round"
                            paint-order="stroke fill" font-family="Pirata One, sans-serif" font-size="36" font-weight="700"
                      >${text.tenure}</text>
    </svg>
  `);

  let circularAvatar;

  try {
    const avatarBuffer = await fetchSagaHistoryAvatar(avatarUrl);
    const resizedAvatar = await sharp(avatarBuffer, {
      limitInputPixels: 16_000_000,
      animated: false
    })
      .rotate()
      .resize(avatarSize, avatarSize, { fit: 'cover' })
      .png()
      .toBuffer();

    const circleMask = Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="${avatarSize}" height="${avatarSize}">
        <circle cx="${avatarSize / 2}" cy="${avatarSize / 2}" r="${avatarSize / 2}" fill="#fff"/>
      </svg>
    `);

    circularAvatar = await sharp(resizedAvatar)
      .composite([{ input: circleMask, blend: 'dest-in' }])
      .png()
      .toBuffer();
  } catch (error) {
    console.error('Saga History avatar could not be loaded:', error.message);

    circularAvatar = Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="${avatarSize}" height="${avatarSize}">
        <circle cx="90" cy="90" r="90" fill="#52625c"/>
        <text x="90" y="105" text-anchor="middle" fill="#f3f0e8" 
                            stroke="#0a1721"
                            stroke-width="2"
                            stroke-linejoin="round"
                            paint-order="stroke fill" font-family="Pirata One, sans-serif" font-size="54" font-weight="700">IW</text>
      </svg>
    `);
  }

  const cardDesign = await sharp(cardSvg, {
    limitInputPixels: width * height
  })
    .png()
    .toBuffer();

  return sharp(darkenedBackground, {
    limitInputPixels: width * height
  })
    .composite([
      { input: cardDesign },
      ...honorIconLayers,
      {
        input: circularAvatar,
        left: 76,
        top: 76
      }
    ])
    .png()
    .toBuffer();
}

// Creates one contact-sheet collage from uploaded evidence images.
async function createEvidenceCollage(images) {

  const imageExtensions = /\.(png|jpe?g|gif|webp)$/i;

  const validImages = images.filter(image =>
    imageExtensions.test(image.name)
  );

  if (validImages.length === 0) {
    return null;
  }

  const columns = 3;
  const cellWidth = 400;
  const cellHeight = 300;
  const padding = 12;

  const rows = Math.ceil(validImages.length / columns);

  const collageWidth = columns * cellWidth;
  const collageHeight = rows * cellHeight;

  const composites = [];

  for (let i = 0; i < validImages.length; i++) {

    const image = validImages[i];

    const processedImage = await sharp(image.buffer)
      .rotate()
      .resize(
        cellWidth - padding * 2,
        cellHeight - padding * 2,
        {
          fit: 'contain',
          background: '#202225'
        }
      )
      .png()
      .toBuffer();

    composites.push({
      input: processedImage,
      left: (i % columns) * cellWidth + padding,
      top: Math.floor(i / columns) * cellHeight + padding
    });
  }

  return sharp({
    create: {
      width: collageWidth,
      height: collageHeight,
      channels: 3,
      background: '#202225'
    }
  })
    .composite(composites)
    .png()
    .toBuffer();
}
// ==========================================
// CONFIGURATION CHECK
// ==========================================

const requiredVariables = [
  'DISCORD_TOKEN',
  'REPORT_CHANNEL_ID',
  'REVIEW_CHANNEL_ID',
  'LEADERBOARD_CHANNEL_ID',
  'MODERATOR_ROLE_ID',
  'ORDEAL_REVIEW_CHANNEL_ID',
  'NCO_REVIEW_CHANNEL_ID',
  'ADMIN_ROLE_ID',
  'NCO_ROLE_ID',
  'IRON_WOLVES_ROLE_ID'
];

for (const variable of requiredVariables) {
  if (!process.env[variable]) {
    throw new Error(`${variable} is missing from .env`);
  }
}

// ==========================================
// GAME DATA
// ==========================================

const operations = [
  'Inferno',
  'Decapitation',
  'Vox Liberatis',
  'Reliquary',
  'Fall of Atreus',
  'Ballistic Engine',
  'Termination',
  'Obelisk',
  'Exfiltration',
  'Vortex',
  'Reclamation',
  'Disruption',
  'Purgation',
  'Other / Not Listed'
];
// ----------------------------------------
// ORDEALS CONFIGURATION
// ----------------------------------------

const ordeals = [
  {
    key: 'lone_wolf',
    name: 'Lone Wolf',
    description: 'Complete the Lone Wolf challenge.',
    gameMode: 'Operations',
    difficulty: 'Absolute',
    basePoints: 5,
    rewardRoleId: process.env.LONE_WOLF_ROLE_ID
  },
  {
    key: 'double_trouble',
    name: 'Double Trouble',
    description: 'Complete the Double Trouble challenge.',
    gameMode: 'Stratagems',
    difficulty: 'Hard',
    basePoints: 6,
    rewardRoleId: process.env.DOUBLE_TROUBLE_ROLE_ID
  }
];

// Only challenges with configured reward roles are available.
const activeOrdeals = ordeals.filter(ordeal => Boolean(ordeal.rewardRoleId));

const difficultyPoints = {
  'Average': 1,
  'Substantial': 2,
  'Ruthless': 3,
  'Lethal': 4,
  'Absolute': 5
};

// ==========================================
// DISCORD CLIENT
// ==========================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers
  ],
  partials: [
    Partials.Message,
    Partials.Reaction,
    Partials.User
  ]
});


// Stores each user's selected difficulty
// until they submit their Operations report.
const pendingDifficultySelections = new Map();
const pendingStratagemDifficultySelections = new Map();
const pendingSiegeDifficultySelections = new Map();
const operationsDifficultyWorkflowLifetimeMs = 10 * 60 * 1000;

// Stores each user's Ordeal selections
// while they complete the multi-step submission.

const pendingOrdealWorkflows = new Map();
const processingOrdealSubmissions = new Set();
const processingOrdealReviews = new Set();

client.once(Events.ClientReady, async (readyClient) => {
  console.log('================================');
  console.log('SPACE MARINE 2 AAR BOT');
  console.log('================================');
  console.log(`Bot name: ${readyClient.user.tag}`);
  console.log('Status: Online');
  console.log('Waiting for Discord commands...');

  // Initialize tenure for existing Iron Wolves members.
  try {
    const guilds = readyClient.guilds.cache;

    for (const guild of guilds.values()) {
      console.log(
        `[Iron Wolves] Initializing existing members in ${guild.name}...`
      );

      const members = await guild.members.fetch();

      const insertTenure = db.prepare(`
        INSERT OR IGNORE INTO iron_wolves_tenure (
          guild_id,
          user_id,
          assigned_at
        )
        VALUES (?, ?, ?)
      `);

      const initializedAt = new Date().toISOString();

      const initializeMembers = db.transaction(() => {
        for (const member of members.values()) {
          if (member.roles.cache.has(process.env.IRON_WOLVES_ROLE_ID)) {
            insertTenure.run(
              guild.id,
              member.id,
              initializedAt
            );
          }
        }
      });

      initializeMembers();

      console.log(
        `[Iron Wolves] Existing member initialization completed in ${guild.name}.`
      );
    }
  } catch (error) {
    console.error(
      '[Iron Wolves] Existing member initialization failed:',
      error
    );
  }

  try {
    await trial.publishTrialPanel(readyClient);
    console.log('Unproven Trial panel check completed.');
  } catch (error) {
    console.error('Failed to publish Unproven Trial panel:', error);
  }
});



// ======================================
// UNPROVEN TRIAL GRADUATION PROTECTION
// + IRON WOLVES TENURE TRACKING
// ======================================

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {

  // Keep the existing Trial Graduation Protection.
  try {
    await trial.handleTrialMemberUpdate(oldMember, newMember);
  } catch (error) {
    console.error(
      '[Trial Graduation] GuildMemberUpdate handler failed:',
      error
    );
  }

  // Track Iron Wolves role changes.
  try {
    const hadIronWolvesRole = oldMember.roles.cache.has(
      process.env.IRON_WOLVES_ROLE_ID
    );

    const hasIronWolvesRole = newMember.roles.cache.has(
      process.env.IRON_WOLVES_ROLE_ID
    );

    // Member receives Iron Wolves.
    if (!hadIronWolvesRole && hasIronWolvesRole) {

      db.prepare(`
        INSERT INTO iron_wolves_tenure (
          guild_id,
          user_id,
          assigned_at
        )
        VALUES (?, ?, ?)
        ON CONFLICT(guild_id, user_id)
        DO UPDATE SET assigned_at = excluded.assigned_at
      `).run(
        newMember.guild.id,
        newMember.id,
        new Date().toISOString()
      );

      console.log(
        `[Iron Wolves] Tenure started for ${newMember.user.tag}.`
      );
    }

    // Member loses Iron Wolves.
    if (hadIronWolvesRole && !hasIronWolvesRole) {

      db.prepare(`
        DELETE FROM iron_wolves_tenure
        WHERE guild_id = ? AND user_id = ?
      `).run(
        newMember.guild.id,
        newMember.id
      );

      console.log(
        `[Iron Wolves] Tenure record reset for ${newMember.user.tag}.`
      );
    }

  } catch (error) {
    console.error(
      '[Iron Wolves] Role tracking failed:',
      error
    );
  }
});

// ======================================
// IRON WOLVES MEMBER LEAVE TRACKING
// ======================================

client.on(Events.GuildMemberRemove, async (member) => {
  try {

    db.prepare(`
      DELETE FROM iron_wolves_tenure
      WHERE guild_id = ? AND user_id = ?
    `).run(
      member.guild.id,
      member.id
    );

    console.log(
      `[Iron Wolves] Tenure record cleared for departing member ${member.user.tag}.`
    );

  } catch (error) {
    console.error(
      '[Iron Wolves] Member leave tracking failed:',
      error
    );
  }
});


// ==========================================
// SELECT MENU BUILDER
// ==========================================

function createStringSelector(id, label, choices) {
  const selector = new StringSelectMenuBuilder()
    .setCustomId(id)
    .setPlaceholder(label)
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      choices.map(choice => ({
        label: choice.label || choice,
        value: choice.value || choice
      }))
    );

  return new LabelBuilder()
    .setLabel(label)
    .setStringSelectMenuComponent(selector);
}

// ==========================================
// OPERATIONS MODAL BUILDER
// ==========================================

function createOperationsModal() {

  const squadSelector = new UserSelectMenuBuilder()
    .setCustomId('aar_squad')
    .setPlaceholder('Select up to 2 teammates')
    .setMinValues(0)
    .setMaxValues(2)
    .setRequired(false);

  const evidenceUpload = new FileUploadBuilder()
    .setCustomId('aar_evidence')
    .setMinValues(1)
    .setMaxValues(6)
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId('aar_operations_submit')
    .setTitle('Operations After Action Report')
    .addLabelComponents(

      createStringSelector(
        'aar_operation',
        'Select Operation',
        operations
      ),

      createStringSelector(
        'aar_gene_seed',
        'Gene Seed',
        ['Yes', 'No']
      ),

      createStringSelector(
        'aar_armoury_data',
        'Armoury Data',
        ['0', '1', '2', '3']
      ),

      new LabelBuilder()
        .setLabel('Pack Members')
        .setDescription(
          'You are automatically included. Select up to 2 teammates.'
        )
        .setUserSelectMenuComponent(squadSelector),

      new LabelBuilder()
        .setLabel('Evidence Files')
        .setDescription('Upload 1 to 6 proof images or files.')
        .setFileUploadComponent(evidenceUpload)

    );
}

function buildOperationsParticipants(submitterId, teammateIds) {
  if (
    !Array.isArray(teammateIds) ||
    teammateIds.some(id => typeof id !== 'string' || id === submitterId) ||
    new Set(teammateIds).size !== teammateIds.length ||
    teammateIds.length > 2
  ) {
    throw new Error('Invalid Operations squad member selection.');
  }

  return new Set([submitterId, ...teammateIds]);
}

function deleteOperationsWorkflow(userId, expectedWorkflow) {
  const workflow = pendingDifficultySelections.get(userId);
  if (!workflow || (expectedWorkflow && workflow !== expectedWorkflow)) {
    return;
  }

  if (workflow.expirationTimer) {
    clearTimeout(workflow.expirationTimer);
  }
  pendingDifficultySelections.delete(userId);
}

function scheduleOperationsWorkflowExpiration(userId, workflow) {
  if (workflow.expirationTimer) {
    clearTimeout(workflow.expirationTimer);
  }

  workflow.expiresAt = Date.now() + operationsDifficultyWorkflowLifetimeMs;
  workflow.expirationTimer = setTimeout(() => {
    deleteOperationsWorkflow(userId, workflow);
  }, operationsDifficultyWorkflowLifetimeMs);
  workflow.expirationTimer.unref();
}

const stratagemDifficultyPoints = {
  'Normal': 5,
  'Hard': 6
};

const siegeDifficultyPoints = {
  'Normal': 3,
  'Hard': 5
};

const pvpGameModes = [
  'Capture and Control',
  'Seize Ground',
  'Annihilation',
  'Helbrute Onslaught'
];

const pvpResultPoints = {
  'Victory': 3,
  'Defeat': 1
};

const pvpWinAnswers = {
  'Yes': 'Victory',
  'No': 'Defeat'
};

function createPvpModal() {

  const squadSelector = new UserSelectMenuBuilder()
    .setCustomId('aar_pvp_squad')
    .setPlaceholder('Select up to 2 teammates')
    .setMinValues(0)
    .setMaxValues(2)
    .setRequired(false);

  const evidenceUpload = new FileUploadBuilder()
    .setCustomId('aar_pvp_evidence')
    .setMinValues(1)
    .setMaxValues(6)
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId('aar_pvp_submit')
    .setTitle('PVP After Action Report')
    .addLabelComponents(
      createStringSelector(
        'aar_pvp_game_mode',
        'PVP Game Mode',
        pvpGameModes
      ),

      createStringSelector(
        'aar_pvp_result',
        'Did you win?',
        Object.keys(pvpWinAnswers)
      ),

      new LabelBuilder()
        .setLabel('Pack Members')
        .setDescription(
          'You are automatically included. Select up to 2 teammates.'
        )
        .setUserSelectMenuComponent(squadSelector),

      new LabelBuilder()
        .setLabel('Evidence Files')
        .setDescription('Upload 1 to 6 proof images or files.')
        .setFileUploadComponent(evidenceUpload)
    );
}

function createStratagemsModal() {

  const squadSelector = new UserSelectMenuBuilder()
    .setCustomId('aar_stratagems_squad')
    .setPlaceholder('Select up to 2 teammates')
    .setMinValues(0)
    .setMaxValues(2)
    .setRequired(false);

  const evidenceUpload = new FileUploadBuilder()
    .setCustomId('aar_stratagems_evidence')
    .setMinValues(1)
    .setMaxValues(6)
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId('aar_stratagems_submit')
    .setTitle('Stratagems After Action Report')
    .addLabelComponents(

      createStringSelector(
        'aar_stratagems_gene_seed',
        'Gene Seed',
        ['Yes', 'No']
      ),

      createStringSelector(
        'aar_stratagems_armoury_data',
        'Armoury Data',
        ['0', '1', '2', '3']
      ),

      new LabelBuilder()
        .setLabel('Pack Members')
        .setDescription(
          'You are automatically included. Select up to 2 teammates.'
        )
        .setUserSelectMenuComponent(squadSelector),

      new LabelBuilder()
        .setLabel('Evidence Files')
        .setDescription('Upload 1 to 6 proof images or files.')
        .setFileUploadComponent(evidenceUpload)

    );
}

function createSiegeModal() {

  const wavesInput = new TextInputBuilder()
    .setCustomId('aar_siege_waves')
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(16)
    .setPlaceholder('Enter a positive whole number')
    .setRequired(true);

  const squadSelector = new UserSelectMenuBuilder()
    .setCustomId('aar_siege_squad')
    .setPlaceholder('Select up to 2 teammates')
    .setMinValues(0)
    .setMaxValues(2)
    .setRequired(false);

  const evidenceUpload = new FileUploadBuilder()
    .setCustomId('aar_siege_evidence')
    .setMinValues(1)
    .setMaxValues(6)
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId('aar_siege_submit')
    .setTitle('Siege After Action Report')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Waves Completed')
        .setDescription('Enter the total number of waves completed.')
        .setTextInputComponent(wavesInput),

      new LabelBuilder()
        .setLabel('Pack Members')
        .setDescription(
          'You are automatically included. Select up to 2 teammates.'
        )
        .setUserSelectMenuComponent(squadSelector),

      new LabelBuilder()
        .setLabel('Evidence Files')
        .setDescription('Upload 1 to 6 proof images or files.')
        .setFileUploadComponent(evidenceUpload)
    );
}
// ==========================================
// ORDEAL SUBMISSION MODAL
// ==========================================

function createOrdealModal(ordeal) {

  const participantSelector = new UserSelectMenuBuilder()
    .setCustomId('ordeal_additional_participants')
    .setPlaceholder('Select up to 2 additional teammates')
    .setMinValues(0)
    .setMaxValues(2)
    .setRequired(false);

  const evidenceUpload = new FileUploadBuilder()
    .setCustomId('ordeal_evidence')
    .setMinValues(1)
    .setMaxValues(6)
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId(`ordeal_submit_${ordeal.key}`)
    .setTitle(`${ordeal.name} Completion`)
    .addLabelComponents(
      createStringSelector(
        'ordeal_gene_seed',
        'Gene Seed',
        ['Yes', 'No']
      ),
      createStringSelector(
        'ordeal_armoury_data',
        'Armoury Data',
        ['0', '1', '2', '3']
      ),
      ...(ordeal.gameMode === 'Operations'
        ? [
          createStringSelector(
            'ordeal_operation',
            'Operation',
            operations
          )
        ]
        : []),
      new LabelBuilder()
        .setLabel('Pack Members')
        .setDescription(
          'You are automatically included as a participant. Select up to 2 additional teammates.'
        )
        .setUserSelectMenuComponent(participantSelector),
      new LabelBuilder()
        .setLabel('Challenge Evidence')
        .setDescription(
          'Upload 1 to 6 proof images or files.'
        )
        .setFileUploadComponent(evidenceUpload)
    );
}
// ==========================================
// ORDEAL WORKFLOW — SELECTOR BUILDERS
// ==========================================

function createOrdealCompleterSelector() {

  const completerSelector = new UserSelectMenuBuilder()
    .setCustomId('ordeal_completers')
    .setPlaceholder('Select challenge completers')
    .setMinValues(1)
    .setMaxValues(3);

  return new ActionRowBuilder()
    .addComponents(completerSelector);
}

function createOrdealAdditionalParticipantSelector(maxValues = 2) {

  const participantSelector = new UserSelectMenuBuilder()
    .setCustomId('ordeal_additional_participants')
    .setPlaceholder('Select additional squad participants')
    .setMinValues(0)
    .setMaxValues(maxValues);

  return new ActionRowBuilder()
    .addComponents(participantSelector);
}

function createOrdealOperationSelector() {

  const operationSelector = new StringSelectMenuBuilder()
    .setCustomId('ordeal_operation')
    .setPlaceholder('Select the operation')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      operations.map(operation => ({
        label: operation,
        value: operation
      }))
    );

  return new ActionRowBuilder()
    .addComponents(operationSelector);
}

function createOrdealGeneSeedSelector() {

  const geneSeedSelector = new StringSelectMenuBuilder()
    .setCustomId('ordeal_gene_seed')
    .setPlaceholder('Was Gene Seed acquired?')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      { label: 'Yes', value: 'Yes' },
      { label: 'No', value: 'No' }
    );

  return new ActionRowBuilder()
    .addComponents(geneSeedSelector);
}

function createOrdealArmouryDataSelector() {

  const armouryDataSelector = new StringSelectMenuBuilder()
    .setCustomId('ordeal_armoury_data')
    .setPlaceholder('Select Armoury Data gained')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      { label: '0', value: '0' },
      { label: '1', value: '1' },
      { label: '2', value: '2' },
      { label: '3', value: '3' }
    );

  return new ActionRowBuilder()
    .addComponents(armouryDataSelector);
}

function createOrdealSkipParticipantsButton() {

  const skipButton = new ButtonBuilder()
    .setCustomId('ordeal_skip_additional_participants')
    .setLabel('Skip — No Additional Participants')
    .setStyle(ButtonStyle.Secondary);

  return new ActionRowBuilder()
    .addComponents(skipButton);
}

function createOrdealContinueParticipantsButton() {

  const continueButton = new ButtonBuilder()
    .setCustomId('ordeal_continue_participants')
    .setLabel('Continue')
    .setStyle(ButtonStyle.Primary);

  return new ActionRowBuilder()
    .addComponents(continueButton);
}

function createOrdealCancelButton() {

  const cancelButton = new ButtonBuilder()
    .setCustomId('ordeal_cancel')
    .setLabel('Cancel Ordeal Submission')
    .setStyle(ButtonStyle.Danger);

  return new ActionRowBuilder()
    .addComponents(cancelButton);
}

function createOrdealEvidenceContinueButton() {

  const continueButton = new ButtonBuilder()
    .setCustomId('ordeal_evidence_continue')
    .setLabel('Continue to Evidence Upload')
    .setStyle(ButtonStyle.Primary);

  return new ActionRowBuilder()
    .addComponents(continueButton);
}

// ==========================================
// REACTION-BASED APPROVAL PROCESSING
// ==========================================

async function processReportReaction(reaction, user) {

  // Ignore the bot's own reactions.
  if (user.bot) return;

  try {

    // Fetch partial reaction/message if necessary.
    if (reaction.partial) {
      await reaction.fetch();
    }

    const message = reaction.message;

    if (message.partial) {
      await message.fetch();
    }

    // Only process reports in the review channel.
    if (
      message.channel.id !== process.env.REVIEW_CHANNEL_ID
    ) {
      return;
    }

    // Only process messages created by this bot.
    if (
      !message.author ||
      message.author.id !== client.user.id
    ) {
      return;
    }

    // Identify our report by its title.
    const reportEmbed = message.embeds[0];

    if (!reportEmbed || !reportEmbed.title) {
      return;
    }

    const reportMatch = reportEmbed.title.match(
      /^(Operations|Stratagems|Siege|PVP) Report #(\d+)$/
    );

    if (!reportMatch) return;

    const reportCategory = reportMatch[1];
    const reportId = Number(reportMatch[2]);

    // Identify the reaction.
    const emoji = reaction.emoji.name;

    let decision;

    if (emoji === '✅') {
      decision = 'approved';
    } else if (emoji === '❌') {
      decision = 'rejected';
    } else {
      return;
    }

    // ----------------------------------------
    // CHECK MODERATOR PERMISSIONS
    // ----------------------------------------

    const member = await message.guild.members.fetch(
      user.id
    );

    const isAdministrator = member.permissions.has(
      PermissionFlagsBits.Administrator
    );

    const hasAdminRole = member.roles.cache.has(
      process.env.ADMIN_ROLE_ID
    );

    const hasNCORole = member.roles.cache.has(
      process.env.NCO_ROLE_ID
    );

    const isAARModerator = member.roles.cache.has(
      process.env.MODERATOR_ROLE_ID
    );

    if (
      !isAdministrator &&
      !hasAdminRole &&
      !hasNCORole &&
      !isAARModerator
    ) {

      console.log(
        `Unauthorized reaction ignored on report #${reportId} by ${user.tag}.`
      );

      // Remove the unauthorized user's reaction if possible.
      // The decision is never processed.
      await reaction.users.remove(user.id).catch(error => {
        console.error(
          'Could not remove unauthorized reaction:',
          error.message
        );
      });

      return;
    }

    // ----------------------------------------
    // GET REPORT FROM DATABASE
    // ----------------------------------------

    const report = db.prepare(`
      SELECT *
      FROM reports
      WHERE id = ?
        AND game_mode = ?
    `).get(
      reportId,
      reportCategory
    );

    if (!report) {
      console.error(`Report #${reportId} not found in database.`);
      return;
    }


    // ----------------------------------------
    // GET REPORT PARTICIPANTS
    // ----------------------------------------

    const participants = db.prepare(`
      SELECT user_id
      FROM report_participants
      WHERE report_id = ?
    `).all(reportId);

    if (participants.length === 0) {
      console.error(
        `Report #${reportId} has no registered participants.`
      );
      return;
    }

    // ----------------------------------------
    // PREVENT SELF-APPROVAL OR SELF-REJECTION
    // ----------------------------------------

    const isSubmitter = report.submitter_id === user.id;

    const isParticipant = participants.some(
      participant => participant.user_id === user.id
    );

    if (isSubmitter || isParticipant) {

      console.log(
        `Self-review blocked for report #${reportId} by ${user.tag}.`
      );

      await reaction.users.remove(user.id).catch(error => {
        console.error(
          'Could not remove reviewer reaction:',
          error.message
        );
      });

      return;
    }


    // ----------------------------------------
    // DATABASE TRANSACTION
    // ----------------------------------------

    const saveDecision = db.transaction(() => {

      // Update only if the report is still pending.
      const updateResult = db.prepare(`
        UPDATE reports
        SET
          status = ?,
          reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND status = 'pending'
      `).run(
        decision,
        reportId
      );

      // Prevent duplicate decisions.
      if (updateResult.changes !== 1) {
        return false;
      }

      // Award points only when approved.
      if (decision === 'approved') {

        const insertScore = db.prepare(`
          INSERT INTO score_ledger (
            report_id,
            user_id,
            points
          )
          VALUES (?, ?, ?)
        `);

        for (const participant of participants) {
          insertScore.run(
            reportId,
            participant.user_id,
            report.total_points
          );
        }
      }

      // Record the moderator's decision.
      db.prepare(`
        INSERT INTO audit_log (
          report_id,
          moderator_id,
          decision,
          reason
        )
        VALUES (?, ?, ?, ?)
      `).run(
        reportId,
        user.id,
        decision,
        null
      );

      return true;
    });

    const decisionSaved = saveDecision();

    if (!decisionSaved) {

      console.log(
        `Another moderator already decided report #${reportId}.`
      );

      await message.reactions.removeAll().catch(console.error);
      return;
    }

    // Refresh leaderboard immediately after a successful decision.
    if (decision === 'approved') {
      try {
        await refreshLeaderboard(client);
      } catch (error) {
        console.error(
          'Could not refresh leaderboard after AAR approval:',
          error
        );
      }
    }

    // ----------------------------------------
    // UPDATE ORIGINAL REPORT WITH FINAL RESULT
    // ----------------------------------------

    const updatedEmbed = EmbedBuilder.from(reportEmbed);

    const statusIndex = updatedEmbed.data.fields.findIndex(
      field => field.name === 'Status'
    );

    const finalStatus = decision === 'approved'
      ? 'APPROVED ✅'
      : 'REJECTED ❌';

    if (statusIndex !== -1) {
      updatedEmbed.spliceFields(
        statusIndex,
        1,
        {
          name: 'Status',
          value: finalStatus,
          inline: false
        }
      );
    }

    // ----------------------------------------
    // BUILD DETAILED APPROVAL RECEIPT
    // ----------------------------------------

    if (decision === 'approved') {

      const reportData = JSON.parse(report.report_data);

      const totalAwarded =
        report.total_points * participants.length;

      const formatPoints = value =>
        Number(value.toFixed(2)).toString();

      const memberTotals = participants.map(participant => {
        const scoreResult = db.prepare(`
            SELECT COALESCE(SUM(sl.points), 0) AS total
            FROM score_ledger sl
            INNER JOIN reports r
            ON r.id = sl.report_id
            WHERE sl.user_id = ?
            AND r.status = 'approved'
         `).get(participant.user_id);

        const newTotal = scoreResult.total;

        const previousTotal =
          newTotal - report.total_points;

        return (
          `<@${participant.user_id}>: ` +
          `${formatPoints(previousTotal)} → ` +
          `${formatPoints(newTotal)} ` +
          `(+${formatPoints(report.total_points)} pts)`
        );

      });

      const approvalField = {
        name: 'AAR Approval',
        value: reportCategory === 'PVP'
          ? (
            `**Total points awarded to squad: ${formatPoints(totalAwarded)} AAR points.**\n` +
            `Approved by: <@${user.id}>`
          )
          : (
            `**${formatPoints(totalAwarded)} AAR points awarded ` +
            `to ${participants.length} Brother(s).**\n` +
            `Approved by: <@${user.id}>`
          ),
        inline: false
      };

      const memberTotalsField = {
        name: 'Updated AAR Totals',
        value: memberTotals.join('\n'),
        inline: false
      };

      if (reportCategory === 'PVP') {

        const squadBonus = Number(report.bonus_points);

        updatedEmbed.addFields(
          approvalField,
          {
            name: 'PVP Points Breakdown',
            value:
              `PVP Game Mode: ${reportData.pvpGameMode}\n` +
              `Result: ${reportData.result}\n` +
              `Base Points: ${formatPoints(report.base_points)} pts\n` +
              `Pack Bonus: +${formatPoints(squadBonus)} pts\n` +
              `**Total Points Per Participant: ${formatPoints(report.total_points)} pts**`,
            inline: false
          },
          memberTotalsField
        );

      } else if (reportCategory === 'Siege') {

        const waves = Number(reportData.waves);
        const countedWaves = Math.floor(waves / 5) * 5;
        const squadBonus = Number(report.bonus_points);

        updatedEmbed.addFields(
          approvalField,
          {
            name: 'Siege Points Breakdown',
            value:
              `Difficulty: ${reportData.difficulty}\n` +
              `Waves Completed: ${waves}\n` +
              `Waves Counted for Scoring: ${countedWaves}\n` +
              `Base Points: ${formatPoints(report.base_points)} pts\n` +
              `Pack Bonus: +${formatPoints(squadBonus)} pts\n` +
              `**Total Points: ${formatPoints(report.total_points)} pts**\n` +
              `Decision Status: ${finalStatus}`,
            inline: false
          },
          memberTotalsField
        );

      } else {

        const geneSeedBonus =
          reportData.geneSeed === 'Yes' ? 1 : 0;

        const armouryBonus =
          Number(reportData.armouryData || 0) * 0.5;

        const squadBonus =
          participants.length > 1 ? 1 : 0;

        updatedEmbed.addFields(
          approvalField,
          {
            name: 'Points Breakdown Per Brother',
            value:
              `Difficulty (${reportData.difficulty}): ${formatPoints(report.base_points)} pts\n` +
              `Gene Seed: +${formatPoints(geneSeedBonus)} pts\n` +
              `Armoury Data: +${formatPoints(armouryBonus)} pts\n` +
              `Pack Bonus: +${formatPoints(squadBonus)} pts\n` +
              `**Total: ${formatPoints(report.total_points)} pts**`,
            inline: false
          },
          memberTotalsField
        );
      }

    } else {

      updatedEmbed.addFields(
        {
          name: 'AAR Review Result',
          value:
            `**Report rejected. No points awarded.**\n` +
            `Rejected by: <@${user.id}>`,
          inline: false
        }
      );

    }

    // ----------------------------------------
    // UPDATE REVIEWER FOOTER
    // ----------------------------------------

    updatedEmbed.setFooter({
      text:
        `Space Marine 2 AAR System | ${decision.toUpperCase()} by <@${user.id}>`
    });


    // ----------------------------------------
    // UPDATE REVIEW CARD AND PRESERVE EVIDENCE
    // ----------------------------------------

    try {

      await message.edit({
        embeds: [updatedEmbed]
      });

    } catch (editError) {

      console.error(
        `Could not update review card for report #${reportId}. The database decision is already saved:`,
        editError
      );

    }



    // ----------------------------------------
    // REMOVE APPROVAL AND REJECTION REACTIONS
    // ----------------------------------------

    await message.reactions.removeAll().catch(error => {
      console.error(
        'Could not remove report reactions:',
        error.message
      );
    });

    // ----------------------------------------
    // LOG FINAL DECISION
    // ----------------------------------------

    console.log(
      `Report #${reportId} ${decision} by ${user.tag}.`
    );

  } catch (error) {

    console.error(
      'Report reaction processing error:',
      error
    );
  }
}
// ==========================================
// ORDEAL APPROVAL PROCESSING
// ==========================================


async function processOrdealReaction(reaction, user) {

  if (user.bot) return;

  let message;
  let submissionId;
  let lockAcquired = false;

  try {

    if (reaction.partial) {
      await reaction.fetch();
    }

    message = reaction.message;

    if (message.partial) {
      await message.fetch();
    }

    // --------------------------------------
    // CHECK ORDEAL REVIEW CHANNEL
    // --------------------------------------

    if (
      message.channel.id !== process.env.ORDEAL_REVIEW_CHANNEL_ID
    ) {
      return;
    }

    if (
      !message.author ||
      message.author.id !== client.user.id
    ) {
      return;
    }

    const reviewEmbed = message.embeds[0];

    if (!reviewEmbed || !reviewEmbed.title) {
      return;
    }

    const match = reviewEmbed.title.match(
      /^Ordeal Completion #(\d+)$/
    );

    if (!match) return;

    submissionId = Number(match[1]);

    const emoji = reaction.emoji.name;

    let decision;

    if (emoji === '✅') {
      decision = 'approved';
    } else if (emoji === '❌') {
      decision = 'rejected';
    } else {
      return;
    }

    // --------------------------------------
    // PREVENT SIMULTANEOUS REVIEWS
    // --------------------------------------

    if (processingOrdealReviews.has(message.id)) {
      await reaction.users.remove(user.id).catch(() => { });
      return;
    }

    processingOrdealReviews.add(message.id);
    lockAcquired = true;

    // --------------------------------------
    // CHECK MODERATOR PERMISSIONS
    // --------------------------------------

    const moderator = await message.guild.members.fetch(
      user.id
    );

    const isAdministrator = moderator.permissions.has(
      PermissionFlagsBits.Administrator
    );

    const hasAdminRole = moderator.roles.cache.has(
      process.env.ADMIN_ROLE_ID
    );

    const hasNCORole = moderator.roles.cache.has(
      process.env.NCO_ROLE_ID
    );

    const isAARModerator = moderator.roles.cache.has(
      process.env.MODERATOR_ROLE_ID
    );

    if (
      !isAdministrator &&
      !hasAdminRole &&
      !hasNCORole &&
      !isAARModerator
    ) {

      await reaction.users.remove(user.id).catch(() => { });

      console.log(
        `Unauthorized Ordeal review attempt by ${user.username}.`
      );

      return;
    }

    // --------------------------------------
    // GET SUBMISSION
    // --------------------------------------

    const submission = db.prepare(`
      SELECT *
      FROM ordeal_submissions
      WHERE id = ?
    `).get(submissionId);

    if (!submission) {
      console.error(
        `Ordeal submission #${submissionId} not found.`
      );
      return;
    }

    // --------------------------------------
    // READ PARTICIPANT INFORMATION
    // --------------------------------------

    let completerIds = [];
    let participantIds = [];

    try {

      completerIds = JSON.parse(
        submission.challenge_completers || '[]'
      );

      participantIds = JSON.parse(
        submission.participants || '[]'
      );

    } catch (parseError) {

      throw new Error(
        `Could not read participant data for Ordeal #${submissionId}.`
      );
    }

    if (
      !Array.isArray(completerIds) ||
      !Array.isArray(participantIds)
    ) {
      throw new Error(
        `Ordeal #${submissionId} has invalid participant information.`
      );
    }

    if (
      completerIds.length === 0 ||
      participantIds.length === 0
    ) {
      const emptyFields = [
        ...(participantIds.length === 0 ? ['participants'] : []),
        ...(completerIds.length === 0 ? ['challenge_completers'] : [])
      ];
      const diagnostic =
        `Ordeal decision blocked for submission #${submissionId} ` +
        `(${submission.challenge_name}): empty ${emptyFields.join(' and ')} ` +
        `field${emptyFields.length === 1 ? '' : 's'}. Both fields are required ` +
        'to validate the squad and reward recipients; no decision, points, or roles were applied.';

      if (submission.status === 'pending') {
        console.error(diagnostic);
      }

      throw new Error(diagnostic);
    }

    participantIds = [...new Set(participantIds)];
    completerIds = [...new Set(completerIds)];

    if (
      participantIds.length > 3 ||
      completerIds.some(id => !participantIds.includes(id))
    ) {
      throw new Error(
        `Ordeal #${submissionId} has inconsistent squad information.`
      );
    }

    // --------------------------------------
    // PREVENT SELF-REVIEW
    // --------------------------------------

    const isSubmitter = submission.submitter_id === user.id;

    const isParticipant = participantIds.includes(user.id);

    if (isSubmitter || isParticipant) {

      await reaction.users.remove(user.id).catch(() => { });

      console.log(
        `Self-review blocked for Ordeal #${submissionId}.`
      );

      return;
    }

    // --------------------------------------
    // CHECK SUBMISSION STATUS
    // --------------------------------------

    if (submission.status !== 'pending') {

      console.log(
        `Ordeal #${submissionId} already has a final decision.`
      );

      await message.reactions.removeAll().catch(() => { });
      return;
    }

    // --------------------------------------
    // PREPARE REWARD AND POINT INFORMATION
    // --------------------------------------




    let rewardRole = null;
    const newlyAssignedMembers = [];

    if (decision === 'approved') {

      const configuredOrdeal = activeOrdeals.find(ordeal =>
        ordeal.key === submission.challenge_key &&
        ordeal.rewardRoleId === submission.reward_role_id
      );

      if (!configuredOrdeal) {
        throw new Error('This Ordeal submission is no longer configured with its reward role.');
      }

      rewardRole = await message.guild.roles.fetch(
        submission.reward_role_id
      );

      if (!rewardRole) {
        throw new Error(
          `Reward role ${submission.reward_role_id} could not be found.`
        );
      }

      // Fetch every actual challenge completer first.
      const completerMembers = [];

      for (const completerId of completerIds) {

        const member = await message.guild.members.fetch(
          completerId
        );

        completerMembers.push(member);
      }

      // ------------------------------------
      // GRANT ROLE TO CHALLENGE COMPLETERS
      // ------------------------------------

      try {

        for (const member of completerMembers) {

          const alreadyHasRole =
            member.roles.cache.has(rewardRole.id);

          if (!alreadyHasRole) {

            await member.roles.add(
              rewardRole,
              `Approved Ordeal: ${submission.challenge_name}`
            );

            newlyAssignedMembers.push(member);
          }
        }

        // ----------------------------------
        // SAVE APPROVAL DECISION
        // ----------------------------------

        const saveDecision = db.transaction(() => {

          const result = db.prepare(`
            UPDATE ordeal_submissions
            SET
              status = ?,
              reviewed_by = ?,
              reviewed_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND status = 'pending'
          `).run(
            decision,
            user.id,
            submissionId
          );

          if (result.changes !== 1) {
            return false;
          }

          db.prepare(`
            INSERT INTO ordeal_audit_log (
              submission_id,
              moderator_id,
              decision
            )
            VALUES (?, ?, ?)
          `).run(
            submissionId,
            user.id,
            decision
          );



          return true;
        });

        const decisionSaved = saveDecision();

        if (!decisionSaved) {

          // Another reviewer finalized this submission.
          for (const member of newlyAssignedMembers) {

            await member.roles.remove(
              rewardRole,
              'Ordeal was already reviewed'
            ).catch(console.error);
          }

          await message.reactions.removeAll().catch(() => { });
          return;
        }

      } catch (approvalError) {

        // Undo roles assigned during a failed approval.
        for (const member of newlyAssignedMembers) {

          await member.roles.remove(
            rewardRole,
            'Ordeal approval could not be finalized'
          ).catch(console.error);
        }

        throw approvalError;
      }

    } else {

      // ----------------------------------
      // SAVE REJECTION
      // ----------------------------------

      const saveRejection = db.transaction(() => {

        const result = db.prepare(`
          UPDATE ordeal_submissions
          SET
            status = ?,
            reviewed_by = ?,
            reviewed_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND status = 'pending'
        `).run(
          decision,
          user.id,
          submissionId
        );

        if (result.changes !== 1) {
          return false;
        }

        db.prepare(`
          INSERT INTO ordeal_audit_log (
            submission_id,
            moderator_id,
            decision
          )
          VALUES (?, ?, ?)
        `).run(
          submissionId,
          user.id,
          decision
        );

        return true;
      });

      const decisionSaved = saveRejection();

      if (!decisionSaved) {

        await message.reactions.removeAll().catch(() => { });
        return;
      }
    }

    // --------------------------------------
    // BUILD APPROVAL RECEIPT
    // --------------------------------------

    const updatedEmbed = EmbedBuilder.from(reviewEmbed);

    const statusIndex = updatedEmbed.data.fields.findIndex(
      field => field.name === 'Status'
    );

    const finalStatus = decision === 'approved'
      ? 'APPROVED ✅'
      : 'REJECTED ❌';

    if (statusIndex !== -1) {

      updatedEmbed.spliceFields(
        statusIndex,
        1,
        {
          name: 'Status',
          value: finalStatus,
          inline: false
        }
      );
    }

    const resultDescription = decision === 'approved'
      ? (
        `**Challenge completion approved!**\n` +
        `Reward role: <@&${submission.reward_role_id}>\n` +
        `Role recipients: ${completerIds.map(id => `<@${id}>`).join(', ')}\n` +
        `AAR points awarded: **0**\n` +
        `Approved by: <@${user.id}>`
      )
      : (
        `**Challenge submission rejected.**\n` +
        `No reward role or AAR points were granted.\n` +
        `Rejected by: <@${user.id}>`
      );

    updatedEmbed.addFields({
      name: 'Ordeal Review Result',
      value: resultDescription,
      inline: false
    });

    updatedEmbed.setFooter({
      text: `Space Marine 2 Ordeals | ${decision.toUpperCase()} by <@${user.id}>`
    });

    try {

  const evidenceEmbeds = message.embeds
    .slice(1)
    .map(embed => EmbedBuilder.from(embed));

  await message.edit({
    embeds: [
      updatedEmbed,
      ...evidenceEmbeds
    ]
  });

} catch (editError) {

  console.error(
    `Could not update review card for Ordeal #${submissionId}. The database decision is already saved:`,
    editError
  );

}

    await message.reactions.removeAll().catch(console.error);

    console.log(
      `Ordeal #${submissionId} ${decision} by <@${user.id}>.`
    );

  } catch (error) {

    console.error(
      `Ordeal review error for submission #${submissionId}:`,
      error
    );

  } finally {

    if (lockAcquired && message) {
      processingOrdealReviews.delete(message.id);
    }
  }
}

// ==========================================
// REACTION EVENT HANDLER
// ==========================================

client.on(
  Events.MessageReactionAdd,
  async (reaction, user) => {
    await processReportReaction(reaction, user);
    await processOrdealReaction(reaction, user);
  }
);

// ==========================================
// INTERACTION HANDLER
// ==========================================

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // UNPROVEN TRIAL INTERACTIONS
    if (await trial.handleTrialPanelInteraction(interaction)) return;
    if (await trial.handleTrialReviewInteraction(interaction)) return;
    if (await trial.handleTrialSubmission(interaction)) return;

    // ======================================
    // HONOR AUTOCOMPLETE
    // ======================================

    if (interaction.isAutocomplete()) {
      if (interaction.commandName === 'honor') {
        const focused = interaction.options.getFocused(true);

        if (focused.name === 'honor') {
          const search = focused.value.toLowerCase();

          const matchingHonors = honor.getAllHonors()
            .filter(item =>
              item.display_name.toLowerCase().includes(search) ||
              item.honor_id.toLowerCase().includes(search)
            )
            .slice(0, 25)
            .map(item => ({
              name: item.display_name,
              value: item.honor_id
            }));

          await interaction.respond(matchingHonors);
        }
      }

      return;
    }

    // ======================================
    // SLASH COMMANDS
    // ======================================

    if (interaction.isChatInputCommand()) {

      // ======================================
      // MANUAL SAGA POINT COMMAND
      // ======================================

      if (interaction.commandName === 'sagapoint') {

        if (!interaction.guild) {
          await interaction.reply({
            content: 'Saga Point commands can only be used inside a server.',
            flags: MessageFlags.Ephemeral
          });
          return;
        }
        await interaction.deferReply();

        const subcommand = interaction.options.getSubcommand();
        const targetUser = interaction.options.getUser('member', true);
        const requestedPoints = interaction.options.getNumber('amount', true);
        const reason = interaction.options.getString('reason', true).trim();

        // --------------------------------------
        // VERIFY EXECUTOR PERMISSIONS
        // --------------------------------------

        let executor;

        try {
          executor = await interaction.guild.members.fetch(
            interaction.user.id
          );
        } catch (error) {
          console.error(
            'Could not fetch Saga Point command executor:',
            error.message
          );
        }

        if (!executor) {
          await interaction.reply({
            content: 'Could not verify your server permissions.',
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        const canManageSagaPoints =
          (
            process.env.ADMIN_ROLE_ID &&
            executor.roles.cache.has(process.env.ADMIN_ROLE_ID)
          ) ||
          (
            process.env.NCO_ROLE_ID &&
            executor.roles.cache.has(process.env.NCO_ROLE_ID)
          ) ||
          (
            process.env.MODERATOR_ROLE_ID &&
            executor.roles.cache.has(process.env.MODERATOR_ROLE_ID)
          );

        if (!canManageSagaPoints) {
          await interaction.reply({
            content:
              'You need the Admin, NCO, or High Command role to manage Saga Points.',
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        if (
          !Number.isFinite(requestedPoints) ||
          requestedPoints <= 0 ||
          !reason
        ) {
          await interaction.reply({
            content: 'Please provide a valid amount and reason.',
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        // --------------------------------------
        // VERIFY TARGET MEMBER
        // --------------------------------------

        let targetMember;

        try {
          targetMember = await interaction.guild.members.fetch(
            targetUser.id
          );
        } catch (error) {
          console.error(
            'Could not fetch Saga Point target member:',
            error.message
          );
        }

        if (!targetMember) {
          await interaction.reply({
            content: 'The selected member could not be found in this server.',
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        // --------------------------------------
        // CALCULATE CURRENT SAGA POINT BALANCE
        // --------------------------------------

        const getCurrentSagaPoints = db.prepare(`
          SELECT COALESCE(SUM(points), 0) AS total_points
          FROM (
            SELECT sl.points
            FROM score_ledger sl
            INNER JOIN reports r
              ON r.id = sl.report_id
            WHERE r.status = 'approved'
              AND sl.user_id = ?

            UNION ALL

            SELECT tsl.points
            FROM trial_score_ledger tsl
            INNER JOIN trial_submissions ts
              ON ts.id = tsl.submission_id
            WHERE ts.status = 'approved'
              AND tsl.user_id = ?

            UNION ALL

            SELECT spa.points_delta AS points
            FROM saga_point_adjustments spa
            WHERE spa.guild_id = ?
              AND spa.user_id = ?
          )
        `);

        // --------------------------------------
        // RECORD ADJUSTMENT ATOMICALLY
        // --------------------------------------

        const applyAdjustment = db.transaction(() => {

          const currentBalance = Math.max(
            0,
            Number(
              getCurrentSagaPoints.get(
                targetUser.id,
                targetUser.id,
                interaction.guild.id,
                targetUser.id
              ).total_points
            )
          );

          const appliedPoints = subcommand === 'deduct'
            ? Math.min(requestedPoints, currentBalance)
            : requestedPoints;

          const pointsDelta = subcommand === 'deduct'
            ? -appliedPoints
            : appliedPoints;

          const result = db.prepare(`
            INSERT INTO saga_point_adjustments (
              guild_id,
              user_id,
              moderator_id,
              action,
              requested_points,
              applied_points,
              points_delta,
              reason
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            interaction.guild.id,
            targetUser.id,
            interaction.user.id,
            subcommand,
            requestedPoints,
            appliedPoints,
            pointsDelta,
            reason
          );

          const newBalance = Math.max(
            0,
            currentBalance + pointsDelta
          );

          return {
            auditId: Number(result.lastInsertRowid),
            currentBalance,
            appliedPoints,
            newBalance
          };
        });

        let adjustment;

        try {
          adjustment = applyAdjustment();
        } catch (error) {
          console.error('Saga Point adjustment failed:', error);

          await interaction.editReply({
            content: 'The Saga Point adjustment failed. No changes were saved.'
          });
          return;
        }

        // --------------------------------------
        // REFRESH LEADERBOARD
        // --------------------------------------

        let leaderboardUpdated = true;

        try {
          await refreshLeaderboard(client);
        } catch (error) {
          leaderboardUpdated = false;
          console.error(
            'Saga Point adjustment succeeded, but leaderboard refresh failed:',
            error
          );
        }

        // --------------------------------------
        // CONFIRM ADJUSTMENT
        // --------------------------------------

        const actionLabel = subcommand === 'add'
          ? 'Added'
          : 'Deducted';

        const confirmation =
          `**Saga Points ${subcommand === 'add' ? 'Added' : 'Deducted'}**\n\n` +
          `**Member:** <@${targetUser.id}>\n` +
          `**Requested:** ${requestedPoints.toLocaleString('en-US')} points\n` +
          `**${actionLabel}:** ${adjustment.appliedPoints.toLocaleString('en-US')} points\n` +
          `**Previous balance:** ${adjustment.currentBalance.toLocaleString('en-US')} points\n` +
          `**New balance:** ${adjustment.newBalance.toLocaleString('en-US')} points\n` +
          `**Reason:** ${reason}\n` +
          `**Recorded by:** <@${interaction.user.id}>\n` +
          `**Audit ID:** #${adjustment.auditId}` +
          (
            adjustment.appliedPoints < requestedPoints
              ? '\n\nThe deduction was limited to the member’s available balance.'
              : ''
          ) +
          (
            leaderboardUpdated
              ? ''
              : '\n\n⚠️ The adjustment was saved, but the leaderboard could not be refreshed.'
          );

        await interaction.editReply({
          content: confirmation,
          allowedMentions: { parse: [] }
        });

        console.log(
          `Saga Points ${subcommand}: ${adjustment.appliedPoints} points for ${targetUser.id} by ${interaction.user.id}. Audit #${adjustment.auditId}.`
        );

        return;
      }


      // ======================================
      // HONOR COMMANDS
      // ======================================

      if (interaction.commandName === 'honor') {

        if (!interaction.guild) {
          await interaction.reply({
            content: 'Honor commands can only be used inside a server.',
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        // ======================================
        // HONOR MANAGEMENT PERMISSIONS
        // ======================================

        const managementCommands = [
          'give',
          'remove',
          'rename',
          'layout'
        ];

        if (managementCommands.includes(subcommand)) {
          let executor;

          try {
            executor = await interaction.guild.members.fetch(
              interaction.user.id
            );
          } catch (error) {
            console.error(
              'Could not fetch Honor command executor:',
              error.message
            );
          }

          if (!executor) {
            await interaction.reply({
              content: 'Could not verify your server permissions.',
              flags: MessageFlags.Ephemeral
            });
            return;
          }

          const isHonorManager =
            executor.permissions.has(PermissionFlagsBits.Administrator) ||
            (
              process.env.ADMIN_ROLE_ID &&
              executor.roles.cache.has(process.env.ADMIN_ROLE_ID)
            ) ||
            (
              process.env.MODERATOR_ROLE_ID &&
              executor.roles.cache.has(process.env.MODERATOR_ROLE_ID)
            );

          if (!isHonorManager) {
            await interaction.reply({
              content:
                'You need Administrator, Admin, or AAR Moderator permissions to manage Honors.',
              flags: MessageFlags.Ephemeral
            });
            return;
          }
        }

        // ======================================
        // GIVE HONOR
        // ======================================

        if (subcommand === 'give') {
          const selectedUser = interaction.options.getUser('member', true);
          const honorId = interaction.options.getString('honor', true);

          const selectedHonor = honor.getHonorById(honorId);

          if (!selectedHonor) {
            await interaction.reply({
              content: 'Invalid Honor selection.',
              flags: MessageFlags.Ephemeral
            });
            return;
          }

          let member;

          try {
            member = await interaction.guild.members.fetch(selectedUser.id);
          } catch (error) {
            console.error('Could not fetch Honor recipient:', error.message);
          }

          if (!member) {
            await interaction.reply({
              content: 'That member could not be found in this server.',
              flags: MessageFlags.Ephemeral
            });
            return;
          }

          const result = honor.awardHonor(
            guildId,
            member.id,
            honorId,
            interaction.user.id
          );

          await interaction.reply({
            content: result.success
              ? `**${selectedHonor.display_name}** has been awarded to <@${member.id}>.`
              : result.message,
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] }
          });

          return;
        }

        // ======================================
        // REMOVE HONOR
        // ======================================

        if (subcommand === 'remove') {
          const selectedUser = interaction.options.getUser('member', true);
          const honorId = interaction.options.getString('honor', true);

          const selectedHonor = honor.getHonorById(honorId);

          if (!selectedHonor) {
            await interaction.reply({
              content: 'Invalid Honor selection.',
              flags: MessageFlags.Ephemeral
            });
            return;
          }

          let member;

          try {
            member = await interaction.guild.members.fetch(selectedUser.id);
          } catch (error) {
            console.error('Could not fetch Honor member:', error.message);
          }

          if (!member) {
            await interaction.reply({
              content: 'That member could not be found in this server.',
              flags: MessageFlags.Ephemeral
            });
            return;
          }

          const result = honor.removeHonor(
            guildId,
            member.id,
            honorId,
            interaction.user.id
          );

          await interaction.reply({
            content: result.success
              ? `**${selectedHonor.display_name}** has been removed from <@${member.id}>.`
              : result.message,
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] }
          });

          return;
        }

        // ======================================
        // LIST HONORS
        // ======================================

        if (subcommand === 'list') {
          const selectedUser =
            interaction.options.getUser('member') || interaction.user;

          let member;

          try {
            member = await interaction.guild.members.fetch(selectedUser.id);
          } catch (error) {
            console.error('Could not fetch Honor list member:', error.message);
          }

          if (!member) {
            await interaction.reply({
              content: 'That member could not be found in this server.',
              flags: MessageFlags.Ephemeral
            });
            return;
          }

          const memberHonors = honor.getMemberHonors(
            guildId,
            member.id
          );

          const description = memberHonors.length
            ? memberHonors.map(item =>
              `• **${item.display_name}**`
            ).join('\n')
            : 'This member has not earned any Honors yet.';

          await interaction.reply({
            content: `**Honors — ${member.displayName}**\n\n${description}`,
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] }
          });

          return;
        }

        // ======================================
        // HONOR HISTORY
        // ======================================

        if (subcommand === 'history') {
          const selectedUser =
            interaction.options.getUser('member') || interaction.user;

          let member;

          try {
            member = await interaction.guild.members.fetch(selectedUser.id);
          } catch (error) {
            console.error('Could not fetch Honor history member:', error.message);
          }

          if (!member) {
            await interaction.reply({
              content: 'That member could not be found in this server.',
              flags: MessageFlags.Ephemeral
            });
            return;
          }

          const history = honor.getMemberHonorHistory(
            guildId,
            member.id
          );

          if (history.length === 0) {
            await interaction.reply({
              content: `**Honor History — ${member.displayName}**\n\nNo Honor history found.`,
              flags: MessageFlags.Ephemeral
            });
            return;
          }

          const formatDate = value => {
            const date = new Date(
              `${String(value).replace(' ', 'T')}Z`
            );

            return Number.isNaN(date.getTime())
              ? String(value)
              : date.toLocaleString('en-GB', {
                timeZone: 'Asia/Jakarta'
              });
          };

          const historyLines = history.map(item => {
            const awarded = formatDate(item.awarded_at);

            if (item.is_active) {
              return (
                `• **${item.display_name}** — Awarded ${awarded} ` +
                `by <@${item.awarded_by}> — Active`
              );
            }

            return (
              `• **${item.display_name}** — Awarded ${awarded} ` +
              `by <@${item.awarded_by}> — Revoked ${formatDate(item.removed_at)} ` +
              `by <@${item.removed_by}>`
            );
          });

          const chunks = [];
          let currentChunk =
            `**Honor History — ${member.displayName}**\n\n`;

          for (const line of historyLines) {
            if (currentChunk.length + line.length + 1 > 1900) {
              chunks.push(currentChunk);
              currentChunk = '';
            }

            currentChunk += `${line}\n`;
          }

          if (currentChunk) {
            chunks.push(currentChunk);
          }

          await interaction.reply({
            content: chunks[0],
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] }
          });

          for (let i = 1; i < chunks.length; i++) {
            await interaction.followUp({
              content: chunks[i],
              flags: MessageFlags.Ephemeral,
              allowedMentions: { parse: [] }
            });
          }

          return;
        }

        // ======================================
        // RENAME HONOR
        // ======================================

        if (subcommand === 'rename') {
          const honorId = interaction.options.getString('honor', true);
          const newName = interaction.options.getString('name', true);

          const result = honor.renameHonor(honorId, newName);

          await interaction.reply({
            content: result.message,
            flags: MessageFlags.Ephemeral
          });

          return;
        }

        // ======================================
        // CHANGE HONOR LAYOUT
        // ======================================

        if (subcommand === 'layout') {
          const layoutMode = interaction.options.getString('mode', true);

          const result = honor.setHonorLayout(
            guildId,
            layoutMode
          );

          await interaction.reply({
            content: result.message,
            flags: MessageFlags.Ephemeral
          });

          return;
        }
      }

      if (interaction.commandName === 'ping') {
        await interaction.reply({
          content: 'Pong! Space Marine 2 AAR Bot is working.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }


      if (interaction.commandName === 'aar-help') {
        await interaction.reply({
          content:
            '**Space Marine 2 AAR Bot v1.0**\n\n' +

            '**AFTER ACTION REPORTS (AAR)**\n' +
            'Select a game mode from the AAR panel to begin.\n' +
            'Every report requires moderator approval before points are awarded.\n\n' +

            '**HONOR SYSTEM**\n' +
            'Honors are permanent achievements awarded to recognize members. ' +
            'They do not grant Saga Points or affect the leaderboard.\n\n' +

            '**Honor Commands**\n' +
            '`/honor give` — Award an Honor to a member.\n' +
            '`/honor remove` — Revoke an active Honor.\n' +
            '`/honor list` — View a member\'s active Honors.\n' +
            '`/honor history` — View all Honor awards and revocations.\n' +
            '`/honor rename` — Change an Honor\'s display name.\n' +
            '`/honor layout` — Configure the Saga History card layout.\n\n' +

            '**Honor Layout Modes**\n' +
            '`fixed` — Honors always occupy their assigned positions (1–5 left, 6–10 right).\n' +
            '`sequential` — Active Honors fill the columns from oldest award to newest.\n\n' +

            '**MANUAL SAGA POINT MANAGEMENT**\n' +
            '`/sagapoint add` — Add Saga Points to a member.\n' +
            '`/sagapoint deduct` — Deduct Saga Points from a member.\n' +
            'Both commands require a reason and are available to Admins, NCOs, and High Command.\n\n' +

            '**Permissions**\n' +
            'Only server Administrators, Admin role members, and AAR Moderators can manage Honors. ' +
            'NCOs cannot manage Honors unless they also have one of those permissions.\n' +
            'All members can view Honor lists and history.',

          flags: MessageFlags.Ephemeral
        });

        return;
      }


      if (interaction.commandName === 'sagahistory') {

        if (!interaction.guild) {
          await interaction.reply({
            content: 'Saga History can only be viewed in a server.',
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] }
          });

          return;
        }

        const selectedUser =
          interaction.options.getUser('member') || interaction.user;
        await interaction.deferReply({
          allowedMentions: { parse: [] }
        });
        let member;

        try {
          member = await interaction.guild.members.fetch(selectedUser.id);
        } catch (error) {
          console.error(
            'Could not fetch Saga History guild member:',
            error.message
          );
        }

        if (!member) {
          await interaction.editReply({
            content:
              'That user is not currently a member of this server, or their member profile could not be fetched.',
            allowedMentions: { parse: [] }
          });

          return;
        }

        const rankName = SAGA_RANK_PRIORITY.find(rank =>
          member.roles.cache.has(rank.id)
        )?.name || 'Unranked';

        const sagaPoints = db.prepare(`
          SELECT COALESCE(SUM(points), 0) AS total_points
          FROM (
            -- Approved AAR reports
            SELECT sl.points
            FROM score_ledger sl
            INNER JOIN reports r
              ON r.id = sl.report_id
            WHERE r.status = 'approved'
              AND sl.user_id = ?

            UNION ALL

            -- Approved Unproven Trial submissions
            SELECT tsl.points
            FROM trial_score_ledger tsl
            INNER JOIN trial_submissions ts
              ON ts.id = tsl.submission_id
            WHERE ts.status = 'approved'
              AND tsl.user_id = ?

            UNION ALL

            -- Manual Saga Point adjustments
            SELECT spa.points_delta AS points
            FROM saga_point_adjustments spa
            WHERE spa.guild_id = ?
              AND spa.user_id = ?
          )
        `).get(
          selectedUser.id,
          selectedUser.id,
          interaction.guild.id,
          selectedUser.id
        ).total_points;

        let geneSeedTotal = 0;
        let armouryDataTotal = 0;

        const approvedRegularReports = db.prepare(`
          SELECT r.report_data
          FROM reports r
          INNER JOIN report_participants rp
            ON rp.report_id = r.id
          WHERE rp.user_id = ?
            AND r.status = 'approved'
            AND r.game_mode IN ('Operations', 'Stratagems')
        `).all(selectedUser.id);

        for (const report of approvedRegularReports) {
          let reportData;

          try {
            reportData = JSON.parse(report.report_data);
          } catch (error) {
            console.error(
              'Could not parse approved Saga History report data:',
              error.message
            );
            continue;
          }

          if (
            reportData === null ||
            typeof reportData !== 'object' ||
            Array.isArray(reportData)
          ) {
            continue;
          }

          if (reportData.geneSeed === 'Yes') {
            geneSeedTotal += 1;
          }

          const armouryData = Number(reportData.armouryData);
          if (Number.isFinite(armouryData)) {
            armouryDataTotal += armouryData;
          }
        }

        const approvedOrdeals = db.prepare(`
          SELECT participants, gene_seed, armoury_data
          FROM ordeal_submissions
          WHERE status = 'approved'
        `).all();

        for (const ordeal of approvedOrdeals) {
          let participants;

          try {
            participants = JSON.parse(ordeal.participants);
          } catch (error) {
            console.error(
              'Could not parse approved Saga History Ordeal participants:',
              error.message
            );
            continue;
          }

          if (
            Array.isArray(participants) &&
            participants.includes(selectedUser.id)
          ) {
            if (ordeal.gene_seed === 'Yes') {
              geneSeedTotal += 1;
            }

            const armouryData = Number(ordeal.armoury_data);
            if (Number.isFinite(armouryData)) {
              armouryDataTotal += armouryData;
            }
          }
        }


        let tenure = 'Unknown';

        const tenureRecord = db.prepare(`
            SELECT assigned_at
            FROM iron_wolves_tenure
            WHERE guild_id = ? AND user_id = ?
       `).get(
          interaction.guild.id,
          member.id
        );

        if (tenureRecord?.assigned_at) {
          const assignedAt = new Date(tenureRecord.assigned_at);

          if (!Number.isNaN(assignedAt.getTime())) {
            const elapsedDays = Math.max(
              0,
              Math.floor(
                (Date.now() - assignedAt.getTime()) / 86400000
              )
            );

            const wholeWeeks = Math.floor(elapsedDays / 7);
            const remainingDays = elapsedDays % 7;

            tenure = remainingDays === 0
              ? `${wholeWeeks} ${wholeWeeks === 1 ? 'Week' : 'Weeks'}`
              : `${wholeWeeks}.${remainingDays} Weeks`;
          }
        }

        const honorLayout = honor.getHonorDisplayLayout(
          interaction.guild.id,
          member.id
        );

        try {
          const cardBuffer = await createSagaHistoryCard({
            displayName: member.displayName,
            rankName,
            avatarUrl: member.displayAvatarURL({
              extension: 'png',
              size: 256
            }),
            sagaPoints: Number(sagaPoints),
            geneSeedTotal,
            armouryDataTotal,
            tenure,
            honorLayout
          });

          await interaction.editReply({
            files: [
              new AttachmentBuilder(cardBuffer, {
                name: 'saga-history.png'
              })
            ],
            allowedMentions: { parse: [] }
          });
        } catch (error) {
          console.error('Saga History profile card generation failed:', error);

          await interaction.editReply({
            content: 'Could not generate the Saga History profile card. Please try again later.',
            allowedMentions: { parse: [] }
          });
        }

        return;
      }

      if (interaction.commandName === 'aar-panel') {

        if (!interaction.memberPermissions?.has(
          PermissionFlagsBits.Administrator
        )) {
          await interaction.reply({
            content: 'Only server administrators can publish the AAR panel.',
            flags: MessageFlags.Ephemeral
          });

          return;
        }

        const reportChannel = await interaction.guild.channels.fetch(
          process.env.REPORT_CHANNEL_ID
        );

        if (
          !reportChannel ||
          !reportChannel.isTextBased() ||
          !reportChannel.isSendable()
        ) {
          await interaction.reply({
            content: 'The configured AAR report channel is unavailable.',
            flags: MessageFlags.Ephemeral
          });

          return;
        }

        const panelEmbed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('SPACE MARINE 2 — AFTER ACTION REPORTS')
          .setDescription(
            'Welcome, Space Marine!\n\n' +
            'Select the game mode you played below to begin your After Action Report.\n\n' +
            '**Available game modes:**\n' +
            '⚔️ Operations\n' +
            '🎯 Stratagems\n' +
            '🛡️ Siege\n' +
            '🏆 PVP\n' +
            '🐺 Ordeals\n\n' +
            'All submitted reports require administrator or AAR Moderator approval before points are awarded.'
          )
          .setFooter({
            text: 'Space Marine 2 AAR System | Version 1.0'
          });

        const firstRow = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('aar_mode_operations')
              .setLabel('Operations')
              .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
              .setCustomId('aar_mode_stratagems')
              .setLabel('Stratagems')
              .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
              .setCustomId('aar_mode_siege')
              .setLabel('Siege')
              .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
              .setCustomId('aar_mode_pvp')
              .setLabel('PVP')
              .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
              .setCustomId('aar_mode_ordeals')
              .setLabel('☠️ Ordeals')
              .setStyle(ButtonStyle.Danger)
          );

        await reportChannel.send({
          embeds: [panelEmbed],
          components: [firstRow]
        });

        await interaction.reply({
          content: `AAR panel posted successfully in ${reportChannel}.`,
          flags: MessageFlags.Ephemeral
        });

        return;
      }
    }

    // ======================================
    // DIFFICULTY SELECTION
    // ======================================

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === 'aar_difficulty_select'
    ) {

      const selectedDifficulty = interaction.values[0];
      deleteOperationsWorkflow(interaction.user.id);

      const workflow = {
        difficulty: selectedDifficulty,
        expiresAt: 0,
        expirationTimer: null
      };
      pendingDifficultySelections.set(interaction.user.id, workflow);
      scheduleOperationsWorkflowExpiration(
        interaction.user.id,
        workflow
      );

      await interaction.showModal(createOperationsModal());

      return;
    }

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === 'aar_stratagems_difficulty_select'
    ) {

      const selectedDifficulty = interaction.values[0];

      pendingStratagemDifficultySelections.set(
        interaction.user.id,
        selectedDifficulty
      );

      await interaction.showModal(
        createStratagemsModal()
      );

      return;
    }

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === 'aar_siege_difficulty_select'
    ) {

      const selectedDifficulty = interaction.values[0];

      pendingSiegeDifficultySelections.set(
        interaction.user.id,
        selectedDifficulty
      );

      await interaction.showModal(
        createSiegeModal()
      );

      return;
    }

    // ======================================
    // ORDEAL CHALLENGE SELECTION
    // ======================================

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === 'aar_ordeal_select'
    ) {

      const selectedKey = interaction.values[0];

      const selectedOrdeal = activeOrdeals.find(
        ordeal => ordeal.key === selectedKey
      );

      if (!selectedOrdeal) {
        await interaction.reply({
          content: 'This Ordeal challenge could not be found.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      if (pendingOrdealWorkflows.has(interaction.user.id)) {
        await interaction.reply({
          content: 'You already have an active Ordeal submission. Finish or cancel it first.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      pendingOrdealWorkflows.set(interaction.user.id, {
        challenge: selectedOrdeal,
        submitterId: interaction.user.id,
        completerIds: [],
        additionalParticipantIds: [],
        operation: null,
        geneSeed: null,
        armouryData: null
      });

      await interaction.reply({
        content:
          `**${selectedOrdeal.name} — Challenge Completers**\n\n` +
          'Select everyone who completed the challenge. You must explicitly select yourself if you completed it.\n' +
          'Every challenge completer must also be a participant. You are automatically included as a participant whether or not you completed the challenge.\n' +
          'Maximum: 3 unique participants total, including you.',
        components: [
          createOrdealCompleterSelector(),
          createOrdealCancelButton()
        ],
        flags: MessageFlags.Ephemeral
      });

      return;
    }

    // ======================================
    // ORDEAL CHALLENGE COMPLETERS
    // ======================================

    if (
      interaction.isUserSelectMenu() &&
      interaction.customId === 'ordeal_completers'
    ) {

      const workflow = pendingOrdealWorkflows.get(interaction.user.id);

      if (!workflow) {
        await interaction.reply({
          content: 'Your Ordeal submission session has expired. Please start again.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      const completerIds = [...new Set(interaction.values)];

      const participants = new Set([
        interaction.user.id,
        ...completerIds
      ]);

      if (completerIds.length < 1 || participants.size > 3) {
        await interaction.reply({
          content:
            'The submitter is automatically included as a participant. Select completers so the total squad does not exceed 3 unique members.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      workflow.completerIds = completerIds;
      workflow.additionalParticipantIds = [];
      await interaction.showModal(
        createOrdealModal(workflow.challenge)
      );
      return;
    }

    // ======================================
    // ORDEAL ADDITIONAL PARTICIPANTS
    // ======================================

    if (
      interaction.isUserSelectMenu() &&
      interaction.customId === 'ordeal_additional_participants'
    ) {

      const workflow = pendingOrdealWorkflows.get(interaction.user.id);

      if (!workflow) {
        await interaction.reply({
          content: 'Your Ordeal submission session has expired. Please start again.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      const additionalIds = [...new Set(interaction.values)];

      const currentParticipants = new Set([
        interaction.user.id,
        ...workflow.completerIds
      ]);
      const maxAdditionalParticipants = Math.min(
        2,
        3 - currentParticipants.size
      );
      const includesExistingParticipant = additionalIds.some(userId =>
        currentParticipants.has(userId)
      );

      if (includesExistingParticipant) {
        await interaction.reply({
          content:
            'The submitter and challenge completers are already participants. ' +
            'Please select only additional squad participants.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      // The complete squad cannot exceed 3 participants.
      if (additionalIds.length > maxAdditionalParticipants) {
        await interaction.reply({
          content:
            'Your squad can have no more than 3 participants, including the submitter. ' +
            'Please select fewer additional participants.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      workflow.additionalParticipantIds = additionalIds;

      const nextStepInstruction =
        workflow.challenge.gameMode === 'Operations'
          ? 'Press Continue to select the operation.'
          : 'Press Continue to enter challenge details.';

      await interaction.update({
        content:
          `**${workflow.challenge.name} — Participants Confirmed**\n\n` +
          `Challenge completers: ${workflow.completerIds.length}\n` +
          `Additional participants: ${additionalIds.length}\n` +
          `Total squad members: ${new Set([
            interaction.user.id,
            ...workflow.completerIds,
            ...additionalIds
          ]).size}/3, including you\n\n` +
          nextStepInstruction,
        components: [
          createOrdealContinueParticipantsButton(),
          createOrdealCancelButton()
        ]
      });

      return;
    }

    // ======================================
    // ORDEAL OPERATION SELECTION
    // ======================================

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === 'ordeal_operation'
    ) {

      const workflow = pendingOrdealWorkflows.get(interaction.user.id);

      if (!workflow) {
        await interaction.reply({
          content: 'Your Ordeal submission session has expired. Please start again.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      workflow.operation = interaction.values[0];

      await interaction.update({
        content:
          `**${workflow.challenge.name} — Gene Seed Selection**\n\n` +
          `Operation: **${workflow.operation}**\n\n` +
          'Did your squad acquire a Gene Seed?',
        components: [
          createOrdealGeneSeedSelector(),
          createOrdealCancelButton()
        ]
      });

      return;
    }

    // ======================================
    // ORDEAL GENE SEED SELECTION
    // ======================================

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === 'ordeal_gene_seed'
    ) {

      const workflow = pendingOrdealWorkflows.get(interaction.user.id);

      if (!workflow) {
        await interaction.reply({
          content: 'Your Ordeal submission session has expired. Please start again.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      workflow.geneSeed = interaction.values[0];

      await interaction.update({
        content:
          `**${workflow.challenge.name} — Armoury Data Selection**\n\n` +
          (workflow.challenge.gameMode === 'Operations'
            ? `Operation: **${workflow.operation}**\n`
            : `Game Mode: **${workflow.challenge.gameMode}**\n` +
            `Difficulty: **${workflow.challenge.difficulty}**\n`) +
          `Gene Seed: **${workflow.geneSeed}**\n\n` +
          'How many Armoury Data did your squad acquire?',
        components: [
          createOrdealArmouryDataSelector(),
          createOrdealCancelButton()
        ]
      });

      return;
    }

    // ======================================
    // ORDEAL ARMOURY DATA SELECTION
    // ======================================

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === 'ordeal_armoury_data'
    ) {

      const workflow = pendingOrdealWorkflows.get(interaction.user.id);

      if (!workflow) {
        await interaction.reply({
          content: 'Your Ordeal submission session has expired. Please start again.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      workflow.armouryData = Number(interaction.values[0]);

      await interaction.update({
        content:
          `**${workflow.challenge.name} — Evidence Submission**\n\n` +
          (workflow.challenge.gameMode === 'Operations'
            ? `Operation: **${workflow.operation}**\n`
            : `Game Mode: **${workflow.challenge.gameMode}**\n` +
            `Difficulty: **${workflow.challenge.difficulty}**\n`) +
          `Gene Seed: **${workflow.geneSeed}**\n` +
          `Armoury Data: **${workflow.armouryData}**\n\n` +
          'Next, upload 1–6 evidence files proving challenge completion and squad participation.',
        components: [
          createOrdealEvidenceContinueButton(),
          createOrdealCancelButton()
        ]
      });

      return;
    }

    // ======================================
    // BUTTON INTERACTIONS
    // ======================================

    if (interaction.isButton()) {

      // ------------------------------------
      // OPERATIONS BUTTON
      // ------------------------------------

      if (interaction.customId === 'aar_mode_operations') {

        deleteOperationsWorkflow(interaction.user.id);

        const difficultySelector = new StringSelectMenuBuilder()
          .setCustomId('aar_difficulty_select')
          .setPlaceholder('Choose operation difficulty')
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(
            Object.keys(difficultyPoints).map(difficulty => ({
              label: difficulty,
              value: difficulty
            }))
          );

        const selectRow = new ActionRowBuilder()
          .addComponents(difficultySelector);

        await interaction.reply({
          content:
            '**Select Operation Difficulty**\n\n' +
            'Choose the difficulty you completed. ' +
            'You will select your squad before the report form opens.',
          components: [
            selectRow
          ],
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      if (interaction.customId === 'aar_mode_stratagems') {

        pendingStratagemDifficultySelections.delete(
          interaction.user.id
        );

        const difficultySelector = new StringSelectMenuBuilder()
          .setCustomId('aar_stratagems_difficulty_select')
          .setPlaceholder('Choose Stratagems difficulty')
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(
            Object.keys(stratagemDifficultyPoints).map(difficulty => ({
              label: difficulty,
              value: difficulty
            }))
          );

        const selectRow = new ActionRowBuilder()
          .addComponents(difficultySelector);

        await interaction.reply({
          content:
            '**Select Stratagems Difficulty**\n\n' +
            'Choose the difficulty you completed. ' +
            'The Stratagems report form will open immediately after your selection.',
          components: [selectRow],
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      if (interaction.customId === 'aar_mode_siege') {

        pendingSiegeDifficultySelections.delete(
          interaction.user.id
        );

        const difficultySelector = new StringSelectMenuBuilder()
          .setCustomId('aar_siege_difficulty_select')
          .setPlaceholder('Choose Siege difficulty')
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(
            Object.keys(siegeDifficultyPoints).map(difficulty => ({
              label: difficulty,
              value: difficulty
            }))
          );

        const selectRow = new ActionRowBuilder()
          .addComponents(difficultySelector);

        await interaction.reply({
          content:
            '**Select Siege Difficulty**\n\n' +
            'Choose the difficulty you completed. ' +
            'The Siege report form will open immediately after your selection.',
          components: [selectRow],
          flags: MessageFlags.Ephemeral
        });

        return;
      }
      // ------------------------------------
      // ORDEALS BUTTON
      // ------------------------------------

      if (interaction.customId === 'aar_mode_ordeals') {

        const ordealDescriptions = activeOrdeals
          .map(ordeal =>
            `• ${ordeal.name}: ${ordeal.gameMode} / ${ordeal.difficulty} / ${ordeal.basePoints} base points.`
          )
          .join('\n');

        const ordealSelector = new StringSelectMenuBuilder()
          .setCustomId('aar_ordeal_select')
          .setPlaceholder('Choose an Ordeal challenge')
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(
            activeOrdeals.map(ordeal => ({
              label: ordeal.name,
              description: ordeal.description,
              value: ordeal.key
            }))
          );

        const selectRow = new ActionRowBuilder()
          .addComponents(ordealSelector);

        await interaction.reply({
          content:
            '**☠️ ORDEALS — CHALLENGE SELECTION**\n\n' +
            'Choose the challenge your squad completed.\n\n' +
            `${ordealDescriptions}\n\n` +
            '**Rewards (after approval):**\n' +
            '• The designated Discord role/title for approved challenge completers.\n\n' +
            '**Ordeals award zero AAR points and do not affect the leaderboard.**\n' +
            'Only actual challenge completers receive the special Discord role.',
          components: [selectRow],
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      // ------------------------------------
      // ORDEAL CONTINUE BUTTON
      // ------------------------------------

      if (interaction.customId === 'ordeal_continue_participants') {

        const workflow = pendingOrdealWorkflows.get(interaction.user.id);

        if (!workflow) {
          await interaction.update({
            content: 'Your Ordeal submission session has expired. Please start again.',
            components: []
          });

          return;
        }

        const usesOperation =
          workflow.challenge.gameMode === 'Operations';

        await interaction.update({
          content: usesOperation
            ? (
              `**${workflow.challenge.name} — Operation Selection**\n\n` +
              'Select the operation in which you completed this challenge.'
            )
            : (
              `**${workflow.challenge.name} — Gene Seed Selection**\n\n` +
              `Game Mode: **${workflow.challenge.gameMode}**\n` +
              `Difficulty: **${workflow.challenge.difficulty}**\n\n` +
              'Did your squad acquire a Gene Seed?'
            ),
          components: usesOperation
            ? [
              createOrdealOperationSelector(),
              createOrdealCancelButton()
            ]
            : [
              createOrdealGeneSeedSelector(),
              createOrdealCancelButton()
            ]
        });

        return;
      }

      // ------------------------------------
      // ORDEAL SKIP ADDITIONAL PARTICIPANTS
      // ------------------------------------

      if (interaction.customId === 'ordeal_skip_additional_participants') {

        const workflow = pendingOrdealWorkflows.get(interaction.user.id);

        if (!workflow) {
          await interaction.update({
            content: 'Your Ordeal submission session has expired. Please start again.',
            components: []
          });

          return;
        }

        workflow.additionalParticipantIds = [];

        const usesOperation =
          workflow.challenge.gameMode === 'Operations';

        await interaction.update({
          content: usesOperation
            ? (
              `**${workflow.challenge.name} — Operation Selection**\n\n` +
              'No additional participants selected.\n' +
              'Select the operation in which you completed this challenge.'
            )
            : (
              `**${workflow.challenge.name} — Gene Seed Selection**\n\n` +
              'No additional participants selected.\n' +
              `Game Mode: **${workflow.challenge.gameMode}**\n` +
              `Difficulty: **${workflow.challenge.difficulty}**\n\n` +
              'Did your squad acquire a Gene Seed?'
            ),
          components: usesOperation
            ? [
              createOrdealOperationSelector(),
              createOrdealCancelButton()
            ]
            : [
              createOrdealGeneSeedSelector(),
              createOrdealCancelButton()
            ]
        });

        return;
      }

      // ------------------------------------
      // ORDEAL CANCEL BUTTON
      // ------------------------------------

      if (interaction.customId === 'ordeal_evidence_continue') {

        const workflow = pendingOrdealWorkflows.get(interaction.user.id);

        if (!workflow) {
          await interaction.reply({
            content: 'Your Ordeal session has expired. Please start again.',
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        const selectedOrdeal = workflow.challenge;

        if (!selectedOrdeal || !selectedOrdeal.key) {
          await interaction.reply({
            content: 'The selected Ordeal challenge could not be found. Please start again.',
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        await interaction.showModal(createOrdealModal(selectedOrdeal));
        return;
      }

      if (interaction.customId === 'ordeal_cancel') {

        pendingOrdealWorkflows.delete(interaction.user.id);

        await interaction.update({
          content: 'Your Ordeal submission has been cancelled.',
          components: []
        });

        return;
      }

      // ------------------------------------
      // OTHER GAME MODE BUTTONS
      // ------------------------------------

      const gameModes = {
        aar_mode_stratagems: 'Stratagems',
        aar_mode_siege: 'Siege'
      };

      const selectedMode = gameModes[interaction.customId];

      if (interaction.customId === 'aar_mode_pvp') {
        await interaction.showModal(createPvpModal());
        return;
      }

      if (!selectedMode) return;

      await interaction.reply({
        content:
          `You selected **${selectedMode}**.\n\n` +
          'The report submission form for this game mode is under development.',
        flags: MessageFlags.Ephemeral
      });

      return;
    }
    // ======================================
    // ORDEAL FORM SUBMISSION
    // ======================================


    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith('ordeal_submit_')
    ) {

      const challengeKey = interaction.customId.replace(
        'ordeal_submit_',
        ''
      );

      const ordeal = ordeals.find(
        item => item.key === challengeKey
      );

      if (!ordeal) {
        await interaction.reply({
          content: 'This Ordeal challenge could not be found.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const workflow = pendingOrdealWorkflows.get(interaction.user.id);

      if (
        !workflow ||
        workflow.submitterId !== interaction.user.id ||
        workflow.challenge?.key !== ordeal.key
      ) {
        await interaction.reply({
          content:
            'Your Ordeal session has expired. Please start the challenge again.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (processingOrdealSubmissions.has(interaction.user.id)) {
        await interaction.reply({
          content: 'Your Ordeal submission is already being processed.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      // ----------------------------------
      // READ ORDEAL FORM ANSWERS
      // ----------------------------------

      const geneSeed = interaction.fields
        .getStringSelectValues('ordeal_gene_seed')[0];

      const armouryData = Number(
        interaction.fields
          .getStringSelectValues('ordeal_armoury_data')[0]
      );

      const completerIds = [
        ...new Set(workflow.completerIds || [])
      ];

      const selectedAdditionalParticipants = interaction.fields
        .getSelectedUsers('ordeal_additional_participants');
      const selectedAdditionalIds = [
        ...new Set(selectedAdditionalParticipants?.keys() || [])
      ];

      const completerIdSet = new Set(completerIds);
      const additionalParticipantIds = selectedAdditionalIds;

      if (completerIds.length === 0 || completerIds.length > 3) {
        await interaction.reply({
          content:
            'Select between 1 and 3 challenge completers.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (selectedAdditionalIds.length > 2) {
        await interaction.reply({
          content: 'Select no more than 2 additional squad participants.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (
        additionalParticipantIds.some(
          id => id === interaction.user.id || completerIdSet.has(id)
        )
      ) {
        await interaction.reply({
          content:
            'The submitter and selected challenge completers are already participants. Do not select them again as additional teammates.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const participants = [
        ...new Set([
          interaction.user.id,
          ...completerIds,
          ...additionalParticipantIds
        ])
      ];

      if (
        additionalParticipantIds.length > 2 ||
        participants.length > 3 ||
        participants.length === 0
      ) {
        await interaction.reply({
          content: 'An Ordeal squad must contain between 1 and 3 unique members.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (completerIds.some(id => !participants.includes(id))) {
        await interaction.reply({
          content:
            'Every challenge completer must also be included as a participant. Please start again.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      // ----------------------------------
      // VALIDATE CHALLENGE DETAILS
      // ----------------------------------

      const gameMode = ordeal.gameMode;
      const difficulty = ordeal.difficulty;
      const operation = gameMode === 'Operations'
        ? interaction.fields.getStringSelectValues('ordeal_operation')[0]
        : null;
      const operationName = operation || 'Not specified';

      if (!gameMode || !difficulty) {
        await interaction.reply({
          content: 'The challenge game mode or difficulty is missing. Please start again.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (
        gameMode === 'Operations' &&
        (!operation || !operations.includes(operation))
      ) {
        await interaction.reply({
          content: 'Select a valid operation for this Ordeal.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (!['Yes', 'No'].includes(geneSeed)) {
        await interaction.reply({
          content: 'The Gene Seed selection is invalid. Please start again.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (
        !Number.isInteger(armouryData) ||
        armouryData < 0 ||
        armouryData > 3
      ) {
        await interaction.reply({
          content: 'The Armoury Data selection is invalid. Please start again.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      // ----------------------------------
      // VALIDATE EVIDENCE FILES
      // ----------------------------------

      const uploadedFiles = interaction.fields
        .getUploadedFiles('ordeal_evidence');

      if (!uploadedFiles || uploadedFiles.size === 0) {
        await interaction.reply({
          content: 'Please upload at least one evidence file.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (uploadedFiles.size > 6) {
        await interaction.reply({
          content: 'You can upload a maximum of six evidence files.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      // ----------------------------------
      // CHECK PREVIOUS SUBMISSIONS
      // ----------------------------------

      const previousRows = db.prepare(`
    SELECT
      id,
      challenge_name,
      game_mode,
      difficulty,
      challenge_completers,
      participants,
      operation_name,
      review_message_id
      FROM ordeal_submissions
      WHERE challenge_key = ?
      AND status IN ('pending', 'approved')
    ORDER BY id DESC
  `).all(ordeal.key);

      let suspiciousMatch = null;

      for (const previous of previousRows) {

        let previousParticipants = [];
        let previousCompleters = [];

        try {
          previousParticipants = JSON.parse(
            previous.participants || '[]'
          );

          previousCompleters = JSON.parse(
            previous.challenge_completers || '[]'
          );
        } catch (error) {
          console.error(
            `Could not read previous Ordeal submission #${previous.id}:`,
            error
          );
          continue;
        }

        const matchedMembers = participants.filter(
          id => previousParticipants.includes(id)
        );

        if (matchedMembers.length === 0) {
          continue;
        }

        const sameSquad =
          participants.length === previousParticipants.length &&
          participants.every(
            id => previousParticipants.includes(id)
          );

        suspiciousMatch = {
          previousSubmissionId: previous.id,
          previousChallenge: previous.challenge_name || 'Unknown',
          previousGameMode: previous.game_mode || 'Unknown',
          previousDifficulty: previous.difficulty || 'Unknown',
          previousCompleters,
          previousOperation: previous.operation_name || 'Not specified',
          previousReviewMessageId: previous.review_message_id,
          matchedMembers,
          sameSquad
        };

        // Prefer an exact squad match over a partial overlap.
        if (sameSquad) {
          break;
        }
      }

      const suspiciousFlag = suspiciousMatch ? 1 : 0;

      const suspiciousDetails = suspiciousMatch
        ? {
          previousSubmissionId:
            suspiciousMatch.previousSubmissionId,
          previousChallenge:
            suspiciousMatch.previousChallenge,
          previousGameMode:
            suspiciousMatch.previousGameMode,
          previousDifficulty:
            suspiciousMatch.previousDifficulty,
          currentChallenge: ordeal.name,
          currentGameMode: gameMode,
          currentDifficulty: difficulty,
          matchedMembers: suspiciousMatch.matchedMembers,
          previousCompleters:
            suspiciousMatch.previousCompleters,
          newCompleters: completerIds,
          ...(suspiciousMatch.previousGameMode === 'Operations'
            ? {
              previousOperation:
                suspiciousMatch.previousOperation
            }
            : {}),
          ...(gameMode === 'Operations'
            ? { currentOperation: operationName }
            : {}),
          sameSquad: suspiciousMatch.sameSquad
        }
        : {};

      // ----------------------------------
      // ACKNOWLEDGE DISCORD
      // ----------------------------------

      let submissionId = null;
      let reviewChannel = null;
      let reviewMessage = null;
      let reviewMessageCreationAttempted = false;
      let submissionFinalized = false;

      try {

        processingOrdealSubmissions.add(interaction.user.id);

        await interaction.deferReply({
          flags: MessageFlags.Ephemeral
        });

        // ----------------------------------
        // CHECK REVIEW CHANNEL
        // ----------------------------------

        reviewChannel = await client.channels.fetch(
          process.env.ORDEAL_REVIEW_CHANNEL_ID
        );

        if (
          !reviewChannel ||
          !reviewChannel.isTextBased() ||
          !reviewChannel.isSendable()
        ) {
          throw new Error('Ordeal review channel is unavailable.');
        }

        // ----------------------------------
        // SAVE COMPLETE SUBMISSION
        // ----------------------------------

        const saveSubmission = db.transaction(() => {

          const result = db.prepare(`
        INSERT INTO ordeal_submissions (
          submitter_id,
          challenge_key,
          challenge_name,
          game_mode,
          difficulty,
          reward_role_id,
          operation_name,
          challenge_completers,
          participants,
          gene_seed,
          armoury_data,
          base_points,
          bonus_points,
          total_points,
          suspicious_flag,
          suspicious_details,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `).run(
            interaction.user.id,
            ordeal.key,
            ordeal.name,
            gameMode,
            difficulty,
            ordeal.rewardRoleId,
            operationName,
            JSON.stringify(completerIds),
            JSON.stringify(participants),
            geneSeed,
            armouryData,
            0,
            0,
            0,
            suspiciousFlag,
            JSON.stringify(suspiciousDetails)
          );

          return Number(result.lastInsertRowid);
        });

        submissionId = saveSubmission();

        // ----------------------------------
        // DOWNLOAD EVIDENCE FILES
        // ----------------------------------



        const permanentFiles = [];

        for (const file of uploadedFiles.values()) {

          const response = await fetch(file.url);

          if (!response.ok) {
            throw new Error(`Could not download ${file.name}`);
          }

          const buffer = Buffer.from(
            await response.arrayBuffer()
          );


          permanentFiles.push(
            new AttachmentBuilder(buffer, {
              name: file.name
            })
          );
        }


        // ----------------------------------
        // PREPARE REVIEW INFORMATION
        // ----------------------------------

        const completerMentions = completerIds
          .map(id => `<@${id}>`)
          .join('\n');

        const additionalMentions =
          additionalParticipantIds.length > 0
            ? additionalParticipantIds
              .map(id => `<@${id}>`)
              .join('\n')
            : 'None';


        // ----------------------------------
        // CREATE REVIEW EMBED
        // ----------------------------------

        const reviewEmbed = new EmbedBuilder()
          .setColor(suspiciousFlag ? 0xFFA500 : 0xED4245)
          .setTitle(`Ordeal Completion #${submissionId}`)
          .setDescription(
            suspiciousFlag
              ? '⚠️ This submission has overlapping participants with a previous Ordeal submission. Manual review is recommended.'
              : 'A new Ordeal completion has been submitted for review.'
          )
          .addFields(
            {
              name: 'Challenge',
              value: ordeal.name,
              inline: true
            },
            {
              name: 'Game Mode',
              value: gameMode,
              inline: true
            },
            {
              name: 'Difficulty',
              value: difficulty,
              inline: true
            },
            ...(gameMode === 'Operations'
              ? [{
                name: 'Operation',
                value: operationName,
                inline: true
              }]
              : []),
            {
              name: 'Submitted By',
              value: `<@${interaction.user.id}>`,
              inline: true
            },
            {
              name: 'Challenge Completers',
              value: completerMentions,
              inline: false
            },
            {
              name: 'Additional Participants',
              value: additionalMentions,
              inline: false
            },
            {
              name: 'Gene Seed',
              value: geneSeed,
              inline: true
            },
            {
              name: 'Armoury Data',
              value: String(armouryData),
              inline: true
            },
            {
              name: 'Reward Role',
              value: `<@&${ordeal.rewardRoleId}>`,
              inline: false
            },
            {
              name: 'AAR Points',
              value: '**0 points** — Ordeals do not contribute to Saga Points or the leaderboard.',
              inline: false
            },
            {
              name: 'Evidence Files',
              value: String(permanentFiles.length),
              inline: true
            },
            {
              name: 'Status',
              value: 'PENDING APPROVAL',
              inline: true
            }
          )
          .setFooter({
            text: 'Space Marine 2 Ordeals | React ✅ to approve or ❌ to reject'
          })
          .setTimestamp();


    // ----------------------------------
    // SEND TO ORDEAL REVIEW CHANNEL
    // ----------------------------------

reviewMessageCreationAttempted = true;
reviewMessage = await reviewChannel.send({
  content: `👤 <@${interaction.user.id}>`,
  embeds: [reviewEmbed],
  files: permanentFiles,
  allowedMentions: {
    parse: []
  }
});

db.prepare(`
  UPDATE ordeal_submissions
  SET review_message_id = ?
  WHERE id = ?
    AND status = 'pending'
`).run(
  reviewMessage.id,
  submissionId
);


// ----------------------------------
// SAVE EVIDENCE AND REVIEW MESSAGE
// ----------------------------------

const evidence = reviewMessage.attachments.map(file => ({
  id: file.id,
  name: file.name,
  url: file.url,
  size: file.size,
  contentType: file.contentType,
  type: 'original'
}));

db.prepare(`
  UPDATE ordeal_submissions
  SET
    evidence = ?,
    evidence_thread_id = NULL
  WHERE id = ?
    AND status = 'pending'
`).run(
  JSON.stringify(evidence),
  submissionId
);


        // ----------------------------------
        // ADD REVIEW REACTIONS
        // ----------------------------------

        try {
          await reviewMessage.react('✅');
          await reviewMessage.react('❌');

        } catch (reactionError) {

          console.error(
            `[Ordeal] Failed to add review reactions for submission #${submissionId}:`,
            reactionError
          );

          await interaction.editReply({
            content:
              `Your Ordeal submission #${submissionId} was saved, but the review reactions could not be added.\n\n` +
              'The submission remains pending. Please contact an Administrator, NCO, or AAR Moderator.'
          });
          pendingOrdealWorkflows.delete(interaction.user.id);
          return;
        }

        submissionFinalized = true;
        pendingOrdealWorkflows.delete(interaction.user.id);


        // ----------------------------------
        // SEND SUSPICIOUS SUBMISSION ALERT
        // ----------------------------------

        if (suspiciousFlag === 1) {

          try {

            // Check whether an alert was already recorded.
            const existingAlert = db.prepare(`
          SELECT nco_alert_message_id
          FROM ordeal_submissions
          WHERE id = ?
        `).get(submissionId);

            if (!existingAlert?.nco_alert_message_id) {

              const ncoChannel = await client.channels.fetch(
                process.env.NCO_REVIEW_CHANNEL_ID
              );

              if (
                !ncoChannel ||
                !ncoChannel.isTextBased() ||
                !ncoChannel.isSendable()
              ) {
                throw new Error('NCO review channel is unavailable.');
              }

              const adminRoleId = process.env.ADMIN_ROLE_ID;
              const ncoRoleId = process.env.NCO_ROLE_ID;
              const moderatorRoleId = process.env.MODERATOR_ROLE_ID;

              const roleMentions = [
                adminRoleId
                  ? `<@&${adminRoleId}>`
                  : '',
                ncoRoleId
                  ? `<@&${ncoRoleId}>`
                  : '',
                moderatorRoleId
                  ? `<@&${moderatorRoleId}>`
                  : ''
              ].filter(Boolean).join(' ');

              const matchedMentions = suspiciousMatch.matchedMembers
                .map(id => `<@${id}>`)
                .join(', ');

              const previousCompleterMentions =
                suspiciousMatch.previousCompleters.length > 0
                  ? suspiciousMatch.previousCompleters
                    .map(id => `<@${id}>`)
                    .join(', ')
                  : 'Unknown';

              const newCompleterMentions = completerIds
                .map(id => `<@${id}>`)
                .join(', ');

              const previousReportLink =
                suspiciousMatch.previousReviewMessageId
                  ? `https://discord.com/channels/${interaction.guildId}/${process.env.ORDEAL_REVIEW_CHANNEL_ID}/${suspiciousMatch.previousReviewMessageId}`
                  : 'Original review message link unavailable';

              const alertEmbed = new EmbedBuilder()
                .setColor(0xFFA500)
                .setTitle(
                  `Suspicious Ordeal Submission #${submissionId}`
                )
                .setDescription(
                  suspiciousMatch.sameSquad
                    ? '**STRONG WARNING:** The exact same squad has submitted this challenge before.'
                    : 'Participant overlap detected with a previous submission.'
                )
                .addFields(
                  {
                    name: 'Previous Challenge',
                    value: suspiciousMatch.previousChallenge,
                    inline: true
                  },
                  {
                    name: 'Previous Game Mode',
                    value: suspiciousMatch.previousGameMode,
                    inline: true
                  },
                  {
                    name: 'Previous Difficulty',
                    value: suspiciousMatch.previousDifficulty,
                    inline: true
                  },
                  ...(suspiciousMatch.previousGameMode === 'Operations'
                    ? [{
                      name: 'Previous Operation',
                      value: suspiciousMatch.previousOperation,
                      inline: true
                    }]
                    : []),
                  {
                    name: 'Current Challenge',
                    value: ordeal.name,
                    inline: true
                  },
                  {
                    name: 'Current Game Mode',
                    value: gameMode,
                    inline: true
                  },
                  {
                    name: 'Current Difficulty',
                    value: difficulty,
                    inline: true
                  },
                  {
                    name: 'Matched Members',
                    value: matchedMentions,
                    inline: false
                  },
                  {
                    name: 'Previous Challenge Completers',
                    value: previousCompleterMentions,
                    inline: false
                  },
                  {
                    name: 'New Challenge Completers',
                    value: newCompleterMentions,
                    inline: false
                  },
                  ...(gameMode === 'Operations'
                    ? [{
                      name: 'Current Operation',
                      value: operationName,
                      inline: true
                    }]
                    : []),
                  {
                    name: 'Original Report',
                    value: previousReportLink,
                    inline: false
                  },
                  {
                    name: 'New Review Report',
                    value: reviewMessage.url,
                    inline: false
                  }
                )
                .setTimestamp();

              const alertMessage = await ncoChannel.send({
                content: roleMentions,
                embeds: [alertEmbed],
                allowedMentions: {
                  roles: [
                    adminRoleId,
                    ncoRoleId,
                    ...(moderatorRoleId ? [moderatorRoleId] : [])
                  ].filter(Boolean),
                  users: []
                }
              });

              db.prepare(`
            UPDATE ordeal_submissions
            SET nco_alert_message_id = ?
            WHERE id = ?
              AND nco_alert_message_id IS NULL
          `).run(
                alertMessage.id,
                submissionId
              );
            }

          } catch (alertError) {
            // The Ordeal submission remains valid even if the NCO alert fails.
            console.error(
              'NCO suspicious submission alert error:',
              alertError
            );
          }
        }

        // ----------------------------------
        // CLEAR COMPLETED WORKFLOW
        // ----------------------------------

        // ----------------------------------
        // CONFIRM SUBMISSION
        // ----------------------------------

        await interaction.editReply({
          content:
            `Your **${ordeal.name}** completion has been submitted successfully!\n\n` +
            `**AAR Points:** 0\n` +
            `**Participants:** ${participants.length}\n` +
            `**Challenge completers:** ${completerIds.length}\n\n` +
            'Your challenge reward role will be processed after Admin, NCO, or High Command review.'
        });

        console.log(
          `Ordeal submission #${submissionId} received from ${interaction.user.username}.`
        );

      } catch (error) {

        console.error('Ordeal submission error:', error);

        if (!submissionFinalized) {
          if (
            !reviewMessage &&
            reviewMessageCreationAttempted &&
            reviewChannel &&
            submissionId !== null
          ) {
            try {
              const recentMessages = await reviewChannel.messages.fetch({
                limit: 100
              });
              reviewMessage = recentMessages.find(message =>
                message.author?.id === client.user.id &&
                message.embeds.some(embed =>
                  embed.title === `Ordeal Completion #${submissionId}`
                )
              ) || null;
            } catch (cleanupError) {
              console.error(
                `Could not locate a partially created review message for Ordeal #${submissionId}:`,
                cleanupError
              );
            }
          }


          if (reviewMessage) {
            try {
              await reviewMessage.delete(
                'Incomplete Ordeal submission cleanup'
              );
            } catch (cleanupError) {
              console.error(
                `Could not delete incomplete review message for Ordeal #${submissionId}:`,
                cleanupError
              );
            }
          }

          if (submissionId !== null) {
            try {
              db.prepare(`
            DELETE FROM ordeal_submissions
            WHERE id = ?
              AND status = 'pending'
          `).run(submissionId);
            } catch (cleanupError) {
              console.error(
                `Could not remove incomplete Ordeal database row #${submissionId}:`,
                cleanupError
              );
            }
          }

          pendingOrdealWorkflows.delete(interaction.user.id);
        }


        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({
            content: submissionFinalized
              ? 'Your Ordeal submission was archived, but the confirmation could not be completed. Please check the review channel or contact an AAR Moderator.'
              : 'Your Ordeal submission could not be completed. Any incomplete review objects were removed where possible. Please contact an AAR Moderator if this problem continues.'
          }).catch(console.error);
        }

      } finally {
        processingOrdealSubmissions.delete(interaction.user.id);
      }

      return;
    }

    // ======================================
    // OPERATIONS FORM SUBMISSION
    // ======================================

    if (
      interaction.isModalSubmit() &&
      interaction.customId === 'aar_operations_submit'
    ) {

      // ------------------------------------
      // READ DIFFICULTY
      // ------------------------------------

      const difficulty =
        pendingDifficultySelections.get(interaction.user.id);

      if (
        !difficulty ||
        !difficulty.difficulty ||
        !Object.prototype.hasOwnProperty.call(
          difficultyPoints,
          difficulty.difficulty
        ) ||
        difficulty.expiresAt <= Date.now()
      ) {
        deleteOperationsWorkflow(interaction.user.id, difficulty);
        await interaction.reply({
          content:
            'Your Operations report session expired or its difficulty could not be found. ' +
            'Please start the Operations report again.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      const selectedSquad = interaction.fields
        .getSelectedUsers('aar_squad');
      const selectedUserIds = [
        ...(selectedSquad?.keys() || [])
      ];

      if (
        selectedUserIds.length > 2 ||
        selectedUserIds.some(id => typeof id !== 'string')
      ) {
        deleteOperationsWorkflow(interaction.user.id, difficulty);
        await interaction.reply({
          content:
            'Your Operations squad selection is invalid or expired. Please start the report again.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const selectedTeammateIds = [
        ...new Set(selectedUserIds)
      ].filter(userId => userId !== interaction.user.id);
      const selectedDifficulty = difficulty.difficulty;

      // ------------------------------------
      // READ FORM ANSWERS
      // ------------------------------------

      const operation = interaction.fields
        .getStringSelectValues('aar_operation')[0];

      const geneSeed = interaction.fields
        .getStringSelectValues('aar_gene_seed')[0];

      const armouryData = Number(
        interaction.fields.getStringSelectValues('aar_armoury_data')[0]
      );

      const uploadedFiles = interaction.fields
        .getUploadedFiles('aar_evidence');

      // ------------------------------------
      // CLEAR TEMPORARY DIFFICULTY
      // ------------------------------------

      deleteOperationsWorkflow(interaction.user.id, difficulty);

      // ------------------------------------
      // VALIDATE EVIDENCE
      // ------------------------------------

      if (!uploadedFiles || uploadedFiles.size === 0) {
        await interaction.reply({
          content: 'Please upload at least one evidence file.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      if (uploadedFiles.size > 6) {
        await interaction.reply({
          content: 'You can upload a maximum of six evidence files.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      // ------------------------------------
      // BUILD PARTICIPANT LIST
      // ------------------------------------

      let participants;
      try {
        participants = buildOperationsParticipants(
          interaction.user.id,
          selectedTeammateIds
        );
      } catch {
        await interaction.reply({
          content: 'Your Operations squad selection is invalid. Please start the report again.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (participants.size > 3) {
        await interaction.reply({
          content:
            'A squad can contain a maximum of 3 people, including you.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      // ------------------------------------
      // CALCULATE PROVISIONAL POINTS
      // ------------------------------------

      const basePoints = difficultyPoints[selectedDifficulty];

      const geneSeedBonus = geneSeed === 'Yes' ? 1 : 0;

      const armouryBonus = armouryData * 0.5;

      const squadBonus = participants.size > 1 ? 1 : 0;

      const bonusPoints =
        geneSeedBonus +
        armouryBonus +
        squadBonus;

      const totalPoints = basePoints + bonusPoints;

      // ------------------------------------
      // SAVE REPORT DATA
      // ------------------------------------

      const reportData = {
        operation,
        difficulty: selectedDifficulty,
        geneSeed,
        armouryData
      };

      const saveReport = db.transaction(() => {

        const reportResult = db.prepare(`
          INSERT INTO reports (
            submitter_id,
            game_mode,
            report_data,
            base_points,
            bonus_points,
            total_points
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          interaction.user.id,
          'Operations',
          JSON.stringify(reportData),
          basePoints,
          bonusPoints,
          totalPoints
        );

        const reportId = Number(reportResult.lastInsertRowid);

        const insertParticipant = db.prepare(`
          INSERT INTO report_participants (
            report_id,
            user_id
          )
          VALUES (?, ?)
        `);

        for (const userId of participants) {
          insertParticipant.run(reportId, userId);
        }

        return reportId;
      });

      const reportId = saveReport();

      // Acknowledge Discord before processing uploads.
      await interaction.deferReply({
        flags: MessageFlags.Ephemeral
      });

      // ====================================
      // ARCHIVE REPORT AND EVIDENCE
      // ====================================

      let reviewMessage = null;

      try {

        const reviewChannel = await client.channels.fetch(
          process.env.REVIEW_CHANNEL_ID
        );

        if (
          !reviewChannel ||
          !reviewChannel.isTextBased() ||
          !reviewChannel.isSendable()
        ) {
          throw new Error('AAR review channel is unavailable.');
        }


        // ----------------------------------
        // DOWNLOAD EVIDENCE FILES
        // ----------------------------------


        const permanentFiles = [];

        for (const file of uploadedFiles.values()) {

          const response = await fetch(file.url);

          if (!response.ok) {
            throw new Error(`Could not download ${file.name}`);
          }

          const buffer = Buffer.from(
            await response.arrayBuffer()
          );

          permanentFiles.push(
            new AttachmentBuilder(buffer, {
              name: file.name
            })
          );
        }



        // ----------------------------------
        // GET SQUAD DISCORD TAGS
        // ----------------------------------

        const squadNames = [...participants].map(userId => {
          return `<@${userId}>`;
        });

        // ----------------------------------
        // CREATE REVIEW EMBED
        // ----------------------------------

        const reviewEmbed = new EmbedBuilder()
          .setTitle(`Operations Report #${reportId}`)
          .setDescription(
            'New After Action Report submitted for review.'
          )
          .addFields(
            {
              name: 'Operation',
              value: operation,
              inline: false
            },
            {
              name: 'Difficulty',
              value: selectedDifficulty,
              inline: false
            },
            {
              name: 'Gene Seed',
              value: geneSeed,
              inline: false
            },
            {
              name: 'Armoury Data',
              value: String(armouryData),
              inline: false
            },
            {
              name: 'Pack Members',
              value: squadNames.join('\n'),
              inline: false
            },
            {
              name: 'Squad Size',
              value: `${participants.size}/3`,
              inline: false
            },
            {
              name: 'Provisional Points Per Participant',
              value: String(totalPoints),
              inline: false
            },
            {
              name: 'Status',
              value: 'PENDING APPROVAL',
              inline: false
            }
          )
          .setFooter({
            text: 'Space Marine 2 AAR System | React ✅ to approve or ❌ to reject'
          })
          .setTimestamp();


        // ----------------------------------
        // SEND REPORT WITH ORIGINAL EVIDENCE
        // ----------------------------------

        reviewMessage = await reviewChannel.send({
          content: `👤 <@${interaction.user.id}>`,
          embeds: [reviewEmbed],
          files: permanentFiles,
          allowedMentions: {
            parse: []
          }
        });

        // ----------------------------------
        // CREATE THREAD FOR ORIGINAL EVIDENCE
        // ----------------------------------

        let originalEvidenceLinks = [];
        let evidenceThreadId = null;

        if (permanentFiles.length > 0) {

          const evidenceThread = await reviewMessage.startThread({
            name: `Original Evidence - Report #${reportId}`,
            autoArchiveDuration: 1440,
            reason: 'Store original AAR evidence files'
          });
          evidenceThreadId = evidenceThread.id;
          await db.prepare(`
            UPDATE reports
            SET evidence_thread_id = ?
            WHERE id = ?
             AND status = 'pending'
         `).run(
            evidenceThreadId,
            reportId
          );
          for (const file of permanentFiles) {

            const evidenceMessage = await evidenceThread.send({
              files: [file]
            });

            const uploadedFile = evidenceMessage.attachments.first();

            if (uploadedFile) {
              originalEvidenceLinks.push({
                name: uploadedFile.name,
                url: evidenceMessage.url
              });
            }
          }
        }



        // ----------------------------------
        // ADD APPROVAL REACTIONS
        // ----------------------------------

        await reviewMessage.react('✅');
        await reviewMessage.react('❌');


        // ----------------------------------
        // SAVE ORIGINAL EVIDENCE METADATA
        // ----------------------------------

        const evidence = reviewMessage.attachments.map(file => ({
          id: file.id,
          name: file.name,
          url: file.url,
          size: file.size,
          contentType: file.contentType,
          type: 'original'
        }));

        db.prepare(`
          UPDATE reports
          SET evidence = ?,
              evidence_thread_id = NULL
          WHERE id = ?
            AND status = 'pending'
        `).run(
          JSON.stringify(evidence),
          reportId
        );

        // ----------------------------------
        // SIMPLE SUBMISSION CONFIRMATION
        // ----------------------------------

        await interaction.editReply({
          content: 'Operation report submitted successfully.'
        });

        console.log(
          `Operations report #${reportId} saved with ${evidence.length} evidence files.`
        );

      } catch (uploadError) {

        console.error('Evidence archive error:', uploadError);

        await interaction.editReply({
          content:
            `Your Operations report #${reportId} was saved, but the review message, evidence, or reactions could not be completed.\n\n` +
            'Please contact an AAR Moderator. The report remains pending and no points have been awarded.'
        });
      }

      return;
    }

    // ======================================
    // STRATAGEMS FORM SUBMISSION
    // ======================================

    if (
      interaction.isModalSubmit() &&
      interaction.customId === 'aar_stratagems_submit'
    ) {

      // ------------------------------------
      // READ AND CLEAR DIFFICULTY
      // ------------------------------------

      const difficulty =
        pendingStratagemDifficultySelections.get(interaction.user.id);

      pendingStratagemDifficultySelections.delete(
        interaction.user.id
      );

      if (
        !difficulty ||
        !Object.prototype.hasOwnProperty.call(
          stratagemDifficultyPoints,
          difficulty
        )
      ) {
        await interaction.reply({
          content:
            'Your Stratagems difficulty selection could not be found. ' +
            'Please start the Stratagems report again.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      // ------------------------------------
      // READ FORM ANSWERS
      // ------------------------------------

      const geneSeed = interaction.fields
        .getStringSelectValues('aar_stratagems_gene_seed')[0];

      const armouryData = Number(
        interaction.fields
          .getStringSelectValues('aar_stratagems_armoury_data')[0]
      );

      const selectedSquad = interaction.fields
        .getSelectedUsers('aar_stratagems_squad');

      const selectedTeammateIds = [
        ...(selectedSquad?.keys() || [])
      ]
        .filter(userId => userId !== interaction.user.id)
        .slice(0, 2);

      const uploadedFiles = interaction.fields
        .getUploadedFiles('aar_stratagems_evidence');

      // ------------------------------------
      // VALIDATE EVIDENCE
      // ------------------------------------

      if (!uploadedFiles || uploadedFiles.size === 0) {
        await interaction.reply({
          content: 'Please upload at least one evidence file.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      if (uploadedFiles.size > 6) {
        await interaction.reply({
          content: 'You can upload a maximum of six evidence files.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      // ------------------------------------
      // BUILD PARTICIPANT LIST
      // ------------------------------------

      const participants = new Set([
        interaction.user.id,
        ...selectedTeammateIds
      ]);

      if (participants.size > 3) {
        await interaction.reply({
          content:
            'A squad can contain a maximum of 3 people, including you.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      // ------------------------------------
      // CALCULATE PROVISIONAL POINTS
      // ------------------------------------

      const basePoints = stratagemDifficultyPoints[difficulty];
      const geneSeedBonus = geneSeed === 'Yes' ? 1 : 0;
      const armouryBonus = armouryData * 0.5;
      const squadBonus = participants.size > 1 ? 1 : 0;
      const bonusPoints =
        geneSeedBonus + armouryBonus + squadBonus;
      const totalPoints = basePoints + bonusPoints;

      // ------------------------------------
      // SAVE REPORT DATA
      // ------------------------------------

      const reportData = {
        difficulty,
        geneSeed,
        armouryData
      };

      const saveReport = db.transaction(() => {

        const reportResult = db.prepare(`
          INSERT INTO reports (
            submitter_id,
            game_mode,
            report_data,
            base_points,
            bonus_points,
            total_points
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          interaction.user.id,
          'Stratagems',
          JSON.stringify(reportData),
          basePoints,
          bonusPoints,
          totalPoints
        );

        const reportId = Number(reportResult.lastInsertRowid);

        const insertParticipant = db.prepare(`
          INSERT INTO report_participants (
            report_id,
            user_id
          )
          VALUES (?, ?)
        `);

        for (const userId of participants) {
          insertParticipant.run(reportId, userId);
        }

        return reportId;
      });

      const reportId = saveReport();

      // Acknowledge Discord before processing uploads.
      await interaction.deferReply({
        flags: MessageFlags.Ephemeral
      });

      // ====================================
      // ARCHIVE REPORT AND EVIDENCE
      // ====================================

      try {

        const reviewChannel = await client.channels.fetch(
          process.env.REVIEW_CHANNEL_ID
        );

        if (
          !reviewChannel ||
          !reviewChannel.isTextBased() ||
          !reviewChannel.isSendable()
        ) {
          throw new Error('AAR review channel is unavailable.');
        }

        // ----------------------------------
        // DOWNLOAD EVIDENCE FILES
        // ----------------------------------

        const permanentFiles = [];

        for (const file of uploadedFiles.values()) {

          const response = await fetch(file.url);

          if (!response.ok) {
            throw new Error(`Could not download ${file.name}`);
          }

          const buffer = Buffer.from(
            await response.arrayBuffer()
          );

          permanentFiles.push(
            new AttachmentBuilder(buffer, {
              name: file.name
            })
          );
        }

        // ----------------------------------
        // CREATE EVIDENCE COLLAGE
        // ----------------------------------

        const squadNames = [...participants].map(userId =>
          `<@${userId}>`
        );

        // ----------------------------------
        // CREATE REVIEW EMBED
        // ----------------------------------

        const reviewEmbed = new EmbedBuilder()
          .setTitle(`Stratagems Report #${reportId}`)
          .setDescription(
            'New After Action Report submitted for review.'
          )
          .addFields(
            {
              name: 'Difficulty',
              value: difficulty,
              inline: false
            },
            {
              name: 'Gene Seed',
              value: geneSeed,
              inline: false
            },
            {
              name: 'Armoury Data',
              value: String(armouryData),
              inline: false
            },
            {
              name: 'Pack Members',
              value: squadNames.join('\n'),
              inline: false
            },
            {
              name: 'Squad Size',
              value: `${participants.size}/3`,
              inline: false
            },
            {
              name: 'Provisional Points Per Participant',
              value: String(totalPoints),
              inline: false
            },
            {
              name: 'Status',
              value: 'PENDING APPROVAL',
              inline: false
            }
          )
          .setFooter({
            text: 'Space Marine 2 AAR System | React ✅ to approve or ❌ to reject'
          })
          .setTimestamp();


        const reviewMessage = await reviewChannel.send({
          content: `👤 <@${interaction.user.id}>`,
          embeds: [reviewEmbed],
          files: permanentFiles,
          allowedMentions: {
            parse: []
          }
        });



        // ----------------------------------
        // SAVE ORIGINAL EVIDENCE METADATA
        // ----------------------------------

        const evidence = reviewMessage.attachments.map(file => ({
          id: file.id,
          name: file.name,
          url: file.url,
          size: file.size,
          contentType: file.contentType,
          type: 'original'
        }));

        db.prepare(`
          UPDATE reports
          SET
            evidence = ?,
            evidence_thread_id = NULL
          WHERE id = ?
            AND status = 'pending'
        `).run(
          JSON.stringify(evidence),
          reportId
        );


        await reviewMessage.react('✅');
        await reviewMessage.react('❌');

        await interaction.editReply({
          content: 'Stratagems report submitted successfully.'
        });

        console.log(
          `Stratagems report #${reportId} saved with ${evidence.length} evidence files.`
        );

      } catch (uploadError) {

        console.error('Stratagems evidence archive error:', uploadError);

        await interaction.editReply({
          content:
            `Your Stratagems report #${reportId} was saved, but the review message, evidence, or reactions could not be completed.\n\n` +
            'Please contact an AAR Moderator. The report remains pending and no points have been awarded.'
        });
      }

      return;
    }

    // ======================================
    // PVP FORM SUBMISSION
    // ======================================

    if (
      interaction.isModalSubmit() &&
      interaction.customId === 'aar_pvp_submit'
    ) {

      const pvpGameMode = interaction.fields
        .getStringSelectValues('aar_pvp_game_mode')[0];

      const didWin = interaction.fields
        .getStringSelectValues('aar_pvp_result')[0];

      if (!pvpGameModes.includes(pvpGameMode)) {
        await interaction.reply({
          content: 'Please select a valid PVP game mode.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      if (!Object.prototype.hasOwnProperty.call(pvpWinAnswers, didWin)) {
        await interaction.reply({
          content: 'Please select Yes or No for whether you won.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      const result = pvpWinAnswers[didWin];

      const selectedSquad = interaction.fields
        .getSelectedUsers('aar_pvp_squad');

      const selectedTeammateIds = [
        ...new Set(
          [...(selectedSquad?.keys() || [])]
            .filter(userId => userId !== interaction.user.id)
        )
      ];

      if (selectedTeammateIds.length > 2) {
        await interaction.reply({
          content: 'You can select a maximum of two additional teammates.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      const participants = new Set([
        interaction.user.id,
        ...selectedTeammateIds
      ]);

      if (participants.size > 3) {
        await interaction.reply({
          content:
            'A squad can contain a maximum of 3 people, including you.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      const uploadedFiles = interaction.fields
        .getUploadedFiles('aar_pvp_evidence');

      if (!uploadedFiles || uploadedFiles.size === 0) {
        await interaction.reply({
          content: 'Please upload at least one evidence file.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      if (uploadedFiles.size > 6) {
        await interaction.reply({
          content: 'You can upload a maximum of six evidence files.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      const basePoints = pvpResultPoints[result];
      const squadBonus = participants.size > 1 ? 1 : 0;
      const bonusPoints = squadBonus;
      const totalPoints = basePoints + bonusPoints;
      const reportData = {
        pvpGameMode,
        result
      };

      const saveReport = db.transaction(() => {

        const reportResult = db.prepare(`
          INSERT INTO reports (
            submitter_id,
            game_mode,
            report_data,
            base_points,
            bonus_points,
            total_points
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          interaction.user.id,
          'PVP',
          JSON.stringify(reportData),
          basePoints,
          bonusPoints,
          totalPoints
        );

        const reportId = Number(reportResult.lastInsertRowid);

        const insertParticipant = db.prepare(`
          INSERT INTO report_participants (
            report_id,
            user_id
          )
          VALUES (?, ?)
        `);

        for (const userId of participants) {
          insertParticipant.run(reportId, userId);
        }

        return reportId;
      });

      const reportId = saveReport();

      await interaction.deferReply({
        flags: MessageFlags.Ephemeral
      });

      try {

        const reviewChannel = await client.channels.fetch(
          process.env.REVIEW_CHANNEL_ID
        );

        if (
          !reviewChannel ||
          !reviewChannel.isTextBased() ||
          !reviewChannel.isSendable()
        ) {
          throw new Error('AAR review channel is unavailable.');
        }


        const permanentFiles = [];

        for (const file of uploadedFiles.values()) {

          const response = await fetch(file.url);

          if (!response.ok) {
            throw new Error(`Could not download ${file.name}`);
          }

          const buffer = Buffer.from(
            await response.arrayBuffer()
          );

          permanentFiles.push(
            new AttachmentBuilder(buffer, {
              name: file.name
            })
          );
        }


        const squadNames = [...participants].map(userId =>
          `<@${userId}>`
        );

        const reviewEmbed = new EmbedBuilder()
          .setTitle(`PVP Report #${reportId}`)
          .setDescription(
            'New After Action Report submitted for review.'
          )
          .addFields(
            {
              name: 'PVP Game Mode',
              value: pvpGameMode,
              inline: false
            },
            {
              name: 'Result',
              value: result,
              inline: false
            },
            {
              name: 'Pack Members',
              value: squadNames.join('\n'),
              inline: false
            },
            {
              name: 'Squad Size',
              value: `${participants.size}/3`,
              inline: false
            },
            {
              name: 'Provisional Points Per Participant',
              value: String(totalPoints),
              inline: false
            },
            {
              name: 'Status',
              value: 'PENDING APPROVAL',
              inline: false
            }
          )
          .setFooter({
            text: 'Space Marine 2 AAR System | React ✅ to approve or ❌ to reject'
          })
          .setTimestamp();


        const reviewMessage = await reviewChannel.send({
          content: `👤 <@${interaction.user.id}>`,
          embeds: [reviewEmbed],
          files: permanentFiles,
          allowedMentions: {
            parse: []
          }
        });


        await reviewMessage.react('✅');
        await reviewMessage.react('❌');


        // ----------------------------------
        // SAVE ORIGINAL EVIDENCE METADATA
        // ----------------------------------

        const evidence = reviewMessage.attachments.map(file => ({
          id: file.id,
          name: file.name,
          url: file.url,
          size: file.size,
          contentType: file.contentType,
          type: 'original'
        }));

        db.prepare(`
          UPDATE reports
          SET
            evidence = ?,
            evidence_thread_id = NULL
          WHERE id = ?
            AND status = 'pending'
        `).run(
          JSON.stringify(evidence),
          reportId
        );


        await interaction.editReply({
          content: 'PVP report submitted successfully.'
        });

        console.log(
          `PVP report #${reportId} saved with ${evidence.length} evidence files.`
        );

      } catch (uploadError) {

        console.error('PVP evidence archive error:', uploadError);

        await interaction.editReply({
          content:
            `Your PVP report #${reportId} was saved, but the review message, evidence, or reactions could not be completed.\n\n` +
            'Please contact an AAR Moderator. The report remains pending and no points have been awarded.'
        });
      }

      return;
    }

    // ======================================
    // SIEGE FORM SUBMISSION
    // ======================================

    if (
      interaction.isModalSubmit() &&
      interaction.customId === 'aar_siege_submit'
    ) {

      // ------------------------------------
      // READ AND CLEAR DIFFICULTY
      // ------------------------------------

      const difficulty =
        pendingSiegeDifficultySelections.get(interaction.user.id);

      pendingSiegeDifficultySelections.delete(
        interaction.user.id
      );

      if (
        !difficulty ||
        !Object.prototype.hasOwnProperty.call(
          siegeDifficultyPoints,
          difficulty
        )
      ) {
        await interaction.reply({
          content:
            'Your Siege difficulty selection could not be found. ' +
            'Please start the Siege report again.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      // ------------------------------------
      // VALIDATE WAVE COUNT
      // ------------------------------------

      const waveInput = interaction.fields
        .getTextInputValue('aar_siege_waves')
        .trim();

      if (!/^\d+$/.test(waveInput)) {
        await interaction.reply({
          content: 'Waves completed must be a positive whole number.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      const waves = Number(waveInput);

      if (!Number.isSafeInteger(waves) || waves <= 0) {
        await interaction.reply({
          content: 'Waves completed must be a positive whole number.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      // ------------------------------------
      // READ SQUAD AND EVIDENCE
      // ------------------------------------

      const selectedSquad = interaction.fields
        .getSelectedUsers('aar_siege_squad');

      const selectedTeammateIds = [
        ...(selectedSquad?.keys() || [])
      ]
        .filter(userId => userId !== interaction.user.id)
        .slice(0, 2);

      const uploadedFiles = interaction.fields
        .getUploadedFiles('aar_siege_evidence');

      if (!uploadedFiles || uploadedFiles.size === 0) {
        await interaction.reply({
          content: 'Please upload at least one evidence file.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      if (uploadedFiles.size > 6) {
        await interaction.reply({
          content: 'You can upload a maximum of six evidence files.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      // ------------------------------------
      // BUILD PARTICIPANTS AND SCORE
      // ------------------------------------

      const participants = new Set([
        interaction.user.id,
        ...selectedTeammateIds
      ]);

      if (participants.size > 3) {
        await interaction.reply({
          content:
            'A squad can contain a maximum of 3 people, including you.',
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      const countedWaves = Math.floor(waves / 5) * 5;
      const completedWaveGroups = Math.floor(waves / 5);
      const basePoints =
        completedWaveGroups * siegeDifficultyPoints[difficulty];
      const squadBonus = participants.size > 1 ? 1 : 0;
      const bonusPoints = squadBonus;
      const totalPoints = basePoints + bonusPoints;

      // ------------------------------------
      // SAVE REPORT AND PARTICIPANTS
      // ------------------------------------

      const reportData = {
        difficulty,
        waves
      };

      const saveReport = db.transaction(() => {

        const reportResult = db.prepare(`
          INSERT INTO reports (
            submitter_id,
            game_mode,
            report_data,
            base_points,
            bonus_points,
            total_points
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          interaction.user.id,
          'Siege',
          JSON.stringify(reportData),
          basePoints,
          bonusPoints,
          totalPoints
        );

        const reportId = Number(reportResult.lastInsertRowid);

        const insertParticipant = db.prepare(`
          INSERT INTO report_participants (
            report_id,
            user_id
          )
          VALUES (?, ?)
        `);

        for (const userId of participants) {
          insertParticipant.run(reportId, userId);
        }

        return reportId;
      });

      const reportId = saveReport();

      // Acknowledge Discord before processing uploads.
      await interaction.deferReply({
        flags: MessageFlags.Ephemeral
      });

      // ====================================
      // ARCHIVE REPORT AND EVIDENCE
      // ====================================

      try {

        const reviewChannel = await client.channels.fetch(
          process.env.REVIEW_CHANNEL_ID
        );

        if (
          !reviewChannel ||
          !reviewChannel.isTextBased() ||
          !reviewChannel.isSendable()
        ) {
          throw new Error('AAR review channel is unavailable.');
        }

        // ----------------------------------
        // DOWNLOAD EVIDENCE FILES
        // ----------------------------------


        const permanentFiles = [];

        for (const file of uploadedFiles.values()) {

          const response = await fetch(file.url);

          if (!response.ok) {
            throw new Error(`Could not download ${file.name}`);
          }

          const buffer = Buffer.from(
            await response.arrayBuffer()
          );

          permanentFiles.push(
            new AttachmentBuilder(buffer, {
              name: file.name
            })
          );
        }


        // ----------------------------------
        // CREATE REVIEW EMBED
        // ----------------------------------

        const reviewEmbed = new EmbedBuilder()
          .setTitle(`Siege Report #${reportId}`)
          .setDescription(
            'New After Action Report submitted for review.'
          )
          .addFields(
            {
              name: 'Difficulty',
              value: difficulty,
              inline: false
            },
            {
              name: 'Waves Completed',
              value: String(waves),
              inline: false
            },
            {
              name: 'Waves Counted for Scoring',
              value: String(countedWaves),
              inline: false
            },
            {
              name: 'Pack Members',
              value: squadNames.join('\n'),
              inline: false
            },
            {
              name: 'Squad Size',
              value: `${participants.size}/3`,
              inline: false
            },
            {
              name: 'Base Points',
              value: String(basePoints),
              inline: false
            },
            {
              name: 'Pack Bonus',
              value: `+${squadBonus}`,
              inline: false
            },
            {
              name: 'Provisional Total Points Per Participant',
              value: String(totalPoints),
              inline: false
            },
            {
              name: 'Status',
              value: 'PENDING APPROVAL',
              inline: false
            }
          )
          .setFooter({
            text: 'Space Marine 2 AAR System | React ✅ to approve or ❌ to reject'
          })
          .setTimestamp();


        const reviewMessage = await reviewChannel.send({
          content: `👤 <@${interaction.user.id}>`,
          embeds: [reviewEmbed],
          files: permanentFiles,
          allowedMentions: {
            parse: []
          }
        });


        // ----------------------------------
        // SAVE ORIGINAL EVIDENCE METADATA
        // ----------------------------------

        const evidence = reviewMessage.attachments.map(file => ({
          id: file.id,
          name: file.name,
          url: file.url,
          size: file.size,
          contentType: file.contentType,
          type: 'original'
        }));

        db.prepare(`
          UPDATE reports
          SET
            evidence = ?,
            evidence_thread_id = NULL
          WHERE id = ?
            AND status = 'pending'
        `).run(
          JSON.stringify(evidence),
          reportId
        );


        await reviewMessage.react('✅');
        await reviewMessage.react('❌');


        await interaction.editReply({
          content: 'Siege report submitted successfully.'
        });

        console.log(
          `Siege report #${reportId} saved with ${evidence.length} evidence files.`
        );

      } catch (uploadError) {

        console.error('Siege evidence archive error:', uploadError);

        await interaction.editReply({
          content:
            `Your Siege report #${reportId} was saved, but the review message, evidence, or reactions could not be completed.\n\n` +
            'Please contact an AAR Moderator. The report remains pending and no points have been awarded.'
        });
      }

      return;
    }

  } catch (error) {

    console.error('Interaction error:', error);

    if (
      interaction.isRepliable() &&
      !interaction.replied &&
      !interaction.deferred
    ) {
      await interaction.reply({
        content: 'An error occurred while processing your request.',
        flags: MessageFlags.Ephemeral
      }).catch(console.error);
    }
  }
});

// ==========================================
// ERROR HANDLING
// ==========================================

client.on(Events.Error, (error) => {
  console.error('Discord client error:', error);
});

// ==========================================
// CONNECT TO DISCORD
// ==========================================

client.login(process.env.DISCORD_TOKEN)
  .catch((error) => {
    console.error('Failed to connect to Discord:', error);
    process.exitCode = 1;
  });
