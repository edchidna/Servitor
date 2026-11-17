require('dotenv').config();

const {
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');

const requiredVariables = [
  'DISCORD_TOKEN',
  'CLIENT_ID',
  'GUILD_ID'
];

for (const variable of requiredVariables) {
  if (!process.env[variable]) {
    throw new Error(`Missing ${variable} in .env`);
  }
}

const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check whether the AAR bot is responding.'),

  new SlashCommandBuilder()
    .setName('aar-help')
    .setDescription('Show information about the AAR system.'),

  new SlashCommandBuilder()
    .setName('aar-panel')
    .setDescription('Post the AAR report submission panel.'),

    new SlashCommandBuilder()
    .setName('sagahistory')
    .setDescription("Display a member's Saga History profile.")
    .addUserOption(option =>
      option
        .setName('member')
        .setDescription('The member whose Saga History to view.')
        .setRequired(false)
    ),

      new SlashCommandBuilder()
    .setName('sagapoint')
    .setDescription('Manually manage a member’s Saga Points.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Add Saga Points to a member.')
        .addUserOption(option =>
          option
            .setName('member')
            .setDescription('The member receiving Saga Points.')
            .setRequired(true)
        )
        .addNumberOption(option =>
          option
            .setName('amount')
            .setDescription('The amount of Saga Points to add.')
            .setMinValue(0.01)
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('reason')
            .setDescription('Why are these Saga Points being added?')
            .setMinLength(1)
            .setMaxLength(500)
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('deduct')
        .setDescription('Deduct Saga Points from a member.')
        .addUserOption(option =>
          option
            .setName('member')
            .setDescription('The member losing Saga Points.')
            .setRequired(true)
        )
        .addNumberOption(option =>
          option
            .setName('amount')
            .setDescription('The amount of Saga Points to deduct.')
            .setMinValue(0.01)
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('reason')
            .setDescription('Why are these Saga Points being deducted?')
            .setMinLength(1)
            .setMaxLength(500)
            .setRequired(true)
        )
    ),
  new SlashCommandBuilder()
    .setName('honor')
    .setDescription('Manage member Honors and Honor settings.')

    // GIVE
    .addSubcommand(subcommand =>
      subcommand
        .setName('give')
        .setDescription('Award an Honor to a server member.')
        .addUserOption(option =>
          option
            .setName('member')
            .setDescription('The member receiving the Honor.')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('honor')
            .setDescription('The Honor to award.')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )

    // REMOVE
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Revoke an active Honor from a member.')
        .addUserOption(option =>
          option
            .setName('member')
            .setDescription('The member losing the Honor.')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('honor')
            .setDescription('The Honor to revoke.')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )

    // LIST
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('View a member’s active Honors.')
        .addUserOption(option =>
          option
            .setName('member')
            .setDescription('The member to inspect. Leave empty for yourself.')
            .setRequired(false)
        )
    )

    // HISTORY
    .addSubcommand(subcommand =>
      subcommand
        .setName('history')
        .setDescription('View a member’s complete Honor award history.')
        .addUserOption(option =>
          option
            .setName('member')
            .setDescription('The member whose Honor history you want to view.')
            .setRequired(false)
        )
    )

    // RENAME
    .addSubcommand(subcommand =>
      subcommand
        .setName('rename')
        .setDescription('Change the display name of an Honor.')
        .addStringOption(option =>
          option
            .setName('honor')
            .setDescription('The Honor whose name you want to change.')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option
            .setName('name')
            .setDescription('The new display name for this Honor.')
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(50)
        )
    )

    // LAYOUT
    .addSubcommand(subcommand =>
      subcommand
        .setName('layout')
        .setDescription("Change the server's Saga History Honor layout.")
        .addStringOption(option =>
          option
            .setName('mode')
            .setDescription('Choose how active Honors are arranged.')
            .setRequired(true)
            .addChoices(
              { name: 'Fixed', value: 'fixed' },
              { name: 'Sequential', value: 'sequential' }
            )
        )
    )
];


const rest = new REST({ version: '10' })
  .setToken(process.env.DISCORD_TOKEN);

async function deployCommands() {
  try {
    console.log('Registering Discord slash commands...');

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      {
        body: commands.map(command => command.toJSON())
      }
    );

    console.log('Slash commands registered successfully!');
  } catch (error) {
    console.error('Command registration failed:', error);
    process.exitCode = 1;
  }
}

deployCommands();