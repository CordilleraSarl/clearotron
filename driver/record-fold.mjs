// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE FOLD: a second filing of the same conflict folds into one finding, and the findings renumber.
//
// It is one of the driver's writes over the model's record, and like each of them it is applied again after
// every accepted save that follows it (record-layer.mjs, design 2026-10-03). Measured on a test run before
// that: a repair saved after the cards wrote the model's own record back, unfolded; the folded filing stood
// as its own finding again, every finding after it moved down one place, 19 cards were rebuilt for findings
// that had only moved, and the last finding shipped without the prose card it was owed.
//
// The fold records its map from the model's ordinals to the folded ones and back, in _driver/fold.json.
// What is named in the model's numbering — a flag's ordinals, the narrative's finding headings — joins the
// model's own record instead (record-layer.mjs `modelRecordPath`), so nothing reads the map to translate.
import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";
import { consolidateFindings, remapActionOrdinals, parseFindingsJson } from "./findings-model.mjs";

export const FOLD_FILE = "fold.json";

const bothWays = (ordinalMap) => {
  const modelToFolded = {}, foldedToModel = {};
  for (const [m, f] of ordinalMap) { modelToFolded[m] = f; (foldedToModel[f] ??= []).push(m); }
  return { modelToFolded, foldedToModel };
};

/**
 * Fold a findings document: a second filing of the same conflict folds into one finding, the findings
 * renumber, and the actions follow the renumber (spec 64 — a merged-away ordinal remaps to its kept
 * finding's new ordinal, so the action still applies to the consolidated conflict). `map` is null when
 * nothing folds, and the document is then returned as it came. PURE.
 */
export function foldRecord(doc, manifest = null) {
  const list = Array.isArray(doc?.findings) ? doc.findings : [];
  if (list.length < 2) return { doc, merges: [], map: null };
  const { findings, merges, ordinalMap } = consolidateFindings(list, (doc.schema_version ?? 1) >= 4 ? manifest : null);
  if (!merges.length) return { doc, merges: [], map: null };
  const next = { ...doc, findings };
  if (Array.isArray(doc.actions)) next.actions = remapActionOrdinals(doc.actions, ordinalMap);
  return { doc: next, merges, map: bothWays(ordinalMap) };
}

/** The last fold's record: its map and merges, or null. Never throws. */
export function readFold(runDir) {
  try { return JSON.parse(readFileSync(driverDir(String(runDir ?? ""), FOLD_FILE), "utf8")); } catch { return null; }
}

function writeAtomic(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/**
 * Fold findings.json in place and record the map. Returns `{merges}`, empty when nothing folded, and `error`
 * when the fold could not be made. Never throws: a record that cannot be folded stays as it is, and the
 * failure is on the fold's record, because nothing else reads this function's return.
 */
export function foldFindingsFile(runDir, findingsPath, manifest) {
  const dir = String(runDir ?? "");
  const record = (state) => {
    try {
      writeAtomic(driverDir(dir, FOLD_FILE), JSON.stringify({
        _provenance: "the fold of findings.json: the map from the model's ordinals to the folded ones and back",
        at: new Date().toISOString(), map: state.map ?? null,
        merges: (state.merges ?? []).map((m) => ({ kept: m.kept, dropped: m.dropped })),   // ordinals only
        ...(state.error ? { error: state.error } : {}),
      }, null, 2) + "\n");
    } catch { /* best-effort: the fold's own record */ }
  };
  try {
    if (!existsSync(findingsPath)) return { merges: [] };
    const { doc, merges, map } = foldRecord(JSON.parse(readFileSync(findingsPath, "utf8")), manifest);
    if (!merges.length) { record({}); return { merges: [] }; }   // nothing folds: the file is left byte-identical
    parseFindingsJson(JSON.stringify(doc));   // the folded record must still validate; a throw keeps the record as it is
    writeAtomic(findingsPath, `${JSON.stringify(doc, null, 2)}\n`);   // a crash mid-write must never leave a truncated findings.json
    record({ map, merges });
    return { merges };
  } catch (e) {
    const error = String(e?.message ?? e).replace(/\s+/g, " ").slice(0, 160);
    record({ error });
    return { merges: [], error };
  }
}
