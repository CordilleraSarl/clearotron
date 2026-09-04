// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// unit-state-verdict.mjs — decide what a systemd unit's ActiveState MEANS.
//
// Extracted from scripts/live-surface-check.mjs for the same reason roster-verdict.mjs was
// extracted by: the decision lived inside a top-level-await script, where no test could reach it,
// and it produced a FALSE RED on the one gate whose entire value is being trusted.
//
//. The arm read:
//
//     const inactive = clones.filter((c) => c.active && c.active !== "active" && c.active !== "inactive");
//     ...
//     else if (inactive.length) fail("units active", ...)
//
// Anything that is neither `active` nor `inactive` is a fault. `prelim-driver` is a `Type=oneshot` fired
// by a 90-second timer, so EVERY drain passes through `activating` — and `activating` landed in that
// list. The filter tolerated the oneshot at rest and failed it for working. deploy-test.sh gates the
// hourly test-instance deploy on this script's exit code, so a deploy that happened to land inside a
// drain window reported the instance unhealthy and exited 1 on a deployment that was fine.
//
// The bug is not the enumeration — was right to give this three outcomes instead of two. The bug is
// INVERSE ENUMERATION over an incomplete vocabulary: listing the two states you have seen and calling
// everything else broken. Four of systemd's six states were then "broken" by default.
//
// So this module enumerates the vocabulary POSITIVELY, from the installed systemd's own documentation
// rather than from recall. `man 5 org.freedesktop.systemd1` on systemd 255 (255.4-1ubuntu8.16, the
// version running on the test and production boxes):
//
//     ActiveState contains a state value that reflects whether the unit is currently active or not.
//     The following states are currently defined: "active", "reloading", "inactive", "failed",
//     "activating", and "deactivating".
//
// Six, all six mapped below. That completeness is what makes the `failed` branch a real discriminator
// instead of a general loosening: after this change exactly one documented state fails, and it is the
// one that means the unit's last run did not succeed.
//
// ── why transitional states are tolerated for EVERY unit, not only for the oneshot ───────────────────
//
// The ruling on says "starting and stopping are both tolerated for a one-shot". That is descriptive
// of the case that was observed, not a restriction: the issue's own Scope section carries no unit-type
// qualifier, the arm has never been unit-type-aware, and it already tolerates `inactive` for everything.
// It is also the wrong place to draw the line — deploy-test.sh RESTARTS the long-running services
// immediately before running this check, so `trademark-portal=activating` is the same race with a
// different unit, and a oneshot-only fix would leave it standing. The unit's Type is still carried into
// the message so a reader can tell a oneshot mid-fire from a service mid-restart.
//
// ── why there is no "stuck in activating" timeout here ───────────────────────────────────────────────
//
// A tempting addition, and it must NOT be added without evidence this file does not have.
// prelim-driver.service ships `TimeoutStartUSec=12h`, because one fire runs a whole clearance: on the
// test box, `activating` is a normal steady state for HOURS. Any threshold small enough to catch a wedge
// is small enough to re-create in the middle of a real run. The wedged-`activating` class (the 19h
// wedge, driver/gateway.mjs) is caught where it is caused — the exec's SIGTERM/SIGKILL escalation
// settles unconditionally — not by a number invented here. The state's age is REPORTED so a human can
// judge; it is never acted on.
//
// ── what this module deliberately does NOT touch: the zero-check ────────────────────────────────
//
// 's Scope is one paragraph and it names one thing — the state vocabulary. So the FAULT branch is
// the only branch whose behaviour changes. 's separate guard, "0 active is not a pass", keeps
// origin/main's predicate (`ActiveState === "active"`, literally) and origin/main's message.
//
// This is not caution for its own sake. An earlier draft of this fix also widened the count to treat
// transitional units as up, on the reasoning that a oneshot mid-fire is "not nothing". The consequence:
// {5 services activating, 3 inactive} returned `pass` with a message that began "0 active" — a green
// tick on the deploy's final gate having confirmed that ZERO services were running. deploy-test.sh
// restarts the long-running services immediately before running this check, so that is the ordinary
// shape of the box, not a corner. Widening a count to make a message read better is how a guard dies.

/** The six documented ActiveState values of systemd 255, mapped to what the check must do about them. */
export const ACTIVE_STATE_MEANING = Object.freeze({
  active:       "running",        // up
  reloading:    "running",        // up, re-reading its configuration
  activating:   "transitional",   // up: entering active. Every oneshot fire passes through here.
  deactivating: "transitional",   // up: leaving active. Identical shape to `activating`.
  inactive:     "at-rest",        // down, and the previous run SUCCEEDED (or never happened)
  failed:       "broken",         // down, and the previous run did NOT succeed — the one real fault
});

/**
 * @param {string|null|undefined} active  a systemd ActiveState string
 * @returns {"running"|"transitional"|"at-rest"|"broken"|"unrecognised"|"absent"}
 */
export function classifyActiveState(active) {
  if (!active) return "absent";                       // the unit did not report — not a state, a silence
  return ACTIVE_STATE_MEANING[active] ?? "unrecognised";
}

/**
 * The "units active" arm.
 *
 * @param {object} o
 * @param {Array<{unit: string, active: string|null, type?: string|null, since?: string|null}>} o.units
 * @param {{ok: boolean, why: string|null}} o.probe  could the user bus be reached at all
 * @returns {{state: "pass"|"fail"|"warn"|"skip", message: string}}
 *
 * The caller must dispatch this through record(name, state, detail) — `warn` is a real outcome here and
 * the ({pass, fail, skip})[state] shorthand used elsewhere in the script has no key for it.
 */
export function unitsActiveVerdict({ units, probe }) {
  // — a failure to look is never a finding about the deployment.
  if (!probe?.ok)
    return { state: "skip", message: `could not enumerate systemd --user units — ${probe?.why ?? "no reason reported"}` };

  const label = (u) => `${u.unit}=${u.active}`
    + (u.type ? ` (${u.type}${u.since ? `, since ${u.since}` : ""})` : (u.since ? ` (since ${u.since})` : ""));

  const by = { running: [], transitional: [], "at-rest": [], broken: [], unrecognised: [], absent: [] };
  for (const u of units ?? []) by[classifyActiveState(u.active)].push(u);

  // `failed` still fails, and says which unit and how long it has been that way.
  if (by.broken.length)
    return { state: "fail", message: `${by.broken.map(label).join(", ")} — the unit's last run did not succeed` };

  // A state systemd defines and this file does not know is EXACTLY the shape, so it must not be a
  // red on a deploy gate; it must also never pass silently. It is named, as itself, as a warn.
  if (by.unrecognised.length)
    return { state: "warn", message: `${by.unrecognised.map(label).join(", ")} — this check does not recognise that ActiveState. `
      + `It is NOT being called a fault (that mistake is #425) and it is NOT being called healthy either: `
      + `the vocabulary here is systemd 255's six documented states, and this box reports one that is not among them` };

  // A unit that reported no ActiveState at all did not answer. The bus WAS reachable (probe.ok above),
  // so this is a per-unit silence rather than a failure to look — and a silence is a finding, not a
  // pass. It is a warn for the same reason an unrecognised state is: naming it is the whole point, and
  // grading silence better than a string you do not recognise is backwards.
  if (by.absent.length)
    return { state: "warn", message: `${by.absent.map((u) => u.unit).join(", ")} — `
      + `${by.absent.length} unit(s) reported no ActiveState at all, on a bus that answered. `
      + `That is a silence, not a state, and it is NOT being counted as healthy` };

  // — "0 active" is not a pass. It is either "I could not look" or "there is nothing running
  // here", and neither is "everything running here is fine".
  //
  // CHANGES NOTHING HERE. The count below is origin/main's, predicate and message unchanged:
  // `active`, literally, and nothing else. An earlier draft of this fix widened it to count
  // transitional units as up, which defeated this guard outright — {5 activating, 3 inactive} then
  // returned `pass` with a message that began "0 active", on the deploy's FINAL gate, on a box where
  // deploy-test.sh has just restarted every long-running service. 's Scope names one thing, the
  // state vocabulary of the FAULT branch above. Transitional units are named in the messages here so
  // they are never swallowed; they are counted as up nowhere.
  const activeCount = (units ?? []).filter((u) => u.active === "active").length;
  const alsoSeen = (by.transitional.length ? `; ${by.transitional.length} starting or stopping — ${by.transitional.map(label).join(", ")}` : "")
    + (by["at-rest"].length ? `; ${by["at-rest"].length} at rest` : "");

  if (activeCount === 0)
    return { state: "skip", message: "systemd --user answered and reported 0 active units — nothing was probed, "
      + `which is not the same as nothing being wrong${alsoSeen}` };

  return { state: "pass", message: `${activeCount} active`
    + (by.transitional.length ? `; ${by.transitional.length} starting or stopping — ${by.transitional.map(label).join(", ")}, which is a unit doing its job, not a fault` : "")
    + (by["at-rest"].length ? `; ${by["at-rest"].length} at rest` : "") };
}
