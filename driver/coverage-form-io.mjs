// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// coverage-form-io.mjs — the ONE place the coverage form's inputs are read off disk.
//
// coverage-form.mjs and coverage-union.mjs are PURE so they test offline. This module is the impure
// edge: it resolves the paths and assembles the driver's input from the run dir. It exists so the
// four callers — the pipeline (which writes the form before the digest dispatches), the gateway (which
// re-unions it before every judgement), the record_coverage tool (coverage-tool.mjs — the seat's one
// route into it mid-turn) and verify.mjs (which judges it) — cannot disagree about WHICH files the
// form is derived from or WHERE the accumulator lives. Deriving a path or a read set twice is the
// drift cost weeks.
//
// THE ERA STAMP IS `_driver/coverage-enum.json`, EXTENDED. That sentinel already exists, is already
// written by runDigest on every pass that will actually run, is already the arming key for the off-enum
// gate, and is already declared in stage-context.VALIDATOR_SIDECARS. adds `form_required: true` and
// `form_path` to it rather than minting a second stamp, so there is one answer to "was a form required
// on this run" and archived runs — which carry either no sentinel at all or a pre- one with no
// `form_required` — leave the whole coverage-form arm OFF and never flip a replay verdict.
//
// THE WRITE ORDER IS LOAD-BEARING AND IT IS STAMP FIRST. 's form write is best-effort and only
// note()s on failure, and its own comment names the outcome it fears: "an absence reading as a pass,
// which is the one outcome this file exists to refuse". It is reachable — a full disk fails as "artifact
// absent", not as a disk error. Writing the FORM first and the stamp second reproduces that hole: a
// failed form write leaves no stamp, the gate never arms and the run passes having judged nothing.
// Writing the STAMP first inverts it: a failed form write leaves a stamp that says a form was required
// and no form to judge, which is `coverage_form_missing` — a named driver bug, fail-closed.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //
import { COVERAGE_STATUSES, COVERAGE_FORM_NAME, REGISTER_AXES } from "./coverage-ledger.mjs";
import { coverageFormSidecarName, parseCoverageForm } from "./coverage-form.mjs";
import { capabilitiesFor } from "./register-capabilities.mjs";

export { COVERAGE_FORM_NAME };

/**
 * The form's paths for a run dir. PURE (string work).
 *
 * `sidecar` is the accumulator in `_driver/` — the ONE live copy, the artifact verify.mjs judges and
 * the record_coverage tool writes. `seat` is the RETIRED seat-facing copy's address: nobody writes it
 * any more (the typed-transport conversion — the seat records values through `record_coverage` and
 * never opens a coverage file), and it is kept only so archived runs' seat copies can still be named
 * by tooling that reads them. The mirror died for disposition-tool.mjs's stated reason: a mirror
 * nothing reads is a second writer waiting to drift.
 */
export function coverageFormPaths(runDir, formName = COVERAGE_FORM_NAME) {
  return {
    seat: join(runDir, formName),
    sidecar: driverDir(runDir, coverageFormSidecarName(formName)),
  };
}

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

/**
 * The era stamp, read. Returns {required, formName} — `required` is true only when a driver carrying
 * this code stamped it, so every archived run answers false and the arm stays off for all of them.
 */
export function coverageFormStamp(runDir) {
  const s = readJson(driverDir(runDir, "coverage-enum.json"));
  return {
    required: s?.form_required === true,
    formName: (typeof s?.form_path === "string" && s.form_path.trim())
      ? basename(s.form_path.trim()) : COVERAGE_FORM_NAME,
  };
}

/**
 * The driver's input for the form, assembled from the run dir.
 *
 * @returns {{input: object|null, absent: string|null}} — `absent` NAMES which half of the plan
 * apparatus was out of reach, from COVERAGE_ABSENCE_CAUSES.
 *
 * M6 CHANGED WHAT THE ABSENCE MEANS, 2026-08-14. It used to return a bare null, and the pipeline
 * answered that by arming the enum sentinel WITHOUT the form arm: no stamp, no form, no coverage-form
 * gate — "unchanged behaviour, not a hole", which was true of the gate and false of the report, because
 * the dispatch then told the seat to write the `## Coverage ledger` table itself. M6 always arms and
 * always writes; a run that can carry no rows gets a form DECLARING that and naming this cause. Which
 * is why the cause is returned rather than discarded: a declaration that cannot say what caused it is
 * indistinguishable from a driver that forgot to write one.
 *
 * A band that will not parse leaves its axis absent from `bandBlocksByAxis`, so that axis contributes no
 * open-block rows — the same per-axis catch the old gate had, and for the same reason: a band parse
 * defect is refused one stage earlier by validators.registerUnit (`named_band_invalid`), so it is not
 * this gate's to re-adjudicate. The axes it happened to are RECORDED on the form
 * (`generated_from.bands_unreadable`) rather than swallowed, so the absence is visible in the artifact.
 */
export function coverageFormInput(runDir) {
  const exec = readJson(driverDir(runDir, "plan-execution.json"));
  if (!exec || typeof exec !== "object" || !Array.isArray(exec.skeleton)) return { input: null, absent: "no_plan_execution_receipt" };
  const plan = readJson(driverDir(runDir, "register-plan.json"));
  if (!plan || !Array.isArray(plan.entries)) return { input: null, absent: "no_frozen_plan" };
  const bandBlocksByAxis = {};
  const bandsUnreadable = [];
  for (const s of exec.skeleton) {
    const axis = String(s?.axis ?? "").trim();
    if (!axis) continue;
    const parsed = readJson(join(runDir, "register-units", `${axis}-band.json`));
    if (parsed == null) { bandsUnreadable.push(axis); continue; }
    bandBlocksByAxis[axis] = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.blocks) ? parsed.blocks : []);
  }
  const deferredReasons = {};
  for (const d of (Array.isArray(exec.deferred) ? exec.deferred : [])) {
    if (d?.qid) deferredReasons[String(d.qid)] = String(d.reason ?? "");
  }
  let activeAxes = null;
  try {
    const units = readdirSync(join(runDir, "register-units")).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));
    if (units.length) activeAxes = units;
  } catch { /* no units dir in reach — the skeleton's axes carry the form */ }
  // ── — THE ONE SNAPSHOT PAIR IN THIS CLASS THAT IS NOT GUARDED, MADE OBSERVABLE ──────────────
  //
  // `activeAxes` is BASENAME-DERIVED: every `.md` in register-units becomes an axis. verify.mjs records
  // what that costs, and records it as unguarded:
  //
  //     "a stray `.md` there would mint a driver axis row the seat cannot repair — the union
  //      regenerates it every pass — and the ladder would run out. […] if it ever is [observed], it is
  //      a DRIVER defect and it needs its own token naming the driver."
  //
  // That is this class exactly: an eligibility side computed from a directory listing meeting an
  // enforcement side regenerated every pass, with the regenerated side winning and nothing able to
  // converge. Of the nine sites in the snapshot sub-shape it is the only one where the two ends do not
  // read one snapshot.
  //
  // WHAT THIS DOES NOT DO IS FILTER. Dropping an unrecognised unit would silently shrink the form's
  // axis set, and a coverage form that quietly covers less is a worse artifact than the unrepairable
  // row it would be avoiding — the same trade this file already refuses when an unknown provider "reads
  // as unestablished, which discloses". The axis list is unchanged; what changes is that the run can
  // now SAY the case occurred instead of dead-ending on it silently.
  //
  // REGISTER_AXES is the closed set and it is imported, not re-listed: a second copy of the axis
  // vocabulary is how one of them ends up with three entries.
  const unknownAxisUnits = (activeAxes ?? []).filter((a) => !REGISTER_AXES.includes(String(a).trim().toLowerCase()));
  // — the two arguments that make the binding-layer disclosure fire on a REAL run.
  //
  // Stage 1 landed the machinery and nothing passed these, so `coverageFormRows` produced the row for a
  // test and never for the pipeline. That is a working guard that guards nothing, and it is the exact
  // shape of green this codebase keeps having to unlearn.
  //
  // Both come off the FROZEN PLAN, deliberately, not off the live environment: the form must describe
  // what THIS run planned, and a capability contract re-read from a since-changed env would describe a
  // different run. A plan frozen before has no `ordered_jurisdictions`, so it degrades to no rows
  // rather than to wrong ones.
  let capabilities = null;
  try { capabilities = plan.provider ? capabilitiesFor(plan.provider) : null; }
  catch { capabilities = null; }   // an unknown provider id reads as unestablished, which discloses
  const orderedTerritories = Array.isArray(plan.ordered_jurisdictions) ? plan.ordered_jurisdictions : [];
  return { input: { skeleton: exec.skeleton, plan, bandBlocksByAxis, deferredReasons, activeAxes,
    bandsUnreadable, orderedTerritories, capabilities, unknownAxisUnits }, absent: null };
}

/**
 * The same derivation, as the shape every existing caller reads: the input, or null.
 *
 * ONE DERIVATION, TWO VIEWS — deliberately not a second function asking the same two questions of the
 * same two files. M6 needs the CAUSE where the pre-M6 callers need only the absence, and a second
 * copy of "is the plan apparatus in reach" is the shape that has cost this codebase four defects in a
 * day: two answers to one question, no way for either to know the other disagreed.
 */
export function readCoverageFormInput(runDir) {
  return coverageFormInput(runDir).input;
}

/** Read the DRIVER'S copy of the form. Three states, and they are not the same fact — see verify.mjs. */
export function readCoverageForm(runDir, formName = COVERAGE_FORM_NAME) {
  const { sidecar } = coverageFormPaths(runDir, formName);
  if (!existsSync(sidecar)) return { rows: null, error: null, present: false, parsed: null };
  let raw = null;
  try { raw = readFileSync(sidecar, "utf8"); }
  catch { return { rows: null, error: `${basename(sidecar)} exists and could not be read`, present: true, parsed: null }; }
  // `parsed` rides out because M6's absence declaration is a TOP-LEVEL fact about the form, not a
  // row — and verify.mjs is the only reader allowed to act on it. Carried rather than re-read: reading
  // the same bytes twice is how two answers to one question get into a codebase.
  const { rows, error, parsed } = parseCoverageForm(raw);
  return { rows, error: error ? `${basename(sidecar)} ${error}` : null, present: true, parsed };
}

/**
 * Write the accumulator. THE STAMP IS ALREADY ON DISK when this runs (armCoverageForm below): a throw
 * here therefore leaves the fail-closed state, never the fail-open one.
 *
 * THE `_driver/` COPY IS THE ONLY COPY, as of the typed-transport conversion. The seat-facing mirror
 * this function used to write beside it is DEAD: the seat records statuses only through the
 * `record_coverage` tool, the validator reads the accumulator, and repairs order tool calls rather
 * than file edits — so a mirror had no reader left and a file the seat may not edit sitting in its
 * run dir is a trap dressed as a courtesy (edit it, believe it recorded, learn otherwise a judgement
 * later). Same delete-not-gate ruling as the disposition form's mirror (disposition-tool.mjs).
 */
export function writeCoverageForm(runDir, form, formName = COVERAGE_FORM_NAME) {
  const { sidecar } = coverageFormPaths(runDir, formName);
  const json = JSON.stringify(form, null, 2) + "\n";
  mkdirSync(dirname(sidecar), { recursive: true });
  writeFileSync(sidecar, json);
  return true;
}

/**
 * Arm the era stamp. Written BEFORE the form and separately from it, which is the whole fail-closed leg:
 * from this point on, a run whose form is absent fails with `coverage_form_missing` naming the driver.
 * The existing off-enum sentinel content is preserved — one file, two facts, one write.
 */
export function armCoverageForm(runDir, formName = COVERAGE_FORM_NAME) {
  const p = driverDir(runDir, "coverage-enum.json");
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({
    statuses: COVERAGE_STATUSES,
    form_required: true,
    form_path: formName,
  }, null, 2) + "\n");
}

/** The off-enum sentinel WITHOUT the form arm — a run whose plan apparatus is out of reach. */
export function armCoverageEnumOnly(runDir) {
  const p = driverDir(runDir, "coverage-enum.json");
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ statuses: COVERAGE_STATUSES }, null, 2) + "\n");
}
