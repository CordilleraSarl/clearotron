// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// server-units.mjs — WHICH UNITS A SERVER RUNS, written down once, read by everything that installs them.
//
// ── why this exists ─────────────────────────────────────────────────────────────
//
// The documented hosted install ran `render-units.mjs --apply` and installed TWO units: a queue watcher
// that is retired, and a provider bridge no box runs UNDER THAT NAME. Not the portal, not the engine
// door, not the drainer. It exited 0 having written two files, so it read as an install that worked.
//
// That second one is worth stating precisely, because "orphan" is the wrong word for it and the wrong
// word invites a deletion. `courtlistener-mcp` is a TRACKED TWIN OF A LIVE PRODUCTION SERVICE: the same
// OAuth bridge runs on production under a different unit name, from a different checkout of the same
// code, and the inventory's own entry says so. Nobody should ever delete that file on a nothing-runs-it
// premise. Positive selection makes the question moot — the file stays, and is simply not installed.
//
// The cause was not a missing skip-list. `render-units.mjs` iterates units carrying an `@PLACEHOLDER@`,
// because its job is resolving what configuration cannot reach; the generic units take `${VAR}` from
// their EnvironmentFile, so they carry no placeholder and a RENDERER CORRECTLY SKIPS THEM. The tool was
// doing its job. The documentation presented it as the install step.
//
// ── WHY THE FILTER IS POSITIVE, AND WHY NO INVENTORY FIELD COULD DO IT ───────────────────────────────
//
// The obvious repair — skip retired units and orphans — was measured and rejected. `clearotron-portal`,
// `clearotron-mcp-face` and `clearotron-worker` all declare `runsOn: []` with an `orphanReason`, exactly
// like `courtlistener-mcp` does: they are orphans BY DECLARATION because `runsOn` records boxes MEASURED to
// carry a unit, and no box carries the worker yet. A skip-on-orphan filter installs the two wrong units
// today and zero right ones tomorrow. `orphanReason` cannot discriminate either — all six carry one, and
// `clearotron-client-mcp`'s used to say the opposite thing — never install it eagerly, because starting
// it was the on-demand consent that opened client-account access. That row was rewritten on 2026-09-03
// when the owner superseded the posture (, settled point 2), which does not rescue the
// rejected repair: the reason a skip-on-orphan filter fails is that `runsOn: []` records boxes MEASURED,
// and every unit here starts life unmeasured.
//
// So the list is stated rather than derived. Two consequences, both wanted:
//
//   A NEW UNIT IS A DECISION, NOT A DEFAULT. A skip-list installs every new unit until somebody
//   remembers to exclude it; this installs none until somebody adds it. That is the discipline
//   driver/test/start-background-units.test.mjs already enforces in those words, and it exists because
//   the question has been got wrong before.
//
//   THE RETIRED FILES NEED NO DELETION. They stay in the tree until production is rebuilt — which is
//   the disposition  records and the reason deleting them was refused — and they
//   simply stop being installed, because they are not named here.
//
// ── ONE AUTHORITY, TWO CALLERS ───────────────────────────────────────────────────────────────────────
//
// NOT TO BE CONFUSED WITH `SERVER_UNITS` IN bin/start.mjs, which is one word away and answers a
// different question: which units, IF PRESENT, mean this box is already a server. That one is a
// DETECTOR — it exists so `clearotron start` can refuse to run a second portal beside a deployed one —
// and it deliberately still names a retired unit, because a box carrying the old posture is just as
// much a server as one carrying the new. A detector must recognise what IS there; an installer must
// place what SHOULD be. Merging them would make one of those two answers wrong.
//
// `bin/start.mjs --background` and `driver/systemd/render-units.mjs --apply` are the two ways units
// reach a box, and they used to answer this question separately. A value set in exactly one place is
// how `PORTAL_MCP_URL` came to be missing from every hosted install; a list kept in
// two places is the same defect with a plural. This module is neither caller, so neither owns it.

/**
 * The units an INSTALLER PLACES on a server, in start order: the door the portal calls, the portal, the drainer.
 *
 * These mirror the three children `bin/start.mjs` supervises in the foreground — one for one, which is
 * the shape the owner's ruling of 2026-08-31 asks for and the shape a reader can hold: the same three
 * processes either way.
 */
export const SERVER_INSTALL_SET = Object.freeze([
  "clearotron-mcp-face.service",
  "clearotron-portal.service",
  "clearotron-worker.service",
  // ── THE CLIENT DOOR JOINED HERE ON 2026-09-03, SUPERSEDING THE 2026-08-31 RULING ────────────────
  //
  // It was excluded by name until today, and the exclusion was correct under the ruling it cited:
  // "On demand is fine" — starting the door WAS the consent that opened client-account access, so an
  // installer that placed it would have made that consent meaningless.
  //
  // The owner superseded that knowingly (, settled point 2): the door auto-starts
  // with the product and THE PER-ACCOUNT KEY IS THE GATE, not whether a process runs. A door with no
  // key issued refuses everything, which is the same protection with a different mechanism — and a
  // better one, because it does not depend on a reader finding a verb.
  //
  // Recorded rather than quietly rewritten: a later reader meeting this line should see a ruling that
  // changed, not a guard that was weakened.
  "clearotron-client-mcp.service",
]);

/**
 * Installed and enabled ONLY by `clearotron connect`, never by an install path (,
 * owner ruling 2026-08-31). Named here so a reader of this file learns it exists and learns it is
 * excluded on purpose — an absence with no reason beside it is the thing this module is against.
 */
// SUPERSEDED 2026-09-03 and deliberately kept EMPTY rather than deleted. The
// concept is still real — a unit an install must not place is a thing this file must be able to say —
// and emptying it states that no unit is currently in that class, which is a claim a reader can check.
// Deleting the export would make the next such unit an unnamed absence instead.
export const ON_DEMAND_UNITS = Object.freeze([]);
