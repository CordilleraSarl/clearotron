// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// placement-form-io.mjs — the ONE place the placement form's inputs are read off disk.
//
// placement-form.mjs and placement-union.mjs are PURE so they test offline. This is the impure edge: it
// resolves the two paths and assembles the driver's input from the run dir. It exists so the three
// callers — the pipeline (which writes the form before placement dispatches), the gateway (which unions
// it before every judgement) and verify.mjs (which judges the rendered file) — cannot disagree about
// WHICH files the form is derived from or WHERE the two copies live.
//
// IT NEVER PARSES THE BAND. `syncPlacementForm` runs on every judgement inside the dispatch loop of the
// largest stage in the run; the merged band is megabytes. It reads only the two projections the band
// derivation already writes — `_driver/band-shape.json`'s floor and `_driver/register-positions.json` —
// both small, both derived after every band re-merge, both already the unit the digest and
// recall-reconciliation join on.
//
// THE ERA STAMP IS `_driver/stage-contracts.json`, EXTENDED. That marker already exists, is already
// written at DISPATCH only, and is already how validators.placement reads prompt vintage. adds
// `placementForm: 1` beside `structuredPlacements: 1` rather than minting a second stamp, so archived
// runs — which carry the old key alone — keep validating under the rules they were minted under and no
// replay verdict flips.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //
import { PLACEMENT_FORM_NAME, placementFormSidecarName, parsePlacementForm, renderPlacementsJson } from "./placement-form.mjs";
import { parsePlacementsJson } from "./placement-model.mjs";
import { atomicWrite } from "./progress.mjs";

export { PLACEMENT_FORM_NAME };

/** The seat-facing form and the driver's own copy, for a run dir. PURE (string work). */
export function placementFormPaths(runDir, formName = PLACEMENT_FORM_NAME) {
  return { seat: join(runDir, formName), sidecar: driverDir(runDir, placementFormSidecarName(formName)) };
}

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

/**
 * The era stamp, read. `required` is true only when a driver carrying this code stamped it, so every
 * archived run answers false and the whole form arm stays off for all of them.
 */
export function placementFormStamp(runDir) {
  const m = readJson(driverDir(runDir, "stage-contracts.json"));
  return { required: m?.["placement-inquiry"]?.placementForm === 1 };
}

/**
 * The driver's input, assembled from the run dir. Returns `{floors, positions}` where a NULL means the
 * projection could not be read — which the form records as `floors_unreadable` / `positions_unreadable`
 * rather than as an empty list, because "no floors" and "the file would not parse" are different facts
 * and a form that reported them alike would read an absence as a pass.
 */
export function readPlacementFormInput(runDir) {
  const shape = readJson(driverDir(runDir, "band-shape.json"));
  const pos = readJson(driverDir(runDir, "register-positions.json"));
  return {
    floors: Array.isArray(shape?.floors?.in_class_identical_or_near) ? shape.floors.in_class_identical_or_near : null,
    positions: Array.isArray(pos?.positions) ? pos.positions : null,
  };
}

/** Read the DRIVER'S copy. Three states, and they are not the same fact — see verify.mjs. */
export function readPlacementForm(runDir, formName = PLACEMENT_FORM_NAME) {
  const { sidecar } = placementFormPaths(runDir, formName);
  if (!existsSync(sidecar)) return { rows: null, error: null, present: false };
  let raw = null;
  try { raw = readFileSync(sidecar, "utf8"); }
  catch { return { rows: null, error: `${basename(sidecar)} exists and could not be read`, present: true }; }
  const { rows, error } = parsePlacementForm(raw);
  return { rows, error: error ? `${basename(sidecar)} ${error}` : null, present: true };
}

/** Read the SEAT's copy — what this attempt handed back. Absent/unreadable is "said nothing", not "empty". */
export function readSubmittedPlacementForm(runDir, formName = PLACEMENT_FORM_NAME) {
  const { seat } = placementFormPaths(runDir, formName);
  if (!existsSync(seat)) return null;
  let raw = null;
  try { raw = readFileSync(seat, "utf8"); } catch { return null; }
  const { rows } = parsePlacementForm(raw);
  return rows;   // null on a torn/unparseable write ⇒ the union reads it as "said nothing" ⇒ prior stands
}

/** Write both copies. */
export function writePlacementForm(runDir, form, formName = PLACEMENT_FORM_NAME) {
  const { seat, sidecar } = placementFormPaths(runDir, formName);
  const json = JSON.stringify(form, null, 2) + "\n";
  mkdirSync(dirname(sidecar), { recursive: true });
  writeFileSync(sidecar, json);
  writeFileSync(seat, json);
  return true;
}

/**
 * Render `placements.json` from the settled rows — PARSE-THEN-LAND. The rendered bytes are re-read with
 * the strict parser every downstream consumer uses BEFORE they replace the file, so a render defect can
 * never put an unparseable deliverable on disk; on a throw the previous file is left alone and the caller
 * is told. Same discipline as the coverage ledger's derived JSON.
 * @returns {{ok:boolean, placements:number, error:string|null}}
 */
export function renderPlacementsFile(runDir, rows, placementsPath = join(runDir, "placements.json")) {
  let json;
  try {
    const doc = renderPlacementsJson(rows);
    json = JSON.stringify(doc, null, 2) + "\n";
    parsePlacementsJson(json);   // the gate's own parser, before it lands
  } catch (e) { return { ok: false, placements: 0, error: String(e?.message ?? e).slice(0, 160) }; }
  // Atomic: a consumer must never see this file torn, and several read it without coordination.
  try { atomicWrite(placementsPath, json); }
  catch (e) { return { ok: false, placements: 0, error: String(e?.message ?? e).slice(0, 160) }; }
  return { ok: true, placements: JSON.parse(json).placements.length, error: null };
}
