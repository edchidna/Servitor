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