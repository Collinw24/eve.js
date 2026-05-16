# macOS Support Goal

Last updated: 2026-05-16

## Objective

Bring the native macOS side of this repo up to the same practical standard as the existing Windows-oriented workflow: a Mac user should be able to clone the fork, prepare an isolated local EVE client, start the server, and launch into eve.js with clear commands, clean repo state, and actionable troubleshooting.

## Current Baseline

Status: working prototype, not fully productized.

The native macOS client has launched successfully against the local server. Character creation, character selection, station entry, fitting parity, and implant injection work have all been proven and pushed on `collinw24/native-mac-client`.

Known rough edges remain:

- Running local server setup can dirty tracked generated gateway certificate files.
- The launcher-session capture step is still manual.
- Public-gateway gRPC trust failures are still noisy and not fully solved.
- Market daemon setup is optional and not yet seamless.
- Public docs need to be written from the supported workflow, not from private research notes.

## Operating Rules

- Keep private runtime artifacts out of Git: session args, captures, generated certs, local config, logs, staged clients, retail client copies, and research scratch notes.
- Prefer source-controlled helpers for repeatable setup; prefer ignored runtime directories for generated state.
- Keep the Windows/patched-client workflow working while improving the stock native macOS flow.
- Commit Mac productization work in reviewable slices.
- Update this file whenever a phase changes state, scope, or acceptance criteria.

## Status Legend

- `pending`: not started.
- `active`: currently being worked.
- `blocked`: waiting on an unresolved technical issue or decision.
- `done`: implemented, verified, and committed.

## Phase 1: Clean Local Artifacts

Status: done

Goal: make normal macOS setup and server launch stop dirtying the repository.

Tasks:

- Move generated gateway cert/key output out of tracked source paths.
- Use an ignored runtime path such as `server/var/certs/gateway/` or a macOS application-support path.
- Ensure `QuickstartServer.sh` reads generated certs from the runtime path.
- Keep local config, generated certs, session args, captures, staged runtimes, and logs ignored.
- Verify setup plus launch leaves `git status` clean except for intentional source edits.

Acceptance:

- Running the Mac setup and server does not modify tracked files.
- Fresh generated gateway certs include the required gateway hostnames.
- Existing committed cert fixtures, if any, are not overwritten by local runtime.

## Phase 2: macOS Doctor

Status: done

Goal: add a single diagnostic command that tells a Mac user exactly what is ready and what is missing.

Target command:

```bash
bash tools/macos/doctor.sh
```

Tasks:

- Check platform, Node/npm, OpenSSL, and other required commands.
- Check retail EVE root discovery.
- Check prepared source copy.
- Check staged runtime and stage metadata.
- Check launcher-session args file existence and permissions.
- Check local CA certificate and trust state.
- Check gateway certificate SANs.
- Check server/proxy ports.
- Check boot overlay state.
- Check proxy defaults for `clientresources.eveonline.com`.
- Add a quiet/check-only mode suitable for tests.

Acceptance:

- Output is clear pass/fail/remediation text.
- A failing check prints the exact command or next step to fix it.
- The command does not require a running client.

## Phase 3: Setup UX

Status: pending

Goal: make the macOS setup flow feel like the Windows setup flow: guided, predictable, and repeatable.

Tasks:

- Improve `tools/macos/StartClientSetup.sh` step output.
- Make retail EVE auto-detection explicit and overrideable.
- Validate staged runtime after setup.
- Install local CA or clearly explain how to skip/install later.
- Save local config safely in ignored local config.
- Optionally add a setup mode that chains into launcher-session capture.
- Print the normal next commands at the end.

Acceptance:

- A fresh Mac user can run setup without knowing internal paths.
- Re-running setup is safe and predictable.
- The script never stores private launcher session material in tracked paths.

## Phase 4: Runtime Polish

Status: pending

Goal: keep the core Mac gameplay path stable and make remaining runtime noise understandable.

Tasks:

- Keep stock-client handshake mode as the macOS default.
- Preserve patched-client mode for the existing workflow.
- Label expected blocked endpoints clearly in logs.
- Decide whether public-gateway gRPC should be fixed through trust, stubbing, or graceful suppression.
- Improve market daemon UX: auto-start with a small DB or clearly explain offline behavior.
- Add a concise server startup summary for handshake mode, proxy mode, CDN forwarding, gateway cert path, and market state.

Acceptance:

- A normal Mac launch reaches character selection and station entry.
- Expected nonfatal noise is distinguishable from real launch blockers.
- Market/public-gateway limitations are documented and visible.

## Phase 5: Public macOS Docs

Status: pending

Goal: write clean public documentation for the supported Mac workflow.

Target file:

```text
docs/macos.md
```

Tasks:

- Document requirements.
- Document fresh setup.
- Document normal daily start.
- Document launcher-session capture and refresh.
- Document staged-client refresh after EVE updates.
- Document troubleshooting.
- Document local/private files and what not to commit.
- Document known limitations.

Acceptance:

- The doc describes the supported workflow, not the investigation history.
- A new contributor can follow it without private notes.
- No private tokens, local-only session material, or machine-specific secrets appear in docs.

## Phase 6: Regression Tests

Status: pending

Goal: keep Mac support from regressing without requiring CI to launch the real game.

Tasks:

- Keep focused tests for stock handshake response shape.
- Keep focused tests for proxy host policy.
- Keep focused tests for WAIT_AUTH analysis and replay helpers.
- Keep focused tests for docked dogma ship-info pilot rows.
- Keep focused tests for fitting and implant parity.
- Add script smoke checks for `bash -n`.
- Add doctor check-only coverage.
- Add cert builder SAN validation.
- Add launch dry-run validation for sanitized env/args output.

Acceptance:

- CI or a local test command can validate Mac tooling structure.
- Tests do not require private launcher tokens or a real EVE install.
- Script syntax and critical server compatibility paths are covered.

## Phase 7: PR and Branch Structure

Status: pending

Goal: keep upstream review possible and keep the fork clean.

Tasks:

- Keep `origin` as `Collinw24/eve.js`.
- Keep upstream tracking read-only.
- Keep the active Mac branch under a Collin-owned branch name.
- Split upstream PRs into reviewable slices:
  1. Mac setup/launch tooling and safe local artifacts.
  2. Server stock-client compatibility.
  3. Dogma/fitting/implant parity.
  4. Public docs and doctor command.
- Avoid one giant mixed-purpose PR when possible.

Acceptance:

- Fork `main` remains the integrated baseline.
- Mac branch remains the current productization branch.
- PRs are understandable without private context.

## Immediate Next Action

Start with Phase 1.

Reason: local artifact hygiene is the largest blocker to calling this a healthy daily-use Mac setup. Until setup and server launch stop modifying tracked cert files, the workflow is too easy to accidentally commit wrong.

## Update Log

- 2026-05-16: Created initial seven-phase macOS productization plan.
- 2026-05-16: Started Phase 1. Gateway cert generation now targets ignored runtime state under `server/var/certs/gateway/`; full client setup replay still needs a deliberate run because it stages a large local EVE copy.
- 2026-05-16: Started Phase 2 with `tools/macos/doctor.sh`; current machine reports missing prepared source/staged runtime and untrusted local CA, while runtime gateway cert SANs pass.
- 2026-05-16: Ran `StartClientSetup.sh --skip-install-ca`, installed the local CA separately, and verified `doctor.sh --check` passes required checks. `Play.sh --use-captured-session --dry-run` prints sanitized args and builds the local CA bundle. An alternate-port `QuickstartServer.sh` smoke reached healthy HTTP/HTTPS endpoints with the runtime gateway cert path. Restored pre-existing tracked local config/cert diffs so the repo returns to a clean state after setup and launch verification.
