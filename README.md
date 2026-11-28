# Space Marine 2 AAR Bot — Servitor

A Discord bot for managing Space Marine 2 After Action Reports (AARs), challenge completions, Unproven Trials, Saga Points, member Honors, and Saga History profile cards.

**Documentation scope:** This manual preserves the existing Servitor feature and Discord-workflow documentation. On `migration/turso`, the persistence implementation is being changed from local SQLite to asynchronous Turso/libSQL; the feature workflows are intended to remain the same. SQLite-specific setup and backup instructions in the preserved manual below describe the `main` branch baseline, not the Turso migration branch.


> **Migration branch notice — read before using this branch**
>
> This branch uses Turso/libSQL, not the local `aar-database.db` SQLite file. In addition to the existing Discord configuration below, configure:
>
> - `TURSO_DATABASE_URL` — the Turso database URL.
> - `TURSO_AUTH_TOKEN` — a read-write token for the intended Servitor database.
>
> Keep credentials in the host's secret/environment settings or an untracked local `.env`; never commit or paste them into chat. Do not use the CI test database for the live bot.
>
> The feature descriptions and Discord setup instructions in this manual are retained to avoid losing the existing operator documentation. Sections that specifically describe SQLite files, SQLite backup commands, or the old synchronous database modules are historical `main`-branch instructions and are superseded on this branch by [TURSO_MIGRATION_NOTES.md](./TURSO_MIGRATION_NOTES.md). Use `backup-database.js` and `restore-database.js` for the new logical Turso backup/restore workflow. Do not migrate, deploy, or cut over production until the separate validation gates and explicit approval are complete.

## Turso migration branch — current persistence files

| File | Purpose |
|---|---|
| `turso-database.js` | Shared asynchronous libSQL client, transactions, and graceful shutdown |
| `core-database-schema.js` / `feature-database-schemas.js` | Versioned core, Trial, and Honor schema initialization |
| `aar-database-turso.js` / `ordeal-database-turso.js` | AAR and Ordeal persistence |
| `trial-database-turso.js` | Trial submissions, progression, and scoring |
| `saga-database-turso.js` / `member-database-turso.js` | Saga adjustments and member tenure |
| `migrate-sqlite-to-turso.js` | One-time import from a separately copied SQLite database into an empty Turso target |
| `backup-database.js` / `restore-database.js` | Logical JSON backup and clean-target restore |

See [TURSO_MIGRATION_NOTES.md](./TURSO_MIGRATION_NOTES.md) for the migration procedure, validation status, and recovery cautions. See [LIVE_SERVER_CUTOVER_PLAN.md](./LIVE_SERVER_CUTOVER_PLAN.md) for the controlled existing-server cutover sequence and rollback plan.

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
- Turso/libSQL persistence on `migration/turso` (SQLite remains the `main` branch baseline).

## Requirements

- Node.js 22.x and npm. Use a current Node.js 22 release for the bot, tests, and migration toolchain. The legacy SQLite adapter and current SQLite import utility still use `better-sqlite3`; its native installation is exercised by CI on Ubuntu, while Windows host compatibility must be confirmed separately.
- A Discord application and bot created in the Discord Developer Portal.
- A Discord server where the bot can be invited.
- Access to configure the bot's environment variables and Discord role/channel IDs.

The GitHub Actions validation workflow uses Node.js 22.

## Project files

| File or folder | Purpose |
|---|---|
| `index.js` | Main bot entry point; AAR, Ordeal, Saga History, role tracking, and interaction handlers |
| `turso-database.js` | Shared asynchronous Turso/libSQL client, transactions, and graceful shutdown |
| `leaderboard.js` | Calculates and publishes the combined Saga Points leaderboard |
| `trial.js` | Unproven Trial panels, submissions, reviews, progression, and graduation |
| `trial-database-turso.js` | Trial persistence and scoring operations |
| `honor.js` | Honor award, revocation, history, naming, and layout logic |
| `feature-database-schemas.js` | Trial/Honor schema initialization and seeded Honor records |
| `deploy-commands.js` | Registers the bot's guild slash commands |
| `test-operations-modal.js` | Focused Operations modal regression test |
| `assets/saga-background.png` | Background image used by the Saga History profile card |
| `assets/fonts/` | Font assets used by the profile card |
| `package.json` | Project metadata, scripts, and dependencies |
| `package-lock.json` | Locked dependency versions |

On this branch, application data is stored in the Turso/libSQL database selected by `TURSO_DATABASE_URL`. A local `file:` URL can be used for isolated development/testing, but do not point the live bot at a test database. The old `aar-database.db` SQLite file is a migration source, not the active runtime database.

## Installation

Open PowerShell in the Servitor project directory.

```powershell
cd "C:\path\to\Servitor"
npm.cmd ci
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
| `TURSO_DATABASE_URL` | Turso/libSQL database URL used by the bot and migration tools |
| `TURSO_AUTH_TOKEN` | Read-write authentication token for the configured remote Turso database |
| `REPORT_CHANNEL_ID` | Channel where an administrator publishes the AAR submission panel |
| `REVIEW_CHANNEL_ID` | Channel receiving Operations, Stratagems, Siege, and PVP reports for review |
| `LEADERBOARD_CHANNEL_ID` | Channel where the persistent Saga Points leaderboard is posted or updated |
| `MODERATOR_ROLE_ID` | AAR Moderator / High Command role used by review and Honor management permission checks |
| `ORDEAL_REVIEW_CHANNEL_ID` | Dedicated `#ordeal-completion` channel for Hunt completion reviews |
| `NCO_REVIEW_CHANNEL_ID` | Channel receiving Trial/role discrepancy alerts and Ordeal review alerts |
| `ADMIN_ROLE_ID` | Configured Admin role used by review and management permission checks |
| `NCO_ROLE_ID` | NCO role used by AAR/Trial review checks and Trial Pack Member eligibility |
| `IRON_WOLVES_ROLE_ID` | Role granted on Trial graduation and tracked for Saga History tenure |
| `PACK_BROTHER_ROLE_ID` | Additional role granted on Trial graduation |
| `TRIAL_PANEL_CHANNEL_ID` | Channel where the Unproven Trial panel is published |
| `TRIAL_REVIEW_CHANNEL_ID` | Dedicated channel for Unproven Trial submission reviews |
| `UNPROVEN_ROLE_ID` | Role tracked for Trial eligibility and removed on graduation |

The main bot checks its required variables at startup. The command deployment script separately requires `DISCORD_TOKEN`, `CLIENT_ID`, and `GUILD_ID`.

### Optional variables

| Variable | Purpose |
|---|---|
| `SIEGE_OF_FENRIS_ROLE_ID` | Defender of Fenris role granted to approved challenge completers |
| `HUNT_FOR_THE_WULFEN_ROLE_ID` | Wulfen Savior role granted to approved challenge completers |
| `SHADOW_WOLF_ROLE_ID` | Shadow Wolf role granted to approved challenge completers |
| `MAELSTROM_SURVIVOR_ROLE_ID` | Maelstrom Survivor role granted to approved challenge completers |

A Hunt without its configured reward role is not available for selection. The legacy `LONE_WOLF_ROLE_ID` and `DOUBLE_TROUBLE_ROLE_ID` variables are no longer used.

### `.env` template

Replace every placeholder with the actual value from your Discord application/server. These are placeholders, not working credentials.

```dotenv
TURSO_DATABASE_URL=libsql://YOUR_DATABASE-HOST.turso.io
TURSO_AUTH_TOKEN=YOUR_READ_WRITE_DATABASE_TOKEN

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
PACK_BROTHER_ROLE_ID=1572246418679271424
UNPROVEN_ROLE_ID=YOUR_UNPROVEN_ROLE_ID

TRIAL_PANEL_CHANNEL_ID=YOUR_TRIAL_PANEL_CHANNEL_ID
TRIAL_REVIEW_CHANNEL_ID=YOUR_TRIAL_REVIEW_CHANNEL_ID

# Hunt reward roles
SIEGE_OF_FENRIS_ROLE_ID=YOUR_DEFENDER_OF_FENRIS_ROLE_ID
HUNT_FOR_THE_WULFEN_ROLE_ID=YOUR_WULFEN_SAVIOR_ROLE_ID
SHADOW_WOLF_ROLE_ID=YOUR_SHADOW_WOLF_ROLE_ID
MAELSTROM_SURVIVOR_ROLE_ID=YOUR_MAELSTROM_SURVIVOR_ROLE_ID
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

The bot's highest role must be above the roles it needs to grant or remove, including the configured Ordeal reward roles, `UNPROVEN_ROLE_ID`, `IRON_WOLVES_ROLE_ID`, and `PACK_BROTHER_ROLE_ID`.

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
| `/sagapoint add` | Adds Saga Points to a member with a required reason |
| `/sagapoint deduct` | Deducts Saga Points from a member with a required reason |
| `/double saga duration_hours` | Activates Double Saga for the requested number of hours; restricted to Great Wolf and High Wolf Lord |
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

On this branch, startup initializes the configured Turso/libSQL schemas and verifies required Discord destinations. Do not run the bot against production while migration and acceptance testing are still outstanding.

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
- One to six evidence files (10 MB maximum per file).

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

- Difficulty: Substantial or Absolute.
- Gene Seed: Yes or No.
- Armoury Data: 0–3.
- Up to two additional squad members.
- One to six evidence files (10 MB maximum per file).

The submitter is automatically included. Maximum squad size is three.

### Siege

The submitter enters:

- Difficulty: Substantial or Absolute.
- A positive whole number of waves completed.
- Up to two additional squad members.
- One to six evidence files (10 MB maximum per file).

The submitter is automatically included. Maximum squad size is three. Scoring counts completed groups of five waves; incomplete groups do not add base points.

### PVP

The submitter selects:

- Game mode: Capture and Control, Seize Ground, Annihilation, or Helbrute Onslaught.
- Result: Victory or Defeat.
- Up to two additional squad members.
- One to six evidence files (10 MB maximum per file).

The submitter is automatically included. Maximum squad size is three.

### Evidence handling

For regular AAR submissions, the bot:

1. Receives one to six uploaded files (10 MB maximum per file).
2. Downloads the original files.
3. Generates an evidence collage when supported image files are present.
4. Posts a review embed in `REVIEW_CHANNEL_ID`.
5. Creates a thread under the review message for the original evidence files.
6. Adds ✅ and ❌ reactions to the review message.
7. Stores report data and evidence references in Turso/libSQL.

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

On rejection, no Saga Points are awarded. The decision is recorded.

The AAR panel's descriptive text should identify Administrators, Admins, NCOs, and AAR Moderators/High Command as the permitted reviewers.

## Saga Points

The following are the current formulas implemented in the regular AAR handlers. Points are calculated per participant and are awarded only after approval. Hunts award Saga Points using their configured challenge calculations. Unproven Trials use their separate Pack Member reward rule.

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
| Substantial | 5 |
| Absolute | 6 |

Bonuses:

- Gene Seed: +1 when Yes.
- Armoury Data: +0.5 per unit.
- Squad: +1 when the report has more than one participant.

### Siege

Base points are awarded for each completed group of five waves:

| Difficulty | Points per completed 5-wave group |
|---|---:|
| Substantial | 3 |
| Absolute | 5 |

Formula:

`floor(waves completed / 5) × difficulty points + squad bonus`

The squad bonus is +1 when the report has more than one participant. For example, 12 waves count as two completed groups of five for base scoring.

### PVP

| Result | Base points |
|---|---:|
| Victory | 3 |
| Defeat | 1 |

A +1 squad bonus applies when the report has more than one participant.

### Double Saga

The `/double saga duration_hours` command activates Double Saga for the requested number of hours. Only Great Wolf and High Wolf Lord can activate it. The event's start and expiration timestamps are stored in Turso, so it remains accurate across bot restarts and redeployments. The public activation announcement uses a Discord timestamp, which displays in each member's local timezone.

Double Saga applies to Operations, Stratagems, Siege, PVP, and Hunts. It doubles eligible base points and the Gene Seed/Armoury Data bonuses; the +1 Pack Bonus is not doubled. Trials are excluded. Eligibility is determined when the report is submitted and is saved with the submission, so a qualifying report keeps its doubled points if approval happens after the event expires.

## Hunts

Hunts are a separate challenge-completion workflow with their own review channel and reward roles. They remain separate from regular AAR submissions.

All four Hunts award Saga Points to every registered participant after approval. The usual +1 Pack Bonus applies when more than one participant is registered. Only actual challenge completers receive the challenge-specific Discord reward role.

### Configured challenges

| Hunt | Game mode | Difficulty | Reward role variable |
|---|---|---|---|
| The Siege of Fenris | Siege | Absolute | `SIEGE_OF_FENRIS_ROLE_ID` |
| The Hunt for The Wulfen | Stratagems | Absolute | `HUNT_FOR_THE_WULFEN_ROLE_ID` |
| The Shadow Wolf | Stratagems | Absolute | `SHADOW_WOLF_ROLE_ID` |
| The Battle of Maelstrom’s Maw | Stratagems | Absolute | `MAELSTROM_SURVIVOR_ROLE_ID` |

A Hunt is selectable only when its corresponding reward role is configured.

### Submission

The multi-step workflow collects challenge completers, additional Pack Members, challenge details, and evidence. The submitter is automatically included as a participant.

- The Siege of Fenris collects the number of waves completed.
- The other three Hunts collect Gene Seed (Yes/No) and Armoury Data (0–3).
- One to six evidence files are required (10 MB maximum per file).
- A squad contains between one and three unique participants. Challenge completers must be included among the participants.

### Saga Points

The Siege of Fenris uses the Absolute Siege calculation:

`floor(waves completed / 5) × 5 + Pack Bonus`

The other three Hunts use the Absolute Stratagems calculation:

`6 + Gene Seed bonus + (Armoury Data × 0.5) + Pack Bonus`

Each completed five-wave milestone awards 5 base points. Gene Seed Yes awards +1 point. Each Armoury Data awards +0.5 points. The Pack Bonus is +1 when the squad has more than one participant.

When Double Saga is active at submission time, the eligible base and resource bonus components are doubled. The Pack Bonus is not doubled. Eligibility is saved with the submission, so a Hunt submitted during Double Saga keeps its doubled points if it is approved after the event expires.

### Review and rewards

- Submissions are sent to `ORDEAL_REVIEW_CHANNEL_ID` (the dedicated `#ordeal-completion` channel).
- Reviews use ✅ to approve and ❌ to reject.
- The reviewer permission check accepts Discord Administrators, configured Admins, NCOs, and AAR Moderators/High Command.
- The submitter and registered participants cannot review their own submission.
- Suspicious participant overlap is flagged for manual attention and can generate an alert in `NCO_REVIEW_CHANNEL_ID`.
- On approval, every registered participant receives the Hunt's per-participant Saga Points; the configured reward role is granted only to the challenge completer(s).
- Approved Hunt points count toward Saga Points totals and the leaderboard.
- On rejection, no Saga Points or reward role are granted.

Gene Seed and Armoury Data recorded through approved Hunts are also included in Saga History resource totals.

## Unproven Trial system

Unproven Trials are separate from Ordeals. They track completion of three distinct Trials and handle graduation by removing the Unproven role and granting both Iron Wolves and Pack-Brother roles.

### Panel and submission

The Trial panel is published in `TRIAL_PANEL_CHANNEL_ID` by the bot's startup routine. The submission form collects:

- One or two Trial Completers.
- Trial 1, Trial 2, or Trial 3.
- One or two Pack Members.
- One to six evidence files (10 MB maximum per file).

Validation rules:

- Trial Completers and Pack Members must be different people.
- At least one Pack Member must have the configured NCO role.
- The combined squad cannot exceed three participants.
- Participants must be valid, non-bot members of the server.
- Each evidence file is limited to 10 MB by the submission handler.

The submission is sent to `TRIAL_REVIEW_CHANNEL_ID`. A collage is attached when possible, and original evidence files are stored in a thread under the review message.

### Review permissions

Trial reviews use Approve and Reject buttons. Reviewers must have at least one of:

- Discord Administrator permission.
- `ADMIN_ROLE_ID`.
- `NCO_ROLE_ID`.
- `MODERATOR_ROLE_ID`.

The review must occur in `TRIAL_REVIEW_CHANNEL_ID` and must reference the original pending review message.

Self-review is prohibited: the Trial submitter, Trial Completers, and Pack Members cannot approve or reject that same submission.

### Progression and graduation

- Each approved Trial adds progress for the selected Trial key to each Trial Completer.
- Repeated completion of the same Trial key does not add duplicate progress.
- A member graduates after completing all three distinct Trial keys.
- On graduation, the bot removes `UNPROVEN_ROLE_ID` and grants both `IRON_WOLVES_ROLE_ID` and `PACK_BROTHER_ROLE_ID`.
- The same role reconciliation runs at startup for members who had already completed all three Trials before the update.
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

Saga Points in the card reflect approved AAR, Hunt, Trial, and manual adjustment scoring. Approved Hunt Gene Seed and Armoury Data resources also contribute to their respective resource totals.

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

- Saga Points earned from approved regular AAR reports.
- Approved Hunt submissions.
- Approved Trial Pack Member points.
- Manual Saga Point adjustments.

It excludes:

- Honor awards.
- Rejected submissions.
- Trial Completer progression, which is not a Saga Points award.

The bot stores the leaderboard message ID in `bot_settings` and edits the saved message when refreshing. If the saved message cannot be reused, the bot can create a new one.

## Database and persistence

Application persistence on `migration/turso` uses the asynchronous `@libsql/client` driver and the database configured by `TURSO_DATABASE_URL`.

The database stores AAR reports, participants, score ledgers, audit records, Ordeal submissions, Trial records, Honor records, settings, Saga adjustments, and Iron Wolves tenure data. Schema initialization is handled by `core-database-schema.js` and `feature-database-schemas.js`.

Important persistence notes:

- `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` must refer to the intended database and remain secret environment values.
- Use a dedicated disposable Turso database for remote tests; never reuse it for the live bot, migration rehearsal, or restore rehearsal.
- The old `aar-database.db` file is the SQLite migration source. Never overwrite, delete, or use the production source as a rehearsal target.
- `migrate-sqlite-to-turso.js` imports from a separately copied SQLite source into an empty Turso target and verifies row counts/content digests.
- `backup-database.js` creates a logical JSON backup. `restore-database.js` restores only into a clean, correctly initialized target; it refuses to merge into populated application tables.
- Restore commits each table separately, not the entire database atomically. If a later table fails, discard/reset the disposable target before retrying; do not point Servitor at a partially restored target.
- Keep the original production SQLite database and its independent backup untouched until a separately approved cutover plan is executed.

See `TURSO_MIGRATION_NOTES.md` for the detailed rehearsal procedure, verification requirements, and outstanding launch gates.
## Testing

Available automated checks are exposed as npm scripts:

```powershell
npm.cmd run check:syntax
npm.cmd run test:libsql
npm.cmd run test:operations-modal
npm.cmd run test:turso-remote-fk
```

The remote Turso persistence suite is included in `test:libsql` when the dedicated remote test credentials are configured in CI. `test:turso-remote-fk` requires a separate empty disposable remote test database and must never be pointed at production.

These checks do not start a live Discord bot or verify server permissions, role hierarchy, channel configuration, real evidence uploads, or complete end-to-end review behaviour. Review `TURSO_MIGRATION_NOTES.md` for the latest verified CI run and remaining acceptance gates.
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

- Verify `TRIAL_REVIEW_CHANNEL_ID`, `UNPROVEN_ROLE_ID`, `IRON_WOLVES_ROLE_ID`, and `PACK_BROTHER_ROLE_ID`.
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

1. **Hunt scoring:** Approved Hunt submissions award per-participant Saga Points through `ordeal_score_ledger` and contribute to the leaderboard.
2. **Trial preview and approval:** Eligible Pack Members receive +2 Saga Points at approval, not +3. Members who still have the Unproven role at review receive zero.
3. **AAR panel description:** The AAR review permission check accepts Discord Administrators, configured Admins, NCOs, and AAR Moderators/High Command. The panel description should reflect all four accepted permission paths.
4. **No npm test script:** `test-operations-modal.js` is a standalone focused test, not a complete automated test suite.
5. **Trial self-review:** The submitter, Trial Completers, and Pack Members are prohibited from reviewing their own Trial submission.
6. **Discord-side verification:** Automated checks do not replace live testing of channel permissions, role hierarchy, evidence uploads, reactions, and review workflows.

## License

No license file was present in the inspected repository baseline. Add a license separately if you intend to distribute or open-source the project.
