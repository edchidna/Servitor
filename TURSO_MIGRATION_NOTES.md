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
