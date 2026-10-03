// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE DRIVER'S WRITES ARE A LAYER OVER THE MODEL'S RECORD, APPLIED AGAIN AFTER EVERY ACCEPTED SAVE THAT
// FOLLOWS THEM, IN THE PIPELINE'S ORDER (design, 2026-10-03).
//
// A synthesis save rewrites findings.json from the model's own base, so every write the driver made into it
// was lost at the next save. Measured on a test run: 19 coverage-judgment rows stamped at the delivery seam,
// 0 delivered after two repair saves, and the rows feed the scope line the client reads; the fold of a second
// filing was undone the same way. So the model's record is the only thing a save changes, and the delivered
// record is always the driver's layer over it: every driver write into findings.json is applied through the
// layer (pipeline.mjs `layerApply`), which records it, and after every synthesis stage the record is rebuilt
// from the model's record with every write this pass has applied, whole, in order (`reapplyLayer`). A new
// driver write joins the layer or it is lost by construction; there is no list of writers to keep.
//
// THE FILES, in _driver/:
//   findings-model.json — the model's own record, as its last accepted save wrote it, in its own numbering.
//                         Written by the save, and by the two writers that act on the model's base: the
//                         restoration of what a corrective save removed unnamed, and a rollback.
//   layer.json          — the writes this pass has applied, in order, each with the arguments it was applied
//                         with, and the sha of the record the layer last produced. A pass opens with none.
import { readFileSync, writeFileSync, existsSync, renameSync, rmSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { driverDir } from "../shared/driver-dir.mjs";

export const MODEL_RECORD_FILE = "findings-model.json";
export const LAYER_FILE = "layer.json";

const sha = (text) => createHash("sha256").update(text).digest("hex");
/** The sha of a file's bytes, or null when it cannot be read. Never throws. */
export function shaOfFile(path) {
  try { return sha(readFileSync(path)); } catch { return null; }
}

function writeAtomic(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/**
 * The record in the model's numbering: the model's own record when its save kept one, else findings.json
 * (a run whose saves predate the layer). A flag's ordinals, the ordinals a save records it touched and the
 * narrative's finding headings are all in this numbering, so whatever joins them reads this record.
 */
export function modelRecordPath(runDir, findingsPath) {
  const at = driverDir(String(runDir ?? ""), MODEL_RECORD_FILE);
  return existsSync(at) ? at : findingsPath;
}

/** The layer this pass has applied, or null. Never throws. */
export function readLayer(runDir) {
  try { return JSON.parse(readFileSync(driverDir(String(runDir ?? ""), LAYER_FILE), "utf8")); } catch { return null; }
}

function writeLayer(runDir, state) {
  writeAtomic(driverDir(String(runDir ?? ""), LAYER_FILE), JSON.stringify({
    _provenance: "the driver's writes this pass has applied over the model's record, in order, and the sha of the record they last produced",
    applied: state.applied ?? [], producedSha: state.producedSha ?? null,
  }, null, 2) + "\n");
}

/** A pass opens with no write applied. The record on disk stands until the next save or write. */
export function openLayer(runDir) {
  try { writeLayer(runDir, { applied: [] }); } catch { /* best-effort: an unrecorded layer re-applies nothing */ }
}

/** A write was applied: record it, and the record it produced. */
export function noteApplied(runDir, name, args, findingsPath) {
  try {
    const state = readLayer(runDir) ?? { applied: [] };
    writeLayer(runDir, { applied: [...(state.applied ?? []), { name, args: args ?? {} }], producedSha: shaOfFile(findingsPath) });
  } catch { /* best-effort */ }
}

/** The layer produced this record: the next rebuild is owed only once something else writes it. */
export function noteProduced(runDir, findingsPath) {
  try {
    const state = readLayer(runDir);
    if (state) writeLayer(runDir, { ...state, producedSha: shaOfFile(findingsPath) });
  } catch { /* best-effort */ }
}

/** Each file as it stands, or null where there is none, to put back exactly. Never throws. */
export function snapshotFiles(paths) {
  const out = {};
  for (const p of paths) { try { out[p] = readFileSync(p, "utf8"); } catch { out[p] = null; } }
  return out;
}

/** Put every file back as a snapshot held it; a file that did not exist then is removed. Returns the paths changed. */
export function restoreFiles(snap) {
  const changed = [];
  for (const [p, raw] of Object.entries(snap ?? {})) {
    let now = null;
    try { now = readFileSync(p, "utf8"); } catch { now = null; }
    if (now === raw) continue;
    if (raw == null) rmSync(p, { force: true }); else writeAtomic(p, raw);
    changed.push(p);
  }
  return changed;
}
