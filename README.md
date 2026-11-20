# Servitor — Turso Migration Branch

**Branch:** `migration/turso`  
**Baseline:** `07fc7c9ffa97244dd71f0b909c48cc944312f1f0` (`main`)  
**Scope:** Persistence-driver migration from synchronous SQLite access to asynchronous Turso/libSQL access. The goal is to preserve the existing Discord workflow, not redesign it.

## Safety status

- All migration work belongs on `migration/turso`.
- `main` has not been changed, merged, or deployed.
- This branch contains substantial application-code changes. It is **not production-ready** until the outstanding remote-database and Discord acceptance checks pass.
- Do not point the live Servitor bot at a migration database until cutover is explicitly approved.
- Keep an independent copy of the original `aar-database.db` until migration and recovery rehearsals are complete.

## What is implemented

- Shared asynchronous libSQL client, connection initialization, transactions, and shutdown.
- Versioned core schema plus Trial and Honor schema initialization.
- Async persistence paths for AAR reports/reviews, Ordeals, Trials, Honors, leaderboard aggregation, tenure, and Saga point adjustments.
- SQLite-to-Turso transfer utility with source integrity checks, consistent source snapshot, target-empty safeguards, per-table transactions, and row-count/content-digest verification.
- Logical JSON backup and clean-target restore utilities, including BLOB preservation and per-table restore verification.
- Local persistence tests and an Operations modal regression test.
- GitHub Actions validation workflow scoped to `migration/turso`.

## Validation status

- Earlier GitHub Actions run #68 passed the local persistence suite, syntax checks, Operations modal regression, and dependency audit on commit `4f325745323a3104604767513e3d7b479bedac86`.
- The latest documentation-only commit's CI status has not been confirmed.
- Remote Turso persistence and foreign-key tests have **not** been verified; the dedicated disposable-database secrets are not configured.
- The real production SQLite database has not yet been migrated or rehearsed against a remote Turso database.
- A live Discord test-server acceptance run remains outstanding.

## Safe migration sequence

1. Provision a **separate disposable Turso test database**. Never use the live production database for CI or rehearsals.
2. Configure GitHub repository secrets `TURSO_TEST_DATABASE_URL` and `TURSO_TEST_AUTH_TOKEN` to point only to that disposable test database.
3. Verify the remote persistence suite and foreign-key probe pass.
4. Rehearse transferring a copy of the existing SQLite database into a separate disposable Turso database. Verify the transferred tables and important records.
5. Rehearse logical backup and restore on another clean disposable target.
6. Run the Discord workflow acceptance checks: AAR submission and approval/rejection, review recovery, Ordeal role rewards without points, Trial progression/scoring, Honor award/removal, leaderboard refresh, Saga adjustments, and restart behavior.
7. Review hosting configuration, secrets, startup, and rollback procedure.
8. Cut over only after explicit approval. Keep the original SQLite database and independent backup untouched until the new deployment is proven stable.

## Important operational cautions

- The transfer and restore utilities refuse to merge into populated targets.
- Each table is committed and verified separately. If a later table fails, earlier tables may already have committed. Treat that target as partially populated: do not retry against it or run Servitor on it. Recreate/reset the disposable target to a clean schema state before retrying.
- Logical JSON backups are not byte-for-byte database images. Keep copies outside the bot host.
- Remote foreign-key behavior, remote recovery, production-data compatibility, and live Discord behavior remain unverified.

See [TURSO_MIGRATION_NOTES.md](./TURSO_MIGRATION_NOTES.md) for the detailed implementation audit, test coverage, compatibility risks, and recovery notes.
