# Turso Migration Audit — Servitor

**Branch:** `migration/turso`
**Baseline:** `07fc7c9ffa97244dd71f0b909c48cc944312f1f0` (main)
**Scope:** Database driver and persistence migration only. No feature redesign.

## Safety status

- `main` remains untouched.
- This branch currently contains no application-code migration.
- The migration must not be deployed or merged until static checks, database migration checks, and user-run Discord tests pass.
- Existing data should be preserved where possible; backup is required before cutover.

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

### Important design choice still pending

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

### Current branch implementation status

- The only committed change on `migration/turso` so far is this audit document.
- No application JavaScript or package dependency has been modified yet.
- The latest audit commit is documentation-only. It is not deployable and must not be used to start the bot as a Turso build.

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


## Implementation checkpoint: async database foundation

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


### Feature schema foundation added

A third support file, `feature-database-schemas.js`, has been added. It provides explicit async initializers for Trial and Honor schemas, both using the shared interactive transaction helper.

- Trial tables and indexes are created without import-time side effects.
- Honor tables, indexes, and the legacy `icon_path` column migration are created explicitly.
- Ten default Honor rows are inserted with `INSERT OR IGNORE`, preserving existing names and order.
- The five existing built-in icon paths are still assigned at initialization, matching current behavior.
- The initializer is not yet called by runtime startup. Existing `trial-database.js`, `honor-database.js`, `trial.js`, `honor.js`, and `index.js` remain on the old synchronous SQLite path.

Latest commit:
- `63b92188cd1cd9e8e2fed4e7a10e823ac8abb613` — async Trial and Honor schema initialization.

The foundation code is not yet validated against a live/disposable Turso database. In particular, transaction-wrapped DDL, `PRAGMA table_info`, foreign-key enforcement, and repeated initialization must be exercised before runtime adoption.


## Trial persistence implementation checkpoint

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


## Implementation checkpoint: Honor and leaderboard async conversion

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


## AAR persistence module foundation

Added `aar-database-turso.js` with explicit asynchronous persistence operations for the core AAR workflow:

- Fetch reports by ID/status, review-message ID, and report category.
- Fetch report participants and moderation audit details.
- List reports whose Discord review-card update needs recovery.
- Attach a review message and evidence metadata in one guarded transaction.
- Save an AAR decision using a pending-only status guard, conditional score-ledger inserts, and audit-log insertion in one interactive transaction.
- Create a report and its participant rows atomically.
- Read an individual member's approved AAR total.

This module is currently a staged persistence layer. The corresponding `index.js` workflows have not yet been switched to it, so it must not be treated as active runtime code. The remaining AAR/Ordeal/Saga direct database operations in `index.js` still require async conversion and call-site updates.


## Implementation checkpoint: AAR review, Ordeal review, and Saga adjustment workflows

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


## Latest implementation checkpoint: Ordeal submission, tenure, Saga History, and startup

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

### Outstanding release blockers
- `@libsql/client` has not yet been installed through npm, and `package.json` / `package-lock.json` have not been updated. This environment could not reach the npm registry, so no version or lockfile was guessed or hand-written.
- No Node syntax checks, automated tests, Turso schema tests, data-transfer rehearsal, or Discord integration tests have been run.
- The migration utility must be reviewed and rehearsed against a disposable copy of the real SQLite database and a disposable Turso database before using it on production data.
- The new startup path will not run until the dependency is installed and Turso environment variables are configured.
- Keep `main` as the known-good fallback. Do not deploy or merge this branch yet.


## Follow-up hardening: backup and transfer verification

- Replaced the old SQLite-only `backup-database.js` with a Turso logical export. It exports every application table to a timestamped JSON file under `backups/`, records the format/version and timestamp, and serializes large integer values safely.
- Added `/backups/` to `.gitignore` so generated database exports are not accidentally committed.
- The logical export is a data snapshot, not a byte-for-byte Turso database image and not yet a restore command. Store copies outside the bot host as well.
- The SQLite transfer utility now holds one read transaction for a consistent source snapshot and verifies target row counts after each imported table. Honor records are checked by ID because the target schema seeds default Honor rows before import.
- Restored the legacy Trial module's strict JSON-safety validation in the async Trial persistence module. This rejects circular values, non-finite numbers, sparse arrays, symbol keys, accessors, and non-plain objects rather than silently dropping or transforming them during JSON serialization.

### Still not verified
These are code-level safeguards only. No actual Turso connection, export, import, schema migration, Node test, or Discord workflow has run yet. The package dependency and lockfile remain the first execution blocker.
