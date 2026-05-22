# Server Triage Log

Date started: 2026-05-22

## Operating Rules

- Do not restart the running server during this triage session.
- Stack fixes as local commits on the `collinw24/native-mac-client-pr` branch.
- Preserve existing runtime/data changes unless a specific fix requires touching them.
- Record every fix, test, and deferred restart check here.
- Mirror this fork to the local Gitea instance once the local remote/repo target is confirmed.

## Repository State At Start

- Local path: `/Users/collin/eve.js`
- Branch: `collinw24/native-mac-client-pr`
- Primary fork remote: `origin` -> `https://github.com/Collinw24/eve.js.git`
- Local mirror remote: `gitea` -> `https://git.luxiumdigital.net/collin/eve.js.git`
- Upstream remote: `upstream` -> `https://github.com/rrfarmer/eve.js.git`
- Worktree already contained runtime/data changes before triage began, mostly under `server/src/newDatabase/data/`, plus local config and tooling artifacts.
- `git ls-remote --heads gitea` succeeded but returned no refs, so the Gitea repo exists or is reachable as an empty mirror target.

## Fix Log

No fixes committed yet in this triage session.

## Deferred Restart Checks

- Confirm post-restart behavior for each committed server fix.
- Confirm local Gitea mirror exists and receives the stacked fix commits.

## Notes

- Server restarts are intentionally deferred.
- For code fixes, stage only the files intentionally touched for that fix and leave live runtime/data churn alone unless the issue requires it.
