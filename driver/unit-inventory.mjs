// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// unit-inventory.mjs —: WHICH UNITS A DEPLOYMENT IS SUPPOSED TO HAVE, written down once.
//
// built the check that compares a live unit against its tracked file. The moment it could run it
// reported "5 unit(s) had no readable fragment and were NOT compared; 2 run from no file in
// driver/systemd/" — and there was nothing to say whether that was a defect or the arrangement. The
// unit list was a bare array of eight names in the health script, so a unit was inside the guarantee or
// outside it BY OMISSION rather than by decision, and nothing recorded which.
//
// Measured on both boxes, 2026-08-11 (unit names only — no Environment block was read):
//
//   | unit                        | prod | test | tracked | was in the check's list |
//   | trademark-portal            | live | live |   no    | yes                     |
//   | trademark-ops-mcp           | live | live |   no    | yes                     |
//   | client-mcp                  | live |  —   |   no    | yes                     |
//   | client-mcp-apikey           | live |  —   |   no    | yes                     |
//   | trademark-artifacts-http    | live |  —   |   no    | yes                     |
//   | client-access               | live |  —   |   no    | NO                      |
//   | prelim-driver               | live | live |  yes    | yes                     |
//   | profile-service             | live |  —   |  yes    | yes                     |
//   | prelim-outbox               | live |  —   |  yes    | NO                      |
//   | recipe-service              |  —   |  —   |  yes    | yes                     |
//   | portal-service              |  —   |  —   |  yes    | NO                      |
//
// TWO CORRECTIONS TO THE ISSUE ARE BAKED INTO THIS TABLE, and one of them inverts a fix. lists
// `profile-service` and `prelim-outbox` under "tracked and never run". That reading comes from the test
// box, where neither is installed. PRODUCTION RUNS BOTH — so deleting their tracked files as dead
// weight would have removed the only tracked description of two live production services.
//
// `client-access` was exempt from the guarantee TWICE: no tracked file, and not even in the list, so
// nothing noticed it existed. `prelim-outbox` is the mirror image — tracked and live on prod, absent
// from the list, so its drift was never checked either. Both are named here now.
//
// ── WHAT THIS FILE DOES NOT DO ───────────────────────────────────────────────────────────────────
//
// It writes no unit file and renames nothing. Portal, client-mcp, profile-service and recipe-service are
// TEMPLATE units: they carry real CF Access team/AUD/domain values INLINE in the deployed copies and ship
// as placeholders merged by hand after a diff (the two unit kinds are inventoried in
// docs/architecture/05-config-governance.md, tier 2). Getting that wrong replaces working auth with
// placeholders that look configured, and it is not work to do beside a running round.
//
// So the untracked units are declared as untracked, WITH THE REASON, which is exactly what 's
// acceptance asks for: "either has a tracked file it is compared against, or is named here with the
// reason it does not".
//
// ── THE CORRECTION THIS FILE NEEDED ITSELF ───────────────────────────────────────────────────────
//
// The paragraph above was written while every lookup behind it opened `driver/systemd/` and nothing
// else. `client-mcp`, `client-mcp-apikey` and `trademark-artifacts-http` were therefore recorded here as
// having no tracked file, with the reason that writing one would be dangerous — and the tracked file for
// each was already in the tree, in `mcp-server/remote/`. The repo's own governance doc names BOTH
// directories (`docs/architecture/05-config-governance.md`, tier 2); the guard named one.
//
// That is the same defect one layer up from the one this file was built to fix. 's inline array made
// a unit's membership of the guarantee an omission; the hardcoded directory made a FILE's membership an
// omission, and the result was three statements of fact that were false with nothing able to contradict
// them. The tracked-file lookup is now a repo-wide walk (driver/unit-files.mjs), and `unitInventoryVerdict`
// FAILS on an entry claiming no tracked file while a file of that name is in the tree — so this
// particular lie cannot be told again.
//
// Re-measured on both boxes 2026-08-13 (unit names, FragmentPath and ExecStart only — no Environment
// block was read, no EnvironmentFile was opened). What that added: `feedback-mint`, a THIS-REPO script on
// a production timer that nothing here recorded, and five units production runs that belong to other
// repos. All six were undeclared, which is the condition this file exists to make impossible.
// (`feedback-mint` no longer runs anywhere — stopped and disabled on production 2026-08-20. The
// paragraph above is the 2026-08-13 finding and stays as written; this line is here so no reader takes
// it for current state.)

/** Where a unit is expected to be installed. "none" is a claim, not an absence — see ORPHANED below. */
export const BOXES = Object.freeze(["prod", "test", "dev"]);

// ── RESOLVED UNITS (, owner ruling 2026-08-25 — option B) ──────────────────────
//
// `resolved: [...]` names tracked files the INSTALLER rewrites before installing. Three units carry
// `@NAME@` placeholders because configuration cannot reach them: a `.path` unit reads no environment at
// all, and two others deliberately load no `EnvironmentFile` (one would let `~/.env` shadow the CF
// Access AUD, the other its PATH). `driver/systemd/render-units.mjs` substitutes and writes the copy
// into `~/.config/systemd/user/`; the tracked file stays generic.
//
// THIS FIELD IS A DECLARATION AND THE FILES ARE THE FACT, so neither is trusted alone. A test asserts
// they agree in BOTH directions — every file with a directive placeholder is declared here, and
// everything declared here really carries one. A one-way check would let a new placeholder ship
// undeclared, which is the same shape as the undeclared units this file was written to make impossible.

// ── RETIRED UNITS (; owner ruling 2026-08-26, restated 2026-08-31) ────────────
//
// `retired: { ruled, filesStayUntil, why }` says a unit's posture has been ruled away while its tracked
// files are still in the tree. It is a FACT about a decision, not a pointer at a replacement — the
// `supersedes:` field that once stood on `trademark-portal` was deliberately removed because a pointer
// outlives the thing it points at, and this field must not repeat that. Nothing here names a file that
// could be deleted out from under it.
//
// `filesStayUntil` is a BOX, and it is the whole reason the files are still here. Deleting a tracked
// file whose unit that box is running today removes the only tracked description of a live service —
// the mistake this file's own header records being caught once already, for `profile-service` and
// `prelim-outbox`. Production is on pre-sweep code and is rebuilt rather than migrated (owner ruling
// 2026-08-26), so the rebuild is the event that releases the files, and until then entry and tree
// disagree ON PURPOSE.
//
// Two consumers, so this is not prose: `unitInventoryVerdict` reports a retired unit's absence as
// EXPECTED rather than as drift, and a claimed-but-missing tracked file is a fault whatever the
// retirement says. That pair is what asks for — absent-and-expected-to-be told
// apart from absent-and-should-not-be, by the check rather than by a reader.

export const UNIT_INVENTORY = Object.freeze([
  {
    // — the update mechanism the install PLACES. `bin/onboard.mjs` writes both
    // files; `bin/update.mjs` is what the service runs. It is declared here on the day it is SHIPPED
    // rather than the day it first runs, because a unit file no entry claims is exactly what this file
    // exists to make impossible — and a mechanism that installs itself is the easiest kind to ship
    // undeclared.
    unit: "clearotron-deploy", runsOn: [],
    tracked: ["clearotron-deploy.service", "clearotron-deploy.timer"],
    note: "the install's own updater. Ships tracked, runs nowhere yet.",
    orphanReason: "SHIPPED AND PLACED ON NO BOX YET, which is a THIRD kind of orphan and not either of "
      + "the other two: courtlistener-mcp runs on production under another name, feedback-mint was "
      + "deliberately switched off, and this one has simply never been installed. `runsOn` gains "
      + "\"test\" the day a test deploy places it and \"prod\" when the owner asks for it. Until then it "
      + "stays out of CHECKED_UNITS, because asking systemd about a unit nobody installed produces a "
      + "\"not compared\" row that reads like a fault and is not one. It goes on with "
      + "`systemctl --user enable --now clearotron-deploy.timer` once bin/onboard.mjs has written both files.",
  },
  {
    unit: "prelim-driver", runsOn: ["prod", "test"],
    tracked: ["prelim-driver.service", "prelim-driver.path", "prelim-driver.timer"],
    resolved: ["prelim-driver.path"],   // option B — see RESOLVED below
    retired: {
      ruled: "2026-08-26, restated 2026-08-31",
      filesStayUntil: "prod",
      why: "the path-watcher/timer drain posture is retired (tracker issue 1863): the built-in worker "
        + "is the product's drain, and a hosted deployment gets ONE plain service unit invoking the "
        + "entrypoint directly rather than a oneshot woken by a timer and a queue glob. Absence on any "
        + "box is now the EXPECTED direction rather than drift. The replacement is deliberately not "
        + "named here — a pointer outlives the file it points at, which is why `supersedes:` was "
        + "removed from this file once already; the pinned background list is where the current drain "
        + "is stated, and it is code rather than prose.",
    },
    note: "the driver itself — the one unit the drift check has always been able to compare. "
      + "SETTLED (tracker issue 1888, measured on the owner's fresh production install 2026-08-31): "
      + "the documented install creates NO units at all — not even the unit directory — and a knockout "
      + "delivered end to end without them, so units are the hosted-deployment OPT-IN step, never the "
      + "install's output. Absent on a box is the install's normal state; present means someone ran the "
      + "hosted step there. `runsOn` lists exactly the boxes MEASURED to carry it, which is why absence "
      + "anywhere else is not drift — the earlier expectation that the .path unit ships with the install "
      + "was the wrong half of the disagreement.",
  },
  {
    unit: "profile-service", runsOn: ["prod"], tracked: ["profile-service.service"],
    // NO LONGER RESOLVED AT INSTALL. It carried `@CLEAROTRON_CHECKOUT_DIR@` because
    // it loaded no EnvironmentFile and so had no `${VAR}` systemd could expand. The owner's one-config-
    // per-server-box ruling gives it `EnvironmentFile=%h/.env` like every other service, which makes the
    // checkout path an ordinary systemd expansion and leaves no placeholder to render.
    note: "LIVE ON PRODUCTION. #685's body lists it as never run; that is true of the test box only. "
      + "Was a TEMPLATE unit carrying CF Access values inline; generic since tracker issue 1925.",
  },
  {
    // RUNS ON NO BOX YET, AND THAT IS THE HONEST DECLARATION. `runsOn: ["prod"]` is a claim about a
    // LIVE box, not about intent: the expected-but-absent arm reads it as "this is running on prod",
    // and prod has never been enumerated carrying this unit. An orphan entry is the sanctioned way to
    // say "the repo ships this, nothing runs it, and here is the decision it waits on" — orphans are
    // REPORTED, never a fault, for exactly this case. It becomes `["prod"]` in the change that DEPLOYS
    // it, against a fresh enumeration, which is the ratchet working rather than being edited around.
    unit: "clearotron-portal", runsOn: [], tracked: ["clearotron-portal.service"],
    note: "NEW, tracker issue 1925, SHIPPED BUT NOT YET DEPLOYED. The portal had NO unit at all — it "
      + "and the MCP face are the two children bin/start.mjs supervises, and neither ran under systemd, "
      + "so a hosted deployment kept them alive with a hand launcher and `clearotron start` had nothing "
      + "to refuse in favour of.",
    orphanReason: "THE WEB PORTAL, SHIPPED WITH NO BOX CARRYING IT YET — the same KIND of orphan as "
      + "clearotron-deploy (never installed), a different unit and a different install path. It is not "
      + "courtlistener-mcp, which runs on production under another name, and not feedback-mint, which "
      + "was deliberately switched off. It arrives with the PRODUCTION REBUILD (owner ruling 2026-08-26: "
      + "rebuild, not migrate) and then `systemctl --user enable --now clearotron-portal.service`. "
      + "`runsOn` gains \"prod\" the day a MEASURED enumeration of that box shows it, never on the day "
      + "someone intends it — an entry claiming a live box is a claim about a box, not about a plan.",
  },
  {
    // Same as clearotron-portal above: shipped, running nowhere, declared as an orphan rather than
    // asserting a production state no enumeration has ever shown.
    unit: "clearotron-mcp-face", runsOn: [], tracked: ["clearotron-mcp-face.service"],
    note: "NEW, tracker issue 1925, SHIPPED BUT NOT YET DEPLOYED. The engine door the portal calls over "
      + "MCP; the other of the two processes that had no unit.",
    orphanReason: "THE ENGINE DOOR THE PORTAL CALLS, shipped with no box carrying it yet. Same kind as "
      + "clearotron-portal beside it and as clearotron-deploy — never installed — and distinct from "
      + "both other kinds in this list. It arrives with the PRODUCTION REBUILD and then `systemctl "
      + "--user enable --now clearotron-mcp-face.service`. ONE EXTRA CONDITION THAT IS NOT TRUE OF THE "
      + "PORTAL: it REFUSES TO START without TRADEMARK_MCP_ALLOWED_HOSTS in the box's `%h/.env`, so "
      + "installing it before that key exists produces a unit that fails at every start rather than a "
      + "door that is merely unreachable.",
  },
  {
    // A THIRD KIND OF ORPHAN, and the distinction is the point of the entry. clearotron-portal and
    // clearotron-mcp-face are shipped-and-not-yet-deployed: they arrive with the production rebuild and
    // are then enabled like anything else. This one is shipped and DELIBERATELY NOT INSTALLED BY ANY
    // INSTALL PATH — `clearotron start` neither installs nor starts it, and a rebuild must not either.
    //
    // ── IT INSTALLS WITH THE PRODUCT SINCE 2026-09-03 (, settled point 2) ────────
    //
    // Until then it was an orphan BY DESIGN: `clearotron connect` installed and started it on demand,
    // because starting it turned on client-account access and a unit that came up with everything else
    // would have made that consent meaningless (; owner ruling 2026-08-31, "On demand
    // is fine"). He superseded that knowingly — the door auto-starts and the per-account key is the
    // gate, not whether a process runs.
    //
    // So it is now an orphan of the FIRST kind, awaiting a box, exactly like the portal and the engine
    // door beside it: it is in SERVER_INSTALL_SET, and it leaves this list on the day a measured
    // enumeration of a box shows it running.
    unit: "clearotron-client-mcp", runsOn: [], tracked: ["clearotron-client-mcp.service"],
    note: "tracker issue 1976, and INSTALLED WITH THE PRODUCT since tracker issue 2148. The client door "
      + "— the one surface that accepts an account-scoped key, and a separate process from the engine "
      + "door, which refuses one outright.",
    orphanReason: "Awaiting a box. It joined the install set on 2026-09-03 (tracker issue 2148 settled "
      + "point 2, superseding the on-demand posture it shipped under), so `render-units.mjs --apply` "
      + "and `clearotron start --background` both place and enable it. It REFUSES TO START without "
      + "CLIENT_MCP_TOKEN_ONLY=1, CLIENT_MCP_ACCOUNT_ACCESS=1, the allow-list, the signing secret and "
      + "CLEAROTRON_ACCESS_FILE in the box's `%h/.env` (it otherwise demands an OIDC audience and an "
      + "access team, which a local install has neither of) — both install paths write those from "
      + "`enablePlan` BEFORE placing it, and a box that has the unit without them crash-loops a door.",
  },
  {
    // — THE THIRD CHILD, and the only one that had no unit. `bin/start.mjs`
    // supervises the portal, the engine door and this worker; 1925 shipped units for the first two.
    // Written as part of retiring the path-watcher posture, because retiring `prelim-driver.*` without
    // it leaves a hosted box healthy-looking and draining nothing.
    unit: "clearotron-worker", runsOn: [], tracked: ["clearotron-worker.service"],
    note: "NEW, tracker issue 1863. The drain, as one plain service unit invoking the entrypoint "
      + "directly (owner ruling 2026-08-31). Ships tracked, runs nowhere yet — production takes it at "
      + "its rebuild, which is the same event that lets the retired units' files leave the tree.",
    orphanReason: "AWAITING A BOX, not an orphan by design. It is the hosted posture's drainer, and the "
      + "hosted posture is an opt-in step no install performs (tracker issue 1888). It must NOT be "
      + "started beside `clearotron start`, which supervises its own worker — the two postures are "
      + "alternatives, and running both puts a second claimant on one queue.",
  },
  {
    unit: "prelim-outbox", runsOn: ["prod"],
    tracked: ["prelim-outbox.service", "prelim-outbox.path", "prelim-outbox.timer"],
    retired: {
      ruled: "2026-08-31",
      filesStayUntil: "prod",
      why: "the timer retires with the watcher it backstopped, by name in the ruling. That watcher also "
        + "carried the last dead OpenClaw literal in the tree. Channel delivery is the "
        + "integrator's (INSTALL.md §9), so retiring these takes away nothing the product promises — "
        + "the worked example moves into the document rather than being deleted with them.",
    },
    note: "LIVE ON PRODUCTION (path and timer active-waiting). Was absent from the health check's unit "
      + "list, so its drift was never checked despite being tracked.",
  },
  {
    unit: "trademark-portal", runsOn: ["prod", "test"], tracked: null,
    untrackedReason: "the deployed copy carries real Cloudflare Access team/AUD/domain values inline. "
      + "A tracked file would be the placeholder TEMPLATE, merged by hand after a "
      + "diff — writing one carelessly replaces working auth with placeholders that look configured.",
    // — `supersedes: "portal-service.service"` stood here until the owner ruled that file deleted
    // (2026-08-14). The FACT is history worth keeping; the POINTER is not, because a reference to a
    // file that no longer exists is the dangling kind that reads as a missing artefact rather than a
    // retired one.
    supersededName: "portal-service.service (deleted, owner-ruled 2026-08-14)",
  },
  {
    unit: "trademark-ops-mcp", runsOn: ["prod", "test"], tracked: null,
    untrackedReason: "same CF Access inline-values shape as the portal it serves.",
  },
  {
    unit: "client-mcp", runsOn: ["prod", "test"], tracked: ["client-mcp.service"],
    note: "TRACKED, in mcp-server/remote/ — this entry said it had no file, and the file was there. It is "
      + "a banner-marked TEMPLATE, so the live copy differing from it is the arrangement, not drift. "
      + "#1147 ADDED THE TEST BOX (2026-08-18): the client surface ran nowhere but production, so the test "
      + "instance exercised none of it and #764 sat merged-awaiting-e2e with no round able to settle it. "
      + "The issue reported that no unit shipped; a unit did ship, in mcp-server/remote/ rather than "
      + "driver/systemd/ — the same one-directory blind spot this file's own header records. The test "
      + "unit runs the same binary in dev mode on its own port; see the template for why that port is "
      + "not the default.",
  },
  {
    unit: "client-mcp-apikey", runsOn: ["prod"], tracked: ["client-mcp-apikey.service"],
    note: "TRACKED, in mcp-server/remote/. Same correction as client-mcp: the old reason claimed the live "
      + "key made a tracked file impossible, and the tracked TEMPLATE — which holds no key — already existed.",
  },
  {
    unit: "trademark-artifacts-http", runsOn: ["prod"], tracked: ["trademark-artifacts-http.service"],
    note: "TRACKED, in mcp-server/remote/. GENERIC, not a template: it carries no banner and no "
      + "placeholder, and defers its CF Access values to the EnvironmentFile — so its live copy is "
      + "expected to MATCH the tracked file, and a difference is real drift.",
  },
  {
    unit: "client-access", runsOn: ["prod"], tracked: null,
    untrackedReason: "it is not this repo's service. Its ExecStart runs a script from a different "
      + "product's checkout on the same box, not under this clone — so there is no code here to "
      + "template, and the old reason (CF Access values inline) would send the next reader hunting for a "
      + "file that cannot exist. Declared for the same reason sync-skills is: a unit this repo does not own "
      + "but shares a box with is still a unit that must not be invisible.",
  },
  {
    unit: "feedback-mint", runsOn: [], tracked: null,
    untrackedReason: "THIS REPO'S OWN SCRIPT on a production timer — scripts/feedback-mint.mjs, run against "
      + "the archive pool, minting GitHub issues on a schedule nothing here recorded. Found by enumerating "
      + "production rather than by reading a list. Untracked only because nobody wrote the unit down; "
      + "unlike the CF Access units it carries no identity-edge value, so it CAN be tracked and should be.",
    // — THE TIMER IS STOPPED. Owner's word 2026-08-20, executed the same evening; `runsOn` is now
    // [] because the unit runs on no box, and the orphanReason below is what an empty runsOn owes.
    //
    // MEASURED ON PRODUCTION BEFORE AND AFTER, one property at a time (a prod unit's Environment block
    // carries live keys inline and is never dumped):
    //
    //   before   LoadState=loaded  ActiveState=active    UnitFileState=enabled
    //            LastTriggerUSec=Thu 2026-08-20 20:27:26 CEST
    //   after    LoadState=loaded  ActiveState=inactive  UnitFileState=disabled
    //            feedback-mint.service ActiveState=inactive
    //            `systemctl --user list-timers --all` no longer lists it
    //   control  the other three timers on that account — prelim-driver, prelim-outbox,
    //            launchpadlib-cache-clean — are still on their normal cadence, so exactly one unit moved
    //
    // The store was re-checked first rather than taken from the recommendation:
    // /srv/trademark-archive/_feedback ABSENT, with the sibling listing (_state, assets, customer,
    // index.html) as the control proving the read works. An absence measured against a working read is
    // the statement that no flag was ever captured, not a failed look.
    //
    // RE-ENABLING IS ONE COMMAND: `systemctl --user enable --now feedback-mint.timer` as the service account.
    // Nothing was deleted — not the unit file, not the script, not the capture path left intact.
    //
    // retired the surface that writes to this timer's input. The recommendation is to stop and
    // disable the unit, and it drops nothing, because there is nothing there to drop. Measured on
    // production 2026-08-20, not inferred:
    //
    //   ExecStart  node .../scripts/feedback-mint.mjs --dir /srv/trademark-archive/_feedback
    //   the store  /srv/trademark-archive/_feedback DOES NOT EXIST
    //   the unit   active, enabled, last triggered 2026-08-20 15:26:26 CEST, exits 0 every time
    //
    // `appendFlag` mkdirs the store on first write, so an absent store is not a read failure — it is the
    // statement that no flag has ever been captured on production. The drain therefore has an empty
    // queue by construction and has had one since the unit was installed. What the timer does every
    // thirty minutes is print "No feedback store at ... yet" and exit.
    //
    // WHY THIS ROW SURVIVES THE STOP rather than being deleted. The unit file is still installed and
    // still loadable, so a row saying nothing would leave a real unit undeclared — the condition this
    // file exists to make impossible — and the drift arm would go blind to it again the moment anyone
    // re-enabled it. An orphan row is the honest shape for a unit that exists and runs nowhere, which is
    // the same reason courtlistener-mcp keeps one.
    //
    // `untrackedReason` above is kept in the PAST tense of its own finding on purpose: it records how
    // this unit was discovered — by enumerating production, not by reading a list — and that is history
    // the stop does not erase.
    orphanReason: "STOPPED AND DISABLED ON PRODUCTION 2026-08-20 on the owner's word (#1437), so it runs "
      + "on no box and `runsOn` is empty. It is not deleted: the unit file, scripts/feedback-mint.mjs and "
      + "the whole capture path are intact, and `systemctl --user enable --now feedback-mint.timer` as "
      + "the service account puts it back. It drained a store that never existed — /srv/trademark-archive/_feedback "
      + "was absent on production with a sibling listing as the control, which is the statement that no "
      + "flag was ever captured, so stopping it dropped nothing. The decision owed, if any, is whether the "
      + "feedback machinery is removed rather than parked; driver/run-activity.mjs still carries a note "
      + "addressed to whoever picks that up, and it is still unclaimed.",
    note: "STOPPED. Production ran it every 30 minutes against an input nothing writes to any more "
      + "(#1437); the owner's word came 2026-08-20 and it was disabled the same evening.",
  },
  // ── OTHER REPOS' UNITS, SHARING THE BOX ───────────────────────────────────────────────────────────
  // Declared, not adopted. A unit this repo does not own is still a unit the arm enumerates, and an
  // undeclared unit is a FAIL by design — so the choice is to name them or to make the arm useless on the
  // box it matters most on. Same treatment sync-skills already gets. Owner and measured ExecStart root
  // only: no port, no hostname, no tenant.
  //
  // AND NOT THE OTHER PRODUCT'S REPOSITORY NAME. This file ships — the cut keeps it
  // because `scripts/live-surface-check.mjs` imports it — so every sentence here is on the public repo.
  // Naming the unrelated product's repo there is a cross-reference the rules forbid, and it told a public
  // reader nothing the sentence does not: what they need is that the unit belongs to a different checkout
  // and that nothing in THIS one touches it. The unit names themselves keep their prefix, because that is
  // what `systemctl` actually calls them and a renamed unit in an inventory is worse than a named repo.
  {
    unit: "openclaw-gateway", runsOn: ["prod"], tracked: null,
    untrackedReason: "OpenClaw's gateway, run from a global npm install of the `openclaw` package. Nothing "
      + "in this repo builds, deploys or restarts it.",
  },
  {
    unit: "graph-notify-adapter", runsOn: ["prod"], tracked: null,
    untrackedReason: "belongs to a DIFFERENT product's checkout on the same box — its WorkingDirectory is "
      + "outside this clone, so nothing here builds, deploys or restarts it.",
  },
  {
    unit: "clawdi-courtlistener-mcp", runsOn: ["prod"], tracked: null,
    untrackedReason: "the OAuth MCP bridge as PRODUCTION ACTUALLY RUNS IT: under this name, from the other "
      + "checkout's copy of warm-server.mjs. This repo ships a unit file for the same bridge under the name "
      + "`courtlistener-mcp` (see the orphan below) — editing providers/oauth-mcp-bridge/ here changes "
      + "nothing on the box.",
  },
  {
    unit: "clawdi-ghostfolio-mcp", runsOn: ["prod"], tracked: null,
    untrackedReason: "belongs to a different product's checkout on the same box; runs from that "
      + "checkout's bridge, not this clone's.",
  },
  {
    unit: "clawdi-openbb-mcp", runsOn: ["prod"], tracked: null,
    untrackedReason: "belongs to a different product's checkout on the same box; runs from that "
      + "checkout's bridge, not this clone's.",
  },
  {
    unit: "trademark-test-deploy", runsOn: ["test"], tracked: null,
    untrackedReason: "the hourly --ff-only deploy of the TEST instance. It exists on the test box only "
      + "and by design: production never auto-deploys, so a tracked file shipped to both would be a unit "
      + "production must be trusted never to enable.",
  },
  // register-ledger-prune is DELIBERATELY not listed, and the sequence is worth keeping because the
  // row was right until the moment it was wrong. 's nightly rotation was retired in code by:
  // bin/register-ledger-prune.mjs is deleted, record bodies now live in each run's own directory and
  // are purged with the run, so there is no global file left to rotate. The row stayed here on
  // purpose while the TIMER was still installed on the test box — dropping it first would have made
  // an installed unit invisible to the very check that exists to find installed units nothing
  // describes. The timer was disabled and stopped on 2026-08-13, four hours before it would have
  // fired against the deleted script, and this row went with it. Re-listing it would re-declare a
  // unit that no longer runs anywhere.
  {
    unit: "sync-skills", runsOn: ["dev"], tracked: null,
    untrackedReason: "belongs to the skills repository, not to this repo — it fast-forwards the "
      + "skills checkout that every role reads. A tracked file HERE would be this repo describing another "
      + "repo's unit, which is how a name mismatch starts.",
  },
  // ── ORPHANED: RESOLVED. `portal-service.service` and `recipe-service.service` were tracked here and
  // run by no box. The decision the previous comment said was owed is taken: DELETED, owner-ruled
  // 2026-08-14, as superseded. Their rows are gone with their files rather than left as
  // tombstones — an inventory of what ships should not carry entries for what does not.
  //
  // The two claims they held apart are still worth the sentence, because they were different: the
  // portal unit was almost certainly the old name for the live `trademark-portal.service` (see
  // `supersededName` above), while the recipe unit was NOT another unit's old name — "nothing runs it
  // today" and "it is dead" were different statements, and the owner made the second one.

  {
    unit: "courtlistener-mcp", runsOn: [], tracked: ["courtlistener-mcp.service"],
    resolved: ["courtlistener-mcp.service"],   // option B
    orphanReason: "providers/oauth-mcp-bridge/systemd/. No box runs a unit of this name: production runs "
      + "the same bridge as `clawdi-courtlistener-mcp`, from the other checkout's copy of the code. So this repo "
      + "asserts it owns a service it does not run, and the drift check could never see it for TWO "
      + "independent reasons — the name does not match the live fragment, and until now the lookup only "
      + "opened driver/systemd/. It is the exact name mismatch #685 named as \"how the mismatch that made "
      + "#646 invisible got there\", in a directory #685 never looked at. The decision owed is which repo "
      + "owns the bridge; until it is taken, the file is claimed here rather than left unexplained.",
  },
]);

/** The names the health check should ask systemd about — every unit this deployment claims to have. */
export const CHECKED_UNITS = Object.freeze(
  UNIT_INVENTORY.filter((u) => u.runsOn.length > 0).map((u) => u.unit),
);

/** Every tracked file the inventory accounts for, flattened. */
export const ACCOUNTED_FILES = Object.freeze(
  UNIT_INVENTORY.flatMap((u) => u.tracked ?? []),
);

/**
 * Judge one box's live units against the inventory. PURE — the caller reads systemd and the tree.
 *
 * @param {object} arg
 *   live       — unit base names observed active on this box (no `.service` suffix needed)
 *   files      — every unit-file BASENAME tracked anywhere in the tree (driver/unit-files.mjs)
 *   collisions — basenames carried by more than one path, from the same walk
 *   filesError — the walk could not run. An empty `files` with an error is NOT "nothing unaccounted for"
 *   box        — "prod" | "test" | null. null means "some box we cannot name", which suppresses the
 *                expected-but-absent arm rather than guessing at it.
 *   probe      — {ok, why} — could the caller enumerate at all?
 * @returns {{state:"pass"|"fail"|"skip", message:string, undeclared:string[], orphaned:string[],
 *            absent:string[], misdeclared:string[]}}
 *
 * FOUR FINDINGS. `undeclared` is the one this file was built for: a unit running on a box the repo has
 * never heard of is outside every guarantee, and it was outside them silently. `misdeclared` is the one
 * this file needed applied to ITSELF: an entry claiming no tracked file exists while a file of that name
 * sits in the tree. Three entries said exactly that, and were wrong, and nothing could tell.
 */
export function unitInventoryVerdict({
  live = [], files = [], collisions = [], filesError = null, box = null, probe = { ok: true },
} = {}) {
  if (!probe.ok) {
    return { state: "skip", undeclared: [], orphaned: [], absent: [], misdeclared: [],
      message: `could not enumerate systemd units, so the inventory was NOT checked — ${probe.why ?? "no reason given"}. `
        + "A failure to look is not a finding about the deployment." };
  }
  const base = (u) => String(u).replace(/\.(service|timer|path|socket|target|mount|slice)$/, "");
  const known = new Set(UNIT_INVENTORY.map((u) => u.unit));
  const liveBases = [...new Set(live.map(base))];

  const undeclared = liveBases.filter((u) => !known.has(u)).sort();

  // A tracked file no inventory entry claims. Distinct from an ORPHAN, which IS claimed — by an entry
  // that says nothing runs it. Both are "the repo ships something no box runs"; only the second has a
  // reason attached, and the difference is the whole point of writing the reasons down.
  const accounted = new Set(ACCOUNTED_FILES);
  const unaccountedFiles = files.filter((f) => !accounted.has(f)).sort();
  const orphaned = UNIT_INVENTORY.filter((u) => u.runsOn.length === 0).map((u) => u.unit).sort();

  // THE RATCHET THAT MAKES THIS FILE'S OWN DEFECT UNREPRESENTABLE. An entry with no tracked file states
  // a fact about the tree, and until the lookup went repo-wide it was a fact nothing could check —
  // client-mcp, client-mcp-apikey and trademark-artifacts-http each declared "no tracked file, and here
  // is why writing one is dangerous" while the tracked file sat one directory over. A reader asking what
  // configuration the client door runs was told, with confidence, to look at nothing.
  const trackedNames = new Set(files);
  const misdeclared = UNIT_INVENTORY
    .filter((u) => !u.tracked)
    .filter((u) => ["service", "timer", "path"].some((s) => trackedNames.has(`${u.unit}.${s}`)))
    .map((u) => u.unit).sort();

  // THE SAME RATCHET IN THE DIRECTION NOBODY BUILT. `misdeclared` catches an entry
  // that claims NO file while one exists, and `unaccountedFiles` catches a file no entry claims. The
  // third case — an entry claiming a tracked file that is NOT in the tree — was checked by nothing:
  // ACCOUNTED_FILES was only ever read in the files→entries direction, so deleting a unit file and
  // leaving its entry behind passed silently, in the one file written to make undeclared units
  // impossible. It is the absence-read-as-a-pass this whole file is about, one layer in.
  //
  // It matters now because the retirement above deletes unit files on a schedule set by production's
  // rebuild rather than by this PR, so entry and tree are deliberately going to disagree for a while,
  // and the disagreement must be the kind that gets reported rather than the kind that is invisible.
  const claimedAbsent = files.length === 0 || filesError ? [] : UNIT_INVENTORY
    .flatMap((u) => (u.tracked ?? []).map((f) => ({ unit: u.unit, file: f })))
    .filter((c) => !trackedNames.has(c.file))
    .map((c) => `${c.file} (claimed by ${c.unit})`).sort();

  // The expected-but-absent arm needs to know WHICH box this is, and a wrong guess is worse than none:
  // reporting every production unit missing on a dev box is a false alarm, and it would train a reader
  // to skim this check. But an arm that did not run is not an arm that passed — this file's whole
  // thesis — so an unnameable box is STATED rather than silently skipped.
  // ABSENT-AND-EXPECTED-TO-BE vs ABSENT-AND-SHOULD-NOT-BE (, criterion 3). A retired
  // unit that is gone from a box is the ruling taking effect, not drift; reporting it as a fault trains
  // a reader to skim the arm that would have caught a real one. Both are still REPORTED — the
  // distinction is which of them is a fault.
  const declaredHere = (u) => box && u.runsOn.includes(box) && !liveBases.includes(u.unit);
  const absent = box
    ? UNIT_INVENTORY.filter((u) => declaredHere(u) && !u.retired).map((u) => u.unit).sort()
    : [];
  const absentByRetirement = box
    ? UNIT_INVENTORY.filter((u) => declaredHere(u) && u.retired).map((u) => u.unit).sort()
    : [];
  const boxLine = box ? "" : " The box could not be named, so 'declared here and not running' was NOT "
    + "checked — that half did not run, which is not the same as passing.";

  // The tracked-file half of this arm depends on a walk of the tree, and an incomplete walk returns a
  // SHORT list — which quietly satisfies "no file is unaccounted for" and "no entry is misdeclared" at
  // once. What it cannot do is invent a file, so anything the short list DID find is sound and is still
  // reported; what is never reported is a clean bill of health, because a clean result off a partial
  // walk is the absence-read-as-a-pass this whole file is about.
  const filesLine = filesError
    ? ` The tracked-unit-file walk was INCOMPLETE (${filesError}), so any file arm below that found `
      + "nothing did not pass — it did not finish looking."
    : files.length === 0
      ? " The tracked-unit-file walk found NO unit file anywhere in the tree. For this repo that is not a "
        + "clean bill of health, it is a walk pointed somewhere wrong — both file arms are reported as "
        + "NOT run."
      : "";

  const faults = [];
  if (undeclared.length) {
    faults.push(`${undeclared.length} live unit(s) the repo does not declare: ${undeclared.join(", ")}. `
      + "A unit nothing declares is compared against nothing and reported by nothing — add it to "
      + "driver/unit-inventory.mjs, tracked or with the reason it is not.");
  }
  if (misdeclared.length) {
    faults.push(`${misdeclared.length} entr(y/ies) claim NO tracked file while a unit file of that name is `
      + `in the tree: ${misdeclared.join(", ")}. The entry is not merely incomplete, it is false — and a `
      + "reader asking what configuration that unit runs is told there is nothing to read.");
  }
  if (unaccountedFiles.length) {
    faults.push(`${unaccountedFiles.length} tracked unit file(s) that no inventory entry claims: `
      + `${unaccountedFiles.join(", ")}.`);
  }
  if (claimedAbsent.length) {
    faults.push(`${claimedAbsent.length} tracked unit file(s) an entry claims that are NOT in the tree: `
      + `${claimedAbsent.join(", ")}. The entry describes configuration a reader cannot open. When a `
      + "unit is retired, its entry leaves with its files — a retirement records WHY the files are "
      + "still here, it does not licence an entry to outlive them.");
  }
  if (collisions.length) {
    faults.push(`${collisions.length} unit file basename(s) exist at more than one path: `
      + `${collisions.join(", ")}. The drift check keys on the live fragment's basename, so an ambiguous `
      + "name makes it compare against whichever copy the walk saw first — a comparison that never "
      + "happened wearing the shape of one that did.");
  }
  if (absent.length) {
    faults.push(`${absent.length} unit(s) declared for ${box} and NOT running: ${absent.join(", ")}.`);
  }

  // Orphans are REPORTED, never a fault. They are a decision owed to a person, and a check that failed
  // on them would be a check demanding someone else's ruling every hour until it was made.
  // Reported, never a fault, for the same reason orphans are: the ruling says these units are going, so
  // their absence is the intended end state and flagging it hourly would train a reader to skim.
  const retiredLine = absentByRetirement.length
    ? ` ${absentByRetirement.length} unit(s) declared for ${box} are absent BY RETIREMENT `
      + `(${absentByRetirement.join(", ")}) — expected, not drift; each entry carries the ruling.`
    : "";

  const orphanLine = orphaned.length
    ? ` ${orphaned.length} tracked unit(s) run on no box and are declared as such (${orphaned.join(", ")}) — `
      + "each carries the decision it is waiting on."
    : "";

  if (faults.length) {
    return { state: "fail", undeclared, orphaned, absent, misdeclared, claimedAbsent, absentByRetirement,
      message: faults.join(" ") + retiredLine + orphanLine + boxLine + filesLine };
  }
  return {
    state: "pass", undeclared, orphaned, absent, misdeclared, claimedAbsent, absentByRetirement,
    message: `${liveBases.length} live unit(s), all declared; `
      + `${UNIT_INVENTORY.filter((u) => u.tracked).length} entr(y/ies) tracked, `
      + `${UNIT_INVENTORY.filter((u) => u.runsOn.length && !u.tracked).length} live-and-untracked BY DECLARATION `
      + `with a stated reason.${retiredLine}${orphanLine}${boxLine}${filesLine}`,
  };
}

/**
 * — A systemd `WorkingDirectory` IS NOT ALWAYS A PATH, and handing it to `git -C` as though it
 * were put a `fatal:` in the deploy journal on every tick for at least eleven ticks.
 *
 * `WorkingDirectory=~` is rendered by `systemctl show` as `!/home/<user>`. The `!` is systemd's marker,
 * not a directory anybody can change into, so `git -C '!/home/<user>'` fails — correctly — and the
 * unit running the check drops out of the comparison it is running. `-` is the other documented prefix
 * (ignore a missing directory) and can appear with it.
 *
 * PARSED, NOT TRIMMED BLIND. Anything that is not an absolute path after the prefixes come off is
 * returned as `path: null` with a reason, because the useful answer to "is this a directory I can ask
 * git about" is no plus a sentence, and a caller that gets `null` can then say WHY it did not compare a
 * unit instead of silently dropping it.
 *
 * @param {string|null} raw  the value `systemctl show -p WorkingDirectory` printed
 * @returns {{path: string|null, prefixes: string, why: string|null}}
 */
export function unitWorkingDirectory(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return { path: null, prefixes: "", why: "the unit reported no WorkingDirectory" };
  const m = /^([-!]*)(.*)$/.exec(s);
  const prefixes = m[1] ?? "";
  const rest = (m[2] ?? "").trim();
  if (!rest.startsWith("/"))
    return { path: null, prefixes, why: `WorkingDirectory is not a literal absolute path: ${s}` };
  return { path: rest, prefixes, why: null };
}

/**
 * / bundle — WHICH UNITS IS THIS DEPLOY ENTITLED TO JUDGE ON ITS COMMIT?
 *
 * The "services share one commit" straddle arm compared every unit in `CHECKED_UNITS`, and that list is
 * "every unit this repo has heard of on any box" — which on production includes units this product
 * neither owns nor touches. `client-access` runs a script from a different product's checkout;
 * `graph-notify-adapter`, `clawdi-courtlistener-mcp` and the other product's bridges have WorkingDirectories
 * inside a different clone entirely. The deploy skill states in as many words that a trademark deploy
 * must not restart `client-access`. So the arm demanded commit agreement from services this deploy is
 * forbidden to move, and reddened on every production deploy for units behaving correctly.
 *
 * THE DISCRIMINATOR IS THE CLONE, and it is not a second list to keep in step. A unit belongs to this
 * deploy when its WorkingDirectory resolves into the same git checkout the deploy is deploying — which
 * is precisely the derivation the deploy itself uses to pick what to restart, and precisely what the
 * inventory's own prose already gives as the reason those units are untracked ("its WorkingDirectory is
 * inside that checkout, not this clone"). `serviceClones()` has read it all along; the arm just never
 * used it.
 *
 * NOT `tracked`, which is the tempting shortcut and is a different question. `trademark-portal` and
 * `trademark-ops-mcp` carry no tracked unit file and are unmistakably this product's; scoping on
 * `tracked` would have dropped three of our own services out of the guarantee to silence two of theirs.
 *
 * A FOREIGN UNIT ON ANOTHER COMMIT IS REPORTED, NEVER FAILED. It is real information — it says the box
 * is shared and with what — and suppressing it entirely would trade one blind spot for another.
 *
 * — AND A UNIT IT COULD NOT READ IS REPORTED TOO. This arm filtered to units with a resolved head
 * and said "4 unit(s) of this deploy, all on <sha>" — over a population of five, with the fifth dropped
 * for being unreadable and no mention that it existed. That is agreement asserted over a population
 * that was filtered without saying so, and it is exactly the claim a reader of a deploy gate must be
 * able to trust: a genuine deploy unit whose WorkingDirectory became unreadable would vanish from the
 * comparison and the arm would still say ALL. Its own sibling `unitFileDriftVerdict` had the pattern
 * already — "12 unit(s) had no readable fragment and were NOT compared" — so this is that sentence,
 * borrowed. The count still passes; what changes is that the arm now says what the count is OF.
 *
 * PURE. The caller reads systemd and git.
 *
 * @param {object} a
 * @param {{unit:string, clone:string|null, head:string|null}[]} a.clones  every probed unit
 * @param {string|null} a.deployClone  the git toplevel this deploy is deploying
 * @param {string|null} a.expectHead   the commit the deploy believes it just placed
 * @param {boolean} a.ahead            the clone holds commits its remote does not
 * @returns {{state:"pass"|"fail"|"skip", message:string, owned:string[], foreign:string[]}}
 */
export function serviceCommitVerdict({ clones = [], deployClone = null, expectHead = null, ahead = false } = {}) {
  const running = (clones ?? []).filter((c) => c?.head);
  // — ASKED AND FAILED, which is not the same as "reported no WorkingDirectory". Only a unit the
  // caller actually tried to read and could not lands here; an inactive unit with nothing to compare is
  // not a gap in the population and is not reported as one.
  const unreadable = (clones ?? []).filter((c) => c && !c.head && c.unreadable);
  const norm = (p) => String(p ?? "").replace(/\/+$/, "");
  const foreign = running.filter((c) => norm(c.clone) !== norm(deployClone));
  const owned = running.filter((c) => norm(c.clone) === norm(deployClone));
  const asideParts = [
    foreign.length
      ? `${foreign.length} unit(s) on another clone, not this deploy's to judge: ${foreign.map((c) => c.unit).join(", ")}`
      : "",
    unreadable.length
      ? `${unreadable.length} unit(s) could NOT be read and were NOT compared: ${unreadable.map((c) => `${c.unit} (${c.unreadable})`).join("; ")}`
      : "",
  ].filter(Boolean);
  const aside = asideParts.length ? ` · ${asideParts.join(" · ")}` : "";
  const names = { owned: owned.map((c) => c.unit), foreign: foreign.map((c) => c.unit), unreadable: unreadable.map((c) => c.unit) };

  // COULD NOT SCOPE ⇒ DO NOT JUDGE. Without knowing which clone is being deployed, every unit looks
  // equally like ours, which is the state that produced the false red. A failure to look is not a
  // finding about the deployment — the same rule the three-outcome split above already settled.
  if (!norm(deployClone)) {
    return { state: "skip", ...names,
      message: `the deploy's own clone could not be resolved, so ownership could not be decided and the commit was NOT compared${aside}` };
  }
  if (!owned.length) {
    return { state: "skip", ...names,
      message: `no unit reported a WorkingDirectory inside ${deployClone} — nothing of this deploy's to compare${aside}` };
  }

  const heads = [...new Set(owned.map((c) => c.head))];
  if (heads.length > 1) {
    const byHead = heads.map((h) => `${h.slice(0, 8)}: ${owned.filter((c) => c.head === h).map((c) => c.unit).join(",")}`);
    return { state: "fail", ...names,
      message: `${heads.length} DIFFERENT commits are serving this deployment — ${byHead.join(" | ")}${aside}` };
  }
  const head = heads[0];
  if (ahead) {
    return { state: "fail", ...names,
      message: `all on ${head.slice(0, 8)} but the clone is AHEAD of its remote — commits exist here and in no repo${aside}` };
  }
  if (expectHead && !head.startsWith(expectHead) && !expectHead.startsWith(head.slice(0, 8))) {
    return { state: "fail", ...names,
      message: `all on ${head.slice(0, 8)}, expected ${expectHead.slice(0, 8)}${aside}` };
  }
  return { state: "pass", ...names,
    message: `${owned.length} unit(s) of this deploy, all on ${head.slice(0, 8)}${expectHead ? " (as expected)" : ""}${aside}` };
}
