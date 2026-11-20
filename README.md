# Space Marine 2 AAR Bot — Servitor

A Discord bot for managing Space Marine 2 After Action Reports (AARs), challenge completions, Unproven Trials, Saga Points, member Honors, and Saga History profile cards.

**Migration branch notice (20 November 2026):** `migration/turso` contains an in-progress conversion from SQLite to Turso. The current `main` branch remains the SQLite baseline. Do not deploy this migration branch yet: `@libsql/client` and its lockfile entry are still pending, and the database transfer/runtime/Discord tests have not been completed. See [TURSO_MIGRATION_NOTES.md](TURSO_MIGRATION_NOTES.md) for the actual migration status.

**Documentation scope:** This manual describes the Servitor production repository and its current implementation as reviewed on 16 November 2026. It documents the production configuration and implemented behavior, including relevant limitations. It does not imply that future planned features are already available.

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
- [Known implementation notes](#known-implementation-notes)

## Features

- Four regular AAR categories: Operations, Stratagems, Siege, and PVP.
- Evidence uploads with generated image collages and archived original files in Discord threads.
- Reaction-based AAR approval and rejection.
- Separate Ordeal challenge submissions, review channel, and role rewards.
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

The repository does not currently declare a specific Node.js version in `package.json`. Check dependency compatibility if you encounter a runtime or installation error.

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
| `assets/fonts/` | Font assets used by the profile card |
| `package.json` | Project metadata, scripts, and dependencies |
| `package-lock.json` | Locked dependency versions |

The database is created locally as `aar-database.db`. SQLite may also create `aar-database.db-wal` and `aar-database.db-shm` while using write-ahead logging.

## Installation

Open PowerShell in the Servitor project directory.

```powershell
cd C:\Users\edchi\Servitor
npm.cmd install
```

`npm.cmd` is used here to avoid the common Windows PowerShell script-execution restriction affecting `npm.ps1`.

Create a `.env` file in the project root and populate it using the configuration section below. Do not commit this file or share its secret values.

The production repository has its own Git history and should be maintained independently from the development repository.

## Environment configuration

The bot reads configuration from `.env`.

### Required variables

| Variable | Purpose |
|---|---|
| `DISCORD_TOKEN` | Bot token used to log in to Discord |
| `CLIENT_ID` | Discord application/client ID; used by `deploy-commands.js` |
| `GUILD_ID` | Discord server ID where slash commands are registered |
| `REPORT_CHANNEL_ID` | Channel where an administrator publishes the AAR submission panel |
| `REVIEW_CHANNEL_ID` | Channel receiving Operations, Stratagems, Siege, and PVP reports for review |
| `LEADERBOARD_CHANNEL_ID` | Channel where the persistent Saga Points leaderboard is posted or updated |
| `MODERATOR_ROLE_ID` | AAR Moderator / High Command role used by review and Honor management permission checks |
| `ORDEAL_REVIEW_CHANNEL_ID` | Dedicated channel for Ordeal completion reviews |
| `NCO_REVIEW_CHANNEL_ID` | Channel receiving Trial/role discrepancy alerts and Ordeal review alerts |
| `ADMIN_ROLE_ID` | Configured Admin role used by review and management permission checks |
| `NCO_ROLE_ID` | NCO role used by AAR/Trial review checks and Trial Pack Member eligibility |
| `IRON_WOLVES_ROLE_ID` | Role granted on Trial graduation and tracked for Saga History tenure |
| `TRIAL_PANEL_CHANNEL_ID` | Channel where the Unproven Trial panel is published |
| `TRIAL_REVIEW_CHANNEL_ID` | Dedicated channel for Unproven Trial submission reviews |
| `UNPROVEN_ROLE_ID` | Role tracked for Trial eligibility and removed on graduation |

The main bot checks its required variables at startup. The command deployment script separately requires `DISCORD_TOKEN`, `CLIENT_ID`, and `GUILD_ID`.

### Optional variables

| Variable | Purpose |
|---|---|
| `LONE_WOLF_ROLE_ID` | Reward role granted for an approved Lone Wolf Ordeal |
| `DOUBLE_TROUBLE_ROLE_ID` | Reward role granted for an approved Double Trouble Ordeal |

An Ordeal challenge without its configured reward role is not available for selection.

### `.env` template

Replace every placeholder with the actual value from your Discord application/server. These are placeholders, not working credentials.

```dotenv
DISCORD_TOKEN=YOUR_BOT_TOKEN
CLIENT_ID=YOUR_DISCORD_APPLICATION_ID
GUILD_ID=YOUR_DISCORD_SERVER_ID

REPORT_CHANNEL_ID=YOUR_AAR_PANEL_CHANNEL_ID
REVIEW_CHANNEL_ID=YOUR_AAR_REVIEW_CHANNEL_ID
LEADERBOARD_CHANNEL_ID=YOUR_LEADERBOARD_CHANNEL_ID
MODERATOR_ROLE_ID=YOUR_HIGH_COMMAND_ROLE_ID

ORDEAL_REVIEW_CHANNEL_ID=YOUR_ORDEAL_REVIEW_CHANNEL_ID
NCO_REVIEW_CHANNEL_ID=YOUR_NCO_ALERT_CHANNEL_ID

ADMIN_ROLE_ID=YOUR_ADMIN_ROLE_ID
NCO_ROLE_ID=YOUR_NCO_ROLE_ID
IRON_WOLVES_ROLE_ID=YOUR_IRON_WOLVES_ROLE_ID
UNPROVEN_ROLE_ID=YOUR_UNPROVEN_ROLE_ID

TRIAL_PANEL_CHANNEL_ID=YOUR_TRIAL_PANEL_CHANNEL_ID
TRIAL_REVIEW_CHANNEL_ID=YOUR_TRIAL_REVIEW_CHANNEL_ID

# Optional Ordeal reward roles
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

**Important:** The deployment script replaces the registered guild command list for this application. Review the command definitions before deploying changes.

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

The first startup initializes the local SQLite database and may create or update database records. Back up any existing database before replacing or changing production data.

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

If evidence archiving fails after a report has been saved, the report remains pending and no points are awarded. The bot reports the failure so an AAR Moderator can investigate. The evidence thread reference is saved when the thread is created, helping reviewers locate partially archived evidence.

### AAR review process

AAR reviews happen in `REVIEW_CHANNEL_ID` using reactions:

- ✅ — approve.
- ❌ — reject.

The reviewer must be a server member with at least one of:

- Discord Administrator permission.
- The configured `ADMIN_ROLE_ID`.
- The configured `NCO_ROLE_ID`.
- The configured `MODERATOR_ROLE_ID`.

**Self-review is prohibited:** neither the report submitter nor any registered report participant can approve or reject that report.

Unauthorized reactions and self-review attempts are ignored and removed where possible. Reports already finalized cannot be decided again.

On approval:

- The report status is updated.
- Each recorded participant receives the report's per-participant points in the score ledger.
- The reviewer decision is recorded in the audit log.
- The leaderboard is refreshed.

On rejection, no AAR points are awarded. The decision is recorded.

The AAR panel's descriptive text should identify Administrators, Admins, NCOs, and AAR Moderators/High Command as the permitted reviewers.

## Saga Points

The following are the current formulas implemented in the regular AAR handlers. Points are calculated per participant and are awarded only after approval. Ordeals do not award Saga Points. Unproven Trials use their separate Pack Member reward rule.

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

**Ordeals award zero AAR points. They do not contribute to the Saga Points leaderboard.**

### Configured challenges

| Challenge | Game mode | Difficulty | Reward role variable |
|---|---|---|---|
| Lone Wolf | Operations | Absolute | `LONE_WOLF_ROLE_ID` |
| Double Trouble | Stratagems | Hard | `DOUBLE_TROUBLE_ROLE_ID` |

A challenge is selectable only when its corresponding reward role is configured.

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
- The reviewer permission check accepts Discord Administrators, configured Admins, NCOs, and AAR Moderators/High Command.
- The submitter and registered participants cannot review their own Ordeal submission.
- Suspicious participant overlap is flagged for manual attention and can generate an alert in `NCO_REVIEW_CHANNEL_ID`.
- On approval, the configured challenge reward role is granted to the challenge completer(s), subject to Discord role permissions and hierarchy.
- On rejection, no reward role is granted.
- The review decision is recorded in the Ordeal audit log.

Ordeal submissions do not create Saga Points ledger entries or trigger a leaderboard reward. The legacy `ordeal_score_ledger` table may remain in the database for compatibility, but it is not used for current scoring or leaderboard calculations.

Gene Seed and Armoury Data recorded through approved Ordeals can still be included separately in Saga History resource totals. These resources are not Saga Points.

After a decision, the original Ordeal evidence thread is deleted. The review card and its audit information remain.

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

Unlike regular AAR and Ordeal reviews, Trial reviews intentionally do not block a reviewer from reviewing their own submission.

### Progression and graduation

- Each approved Trial adds progress for the selected Trial key to each Trial Completer.
- Repeated completion of the same Trial key does not add duplicate progress.
- A member graduates after completing all three distinct Trial keys.
- On graduation, the bot attempts to remove `UNPROVEN_ROLE_ID` and grant `IRON_WOLVES_ROLE_ID`.
- Existing Iron Wolves tenure is preserved rather than reset when the member already has a tenure record.
- The bot prevents the Unproven role from being re-added to a member who has already graduated.
- Role update failures are reported to `NCO_REVIEW_CHANNEL_ID`.

If a graduation role action fails, the database progression remains recorded. The failure is reported for administrative follow-up.

### Trial Pack Member points

At approval time, each Pack Member's current Unproven role status is checked:

| Unproven role at review | Saga Points |
|---|---:|
| No Unproven role | +2 |
| Still has Unproven role | 0 |

Trial Completers receive Trial progression, not these Pack Member points.

Pack Member points are recorded in `trial_score_ledger` only when the member qualifies for the +2 award. Zero-point Pack Members are still recorded in their submission review details.

Approved Trial Pack Member points count toward the combined Saga Points leaderboard.

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

The command generates a public profile card image containing the selected member's:

- Saga Points total.
- Gene Seed total.
- Armoury Data total.
- Iron Wolves tenure.
- Honor display.

The card is generated using Sharp and the background asset at `assets/saga-background.png`.

Saga Points in the card reflect approved AAR and Trial scoring. Ordeals contribute no points. Approved Ordeal Gene Seed and Armoury Data resources can still contribute to their respective resource totals.

Iron Wolves tenure tracking:

- Existing members with the configured Iron Wolves role are initialized when the bot starts.
- When a member receives the role, the tenure start time is recorded.
- When a member loses the role, the tenure record is deleted.
- When a member leaves the server, their tenure record is deleted.
- Trial graduation preserves an existing tenure record rather than resetting it.

Members can request their own Saga History or another member's profile.

## Leaderboard

The bot maintains an all-time top-10 leaderboard in `LEADERBOARD_CHANNEL_ID`.

The leaderboard includes:

- Approved regular AAR points.
- Approved Trial Pack Member points.

It excludes:

- Ordeal submissions, which award zero Saga Points.
- Honor awards.
- Rejected submissions.
- Trial Completer progression, which is not a Saga Points award.

The bot stores the leaderboard message ID in `bot_settings` and edits the saved message when refreshing. If the saved message cannot be reused, the bot can create a new one.

## Database and persistence

The current `main` branch uses SQLite through `better-sqlite3`. The `migration/turso` branch is being converted to Turso/libSQL; it must not be treated as production-ready until the dependency, lockfile, migration rehearsal, and runtime tests are complete.

The main SQLite database file on `main` is:

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

### Turso logical backup and restore (migration branch)

Create a logical JSON backup:

```powershell
npm.cmd run backup
```

Restore into a **clean, dedicated target database** after configuring its `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in the environment:

```powershell
$env:BACKUP_FILE = "backups\\servitor-turso-backup-YYYY-MM-DDTHH-MM-SS-sssZ.json"
npm.cmd run restore
```

The restore command refuses to merge into non-empty application tables and verifies every restored table's row count and content digest. Test recovery on a disposable database first. The JSON backup is a logical data export, not a byte-for-byte database image. Keep backup copies outside the bot host and never point a restore at production unless you have explicitly planned and approved that recovery.

The production Servitor setup is intended to begin with a fresh database. Do not copy development or test database files into production unless a deliberate migration has been planned and approved.

## Testing

The repository contains a focused Operations modal test script. Run it from the project root:

```powershell
node test-operations-modal.js
```

The script checks the Operations modal structure, field constraints, difficulty values, difficulty-selection workflow, and participant-selection helper behavior.

The migration branch also includes database-focused checks:

```powershell
npm.cmd run check:syntax
npm.cmd run test:libsql
npm.cmd run test:operations-modal
```

- `check:syntax` checks the root JavaScript files and JavaScript test files.
- `test:libsql` runs the ten local libSQL persistence tests against a temporary database, including a complete SQLite migration and backup/restore round trip.
- `test:operations-modal` checks the existing Operations modal, field constraints, difficulty selection, squad limits, and its async AAR persistence/review path.
- `test:turso-remote-fk` probes foreign-key behavior against a dedicated disposable remote Turso database. Set `TURSO_TEST_DATABASE_URL` and `TURSO_TEST_AUTH_TOKEN` first.
- GitHub Actions runs the local tests on every migration-branch update. When the two dedicated remote-test secrets are configured, it also runs the full persistence suite against the remote test database and the isolated foreign-key probe.

The remote persistence suite requires an empty, dedicated test database; it creates and drops its own test tables. Never point the test variables at production.

These database tests do not replace live Discord acceptance testing. They do not verify server permissions, channel configuration, role hierarchy, evidence uploads, reactions, or complete end-to-end review behavior.

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
- Remember that AAR submitters and registered participants cannot review their own reports.
- Confirm the bot can read message history and manage reactions as required by the channel configuration.

### Trial reviews or graduation roles do not work

- Verify `TRIAL_REVIEW_CHANNEL_ID`, `UNPROVEN_ROLE_ID`, and `IRON_WOLVES_ROLE_ID`.
- Confirm the reviewer has an accepted Trial review permission.
- Confirm the bot has Manage Roles permission.
- Move the bot's highest role above the roles it must grant or remove.
- Check the bot console and NCO review alert channel for follow-up errors.

### Ordeal reward roles are not granted

- Verify `ORDEAL_REVIEW_CHANNEL_ID`.
- Verify the corresponding optional reward role variable is configured.
- Confirm the bot has Manage Roles permission.
- Move the bot's highest role above the reward role.
- Check the bot console and NCO review alert channel for errors.

### Evidence collage is missing

- Original evidence may still be present in the evidence thread.
- Collage generation only includes supported image formats.
- Check the bot console for image-processing or upload errors.

## Known implementation notes

The following are operational limitations or implementation details worth understanding. They are not claims that the features are missing.

1. **Ordeal scoring:** The legacy `ordeal_score_ledger` table and legacy point-related columns may remain in the database for compatibility. Current Ordeal approvals do not award Saga Points or contribute to the leaderboard.
2. **Trial preview and approval:** Eligible Pack Members receive +2 Saga Points at approval, not +3. Members who still have the Unproven role at review receive zero.
3. **AAR panel description:** The AAR review permission check accepts Discord Administrators, configured Admins, NCOs, and AAR Moderators/High Command. The panel description should reflect all four accepted permission paths.
4. **No npm test script:** `test-operations-modal.js` is a standalone focused test, not a complete automated test suite.
5. **Discord-side verification:** Local syntax checks and the Operations regression test do not replace live testing of channel permissions, role hierarchy, evidence uploads, reactions, and review workflows.

## License

No license file was present in the inspected repository baseline. Add a license separately if you intend to distribute or open-source the project.
