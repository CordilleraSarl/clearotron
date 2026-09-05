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

/**
 * Which of the installed units a `--background` REFRESH must restart.
 *
 * — Hera's review of the F15 fix. `enable --now` on an ALREADY-ACTIVE unit is a
 * no-op, so a refresh over an updated checkout leaves the old process running the old files. The restart
 * loop that exists for exactly that named a hardcoded PAIR — the same pair the health check named, three
 * lines below it — with the same stale justification: "the oneshot and its triggers pick the new copies
 * up on their next activation by themselves". There is no oneshot in the set.
 *
 * So a refresh restarted the portal and the engine door onto new code and left the worker and the client
 * door on the old, while the health check reported all four up. Measured on the test box: `enable --now`
 * left MainPID unchanged. Fixing the check without fixing this made it worse, not better — a more
 * confident report over an unchanged restart.
 *
 * PURE, and separated from the shelling-out, because the decision is the half that had the bug and the
 * half worth driving. A oneshot is excluded for the reason the old comment gave, which is sound for a
 * oneshot and was simply not true of anything in this set: restarting one re-runs it, and it picks up
 * new files on its next activation anyway.
 *
 * @param {readonly string[]} units    the install set
 * @param {(u: string) => string} typeOf  the unit's declared systemd Type, lowercased
 */
export function unitsToRestartOnRefresh(units, typeOf) {
  return units.filter((u) => typeOf(u) !== "oneshot");
}

/**
 * Is this unit healthy, given what systemd says about it?
 *
 *. The verdict required `NRestarts === "0"`, and NRestarts is a LIFETIME
 * counter — it counts every restart since the unit was loaded, so a unit that crash-looped, recovered,
 * and has served ever since carries a non-zero count while reading `active/running`. `start
 * --background` printed "✗ … is NOT running (active/running, restarts 15)" and exited 1 on a healthy
 * box. Measured on the box, and again from scratch on a throwaway unit: crash-looping reads 3,
 * recovery by systemd's OWN auto-restart reads 4 — still `active/running`.
 *
 * WHAT CLEARS IT (measured on systemd 255.4-1ubuntu8.17 — the version travels with the claim, because
 * that reset is not documented contract; this corrects an earlier note here that said otherwise): an
 * explicit `systemctl restart` sets it to 0, and so does `reset-failed` — which is the better remedy
 * for a reader, because it clears the count without touching the running process. What does NOT clear
 * it is systemd's own auto-restart, which is the case that produced the false refusal.
 *
 * The real crash loop needs no counter — a looping unit reads `activating/auto-restart`, never
 * `active/running`. The count is history, and belongs where a reader asks about a box they did not
 * just restart: `doctor`, not the health line of a command that restarts the unit on its way past.
 *
 * PURE, so the recovered-unit case can be driven rather than asserted from the source: that case is the
 * whole finding, and a source match would go green on a verdict that still used the counter elsewhere.
 */
export function unitHealthVerdict({ type = "simple", activeState = null, subState = null, unitFileState = null, nRestarts = 0 } = {}) {
  const restarts = Number.isFinite(Number(nRestarts)) ? Number(nRestarts) : 0;
  if (type === "oneshot") {
    // A oneshot that has exited is healthy by design; what it must be is ENABLED.
    return { ok: unitFileState === "enabled", restarts, kind: "oneshot" };
  }
  return { ok: activeState === "active" && subState === "running", restarts, kind: "service" };
}
