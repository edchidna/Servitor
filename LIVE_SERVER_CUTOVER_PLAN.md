# Servitor — Controlled Live-Server Cutover Plan

This plan intentionally skips a separate Discord test server. Functional validation will take place in the existing live Discord server, during a controlled cutover window.

**This document is preparation only. It does not authorize merging, stopping the current bot, changing production credentials, migrating the production database, or deploying.**

## 1. Preconditions — do not skip

- [ ] Finish the migration-branch static audit and resolve all code defects found.
- [ ] Confirm the exact hosting provider and deployment method. Keep all tokens in the host's secret/environment settings.
- [ ] Confirm the current production bot process and its restart/rollback procedure.
- [ ] Confirm the existing bot application, server ID, channel IDs, role IDs, and role hierarchy. Required IDs must resolve to the intended live resources, not merely be non-empty.
- [ ] Provision a dedicated production Turso database. Never use the CI test database or migration rehearsal database.
- [ ] Confirm Turso region, authentication token permissions, and connection settings.
- [ ] Confirm a second independent backup location outside the bot host and outside the Turso database account's single failure domain where practical.

## 2. Protect and migrate the existing production data

- [ ] Take a verified, consistent SQLite backup using SQLite's backup mechanism or a clean bot shutdown. Do not copy only the main database file while WAL writes may still be pending.
- [ ] Preserve the existing independent production backup unchanged.
- [ ] Keep the original production SQLite database untouched.
- [ ] Run the migration against a separate working copy of the SQLite backup and the dedicated production Turso target.
- [ ] Verify all expected tables, row counts, content digests, source SQLite integrity, Turso foreign-key checks, and AUTOINCREMENT high-water marks.
- [ ] Inspect key records manually: recent AARs, participants, score ledgers, Ordeal submissions, Trial progression, Honors, Saga adjustments, settings, and tenure.
- [ ] Create a logical Turso backup (format v2) and store a second copy off-host.
- [ ] Complete a restore rehearsal into a separate clean disposable Turso database before the cutover. Never restore over the production Turso database.

## 3. Prepare live Discord configuration

- [ ] Use the existing Discord bot application and token only at the approved cutover time.
- [ ] Confirm required environment variables: Discord token, Turso URL/token, AAR panel/review channels, Ordeal review channel, NCO alert channel, leaderboard channel, Trial panel/review channels, and required role IDs.
- [ ] Verify the configured channels are text-capable and the bot can view, send, attach files, read history, manage reactions/threads as needed.
- [ ] Verify the bot's highest role is above the Iron Wolves, Unproven, and configured Ordeal reward roles.
- [ ] Confirm slash-command definitions match the migration branch. Deploy commands only if required; avoid unnecessary command churn.
- [ ] Configure the host health check to use `/ready`, not only `/health`. `/health` means the process responds; `/ready` requires database initialization and Discord readiness.
- [ ] Set the host start command to `npm start`, the supported Node.js runtime to 22.x, and the platform-provided `PORT`.

## 4. Cutover sequence — one active bot instance only

1. Announce a short maintenance window to server administrators/moderators.
2. Stop the existing production bot cleanly and confirm it is offline. Do not run old and new instances simultaneously with the same Discord token.
3. Take the final consistent SQLite snapshot after the old process has stopped, so no final reports or score changes are missed.
4. Migrate that final snapshot into the dedicated production Turso database. Repeat all verification checks.
5. Create and verify a final logical Turso backup and preserve it off-host.
6. Update the host's production secrets/configuration to the Turso URL/token and the verified Discord IDs.
7. Deploy the migration branch revision that has passed CI and the final audit.
8. Start exactly one Servitor instance.
9. Wait for `/ready` to return HTTP 200 and confirm the bot appears online in Discord.
10. Keep the old SQLite database and its independent backup untouched.

## 5. Live-server validation — read-only first

- [ ] Confirm `/health` returns HTTP 200 and `/ready` returns HTTP 200.
- [ ] Confirm the existing AAR panel is present and usable; avoid posting duplicate panels.
- [ ] Confirm the Trial panel is present and reused rather than duplicated.
- [ ] Confirm the persistent leaderboard is refreshed once and shows Saga Points.
- [ ] Run read-only commands such as Saga History/leaderboard views and verify representative member records against the migrated data.
- [ ] Check bot logs for missing channel/role errors, database errors, unhandled rejections, and Discord permission failures.
- [ ] Confirm the bot reconnects and remains ready after a controlled host restart.

## 6. Carefully controlled workflow validation

Because this is the live community, do not create fake approvals, award test roles, change real member balances, or publish dummy panels casually.

- [ ] Coordinate one clearly labelled, administrator-approved validation AAR submission. Reject it after checking evidence upload, review-card display, participant handling, and review controls, so it awards no Saga Points.
- [ ] If Ordeal UI/evidence/review must be validated, use an agreed validation submission and reject it. Do not approve it or grant a challenge reward role as a test.
- [ ] Validate Trial submission/review UI with an agreed submission and reject it. Do not approve it or change Trial progression/roles as a test.
- [ ] Validate Honor and manual Saga adjustment commands by inspecting permissions and read-only history first. Any award/deduction test requires an explicitly approved member/account and a recorded compensating action; it will still leave audit history.
- [ ] Verify unauthorized users cannot access review or administrative actions.
- [ ] Verify that rejected validation submissions award zero points and do not grant roles.

## 7. Rollback triggers and response

Stop the new process and begin rollback if any of these occur:

- `/ready` does not become healthy within the agreed startup window.
- Database errors, schema mismatch, missing migrated records, or foreign-key failures appear.
- AAR/Trial/Ordeal review controls are missing or permissions are wrong.
- The bot creates duplicate panels/leaderboard messages or duplicate responses.
- Points, progression, or roles are awarded incorrectly.
- Evidence uploads or review-card recovery fail in a way that risks losing submissions.

Rollback procedure:

1. Stop the Turso-backed process.
2. Preserve its logs and a fresh logical backup for diagnosis; do not overwrite the original migration backup.
3. Restore the old host configuration and restart the original SQLite-backed bot using the untouched production database.
4. Confirm only one instance is active and the bot is healthy.
5. Reconcile any submissions made during the cutover window before reopening normal activity.

Do not point the old SQLite bot at Turso or the Turso bot at the old SQLite database as an improvised rollback.

## 8. Final approval gates

- [ ] Final code audit complete and CI green for the exact deployment commit.
- [ ] Real production SQLite snapshot migrated and independently verified.
- [ ] Remote Turso backup/restore rehearsal passed.
- [ ] Hosting provider configured and startup/readiness/shutdown verified.
- [ ] Live Discord channel/role permissions confirmed.
- [ ] Rollback operator and maintenance window agreed.
- [ ] User explicitly approves the production cutover.

Until all gates are met, keep the existing production Servitor instance and production SQLite database unchanged.
