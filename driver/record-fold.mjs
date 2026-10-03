// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE FOLDED RECORD IS THE RECORD FROM THE DELIVERY SEAM ON (design, 2026-10-03).
//
// Before the overview and the cards are built, the driver folds a second filing of the same conflict into
// one finding and renumbers the rest. A synthesis save after that seam — the pre-delivery lint's narrative
// repair, the stale repair, the fix pass — wrote the model's own record back over the folded one, and
// nothing folded it again. Measured on a test run: the folded filing stood as its own finding again, every
// finding after it moved down one place, 19 cards were rebuilt for findings that had only moved, and the
// last finding shipped without the prose card it was owed, because no card had ever been built at its
// ordinal.
//
// So once the seam is passed, every accepted save folds again on acceptance, and findings.json — what the
// reviewer after the seam, the cards and the delivery read — is always the folded record. Two things stay
// in the model's numbering, because the model wrote them in it: its own record, which stays the base for
// its patches (the call records the save keeps), and whatever is named against that record — a flag's
// ordinals, the ordinals a save records it touched, the narrative's finding headings. So the record the
// save wrote is kept beside the folded file while a fold is in force, with the fold's map both ways, and a
// reader that joins something in the model's numbering reads that record (`modelRecordPath`).
//
// THE STATE, in _driver/fold.json:
//   seamPassed — this pass has passed the seam. A pass opens with it cleared (`openPass`) and the seam's
//                own fold sets it, so a save before the seam on a resumed pass writes the model's record,
//                as every save before the seam always has.
//   map        — {modelToFolded, foldedToModel} for findings.json as it stands; null when the file is
//                the record as the save wrote it.
// and _driver/findings-unfolded.json — that record, in the model's numbering, kept only while a fold is
// in force.
import { readFileSync, writeFileSync, existsSync, renameSync, rmSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";
import { consolidateFindings, remapActionOrdinals, parseFindingsJson } from "./findings-model.mjs";
import { parseFrameworkManifest } from "./framework.mjs";

export const FOLD_FILE = "fold.json";
export const UNFOLDED_FILE = "findings-unfolded.json";

const bothWays = (ordinalMap) => {
  const modelToFolded = {}, foldedToModel = {};
  for (const [m, f] of ordinalMap) { modelToFolded[m] = f; (foldedToModel[f] ??= []).push(m); }
  return { modelToFolded, foldedToModel };
};

/**
 * Fold a findings document as the delivery seam does: a second filing of the same conflict folds into one
 * finding, the findings renumber, and the actions follow the renumber. `map` is null when nothing folds,
 * and the document is then returned as it came. PURE.
 */
export function foldRecord(doc, manifest = null) {
  const list = Array.isArray(doc?.findings) ? doc.findings : [];
  if (list.length < 2) return { doc, merges: [], map: null };
  const { findings, merges, ordinalMap } = consolidateFindings(list, (doc.schema_version ?? 1) >= 4 ? manifest : null);
  if (!merges.length) return { doc, merges: [], map: null };
  const next = { ...doc, findings };
  // spec 64 — a merged-away ordinal remaps to its kept finding's new ordinal
  if (Array.isArray(doc.actions)) next.actions = remapActionOrdinals(doc.actions, ordinalMap);
  return { doc: next, merges, map: bothWays(ordinalMap) };
}

/** The fold state of a run, or null before any seam. Never throws. */
export function readFold(runDir) {
  try { return JSON.parse(readFileSync(driverDir(String(runDir ?? ""), FOLD_FILE), "utf8")); } catch { return null; }
}

function writeFold(runDir, { seamPassed, map = null, merges = [] }) {
  const at = driverDir(String(runDir ?? ""), FOLD_FILE);
  mkdirSync(dirname(at), { recursive: true });
  const tmp = `${at}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({
    _provenance: "the fold of findings.json as it stands: whether this pass has passed the delivery seam, and the map from the model's ordinals to the folded ones and back",
    at: new Date().toISOString(), seamPassed: Boolean(seamPassed), map,
    // ordinals only: the names stay in the record itself
    merges: (merges ?? []).map((m) => ({ kept: m.kept, dropped: m.dropped })),
  }, null, 2) + "\n");
  renameSync(tmp, at);
}

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/**
 * Fold findings.json in place and record the fold. The seam calls it with `seam: true`; every accepted save
 * calls it after writing the record, and it folds only once this pass has passed the seam. Before the seam
 * the save wrote the model's record as it always has, and the state then says the file is unfolded.
 *
 * Returns `{merges}`, empty when nothing folded, and `error` when a fold could not be made. Never throws: a
 * record that cannot be folded stays as the save wrote it, which is what every run did before this.
 */
export function foldFindingsFile(runDir, findingsPath, manifest, { seam = false } = {}) {
  const dir = String(runDir ?? "");
  const state = readFold(dir);
  const unfoldedAt = driverDir(dir, UNFOLDED_FILE);
  try {
    if (!seam && state?.seamPassed !== true) {
      if (state?.map) { writeFold(dir, { seamPassed: false }); rmSync(unfoldedAt, { force: true }); }
      return { merges: [] };
    }
    if (!existsSync(findingsPath)) { writeFold(dir, { seamPassed: true }); return { merges: [] }; }
    const raw = readFileSync(findingsPath, "utf8");
    const { doc, merges, map } = foldRecord(JSON.parse(raw), manifest);
    if (!merges.length) {
      // Nothing folds. On a resumed pass the file can be the earlier pass's fold with no save since: the
      // record and the map it was folded by both stand.
      const held = seam && state?.map && existsSync(unfoldedAt);
      writeFold(dir, held ? { seamPassed: true, map: state.map, merges: state.merges } : { seamPassed: true });
      if (!held) rmSync(unfoldedAt, { force: true });
      return { merges: [] };
    }
    parseFindingsJson(JSON.stringify(doc));   // the folded record must still validate; a throw keeps the record as written
    writeAtomic(unfoldedAt, raw);
    writeAtomic(findingsPath, `${JSON.stringify(doc, null, 2)}\n`);
    writeFold(dir, { seamPassed: true, map, merges });
    return { merges };
  } catch (e) {
    // A fold that cannot be made leaves the record as written. The seam is still passed.
    if (seam) { try { writeFold(dir, { seamPassed: true }); rmSync(unfoldedAt, { force: true }); } catch { /* best-effort */ } }
    return { merges: [], error: String(e?.message ?? e).replace(/\s+/g, " ").slice(0, 160) };
  }
}

/** The fold an accepted save makes, with the run's frozen framework manifest. Never throws. */
export function foldAfterSave(runDir, findingsPath) {
  let manifest = null;
  try { manifest = parseFrameworkManifest(readFileSync(driverDir(String(runDir ?? ""), "framework.json"), "utf8")); }
  catch { manifest = null; }   // a run with no frozen manifest folds as the seam does for it
  return foldFindingsFile(runDir, findingsPath, manifest);
}

/** A pass opens before the seam. The map stands: the file on disk is still what the last writer left. */
export function openPass(runDir) {
  const state = readFold(runDir);
  if (!state?.seamPassed) return;
  try { writeFold(runDir, { ...state, seamPassed: false }); } catch { /* best-effort: the seam rewrites it */ }
}

/** The record in the model's numbering: the one the last save wrote while a fold is in force, else findings.json. */
export function modelRecordPath(runDir, findingsPath) {
  const at = driverDir(String(runDir ?? ""), UNFOLDED_FILE);
  return readFold(runDir)?.map && existsSync(at) ? at : findingsPath;
}

/** The fold as it stands, to put back if a pass that changed it is rolled back. Never throws. */
export function snapshotFold(runDir) {
  const state = readFold(runDir);
  let unfolded = null;
  try { if (state?.map) unfolded = readFileSync(driverDir(String(runDir ?? ""), UNFOLDED_FILE), "utf8"); } catch { unfolded = null; }
  return { state, unfolded };
}

/** Put a snapshot's fold back beside the findings.json it described. This pass's seam stays as it is. */
export function restoreFold(runDir, snap) {
  const dir = String(runDir ?? "");
  try {
    const seamPassed = readFold(dir)?.seamPassed === true;
    if (snap?.state?.map && snap.unfolded != null) {
      writeAtomic(driverDir(dir, UNFOLDED_FILE), snap.unfolded);
      writeFold(dir, { seamPassed, map: snap.state.map, merges: snap.state.merges });
    } else {
      rmSync(driverDir(dir, UNFOLDED_FILE), { force: true });
      if (readFold(dir)) writeFold(dir, { seamPassed });
    }
  } catch { /* best-effort: the next save or seam rewrites the state */ }
}
