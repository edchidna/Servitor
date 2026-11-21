# Turso Migration Audit — Servitor

**Branch:** `migration/turso`
**Baseline:** `07fc7c9ffa97244dd71f0b909c48cc944312f1f0` (main)
**Scope:** Database driver and persistence migration only. No feature redesign.

## Safety status

- `main` remains untouched; all migration work is confined to `migration/turso`.
- The migration implementation is now substantially integrated: the shared async Turso client, schemas, AAR/Ordeal/Trial/Honor/leaderboard/Saga/tenure persistence, startup wiring, transfer utility, and backup/restore utilities are present on this branch.
- This branch is **not production-ready**. Remote Turso validation, a rehearsal using a copy of the real SQLite database, remote recovery testing, and Discord test-server acceptance remain outstanding.
- Do not merge, deploy, or cut over without Ed's explicit approval. Keep the original `aar-database.db` and its independent backup untouched until migration and recovery rehearsals are complete.

> **Document status:** This file contains chronological audit notes from earlier implementation stages. Sections explicitly titled “checkpoint” or “historical” record what was true at that point in development; they are not current-state claims. The current authoritative implementation and validation summary is in the README and the latest sections of this document.

## Database usage inventory

| File | Role | Current synchronous SQLite usage |
|---|---|---|
| `database.js` | Main schema, startup schema changes, AAR/Ordeal/tenure/point-adjustment tables | `better-sqlite3`, `exec`, `pragma`, `prepare`, `run` |
| `index.js` | AAR workflow, Ordeal workflow, Saga points, tenure, review recovery, submission inserts | 58 query/transaction call sites identified by line scan |
| `trial-database.js` | Trial submission/review/progression/ledger/cleanup | 25 query/transaction call sites identified by line scan |
| `trial.js` | Discord Trial interactions and review workflow | 3 direct DB query call sites |
| `honor-database.js` | Honor schema, migration, initial records, icon assignment | startup schema + transaction usage |
| `honor.js` | Honor lookup, award/remove, layout/history | 12 query call sites |
| `leaderboard.js` | Aggregated scores, persistent message ID | 3 query call sites |

Counts above are regex inventory counts, not a final complete dependency audit.

## Important compatibility finding

The existing `better-sqlite3` API is synchronous. The Turso/libSQL client API uses promises for `execute`, `batch`, and interactive transactions. This is not a drop-in package replacement.

The migration must:
1. Convert database operations to awaited calls.
2. Convert all callers that consume those results to asynchronous functions and await them.
3. Replace synchronous transaction wrappers with supported asynchronous transaction/batch patterns.
4. Preserve transactional approval/rejection invariants, including status transition, ledger writes, audit records, and related participant records.
5. Keep the SQL compatible with Turso/libSQL and check unsupported PRAGMA/DDL behavior.
6. Make schema initialization and incremental migrations idempotent.
7. Preserve existing report/evidence data, review-message references, Trial progress, Honor history, Saga point adjustments, settings, and tenure records.

## High-risk workflows to verify

- AAR submission with participants and evidence.
- AAR approval: pending-status guard, score ledger, audit entry, review status.
- AAR rejection and review-message recovery.
- Ordeal approval/rejection and role reward, ensuring Ordeals do not add AAR points.
- Trial approval: progression, role-state tracking, pack-member awards, points ledger, audit log.
- Trial failed-submission cleanup.
- Honor award/remove and uniqueness protection.
- Leaderboard aggregation and saved Discord message ID.
- Iron Wolves tenure initialization, role changes, and member departures.
- Manual Saga point add/deduct and non-negative balance logic.

## Proposed migration sequence

1. **Finish audit:** Map every database function, return shape, call site, and transaction boundary. Record the existing database behavior.
2. **Driver/configuration:** Introduce a single async database client module and environment configuration. Keep credentials out of source control and logs.
3. **Schema/init:** Port table/index creation and schema migrations to an idempotent startup path. Avoid assuming `better-sqlite3` PRAGMA behavior carries over.
4. **Database modules:** Convert core, Trial, Honor, and leaderboard data functions into async APIs with explicit result normalization.
5. **Discord callers:** Update `index.js`, `trial.js`, and `honor.js` to await the new database APIs. Avoid unrelated refactoring.
6. **Validation:** Syntax check all files; review every changed query and transaction; test migration against a disposable copy of the current SQLite database.
7. **Discord acceptance tests:** User tests submission, approval/rejection, Trial progression, Ordeal role, Honor changes, leaderboard, and restart/recovery.
8. **Cutover only with explicit approval:** Configure Turso credentials privately, backup the live SQLite file, deploy the migration branch, monitor, and retain rollback steps.

## Environment variables (planned)

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`

The precise client configuration and transaction API must be finalized before implementation; don't assume remote transactions are interchangeable with the existing synchronous transaction callbacks.

## Additional audit findings (continued)

### Core database initialization

- The main database module performs startup DDL and data normalization synchronously before exporting the database object.
- Startup schema evolution currently depends on `PRAGMA table_info(...)`, conditional `ALTER TABLE`, WAL mode, and foreign-key PRAGMA settings. The Turso initialization path must replace this with a deliberate schema-version/migration mechanism; it must not simply copy the PRAGMA calls.
- `trial-database.js` and `honor-database.js` initialize their own tables at module load by importing the shared database object. The replacement must provide one awaited initialization promise that completes before Discord event handlers can access the database.

### Transaction boundaries confirmed

- **AAR submission:** report row and all participant rows are inserted in one transaction for each report type (Operations, Stratagems, PVP, Siege).
- **AAR review:** pending-only status update, approved score-ledger inserts, and audit-log insert are one transaction. This is a critical exactly-once boundary.
- **AAR review message association:** message ID and evidence metadata are persisted together, and the Discord message is deleted if persistence fails.
- **Ordeal review:** submission status and audit entry are committed together. On approval, Discord reward roles are assigned before the DB decision; if the DB decision fails, newly assigned roles are removed. This cross-system compensation behavior must remain.
- **Trial submission:** submission, completer rows, and pack-member rows are committed together.
- **Trial review:** pending-only status transition, progression rows, pack-member review statuses, Trial score ledger, and audit entry are committed together.
- **Trial pending deletion:** status check and deletion of dependent completer/pack-member/submission rows are committed together.
- **Manual Saga adjustment:** balance calculation and adjustment insert are currently in one transaction. Concurrency behavior must be reviewed carefully because multiple concurrent adjustments can otherwise read the same balance.

### Async call-graph consequences

- The AAR approval receipt builder currently performs synchronous score queries and is called from review and recovery paths. It must become async and all call sites must await it.
- The leaderboard score getter is synchronous today, but its caller is already async; it can be converted with limited caller impact.
- Trial database exports are synchronous and consumed throughout `trial.js`; each consumer must be traced and awaited, not only the database module converted.
- Honor database exports are synchronous and consumed from command handlers and Saga History rendering; these callers must be converted too.
- Startup event registration must be gated behind awaited DB initialization so the bot cannot process interactions while migrations are incomplete.

### Design choice settled in the implementation

Use a single shared `@libsql/client` instance. For short, fixed SQL groups, use libSQL atomic batch operations where they can faithfully express the current transaction. For conditional workflows that need results from earlier statements (e.g. reading current status and then deciding whether to write ledger entries), use an interactive write transaction with explicit commit/rollback and guaranteed close in `finally`. Do not emulate a transaction with unrelated `execute()` calls.

### Migration acceptance checks

- Compare table names, columns, indexes, row counts, and representative records between the source SQLite DB and the Turso destination before cutover.
- Confirm integer IDs and `lastInsertRowid` handling are normalized safely from libSQL result types.
- Confirm `rowsAffected`/change counts are normalized to numbers and preserve existing `changes === 1` guards.
- Test uniqueness constraints, foreign keys, and rollback behavior against a disposable Turso database.
- Keep all existing JSON evidence and report payloads intact; do not reinterpret or regenerate their contents.
### Remaining direct consumers and utility scripts

- `trial.js` directly accesses the shared database in three places (evidence persistence, tenure assignment, and review-message lookup) in addition to calling the Trial database API. These direct calls must be moved to awaited client operations too.
- `trial.js` calls Trial data methods for progress, submission creation, Discord reference persistence, pending cleanup, review, and member-join progression. Those functions currently return synchronously; each call site must await the async replacement.
- `index.js` calls Honor data methods in command handlers and Saga History rendering. All returned Honor data must be awaited before building Discord responses.
- `backup-database.js` currently uses `better-sqlite3`'s local-file backup API. That script cannot remain unchanged after the bot moves to remote Turso. A separate, tested Turso backup/export procedure is required; do not treat a local SQLite backup as a backup of the remote database.
- `package.json` currently has `better-sqlite3` as a dependency and does not include `@libsql/client`. Dependency replacement should happen only alongside the complete migration, not as a standalone package edit.

### Historical checkpoint: before application migration integration

The following bullets describe an early audit-only stage and are retained for historical context; they are superseded by the later implementation checkpoints and current status above.

- At that checkpoint, the only committed change on `migration/turso` was this audit document.
- At that checkpoint, no application JavaScript or package dependency had been modified.
- Those statements no longer describe the current branch.

### Startup and nested async dependency findings

- `index.js` imports `database.js`, `trial.js`, and `honor.js` at module load. `trial.js` imports `trial-database.js`, which imports the shared database and creates Trial tables immediately; `honor-database.js` similarly creates Honor tables and seeds/updates initial Honor records during import.
- This import-time initialization model must be removed or refactored for Turso. A safe startup entry point should explicitly await shared-client creation and all schema initialization before registering/activating Discord event handling and background work. Merely awaiting the core schema is insufficient if Trial and Honor initialization remains implicit.
- `trial.js` has synchronous database calls inside helper functions as well as command handlers. In particular, `getTrialCompleterProgress()` maps over completers and calls `getMemberTrialProgress()`; this helper must become async and await its per-member reads before the review container is built.
- Confirmed Trial call-site consequences include awaiting submission creation, progression reads, Discord-reference persistence, pending-submission cleanup, submission lookup, review decisions, reaction-review refresh reads, and member-update graduation checks. Error cleanup must await the pending-only delete operation so cleanup failures are observed rather than becoming unhandled promise rejections.
- The Trial submission path currently writes the submission before sending the Discord review message, then saves the Discord message reference. If later Discord/evidence work fails, it attempts to delete the still-pending database submission. This ordering and compensating cleanup must be retained, with awaited DB operations.
- The current Honor module performs schema creation, conditional column addition, initial Honor seeding, and icon assignment at import time. The seeding and icon updates are grouped in transactions today; the async replacement must preserve idempotency and avoid resetting user-customized Honor display names or order.
- `leaderboard.js` currently imports the database module as a synchronous object, queries scores and settings synchronously, and saves the new Discord message ID after posting. The refresh routine is already async, so its DB reads/writes can be awaited, but the saved-message behavior and recovery from a deleted Discord message must remain intact.

### Newly confirmed implementation constraints

- Do not expose a synchronous-looking compatibility facade around the Turso client. Returning promises from methods that existing callers treat as rows/arrays would create subtle runtime failures. Convert the complete call graph and make async return types explicit.
- Prefer an explicit database service API over exporting a raw client that every feature module uses directly. The service should centralize parameterized execution, result normalization, transaction lifecycle, and initialization state. This is a design direction, not an implemented change.
- For transaction callbacks that perform dependent reads and writes, each statement must execute through the same interactive transaction object. The transaction must be committed only after all guards and writes succeed, rolled back on error, and closed in a `finally` path.
- Manual Saga point adjustments need special concurrency review. A transaction alone does not necessarily prevent two simultaneous deductions from both reading the same starting balance; the eventual implementation should serialize/guard the balance update or use an atomic database-side calculation so deductions cannot exceed the available balance.
- No application code or dependency changes have been made as part of these additional findings. The branch remains an audit-only, non-deployable branch.


### Final direct-call inventory pass

A fresh line-by-line scan of the current branch found the following direct synchronous DB entry points. This is a more actionable inventory than the earlier approximate regex totals; it still needs a final review after implementation because moving calls into service methods will change the counts.

- `index.js` (6,789 lines): direct database operations at lines 782, 890, 914, 942, 1750, 1825, 1873, 1883, 1927, 1976, 1991, 2116–2117, 2211, 2310, 2330, 2394–2440, 2515, 2580, 2806, 2901, 3082–3102, 3157–3177, 3446–3500, 4064, 4103, 4144, 4181, 5240, 5381–5383, 5511, 5559, 5609, 5761, 5847, and four report/participant submission transaction blocks around 6042, 6249, 6427, and 6636. Honor API consumers are additionally present around lines 3313, 3686–3951, and 4210.
- `trial.js` (1,506 lines): Trial API consumers around lines 620, 732, 811, 905, 983, 1034, 1417, and 1456. Direct shared-database operations occur around lines 856, 1113, and 1362. The progress helper at line 620 is synchronous today and must be converted before any promise-valued progress can reach the review UI.
- `honor.js` (268 lines): synchronous data access exists in every exported read/write workflow: list/get, member awards, award/remove, history, rename, layout read/write, and display-layout composition. The display-layout function performs multiple dependent reads and therefore must await both stages.
- `trial-database.js`: schema creation at module load plus the submission, retrieval, progress, review, Discord-reference, and pending-cleanup methods. Review and cleanup contain multi-statement transactions.
- `honor-database.js`: schema and seed initialization at module load, a PRAGMA-based column migration, and two transactions (seed defaults and assign built-in icon paths).
- `leaderboard.js`: aggregate-score read, saved-message lookup, and saved-message ID upsert are synchronous today; `refreshLeaderboard()` is already asynchronous and can await these operations.
- `backup-database.js`: local SQLite backup utility is separate from runtime DB access and needs a new remote backup/export workflow for Turso.

### Important data-integrity note: Honor initialization

The Honor initialization transaction seeds ten default Honor rows with `INSERT OR IGNORE`, then assigns five built-in icon paths. Preserve the existing row values and the uniqueness of `display_order`; migration must not re-seed over customized Honor names/order or overwrite unrelated icon choices. The existing icon update behavior should be reviewed against the current database before porting because it updates the five configured Honor IDs every startup.

### Current implementation checkpoint

- Latest audit-only commit: `549f0631736b47c015136fa2830a3079389f7d13`.
- No JavaScript source, package manifest, lockfile, database file, or deployment configuration has been changed.
- The Turso branch remains intentionally non-deployable until the async service, schema migration, caller conversion, data transfer, and validation work are complete.


## Historical implementation checkpoint: async database foundation

The first two application-support files have now been added to `migration/turso`:

- `turso-database.js`
  - Creates one shared `@libsql/client` client from `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.
  - Requires callers to await initialization before database access.
  - Exposes parameterized `execute`, fixed `batch`, and interactive `withTransaction` helpers.
  - Ensures dependent statements inside a transaction use the same transaction object, commits only after the callback succeeds, rolls back on failure, and closes the transaction.
  - Does not log connection URLs or tokens.
  - Supports a local `file:` URL for isolated development; remote connections require an auth token.
- `core-database-schema.js`
  - Adds versioned, asynchronous initialization for the core AAR, Ordeal, tenure, Ordeal ledger, and manual Saga adjustment tables.
  - Preserves the legacy missing-column upgrades and the legacy Ordeal default normalization.
  - Creates the indexes and constraints present in the current SQLite schema.
  - Records migration version 1 only after the schema transaction completes.

These files are foundation components only. Existing runtime modules still import and use `better-sqlite3`; they have not yet been switched over. `package.json` and `package-lock.json` remain unchanged, and the new files have not yet been runtime-tested against a real Turso database. The branch remains non-deployable.

### Validation still required for this foundation

- Install the pinned `@libsql/client` dependency and update the lockfile using npm, rather than hand-editing dependency resolution.
- Verify the installed version's `createClient`, `execute`, `batch`, interactive transaction, `commit`, `rollback`, and `close` behavior against its actual package types.
- Verify remote Turso support for the schema transaction, `PRAGMA table_info`, partial indexes, `AUTOINCREMENT`, and foreign-key enforcement.
- Run the schema twice against an empty disposable database and once against a legacy-shaped database to prove idempotency and compatibility.
- Add feature-schema initialization for Trial and Honor, then explicitly wire startup to await all schemas before enabling Discord event handlers.

Latest foundation commits:
- `25cd23ba3c2fe8e6fcd89a601ca8862fada4f97a` — shared async Turso database foundation.
- `a14f41cafd0973c27af5504d442d24ba188ddcd7` — versioned core schema initializer.
- `3b6772d4ce67c57aa3408ef6b77fb26f6e4b016d` — hardened rollback-error handling.


### Historical checkpoint: feature schema foundation added

A third support file, `feature-database-schemas.js`, has been added. It provides explicit async initializers for Trial and Honor schemas, both using the shared interactive transaction helper.

- Trial tables and indexes are created without import-time side effects.
- Honor tables, indexes, and the legacy `icon_path` column migration are created explicitly.
- Ten default Honor rows are inserted with `INSERT OR IGNORE`, preserving existing names and order.
- The five existing built-in icon paths are still assigned at initialization, matching current behavior.
- The initializer is not yet called by runtime startup. Existing `trial-database.js`, `honor-database.js`, `trial.js`, `honor.js`, and `index.js` remain on the old synchronous SQLite path.

Latest commit:
- `63b92188cd1cd9e8e2fed4e7a10e823ac8abb613` — async Trial and Honor schema initialization.

The foundation code is not yet validated against a live/disposable Turso database. In particular, transaction-wrapped DDL, `PRAGMA table_info`, foreign-key enforcement, and repeated initialization must be exercised before runtime adoption.


## Historical checkpoint: Trial persistence implementation

Two Trial runtime files have now been added/updated on the migration branch:

- Added `trial-database-turso.js` with asynchronous implementations for:
  - submission creation, including atomic insertion of the submission, completers, and Pack Members;
  - submission retrieval and JSON evidence parsing;
  - member progression reads;
  - pending-only review with progression awards, Pack Member role checks, Trial score ledger entries, and audit log in one transaction;
  - Discord review/evidence reference persistence;
  - safe deletion of failed pending submissions and dependent rows.
- Updated `trial.js` to await those operations, await completer progression reads, and replace its direct Trial evidence/tenure/reaction lookup SQLite queries with the shared Turso query helper.

The review transaction deliberately performs its dependent SQL operations sequentially on the same transaction handle. A review still uses the pending-status guard and requires the update to affect exactly one row before awards and audit data are written.

### Important integration warning

This is not yet a runnable migration or deployable bot state. The rest of the application still imports the synchronous SQLite `database.js`; startup has not yet been changed to initialize Turso and all schemas. `package.json` and the lockfile still do not install `@libsql/client`. The new Trial module is therefore a staged migration target, not a working standalone runtime yet.

The new Trial implementation also needs a careful parity review against the old validator behavior and tests against a disposable Turso database. Do not deploy this branch at this stage.

Latest Trial commits:
- `744942c9c145758e230624290369ca6a0e6c427b` — async Trial persistence module.
- `0a726cb5b0f3b0f13d008dac243102d3614afb11` — async Trial Discord workflow callers.
- `dec43d37e3a7e2700518e1502904b61d0299d3ba` — serialize dependent reads inside Trial review transaction.


## Historical checkpoint: Honor and leaderboard async conversion

The migration branch now includes the following additional changes:

- Replaced synchronous Honor persistence calls in `honor.js` with awaited calls through the shared Turso service.
- Converted Honor award and removal to interactive transactions so the existence checks and writes use one transaction. The existing partial unique index remains the final duplicate-award guard.
- Converted Honor rename and display-layout composition to async workflows. Display-layout reads use one read transaction for a consistent settings/awards view.
- Updated the Honor command/autocomplete and Saga History call sites in `index.js` to await their asynchronous results.
- Converted leaderboard score aggregation, saved-message lookup, and message-ID persistence to asynchronous Turso queries. The existing Discord message update/recreate behavior remains.
- Reused the existing `feature-database-schemas.js` Honor initializer rather than keeping a duplicate schema module.

### Current integration warning

The runtime startup path has not yet been switched to Turso. `index.js` still imports the legacy synchronous `database.js`, and the Trial/Honor schema initializers are not yet wired into startup. The branch is still intentionally non-deployable. `package.json` and its lockfile still need the actual `@libsql/client` dependency installation. No live Turso or Discord test has been run.

### Review items for this checkpoint

- Verify all Honor call sites (including autocomplete and Saga History rendering) are awaited.
- Confirm the interaction handler remains async at each converted call site.
- Compare the async Honor schema and SQL behavior against the legacy schema, especially partial unique index behavior and `PRAGMA table_info` support.
- Test concurrent duplicate Honor awards against a disposable Turso database.
- Verify the leaderboard's union query against the final core and Trial schema.


## Historical checkpoint: AAR persistence module foundation

Added `aar-database-turso.js` with explicit asynchronous persistence operations for the core AAR workflow:

- Fetch reports by ID/status, review-message ID, and report category.
- Fetch report participants and moderation audit details.
- List reports whose Discord review-card update needs recovery.
- Attach a review message and evidence metadata in one guarded transaction.
- Save an AAR decision using a pending-only status guard, conditional score-ledger inserts, and audit-log insertion in one interactive transaction.
- Create a report and its participant rows atomically.
- Read an individual member's approved AAR total.

This module is currently a staged persistence layer. The corresponding `index.js` workflows have not yet been switched to it, so it must not be treated as active runtime code. The remaining AAR/Ordeal/Saga direct database operations in `index.js` still require async conversion and call-site updates.


## Historical checkpoint: AAR review, Ordeal review, and Saga adjustment workflows

Additional async persistence work has now been connected to `index.js`:

### AAR
- Operations, Stratagems, PVP, and Siege submissions now create their report and participant rows through `aar-database-turso.js` in one awaited transaction.
- AAR review-message lookup, pending report lookup, participant lookup, evidence/review-message association, recovery queue reads, audit lookup, and recovery-marker clearing now use the async AAR persistence module.
- AAR approval/rejection now uses a pending-only transactional status update, approved score-ledger inserts, and moderation audit insert.
- Approval receipt builders now await each member's approved AAR total.

### Ordeals
- Added `ordeal-database-turso.js`.
- Ordeal review-message lookup and submission lookup now use async persistence.
- Approval and rejection decisions now share one pending-only transaction that updates the submission and inserts its audit row.
- The existing Discord role assignment compensation remains in the workflow: newly assigned roles are removed if the database decision fails.

### Saga
- Added `saga-database-turso.js`.
- Manual Saga point adjustments now calculate the balance and insert the adjustment inside one async transaction, instead of relying on synchronous SQLite APIs.

### Remaining work and cautions
- Several direct synchronous SQLite operations remain in `index.js`, including tenure tracking, Saga profile/history reads, Ordeal submission creation/evidence/alert updates, and the old database initialization/runtime path.
- The AAR/Ordeal/Saga modules are staged and not yet the sole persistence layer.
- The main startup path still imports legacy `database.js`; it has not yet been safely switched to Turso.
- `@libsql/client` is not yet installed through the project's package manager, and no Node syntax, unit, integration, Turso, or Discord runtime tests have been run in this environment.
- Treat all new SQL/transaction paths as implementation candidates until they have been verified against a disposable Turso database and the legacy SQLite schema/behavior.


## Historical checkpoint: Ordeal submission, tenure, Saga History, and startup

This checkpoint supersedes earlier notes that said these workflows and startup were still on SQLite.

### Newly connected workflows
- Ordeal previous-submission duplicate/suspicion checks now use async Turso reads.
- Ordeal submission creation is transactional and includes challenge details, participants, completers, and suspicious-submission metadata.
- Ordeal review-message ID and evidence metadata are saved through guarded async updates.
- NCO alert-message lookup and ID persistence are asynchronous.
- Failed incomplete Ordeal submissions are removed through a pending-only cleanup operation.
- Iron Wolves tenure initialization, role-change updates, member-leave cleanup, and Saga History tenure lookup now use async Turso persistence.
- Saga History point totals, approved AAR report reads, and approved Ordeal reads now use async Turso queries.
- The remaining direct `db.prepare()` and `db.transaction()` calls were removed from `index.js`; its legacy `database.js` import was removed.

### Runtime startup wiring
- `index.js` now initializes the shared Turso connection, core schema, Trial schema, and Honor schema before logging the Discord client in.
- Database initialization enables and verifies foreign-key enforcement on the shared connection.
- The shared `execute()` API now accepts both SQL strings and libSQL statement objects, matching the call forms used by the migrated persistence modules.

### Legacy data transfer
- Added `migrate-sqlite-to-turso.js` as a one-time transfer utility for the existing `aar-database.db`.
- It initializes the target schemas, copies the known application tables in parent-before-child order, preserves explicit IDs, and imports legacy Honor definitions over the schema's seeded defaults.
- It refuses to merge into non-empty target tables (apart from the seeded Honor rows) to avoid silently duplicating reports or points. Each table import is transactional. If a later table fails after earlier tables committed, reset the disposable target database before retrying.
- Take an independent copy of the SQLite database before running this utility. Verify source/target row counts and key records before switching production traffic.

### Current release blockers

- A disposable remote Turso database has not yet been connected to the test workflow. The optional remote test steps are skipped because `TURSO_TEST_DATABASE_URL` and `TURSO_TEST_AUTH_TOKEN` are not configured.
- The real SQLite database has not yet been copied to a disposable target and rehearsed end-to-end. The transfer utility now preflights target emptiness and schema columns, and verifies row content digests, but actual historical data has not been exercised.
- The logical JSON backup now has a verified local restore utility and a passing local round-trip test. A real remote Turso recovery rehearsal and off-host backup retrieval have not yet been performed.
- Discord end-to-end acceptance testing has not been run. Existing submission, review, scoring, role, and notification behavior must be verified on a test server.
- The final hosting environment has not been validated.
- `main` remains the production SQLite baseline. Do not merge or deploy this branch until the blockers above are resolved.

## Follow-up hardening: backup and transfer verification

- Replaced the old SQLite-only `backup-database.js` with a Turso logical export. It exports every application table to a timestamped JSON file under `backups/`, records the format/version and timestamp, and serializes large integer values safely.
- Added `/backups/` to `.gitignore` so generated database exports are not accidentally committed.
- The logical export is a data snapshot, not a byte-for-byte Turso database image and not yet a restore command. Store copies outside the bot host as well.
- The SQLite transfer utility now holds one read transaction for a consistent source snapshot and verifies target row counts after each imported table. Honor records are checked by ID because the target schema seeds default Honor rows before import.
- Restored the legacy Trial module's strict JSON-safety validation in the async Trial persistence module. This rejects circular values, non-finite numbers, sparse arrays, symbol keys, accessors, and non-plain objects rather than silently dropping or transforming them during JSON serialization.

### Still not verified

- Remote Turso connection behavior, including foreign-key enforcement on the actual database type.
- Full SQLite-to-Turso transfer using a fresh copy of the actual production database.
- Backup recovery/restore and an operational rollback rehearsal.
- Discord permissions, channels, evidence uploads, review actions, role assignment, leaderboard refresh, and other end-to-end workflows.
- Hosting-provider startup, shutdown, reconnect, and runtime compatibility.

The local automated suite is now running successfully; it is not a substitute for these remote and production-like rehearsals.

## Operational handoff updates

- Added npm scripts: `npm run backup` for the Turso logical JSON export and `npm run migrate:sqlite-to-turso` for the one-time SQLite transfer utility.
- Updated the README to clearly state that `main` remains the SQLite production baseline and `migration/turso` is not deployable yet.
- The transfer utility now checks SQLite `integrity_check`, requires every expected application table to exist, holds one source read snapshot, imports each table transactionally, and verifies imported row counts (or Honor IDs) before proceeding.
- The backup reads all tables inside one read transaction, so the export represents a consistent snapshot rather than a sequence of independently timed table reads. A matching `restore-database.js` now restores into a clean target only, validates backup format/schema version/table inventory, preserves the seeded Honor records through upsert, and verifies every restored table by row count and content digest. The end-to-end local test now exercises SQLite migration, JSON backup, and restore to a second database.

The branch has not been merged, deployed, or tested against a live Turso database.



## Current CI, dependency, and test status

- `@libsql/client` is pinned to `0.18.0` in both `package.json` and `package-lock.json`.
- GitHub Actions uses Node 22 and runs normal `npm ci` (install scripts are not disabled), `npm run check:syntax`, and `npm run test:libsql`.
- Syntax validation covers root-level JavaScript files and JavaScript test files.
- The local persistence suite contains 15 tests covering SQLite-to-libSQL transfer, refusal of populated targets, core/feature schema setup, foreign keys, AAR atomicity and review, rollback, Trial progression/scoring, Ordeal's zero-point/audit behavior, Honor award lifecycle, Saga point adjustments, content-digest verification, logical backup/restore round-trip verification, and database shutdown draining. CI also runs the Operations modal workflow regression test.
- If dedicated remote-test secrets are configured, CI also runs the full 15-test persistence suite against an empty disposable remote Turso database and the isolated foreign-key probe. The suite drops only the tables it creates.
- Latest verified CI run: GitHub Actions run #93 on commit `e233f62a3685bc2016e583a66481b0f76b67fcce`. Dependency installation, syntax validation, all 15 local persistence tests, and the Operations modal regression test passed. The remote Turso persistence suite and foreign-key probe were skipped because `TURSO_TEST_DATABASE_URL` and `TURSO_TEST_AUTH_TOKEN` are not configured. This validates the local test environment only, not remote Turso behavior.

## Foreign-key compatibility risk

- The client documentation says standalone `client.execute()` calls use independent logical database connections; Turso documents foreign-key enforcement as off by default.
- The startup PRAGMA check and local-file test do not prove that remote Turso enforces foreign keys on every standalone and transactional operation.
- Added `test/turso-remote-foreign-key-smoke.js` and `npm run test:turso-remote-fk`. The probe creates uniquely named temporary parent/child tables in a dedicated remote test database, checks PRAGMA state across statements and a transaction, and verifies orphan inserts are rejected.
- The full 15-test persistence suite also runs remotely when the dedicated secrets are present.
- Remote tests are currently skipped because the required test-database secrets are absent. Treat remote foreign-key behavior as unverified and a production blocker.

## Legacy schema inventory and compatibility

- All 19 legacy application tables declared in `database.js`, `trial-database.js`, and `honor-database.js` are represented in the SQLite transfer utility.
- Static comparison found no differences across the 19 tables in column names, declared types, NOT NULL, PRIMARY KEY, UNIQUE, or DEFAULT declarations.
- The migrated target additionally has the `servitor_schema_migrations` metadata table.
- This static check does not replace inspecting the actual production SQLite file or verifying its data.

## Transfer utility safeguards

- Before importing, the transfer utility verifies SQLite `integrity_check` and `foreign_key_check`, requires all expected legacy tables, validates the ten permanent Honor IDs and untouched target Honor seeds, checks target table emptiness, compares source/target column names, and requires primary keys for deterministic verification.
- Each table import is transactional. A failure after earlier tables committed requires resetting the disposable target before retrying.
- After each table import, source and target rows are ordered by primary key and compared using SHA-256 digests. The comparison normalizes numeric, text, NULL, and BLOB values.
- This has been tested with a local SQLite/libSQL fixture, but not yet against the actual production database copy.

## Native dependency and workflow permissions

- CI uses ordinary `npm ci`, so native dependency installation is exercised on the Ubuntu/Node 22 runner. It also runs the Operations modal regression test against the async AAR persistence path. Host-specific compatibility remains unverified.
- The migration validation workflow has only `contents: read` permission. It does not commit files, write to branches, or deploy.
- The workflow is scoped to `migration/turso`; `main` remains untouched.

## SQLite transfer content verification

- The migration utility verifies source and target column names, row counts, and SHA-256 digests for all transferred rows, ordered by primary key.
- Digest normalization handles SQLite/libSQL integer, numeric, text, NULL, and BLOB representations (including Buffer, typed-array views, and ArrayBuffer).
- Honor rows receive the same full-content verification after reconciling the target's ten seeded Honor records.
- A local regression test confirms matching SQLite/libSQL scalar and BLOB values verify successfully and a changed target value is detected. The end-to-end migration test also exercises the transfer utility against a populated SQLite fixture based on the legacy schema definitions, including representative records in all 19 tables.
- GitHub Actions run #36 passed on commit `61aecf40712ae9b8f053a8842db66b703aa50131`: normal `npm ci`, syntax validation, and all ten local persistence tests passed (10 passed, 0 failed; dependency audit reported 0 vulnerabilities).
- The later documentation-only run #33 is tracked separately. Remote Turso tests were skipped because the dedicated test-database secrets are not configured.


## Discord workflow preservation checks

- `deploy-commands.js` is byte-for-byte unchanged from `main`; the slash-command definitions were not modified in this migration branch.
- A static comparison found all 22 interaction custom IDs in `index.js` unchanged from `main`.
- The Operations modal regression test now runs in CI and verifies field order/constraints, difficulty values and selection flow, squad size/participant rules, and that the modal still calls the async AAR persistence and existing evidence/review-message path.
- These checks support the requirement to preserve the established Servitor workflow, but do not replace a live Discord test server acceptance run.


- CI remote-test secret handling was hardened by moving the two dedicated Turso test secrets to job-level environment scope, so the step conditions can actually evaluate whether remote verification should run. The test suite still refuses any non-empty remote database before making schema changes.


## Restore failure and retry safety audit (2026-11-21)

- The restore utility preflights the complete expected table inventory, schema version, target table emptiness, seeded Honor state, and per-table column names before inserting backup rows.
- Restore writes each table in its own transaction and verifies that table immediately after the write. This prevents a failed table transaction from leaving a partially written version of that table.
- **Important operational limitation:** the restore is not one transaction spanning the entire database. If a later table fails after earlier tables have committed, the target can contain a partially restored dataset. Do not retry against that target and do not point Servitor at it. Destroy/recreate or otherwise reset the disposable target to the clean schema state, then retry the restore from the same verified backup.
- A successful restore must reach the final `Servitor logical backup restore completed and verified.` message, with every expected table reporting its restored and verified row count. A process exit or error before that point is a failed restore, even if some earlier tables were restored successfully.
- This is a logical JSON restore, not a byte-for-byte database image. Keep the original SQLite backup and the logical backup off-host until remote recovery rehearsal is complete.
- Remote recovery remains unverified until the same procedure passes against a separate disposable remote Turso database.



## Hosting runtime audit (2026-11-21)

A static review of the current startup/runtime code found two hosting-readiness items that need to be resolved before deployment:

- `keep_alive.js` starts an HTTP server on a hard-coded port `8080`. It does not read the hosting platform's injected `PORT` environment variable. Whether this works depends on the selected host's port configuration; it should be made configurable and tested against the chosen provider.
- `index.js` does not register `SIGINT` or `SIGTERM` shutdown handlers. It closes the Turso client when startup fails, but a normal host stop does not currently explicitly destroy the Discord client and close the database through an application shutdown path. The two recurring `setInterval` jobs are also not retained for cleanup.

These are static findings, not observed runtime failures. Before choosing or configuring a host, add and test a graceful shutdown path, make the health-check listener use the provider's expected port, and verify restart/reconnect behavior. Do not assume the existing HTTP keep-alive endpoint alone makes the bot production-ready.


## Hosting runtime follow-up (2026-11-21)

The initial static hosting findings have now been addressed on `migration/turso`:

- `keep_alive.js` now listens on the hosting-provided `PORT` value, falling back to `8080` for local use, validates the port, and exports the HTTP server for orderly closure.
- The AAR recovery and Veteran promotion intervals are retained so they can be cleared during shutdown.
- `SIGINT` and `SIGTERM` now trigger a single guarded shutdown sequence that stops recurring jobs, destroys the Discord client, closes the Turso client, and closes the health-check server.
- Startup failure now also attempts to destroy the Discord client and close both database and health-check resources.

This is a source-level implementation only. It has not yet been exercised on the selected hosting provider or in a live Discord runtime. Provider-specific port binding, termination grace periods, and restart behavior still require a deployment rehearsal on a non-production test instance.


## Database shutdown drain hardening (2026-11-21)

- Shared database operations through `execute`, `batch`, and `withTransaction` are now tracked while in flight.
- `closeDatabase()` blocks new tracked operations, waits for active tracked operations to finish, and only then closes the shared libSQL client.
- Added a regression test that holds a transaction open, starts shutdown, verifies shutdown remains pending, releases the transaction, and confirms shutdown completes.
- The backup, restore, and one-time transfer scripts also use the raw client directly, but they are standalone maintenance commands rather than Servitor's Discord runtime. They should be run to completion and not terminated mid-operation.
- This is a code-level safeguard; the updated test suite still needs a successful CI run on the latest branch head, and host-level termination behavior still needs a non-production runtime rehearsal.

## Hosting readiness follow-up (2026-11-21)

The earlier hosting-runtime findings above are historical. The current branch now includes these changes:

- The health server reads the provider-injected `PORT` value, with `8080` as the local fallback.
- `/` and `/health` return HTTP 200 while the process is alive.
- `/ready` returns HTTP 200 only when the database schemas have initialized and the Discord client reports ready. It returns HTTP 503 before readiness, during a Discord reconnect, if the readiness check errors, and once shutdown begins.
- SIGINT/SIGTERM handling stops recurring jobs, destroys the Discord client, drains/closes the database, and closes the health server.
- Added an automated HTTP test covering liveness, readiness, an exception in the readiness callback, and unknown routes.

These are code-level changes and a test has been added; the latest GitHub Actions result has not yet been verified. They do not constitute a host runtime test.

**Still blocking host setup / Discord acceptance:** validate the current commit in CI; configure and run remote Turso persistence tests against a dedicated empty disposable database; rehearse SQLite migration, Turso backup, restore, and rollback using disposable copies/targets; then configure the selected host and run the full Discord test-server acceptance checklist. The original production SQLite database and its independent backup remain untouched. Do not merge, deploy, or cut over without explicit approval.

## CI recheck after test-secret configuration (2026-11-21)

- The repository Actions secrets are intended to be named exactly `TURSO_TEST_DATABASE_URL` and `TURSO_TEST_AUTH_TOKEN`, and must point to the same dedicated, empty, disposable Turso test database.
- The workflow runs automatically on pushes to `migration/turso`. Its manual-dispatch control may not be shown while the workflow file exists only on this non-default branch; do not add the workflow to `main` just to expose that control.
- A fresh branch push is being used to trigger validation after the secrets were configured. Check the resulting Actions run to confirm whether both remote steps execute; a successful workflow with those steps skipped is not remote validation.
- This CI trigger does not authorize or perform a merge, deployment, production cutover, or access to the production SQLite database.


## Remote Turso CI validation passed (2026-11-21)

- Workflow run #100 on commit `a85486e2362b800a1cbb53be8cb1ca3c9cc84bbd` completed successfully after the disposable test database token was replaced with a read-write token.
- Dependency installation, JavaScript syntax, local libSQL tests, and the Operations modal regression passed.
- The full persistence suite also passed against the configured disposable remote Turso database: 15 tests passed, 0 failed.
- The separate remote foreign-key enforcement probe passed.
- The remote smoke suite checks that its database is empty before creating its test schema and drops its owned test tables during teardown. Keep this database dedicated to CI smoke tests.
- The passing CI suite is not a rehearsal using a copy of the real `aar-database.db`. The transfer and logical backup/restore rehearsal currently covered by automated tests uses synthetic legacy SQLite data and local libSQL file targets.
- Still outstanding: rehearse migration using a disposable copy of the actual SQLite database, rehearse a remote Turso logical backup and restore into a second clean disposable Turso database, complete Discord test-server acceptance, and test startup/shutdown on the chosen host.
- No production database or its independent backup has been accessed or modified. No merge, deployment, or production cutover has occurred.


## CI concurrency correction and confirmation (2026-11-21)

- The push and pull-request triggers can both run for the same branch update. Because the remote smoke suite deliberately creates and drops tables in its dedicated database, concurrent workflow runs against the same test database are unsafe.
- Two overlapping attempts showed test-state interference (duplicate Trial/Honor data and a missing temporary probe table). This was not treated as a product persistence pass.
- Added a workflow-wide GitHub Actions concurrency group with `cancel-in-progress: false`, so remote validation runs are serialized.
- Confirmed the correction on the latest workflow commit `5308b46321f5fd18bfd3d3372c5a4a3293f8236a`: push run #105 and the queued pull-request run #106 both completed successfully. Each passed dependency installation, syntax checks, local tests, the Operations modal regression, all 15 remote persistence tests, and the remote foreign-key probe.
- The CI test database is now reserved for serialized smoke-test runs only. Do not reuse it as a migration or restore target.

The successful CI runs establish remote persistence behavior for the synthetic smoke-test cases. They do not replace the remaining real-database migration rehearsal, remote backup/restore rehearsal, Discord test-server acceptance, or non-production hosting rehearsal.

## Runtime code audit hardening (2026-11-21)

The continued static audit found and corrected the following issues on `migration/turso`:

- Fixed the `/sagapoint` DM guard so it sends an initial ephemeral reply instead of editing a response that does not exist.
- Added a Trial review self-review restriction covering the submitter, Trial Completers, and Pack Members.
- Corrected leaderboard row separators so entries render on separate lines.
- Restricted automatic Veteran promotion to members who have the configured Iron Wolves role.
- Moved Trial and Ordeal submission acknowledgements ahead of network/database work, and moved Trial review acknowledgement ahead of reviewer/member and submission lookups.
- Moved the AAR panel command acknowledgement ahead of its channel fetch and message send.
- Added startup validation for required runtime destinations and the Discord token so missing configuration fails before the bot appears online.
- Rejected bot accounts in AAR and Ordeal squads.
- Added expiration for abandoned multi-step Ordeal workflows.
- Changed AAR evidence gallery extraction to use the fetched review message rather than the original send response.
- Corrected failed AAR submission cleanup to delete participant rows before the parent report, respecting enforced foreign keys.
- Preserved existing Iron Wolves tenure timestamps during startup initialization and role-add handling instead of overwriting them.

### Latest automated validation

- GitHub Actions run #158 on commit `efa6da86ad8bf20f591a38f26655fc95384443a3` completed successfully.
- Dependency installation, JavaScript syntax checks, local libSQL tests, and the Operations modal regression test passed.
- The full persistence suite passed against the dedicated disposable remote Turso database.
- The remote foreign-key enforcement probe passed.
- This CI result validates the tested persistence and static workflow paths; it does not prove live Discord behavior, real-database migration, remote backup/restore recovery, or hosting-provider runtime behavior.

### Remaining acceptance gates

- Complete a migration rehearsal using a disposable copy of the actual SQLite database.
- Complete a remote Turso logical backup and restore rehearsal into a separate clean disposable database.
- Complete Discord test-server acceptance for AAR, Ordeal, Trial, Honors, Saga adjustments, leaderboard, role changes, evidence uploads, and restart/recovery.
- Complete a non-production hosting rehearsal for startup, readiness, shutdown, and restart behavior.

The branch remains unmerged and undeployed. The production SQLite database and its independent backup remain untouched. Do not merge, deploy, or cut over without Ed's explicit approval.

## Follow-up recovery and leaderboard audit (2026-11-21)

A further pass focused on partial Discord submissions, review recovery, and concurrent leaderboard updates:

- Trial submission cleanup now checks whether the database row is still pending and removes it before deleting the Discord review card. If a moderator already finalized the submission, the card is retained and the NCO channel is alerted instead of deleting a completed review.
- Ordeal partial-message cleanup now searches Components V2 text-display content rather than legacy embeds, so a message created just before a Discord send timeout can be found.
- Ordeal submission cleanup failures, post-decision review-card update failures, and failed reward-role rollback operations now generate NCO discrepancy alerts.
- Migration row digests now use an actual newline byte as the row separator, avoiding ambiguous concatenation of JSON-serialized rows.
- Temporary AAR evidence debug logs that included signed attachment URLs and user-provided filenames have been removed.
- The bot now refreshes the persistent leaderboard on startup. Concurrent refresh requests are queued so simultaneous approvals cannot create duplicate leaderboard messages or leave a newer score snapshot unapplied.
- The leaderboard title/footer now identify the combined total as Saga Points rather than an AAR-only score.

### Latest validation after recovery changes

- GitHub Actions run #192 on commit `b86d156701c0704df2c77390f0d41a5351a98109` completed successfully.
- Dependency installation, syntax validation, local libSQL tests, the Operations modal regression, all 15 remote Turso persistence tests, and the remote foreign-key probe passed.
- The subsequent leaderboard wording change is text-only; no production or remote database was accessed.

The same launch gates remain: real SQLite-copy migration rehearsal, remote backup/restore rehearsal, Discord test-server acceptance, and non-production hosting rehearsal. No merge, deployment, or production cutover has occurred.

## Evidence handling hardening (2026-11-21)

- Standardized AAR, Ordeal, and Trial evidence uploads to a maximum of six files, 10 MB per file.
- Added a 30-second download timeout, Discord content-length checks, and post-download buffer-size checks.
- Updated modal descriptions and README guidance to disclose the 10 MB per-file limit.
- Sanitized and uniquified Ordeal attachment filenames using the same safe naming logic as AAR evidence.

### Validation

- GitHub Actions run #206 on commit `eab6fc75a4a2dd5c9433d36e2ef0856aea5b30bb` completed successfully.
- Dependency installation, JavaScript syntax checks, local libSQL tests, the Operations modal regression, all 15 remote Turso persistence tests, and the remote foreign-key probe passed.
