# Space Marine 2 AAR Bot

A Discord bot for managing Space Marine 2 After Action Reports (AARs), challenge completions, Unproven Trials, Saga Points, member Honors, and Saga History profile cards.

> **Documentation baseline:** This manual describes the implementation in the repository's `main` branch at commit `c39233cd4f59a6802f4d7b85644463236f000432`. It documents current code behavior, including known inconsistencies. It does not imply that planned behavior is already implemented.

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Project files](#project-files)
- [Installation](#installation)
- [Environment configuration](#environment-configuration)
- [Discord setup and permissions](#discord-setup-and-permissions)
- [Deploying slash commands](#deploying-slash-commands)
- [Running the bot](#running-the-bot)
- [AAR system](#aar-system)
- [Saga Points](#saga-points)
- [Ordeals](#ordeals)
- [Unproven Trial system](#unproven-trial-system)
- [Honor system](#honor-system)
- [Saga History profile](#saga-history-profile)
- [Leaderboard](#leaderboard)
- [Database and persistence](#database-and-persistence)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Known implementation gaps](#known-implementation-gaps)

## Features

- Four regular AAR categories: Operations, Stratagems, Siege, and PVP.
- Evidence uploads with generated image collages and archived original files in Discord threads.
- Reaction-based AAR approval and rejection.
- Separate Ordeal challenge submissions and review channel.
- Unproven Trial submissions, progression tracking, and graduation role handling.
- Ten configurable Honors with award/revocation history and display layouts.
- Saga History profile cards generated with Sharp.
- Combined top-10 Saga Points leaderboard.
- SQLite persistence.

## Requirements

- Node.js and npm, using a Node.js release compatible with the dependencies in `package.json`.
- A Discord application and bot created in the Discord Developer Portal.
- A Discord server where the bot can be invited.
- Access to configure the bot's environment variables and Discord role/channel IDs.

The repository does not currently declare a specific Node.js version in `package.json`. Check the installed dependencies if you encounter a runtime compatibility error.

## Project files

| File or folder | Purpose |
|---|---|
| `index.js` | Main bot entry point; AAR, Ordeal, Saga History, role tracking, and interaction handlers |
| `database.js` | Creates and initializes the SQLite database and AAR/Ordeal tables |
| `leaderboard.js` | Calculates and publishes the combined Saga Points leaderboard |
| `trial.js` | Unproven Trial panels, submissions, reviews, progression, and graduation |
| `trial-database.js` | Trial persistence and scoring operations |
| `honor.js` | Honor award, revocation, history, naming, and layout logic |
| `honor-database.js` | Honor tables and initial Honor records |
| `deploy-commands.js` | Registers the bot's guild slash commands |
| `test-operations-modal.js` | Focused checks for the Operations modal and related submission logic |
| `assets/saga-background.png` | Background image used by the Saga History profile card |
| `package.json` | Project metadata, scripts, and dependencies |
| `package-lock.json` | Locked dependency versions |

The database is created locally as `aar-database.db`. SQLite may also create `aar-database.db-wal` and `aar-database.db-shm` while using write-ahead logging.

## Installation

Open PowerShell in the project directory.

```powershell
cd C:\Users\<your-windows-user>\SpaceMarineAAR
npm.cmd install
```

`npm.cmd` is used here to avoid the common Windows PowerShell script-execution restriction affecting `npm.ps1`.

Create a `.env` file in the project root and populate it using the configuration section below. Do not commit this file or share its secret values.

## Environment configuration

The bot reads configuration from `.env`. The following variables are referenced by the current source.

### Required variables

| Variable | Purpose |
|---|---|
| `DISCORD_TOKEN` | Bot token used to log in to Discord and authenticate command deployment |
| `CLIENT_ID` | Discord application/client ID; used by `deploy-commands.js` |
| `GUILD_ID` | Discord server ID where slash commands are registered |
| `REPORT_CHANNEL_ID` | Channel where an administrator publishes the AAR submission panel |
| `REVIEW_CHANNEL_ID` | Channel receiving Operations, Stratagems, Siege, and PVP reports for review |
| `LEADERBOARD_CHANNEL_ID` | Channel where the persistent Saga Points leaderboard is posted or updated |
| `ORDEAL_REVIEW_CHANNEL_ID` | Dedicated channel for Ordeal completion reviews |
| `NCO_REVIEW_CHANNEL_ID` | Channel receiving Trial/role discrepancy alerts and Ordeal review alerts |
| `TRIAL_PANEL_CHANNEL_ID` | Channel where the Unproven Trial panel is published |
| `TRIAL_REVIEW_CHANNEL_ID` | Dedicated channel for Unproven Trial submission reviews |
| `ADMIN_ROLE_ID` | Configured Admin role used by review and management permission checks |
| `MODERATOR_ROLE_ID` | AAR Moderator role used by review and Honor management permission checks |
| `NCO_ROLE_ID` | NCO role used by AAR/Trial review checks and Trial Pack Member eligibility |
| `UNPROVEN_ROLE_ID` | Role tracked for Trial eligibility and removed on graduation |
| `IRON_WOLVES_ROLE_ID` | Role granted on Trial graduation and tracked for Saga History tenure |
| `LONE_WOLF_ROLE_ID` | Reward role granted for an approved Lone Wolf Ordeal |
| `DOUBLE_TROUBLE_ROLE_ID` | Reward role granted for an approved Double Trouble Ordeal |

The main bot checks its required variables at startup. The command deployment script separately requires `DISCORD_TOKEN`, `CLIENT_ID`, and `GUILD_ID`.

### `.env` template

Replace every placeholder with the actual value from your Discord application/server. These are placeholders, not working credentials.

```dotenv
DISCORD_TOKEN=YOUR_BOT_TOKEN
CLIENT_ID=YOUR_DISCORD_APPLICATION_ID
GUILD_ID=YOUR_DISCORD_SERVER_ID

REPORT_CHANNEL_ID=YOUR_AAR_PANEL_CHANNEL_ID
REVIEW_CHANNEL_ID=YOUR_AAR_REVIEW_CHANNEL_ID
LEADERBOARD_CHANNEL_ID=YOUR_LEADERBOARD_CHANNEL_ID
ORDEAL_REVIEW_CHANNEL_ID=YOUR_ORDEAL_REVIEW_CHANNEL_ID
NCO_REVIEW_CHANNEL_ID=YOUR_NCO_ALERT_CHANNEL_ID
TRIAL_PANEL_CHANNEL_ID=YOUR_TRIAL_PANEL_CHANNEL_ID
TRIAL_REVIEW_CHANNEL_ID=YOUR_TRIAL_REVIEW_CHANNEL_ID

ADMIN_ROLE_ID=YOUR_ADMIN_ROLE_ID
MODERATOR_ROLE_ID=YOUR_AAR_MODERATOR_ROLE_ID
NCO_ROLE_ID=YOUR_NCO_ROLE_ID
UNPROVEN_ROLE_ID=YOUR_UNPROVEN_ROLE_ID
IRON_WOLVES_ROLE_ID=YOUR_IRON_WOLVES_ROLE_ID

LONE_WOLF_ROLE_ID=YOUR_LONE_WOLF_REWARD_ROLE_ID
DOUBLE_TROUBLE_ROLE_ID=YOUR_DOUBLE_TROUBLE_REWARD_ROLE_ID
```

To obtain a channel or role ID in Discord, enable Developer Mode in Discord's Advanced settings, then use the context menu's **Copy ID** option.

**Security:** Never post your bot token in chat, screenshots, source files, GitHub, or support requests. If the token is exposed, regenerate it in the Discord Developer Portal and update `.env`.

## Discord setup and permissions

### Developer Portal

1. Create or open the Discord application and add a bot user.
2. Copy the bot token into `DISCORD_TOKEN`.
3. Copy the application ID into `CLIENT_ID`.
4. In the Bot settings, enable the **Server Members Intent**. The code uses the `GuildMembers` gateway intent for member and role tracking.
5. Invite the bot to the intended server with the permissions needed for its configured channels and role workflows.

The bot requests these gateway intents in code:

- `Guilds`
- `GuildMessageReactions`
- `GuildMembers`

### Server permissions and role hierarchy

Configure the bot so it can perform the actions enabled in your server. Depending on channel overrides and enabled features, this includes:

- Viewing channels and reading message history.
- Sending messages, embeds, and file attachments.
- Adding and managing reactions on AAR review messages.
- Creating threads and sending messages in threads.
- Managing roles for Ordeal rewards and Trial graduation.

The bot's highest role must be above the roles it needs to grant or remove, including the configured Ordeal reward roles, `UNPROVEN_ROLE_ID`, and `IRON_WOLVES_ROLE_ID`.

Create the configured channels and roles before starting the bot. Make sure each environment variable contains the ID of the correct server resource.

## Deploying slash commands

Run this after setting `DISCORD_TOKEN`, `CLIENT_ID`, and `GUILD_ID` in `.env`:

```powershell
npm.cmd run deploy
```

The deployment script registers guild-specific slash commands for the server identified by `GUILD_ID`.

Current commands:

| Command | Description |
|---|---|
| `/ping` | Checks whether the bot responds |
| `/aar-help` | Displays AAR and Honor system information |
| `/aar-panel` | Publishes the AAR submission panel |
| `/sagahistory [member]` | Displays a member's Saga History profile card |
| `/honor give` | Awards an Honor to a member |
| `/honor remove` | Revokes an active Honor |
| `/honor list [member]` | Shows a member's active Honors |
| `/honor history [member]` | Shows a member's Honor award/revocation history |
| `/honor rename` | Changes an Honor's display name |
| `/honor layout` | Changes the Saga History Honor layout |

The six Honor subcommands are grouped under `/honor`.

## Running the bot

Start the bot from the project root:

```powershell
npm.cmd start
```

The start script runs `node index.js`.

When the bot becomes ready, it:

- Logs its online status.
- Initializes Iron Wolves tenure records for existing members who already have the configured role.
- Checks/publishes the Unproven Trial panel in `TRIAL_PANEL_CHANNEL_ID`.

Keep the process running for the bot to remain online. For production use, run it on a reliable always-on host and arrange a safe restart strategy.

## AAR system

### Submission categories

The AAR panel provides these regular categories:

1. Operations
2. Stratagems
3. Siege
4. PVP

Ordeals are presented on the panel as a separate challenge-completion system.

### Operations

The submitter selects:

- Operation.
- Difficulty.
- Gene Seed: Yes or No.
- Armoury Data: 0–3.
- Up to two additional squad members.
- One to six evidence files.

The submitter is automatically included, so a squad can contain up to three unique members.

Available Operations are:

- Inferno
- Decapitation
- Vox Liberatis
- Reliquary
- Fall of Atreus
- Ballistic Engine
- Termination
- Obelisk
- Exfiltration
- Vortex
- Reclamation
- Disruption
- Purgation
- Other / Not Listed

### Stratagems

The submitter selects:

- Difficulty: Normal or Hard.
- Gene Seed: Yes or No.
- Armoury Data: 0–3.
- Up to two additional squad members.
- One to six evidence files.

The submitter is automatically included. Maximum squad size is three.

### Siege

The submitter enters:

- Difficulty: Normal or Hard.
- A positive whole number of waves completed.
- Up to two additional squad members.
- One to six evidence files.

The submitter is automatically included. Maximum squad size is three. Scoring counts completed groups of five waves; incomplete groups do not add base points.

### PVP

The submitter selects:

- Game mode: Capture and Control, Seize Ground, Annihilation, or Helbrute Onslaught.
- Result: Victory or Defeat.
- Up to two additional squad members.
- One to six evidence files.

The submitter is automatically included. Maximum squad size is three.

### Evidence handling

For regular AAR submissions, the bot:

1. Receives one to six uploaded files.
2. Downloads the original files.
3. Generates an evidence collage when supported image files are present.
4. Posts a review embed in `REVIEW_CHANNEL_ID`.
5. Creates a thread under the review message for the original evidence files.
6. Adds ✅ and ❌ reactions to the review message.
7. Stores report data and evidence references in SQLite.

The collage is a review convenience; original uploads are retained in the evidence thread. Image collage generation supports common image formats handled by the implementation, including PNG, JPEG, GIF, and WebP. Non-image evidence can remain in the original evidence thread even when it cannot be included in the collage.

### AAR review process

AAR reviews happen in `REVIEW_CHANNEL_ID` using reactions:

- ✅ — approve.
- ❌ — reject.

The reviewer must be a server member with at least one of:

- Discord Administrator permission.
- The configured `ADMIN_ROLE_ID`.
- The configured `NCO_ROLE_ID`.
- The configured `MODERATOR_ROLE_ID`.

The report submitter cannot approve or reject their own report. Unauthorized reactions are ignored and removed where possible. Reports already finalized cannot be decided again.

On approval:

- The report status is updated.
- Each recorded participant receives the report's per-participant points in the score ledger.
- The reviewer decision is recorded in the audit log.
- The leaderboard is refreshed.

On rejection, no AAR points are awarded. The decision is recorded.

The AAR panel's descriptive text currently says reports require administrator or AAR Moderator approval, but the implemented review permission check also accepts the configured NCO role.

## Saga Points

The following are the current formulas implemented in `index.js`. Points are calculated per participant and are awarded to participants only after approval, except where the separate Ordeal and Trial rules below apply.

### Operations

`Difficulty base + Gene Seed bonus + Armoury Data bonus + Squad bonus`

| Difficulty | Base points |
|---|---:|
| Average | 1 |
| Substantial | 2 |
| Ruthless | 3 |
| Lethal | 4 |
| Absolute | 5 |

Bonuses:

- Gene Seed: +1 when Yes.
- Armoury Data: +0.5 per unit.
- Squad: +1 when the report has more than one participant.

### Stratagems

| Difficulty | Base points |
|---|---:|
| Normal | 5 |
| Hard | 6 |

Bonuses:

- Gene Seed: +1 when Yes.
- Armoury Data: +0.5 per unit.
- Squad: +1 when the report has more than one participant.

### Siege

Base points are awarded for each completed group of five waves:

| Difficulty | Points per completed 5-wave group |
|---|---:|
| Normal | 3 |
| Hard | 5 |

Formula:

`floor(waves completed / 5) × difficulty points + squad bonus`

The squad bonus is +1 when the report has more than one participant. For example, 12 waves count as two completed groups of five for base scoring.

### PVP

| Result | Base points |
|---|---:|
| Victory | 3 |
| Defeat | 1 |

A +1 squad bonus applies when the report has more than one participant.

## Ordeals

Ordeals are a separate challenge-completion workflow with their own review channel and reward roles. They are not regular AAR submissions.

### Configured challenges

| Challenge | Game mode | Difficulty | Configured base points | Reward role variable |
|---|---|---|---:|---|
| Lone Wolf | Operations | Absolute | 5 | `LONE_WOLF_ROLE_ID` |
| Double Trouble | Stratagems | Hard | 6 | `DOUBLE_TROUBLE_ROLE_ID` |

### Submission

The multi-step workflow collects challenge completers, any additional participants, and challenge details. The submitter is automatically included as a participant.

Depending on the challenge, the form collects:

- Operation name for Operations-based challenges.
- Gene Seed: Yes or No.
- Armoury Data: 0–3.
- One to six evidence files.

A squad must contain between one and three unique participants. Challenge completers must be included among the participants; the submitter and completers cannot be selected again as additional teammates.

### Review and rewards

- Submissions are sent to `ORDEAL_REVIEW_CHANNEL_ID`.
- Reviews use ✅ to approve and ❌ to reject.
- The reviewer permission check accepts Discord Administrators, configured Admins, NCOs, and AAR Moderators.
- Suspicious participant overlap is flagged for manual attention and can generate an alert in `NCO_REVIEW_CHANNEL_ID`.
- On approval, the configured challenge reward role is granted to the challenge completer(s), subject to Discord role permissions and hierarchy.

**Current implementation note:** the code calculates Ordeal base and bonus points and writes approved Ordeal points to `ordeal_score_ledger`. Those points are included in the combined leaderboard. This is the behavior of the inspected code, even though the intended project design says Ordeals should award zero AAR points and should not affect the leaderboard. See [Known implementation gaps](#known-implementation-gaps).

## Unproven Trial system

Unproven Trials are separate from Ordeals. They track completion of three distinct Trials and handle graduation into the Iron Wolves role.

### Panel and submission

The Trial panel is published in `TRIAL_PANEL_CHANNEL_ID` by the bot's startup routine. The submission form collects:

- One or two Trial Completers.
- Trial 1, Trial 2, or Trial 3.
- One or two Pack Members.
- One to six evidence files.

Validation rules:

- Trial Completers and Pack Members must be different people.
- At least one Pack Member must have the configured NCO role.
- The combined squad cannot exceed three participants.
- Participants must be valid, non-bot members of the server.
- Each evidence file is limited to 10 MB by the Trial submission handler.

The submission is sent to `TRIAL_REVIEW_CHANNEL_ID`. A collage is attached when possible, and original evidence files are stored in a thread under the review message.

### Review permissions

Trial reviews use Approve and Reject buttons. Reviewers must have at least one of:

- Discord Administrator permission.
- `ADMIN_ROLE_ID`.
- `NCO_ROLE_ID`.
- `MODERATOR_ROLE_ID`.

The review must occur in `TRIAL_REVIEW_CHANNEL_ID` and must reference the original pending review message.

### Progression and graduation

- Each approved Trial adds progress for the selected Trial key to each Trial Completer.
- A member graduates after completing all three distinct Trial keys.
- On graduation, the bot attempts to remove `UNPROVEN_ROLE_ID` and grant `IRON_WOLVES_ROLE_ID`.
- The bot prevents the Unproven role from being re-added to a member who has already graduated.
- Role update failures are reported to `NCO_REVIEW_CHANNEL_ID`.

### Trial Pack Member points

At approval time, each Pack Member's current Unproven role status is checked:

- No Unproven role at review: +2 Saga Points.
- Still has the Unproven role at review: 0 Saga Points.

Trial Completers receive Trial progression, not these Pack Member points.

**Current implementation note:** the pending Trial review embed displays `+3 Saga Points (Projected)` for eligible Pack Members, but the database approval logic awards +2. See [Known implementation gaps](#known-implementation-gaps).

## Honor system

The bot initializes ten permanent Honor records:

- `honor_1` through `honor_10`.
- Initial display names: Honor 1 through Honor 10.
- Display order: 1 through 10.

Honor management commands:

| Command | Function |
|---|---|
| `/honor give` | Award an Honor to a member |
| `/honor remove` | Revoke an active Honor |
| `/honor list` | View active Honors |
| `/honor history` | View all Honor awards and revocations |
| `/honor rename` | Change an Honor's display name |
| `/honor layout` | Change the Saga History card layout |

### Honor permissions

The following can give, remove, rename, and change Honor layout:

- Discord Administrators.
- Members with `ADMIN_ROLE_ID`.
- Members with `MODERATOR_ROLE_ID`.

NCO role membership alone does not grant Honor management access. NCOs can manage Honors only if they also have one of the permissions listed above.

All members can view Honor lists and history.

### Award and revocation behavior

- A member cannot hold duplicate active awards of the same Honor.
- Revoking an Honor marks the award inactive and records who revoked it and when.
- Revocation does not erase the historical award record.
- An Honor can be awarded again after it has been revoked.
- Renamed Honors retain their permanent Honor IDs.
- Honor awards do not grant Saga Points and do not affect the leaderboard.

### Honor layout modes

`/honor layout mode: fixed`

- Honors 1–5 occupy the left column.
- Honors 6–10 occupy the right column.
- Empty positions remain empty.

`/honor layout mode: sequential`

- Active Honors are arranged by original award date, oldest first.
- The left column fills first, then the right column.
- Revoked Honors are omitted, so the remaining Honors close the gaps.

The selected layout is stored per server.

## Saga History profile

Use:

```text
/sagahistory
/sagahistory member:@Member
```

The command generates a profile card image containing the member's:

- Saga Points total.
- Gene Seed total.
- Armoury Data total.
- Iron Wolves tenure.
- Honor display.

The card is generated using Sharp and the background asset at `assets/saga-background.png`.

Iron Wolves tenure tracking:

- Existing members with the configured Iron Wolves role are initialized when the bot starts.
- When a member receives the role, the tenure start time is recorded.
- When a member loses the role, the tenure record is deleted.
- When a member leaves the server, their tenure record is deleted.

## Leaderboard

The bot maintains an all-time top-10 leaderboard in `LEADERBOARD_CHANNEL_ID`.

- Approved AAR points are included.
- Approved Ordeal points are included by the current implementation.
- Approved Trial Pack Member points are included.
- Honor awards do not contribute points.
- Rejected submissions do not contribute points.
- The bot stores the leaderboard message ID in `bot_settings` and edits the saved message when refreshing. If the saved message cannot be reused, the bot can create a new one.

The current leaderboard footer text is outdated; see [Known implementation gaps](#known-implementation-gaps).

## Database and persistence

The project uses SQLite through `better-sqlite3`.

The main database file is:

```text
aar-database.db
```

SQLite write-ahead logging is enabled (`journal_mode=WAL`), and foreign-key enforcement is enabled.

The database stores AAR reports, participants, score ledgers, audit records, Ordeal submissions, Trial records, Honor records, settings, and Iron Wolves tenure data.

Important persistence notes:

- Database files are local runtime data and are ignored by Git.
- Do not delete `aar-database.db` to troubleshoot the bot unless you intentionally want to remove the stored data.
- The `-wal` and `-shm` files are SQLite runtime sidecars; do not manually edit them.
- Back up the database before making database/schema changes or moving the bot to another host.
- Stop the bot cleanly before manually copying the database files.

Database initialization and migrations run through the database modules when the bot starts.

## Testing

The repository contains a focused Operations modal test script. Run it from the project root:

```powershell
node test-operations-modal.js
```

The script checks the Operations modal structure, field constraints, difficulty values, difficulty-selection workflow, and participant-selection helper behavior.

There is currently no `test` script in `package.json`, so `npm.cmd test` is not configured. The Operations test is not a full Discord integration test and does not verify live server permissions, channel configuration, role hierarchy, or end-to-end review behavior.

## Troubleshooting

### Bot does not start

- Check that `.env` exists in the project root.
- Check that every required variable is present and contains the correct ID/value.
- Confirm that `DISCORD_TOKEN` is current and has not been reset.
- Run `npm.cmd install` if dependencies are missing.
- Read the PowerShell error and the bot console output; do not share your token when asking for help.

### Slash commands do not appear

- Run `npm.cmd run deploy`.
- Verify `CLIENT_ID`, `GUILD_ID`, and `DISCORD_TOKEN`.
- Confirm that the bot is invited to the server identified by `GUILD_ID`.

### AAR reports are not reaching the review channel

- Verify `REVIEW_CHANNEL_ID`.
- Confirm the bot can view and send messages in the review channel.
- Confirm it can attach files, create threads, and send messages in threads.
- Check the bot console for upload or channel errors.

### Review reactions do not work

- Confirm the review message is a bot-created AAR report in `REVIEW_CHANNEL_ID`.
- Use the exact ✅ or ❌ reaction.
- Confirm the reviewer has one of the configured review permissions.
- The report submitter cannot review their own report.
- Confirm the bot can read message history and manage reactions as required by the channel configuration.

### Roles are not granted or removed

- Verify the role ID in `.env`.
- Confirm the bot has Manage Roles permission.
- Move the bot's highest role above every role it must grant or remove.
- Check the bot console and the NCO review alert channel for follow-up errors.

### Evidence collage is missing

- Original evidence may still be present in the evidence thread.
- Collage generation only includes supported image formats.
- Check the bot console for image-processing or upload errors.

## Known implementation gaps

These are discrepancies observed in the inspected `main` branch. They are documented here so operators do not mistake the current behavior for the intended final design.

1. **Ordeal scoring conflicts with the intended design.** The current code calculates Ordeal points, writes them to `ordeal_score_ledger` on approval, and includes them in the leaderboard. The intended project rule is that Ordeals award zero AAR points and do not affect the leaderboard. The code must be changed before that intended rule is true.
2. **Trial point preview is inconsistent.** The pending Trial review embed displays +3 projected Saga Points for eligible Pack Members, while the approval database logic awards +2.
3. **Leaderboard footer is outdated.** The footer says `All-time rankings | Operations + Ordeals`, but the query includes AAR, Ordeal, and Trial score ledgers.
4. **AAR panel description is narrower than the actual permission check.** The panel text refers to administrator or AAR Moderator approval, while the AAR review handler also accepts the configured NCO role.
5. **No npm test script exists.** `test-operations-modal.js` is a standalone focused test, not a complete automated test suite.

Do not treat this list as a claim that these issues have been fixed. Re-check the source code before removing an item from this section.

## License

No license file was present in the inspected repository baseline. Add a license separately if you intend to distribute or open-source the project.
