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

No server fixes committed yet in this triage session.

## Issue Tracking

Gitea issue tracker: `https://git.luxiumdigital.net/collin/eve.js/issues`

### 2026-05-22 Agent Triage Batch

Five read-only research agents inspected the live logs and code paths. No server restart was performed.

1. Highslot launcher ship rendering
   - Gitea: `https://git.luxiumdigital.net/collin/eve.js/issues/1`
   - Title: Ship slim redraw missing for fitted highslot launchers
   - Evidence: XL launcher modules are present in inventory/dogma and assigned highslot flags, but no fresh ship `OnSlimItemChange` was found for the active ship after fitting/replay.
   - Likely fix area: recompute fitted module tuples for the active ship, refresh presentation fields, and broadcast ship slim changes when fitted module signatures change.
   - Restart check: fit XL launchers, undock/relog, and verify on-ship launcher geometry appears with no missing slim-module update.

2. Ship SKIN apply
   - Gitea: `https://git.luxiumdigital.net/collin/eve.js/issues/2`
   - Title: Ship SKIN apply succeeds server-side but does not persist or refresh client cosmetic state
   - Evidence: `ApplySkinToShip(shipID=2990007244, skinID=12778)` returned ok, but `shipCosmetics/data.json` did not persist the ship row; public gateway notice logged `streams=0`; client logs reported owned-license fetch failures.
   - Likely fix area: avoid mutating cached DB roots before write or force the runtime write, then refresh live ship presentation/slim state after apply/unapply and verify the owned-license gateway response path.
   - Restart check: apply Komodo Cryptic Ecdysis, verify `skinMaterialSetID=3637` is visible in slim/presentation state, relog/restart, and confirm the skin remains applied.

3. Mutaplasmid application
   - Gitea: `https://git.luxiumdigital.net/collin/eve.js/issues/3`
   - Title: Mutaplasmid application fails because dynamicItemService is missing
   - Evidence: the client called `dynamicItemService.CreateDynamicItem` and `GetDynamicItemInfo`, but dispatch returned `dynamicItemService no service registered`; the mutaplasmid stack was not consumed.
   - Likely fix area: add and advertise `dynamicItemService`, import dynamic item attribute data, validate target/mutaplasmid compatibility, persist rolled per-item attribute overrides, consume one mutaplasmid, and expose rolled values through dogma/fitting paths.
   - Restart check: apply one unstable smartbomb mutaplasmid, confirm no missing-service log lines, stack decrements, target becomes dynamic/abyssal, and rolled attributes survive relog/restart.

4. Implant display after plug-in
   - Gitea: `https://git.luxiumdigital.net/collin/eve.js/issues/4`
   - Title: Implants persist after plug-in but character head implant view stays empty
   - Evidence: six `dogmaIM.InjectImplant` calls succeeded and `characters["140000238"].implants` contains slots 1-6, but the character head/implant UI still showed no implants. The post-injection UI path appears to use clone state rather than a fresh `GetImplants` call.
   - Likely fix area: share one active implant serializer across `GetImplants`, `GetCloneInfo`, and `GetCloneState`, with consistent item/type/slot data and any read-only active implant rows needed by the head view.
   - Restart check: open the character head/implant view after restart and verify slots 1-6 show the High-grade Nirvana set; plug a fresh test implant and verify immediate and post-restart visibility.

5. Capital NPC dread command
   - Gitea: `https://git.luxiumdigital.net/collin/eve.js/issues/5`
   - Title: `/capnpc 1 dreads` spawns server-side but fresh AddBalls is dropped before client sees it
   - Evidence: `/capnpc 1 dreads` reached slash handling and spawned dread entities into the bubble, but Destiny dropped `AddBalls2` under `bootstrap_acquire` as `backstep-behind-last-sent`.
   - Likely fix area: route capital command spawns through the tested warp-in acquire path or guard fresh acquire stamp clearing so it cannot move below the last sent/presentation floor.
   - Restart check: run `/capnpc 1 dreads`, verify a dread appears to the client and no `bootstrap_acquire backstep-behind-last-sent` drop is logged; also verify `/capnpctarget dreads me`.

## Deferred Restart Checks

- Confirm post-restart behavior for each committed server fix.
- Confirm local Gitea mirror exists and receives the stacked fix commits.
- Retry Gitea mirror push after checking HTTPS transport/auth/server limits. `git push gitea --all` died with signal 15, and a current-branch push idled in `send-pack` for nearly four minutes before being killed locally. `git ls-remote --heads gitea` still returns no refs.
- Re-run the five issue-specific restart checks above after the next intentional server restart.

## Notes

- Server restarts are intentionally deferred.
- For code fixes, stage only the files intentionally touched for that fix and leave live runtime/data churn alone unless the issue requires it.
