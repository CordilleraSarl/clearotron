// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// unit-file-drift.mjs —: the unit a box RUNS versus the unit the commit SHIPS.
//
// The deploy syncs code. It does not sync systemd units, and nothing said so. The test instance pulled
// a commit that changed `driver/systemd/prelim-driver.service`; the live unit did not change, the
// service restarted, and the health check passed — because the unit that was running was a perfectly
// valid unit. It just was not the one in the commit that had been deployed.
//
// THIS IS THE EXPENSIVE KIND OF FAILURE. It fails silently and it fails GREEN. Anyone reading the repo
// to answer "what configuration does production run" gets the wrong answer with no indication they
// should doubt it, and every unit edit in this repo's history has the same property.
//
// WHAT IS COMPARED, AND WHAT IS NOT. The live FRAGMENT — the main unit file systemd resolved — against
// the tracked file of the same BASENAME anywhere in the clone that unit runs from ( widened that
// lookup from `driver/systemd/` alone; four tracked unit files live elsewhere and were compared against
// nothing). Drop-ins (`<unit>.d/*.conf`) are
// NOT drift: they are the sanctioned way a box carries what a repo must not (secrets, per-host paths),
// and this repo uses them for exactly that. They are reported so a reader knows the effective unit is
// not the tracked one alone.
//
// PURE. The caller does the reading; this decides. Same shape as unit-state-verdict.mjs and for the
// same reason — a verdict a test cannot reach is a verdict nobody checks.

// ── TEMPLATE UNITS, ─────────────────────────────────────────────────────────────────────────
//
// `docs/architecture/05-config-governance.md` (tier 2) splits tracked units in two: GENERIC ones defer
// their values to the EnvironmentFile and are safe to sync verbatim, so their live copy is expected to
// MATCH; TEMPLATE ones ship placeholders and carry the real identity-edge values only in the live copy,
// merged by hand after a diff, so their live copy is expected to DIFFER. Copying a template over a live
// unit replaces working auth with placeholders that look configured — the 2026-07-19 incident.
//
// This matters here because 's correction gave client-mcp and client-mcp-apikey the tracked files
// they always had, in mcp-server/remote/. Comparing a template byte-for-byte against its live copy is a
// guaranteed red on every production run, and an instrument that is red by construction on day one is an
// instrument that gets discounted by day two.
//
// THE DISCRIMINATOR IS THE BANNER IN THE FILE, not a second list beside it. A list would be one more
// declaration free to drift from the thing it describes, which is the failure this whole area keeps
// producing. `unitBody` strips comments, so the banner is invisible to the comparison and readable from
// the raw text — the file classifies itself.
const TEMPLATE_BANNER = /^\s*[#;].*TEMPLATE UNIT/m;

/** Does this tracked unit file declare itself a template? PURE. */
export function isTemplateUnit(text) {
  return TEMPLATE_BANNER.test(String(text ?? ""));
}

/** Normalise a unit file for comparison: strip comments and blank lines, trim, keep order. PURE. */
export function unitBody(text) {
  return String(text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith(";"))
    .join("\n");
}

/**
 * @param {Array} units — one row per unit the caller could look at:
 *   { unit, live, tracked, dropIns }
 *     live     — the live fragment's text, or null when systemd named no fragment
 *     tracked  — the text of the tracked unit file of this basename in the running clone, found by
 *                driver/unit-files.mjs wherever it sits, or null when the repo tracks none
 *     dropIns  — array of drop-in paths (may be empty)
 * @param {{ok: boolean, why?: string}} probe — could the caller enumerate at all?
 * @returns {{state: "pass"|"fail"|"skip", message: string, drifted: string[], templated: string[]}}
 *
 * THREE OUTCOMES, and the third is the one this file exists for. "Could not look" is never "nothing is
 * wrong" — the lesson, applied to the arm that has the same failure mode one layer down: a unit
 * whose fragment cannot be read is a unit whose drift is unknown, and calling that a pass is how a box
 * runs an old unit for six days.
 */
export function unitFileDriftVerdict({ units = [], probe = { ok: true } } = {}) {
  if (!probe.ok) {
    return { state: "skip", drifted: [],
      message: `could not enumerate systemd units, so no unit file was COMPARED — ${probe.why ?? "no reason given"}. `
        + "This is a failure to look, not a finding about the deployment" };
  }
  const comparable = units.filter((u) => u && u.live != null && u.tracked != null);
  const unreadable = units.filter((u) => u && u.live == null);
  const untracked = units.filter((u) => u && u.live != null && u.tracked == null);
  if (!comparable.length) {
    return { state: "skip", drifted: [],
      message: `systemd answered and no unit could be compared to a tracked file (${units.length} unit(s) seen, `
        + `${unreadable.length} with no readable fragment, ${untracked.length} with no tracked unit file `
        + "anywhere in the tree) — nothing was checked" };
  }
  const differs = comparable.filter((u) => unitBody(u.live) !== unitBody(u.tracked));
  // A template that differs is the arrangement working, and it is REPORTED rather than passed over: a
  // reader must not read "8 units match" and believe the client door's live values were checked. What is
  // NOT claimed here is that the difference is only the placeholders — nothing diffs an identity-edge
  // value against a live one, and saying so is cheaper than someone assuming it.
  const templated = differs.filter((u) => isTemplateUnit(u.tracked)).map((u) => u.unit);
  const drifted = differs.filter((u) => !isTemplateUnit(u.tracked)).map((u) => u.unit);
  const withDropIns = comparable.filter((u) => (u.dropIns ?? []).length).map((u) => u.unit);
  const tail = [
    unreadable.length ? `${unreadable.length} unit(s) had no readable fragment and were NOT compared` : "",
    untracked.length ? `${untracked.length} run from no unit file tracked anywhere in the tree` : "",
    templated.length ? `${templated.length} TEMPLATE unit(s) differ as designed (${templated.join(", ")}) — `
      + "they ship placeholders and hold the real values only in the live copy, so this arm does not "
      + "check their contents at all" : "",
    withDropIns.length ? `drop-ins present on ${withDropIns.join(", ")} (sanctioned — the effective unit is not the tracked file alone)` : "",
  ].filter(Boolean).join("; ");
  if (drifted.length) {
    return { state: "fail", drifted, templated,
      message: `${drifted.length} live unit(s) differ from the commit that is deployed — ${drifted.join(", ")}. `
        + "The deploy syncs code, not units: install them and `systemctl --user daemon-reload`"
        + (tail ? `. Also: ${tail}` : "") };
  }
  return { state: "pass", drifted: [], templated,
    message: `${comparable.length - templated.length} generic unit(s) match the tracked file${tail ? `. ${tail}` : ""}` };
}
