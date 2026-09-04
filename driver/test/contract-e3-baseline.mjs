// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// contract-e3-baseline.mjs — the E3 structure-as-text measurement, and the thing that writes its
// baseline. ONE derivation, two callers: contract-audit.test.mjs compares against the committed file,
// and `node driver/test/contract-e3-baseline.mjs --write` regenerates it. This is deliberately the same
// shape as skill-instruction-load.mjs next door, for the reason that file states: a baseline transcribed
// by hand makes the first real change look like a correction.
//
// ── WHY THIS EXISTS AT ALL: THE CEILING FAILED UPWARD ───────────────────────────────────────
//
// `contract-e3-baseline.json` was checked as a CEILING — `if (now > was) over.push(...)` — so a surface
// that SHRANK passed silently and its ceiling stayed at the old number. The room it vacated stayed open
// for a new violation to land in unnoticed. That is not a hypothetical: measured on `main`, three
// surfaces sat loose for five merges —
//
//     matter-frame                  dictated-line-shape   ceiling 2, measured 0
//     skills/blind-frame/SKILL.md   exactly-these-keys    ceiling 3, measured 2
//     skills/frame-diff/SKILL.md    exactly-these-keys    ceiling 3, measured 2
//
// — and `matter-frame` is a RECORDING stage whose dispatch may not dictate line shapes at all. Its
// ceiling permitted two, so re-introducing one there was a green CI run. The check that exists to stop
// the R-RECEIPT class being re-authored was, on that surface, switched off.
//
// ── EXACT MATCH IS A DECISION, AND HERE IS THE DECISION ─────────────────────────────────────────────
//
// The assertion this feeds is EXACT, not a ceiling. That turns every legitimate shrink into a red until
// the author regenerates, which reads as friction and IS the point: the regen is how the drop gets
// RECORDED. A ceiling records only that something was once allowed. The cost is one command on a
// conversion PR; the thing it buys is that a vacated surface cannot quietly re-fill.
//
// It is stated here rather than left to be discovered, because the alternative — "no surface gains a
// violation" — is the reading a maintainer will reach for when this goes red on a legitimate cut, and
// loosening it back to a ceiling would restore exactly the hole describes.
//
// ── SCOPED WRITE, SAME REASON AS THE NEIGHBOUR ──────────────────────────────────────────────────────
//
// `--write` records only the surfaces whose measurement MOVED, and prints every one of them. Nothing is
// silently absorbed: an author who regenerates sees the list they are recording, so a drop nobody
// intended is visible at the moment it is written rather than in a diff nobody re-reads.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { STAGES } from "../stages.mjs";
import { e3Counts, e3CountsMjs, stageSourceBlocks, E3_KINDS } from "../contract-audit.mjs";

const DRIVER = dirname(dirname(fileURLToPath(import.meta.url)));
export const BASELINE_PATH = join(DRIVER, "contract-e3-baseline.json");

// The anchor the file-side lint hangs on. Kept here beside the measurement rather than in the test, so
// the regen and the assertion cannot disagree about WHAT is measured — the failure that would produce is
// a baseline that is correct about numbers nobody checks.
const REDISPATCH_ANCHOR =
  "// and its fresh scoped retry) hands pipeline.mjs a followup/freshMessage, which REPLACES def.message";

/** Zero-filled row, so a surface that dropped to nothing is a row of zeros rather than an absence. */
const row = (counts) => Object.fromEntries(E3_KINDS.map((k) => [k, counts?.[k] ?? 0]));

/**
 * Measure every E3 surface: the per-stage dispatch blocks, and the files.
 *
 * THE FILE SET IS DERIVED FROM `skillReads`, never recited. A recited list stops covering a stage the
 * day one is added, and the lint then reports clean because it never looked.
 */
export function measureE3() {
  const src = readFileSync(join(DRIVER, "stages.mjs"), "utf8");
  const blocks = stageSourceBlocks(src);

  const byStage = {};
  for (const stage of Object.keys(STAGES)) byStage[stage] = row(e3CountsMjs(blocks[stage].text));

  const files = {};
  const at = src.indexOf(REDISPATCH_ANCHOR);
  if (at < 0) {
    throw new Error(
      "[contract-e3-baseline] the re-dispatch builder anchor is gone from stages.mjs. Those builders "
      + "REPLACE def.message, so a measurement that loses them stops seeing a whole class of dictate — "
      + "and would report a clean shrink. Restore the anchor or re-point it deliberately.");
  }
  files["stages.mjs#re-dispatch-builders"] = row(e3CountsMjs(src.slice(at)));
  files["stages-knockout.mjs"] = row(e3CountsMjs(readFileSync(join(DRIVER, "stages-knockout.mjs"), "utf8")));
  for (const rel of [...new Set(Object.values(STAGES).flatMap((d) => d.skillReads ?? []))]) {
    const p = join(DRIVER, rel);
    if (existsSync(p)) files[rel] = row(e3Counts(readFileSync(p, "utf8")));   // .md — `//` is not a comment there
  }

  const sum = (o) => Object.values(o).reduce((a, r) => a + Object.values(r).reduce((x, n) => x + n, 0), 0);
  return { byStage, files, totals: { stages: sum(byStage), files: sum(files) } };
}

export const readBaseline = () => JSON.parse(readFileSync(BASELINE_PATH, "utf8"));

/**
 * Every surface where the committed baseline and the measurement disagree, in both directions.
 *
 * `grew` is a NEW violation and is what the old ceiling caught. `shrank` is a surface that was cleaned
 * up and never recorded — invisible to the ceiling, and the whole. Reported separately because
 * they mean opposite things to the person reading the red.
 */
export function e3Drift(measured = measureE3(), baseline = readBaseline()) {
  const grew = [];
  const shrank = [];
  for (const half of ["byStage", "files"]) {
    const keys = [...new Set([...Object.keys(measured[half]), ...Object.keys(baseline[half] ?? {})])].sort();
    for (const key of keys) {
      const now = measured[half][key];
      const was = baseline[half]?.[key];
      // A surface the baseline never knew about is a GROWTH of the whole row, not a drift: it appeared.
      if (!now) { shrank.push(`${half} ${key}: recorded but no longer measured (the surface is gone)`); continue; }
      if (!was) { grew.push(`${half} ${key}: measured but not recorded (a new surface)`); continue; }
      for (const kind of E3_KINDS) {
        const a = was[kind] ?? 0, b = now[kind] ?? 0;
        if (b > a) grew.push(`${half} ${key} / ${kind}: ${a} → ${b}`);
        else if (b < a) shrank.push(`${half} ${key} / ${kind}: ${a} → ${b}`);
      }
    }
  }
  return { grew, shrank };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!process.argv.includes("--write")) {
    console.error("usage: node driver/test/contract-e3-baseline.mjs --write\n"
      + "  records the CURRENT measurement, and prints every surface that moved in either direction");
    process.exit(2);
  }
  const measured = measureE3();
  const { grew, shrank } = existsSync(BASELINE_PATH) ? e3Drift(measured) : { grew: [], shrank: [] };
  // PRINTED BEFORE THE WRITE, and both directions, because the two mean opposite things: a shrink is the
  // conversion doing its job, a growth is a dictated structure that was re-authored. An author who sees
  // only "wrote the file" learns nothing about which one they just recorded.
  if (shrank.length) { console.error(`${shrank.length} surface(s) SHRANK — this is what the regen is for:`); for (const l of shrank) console.error(`  ${l}`); }
  if (grew.length) {
    console.error(`${grew.length} surface(s) GREW — recording this makes a NEW dictated structure the new normal:`);
    for (const l of grew) console.error(`  ${l}`);
    console.error("  If that was not deliberate, fix the dispatch instead of recording it.");
  }
  if (!shrank.length && !grew.length) console.error("nothing moved — the baseline already matches the measurement");
  writeFileSync(BASELINE_PATH, `${JSON.stringify(measured, null, 2)}\n`);
  console.log(`wrote ${BASELINE_PATH} (stages ${measured.totals.stages}, files ${measured.totals.files})`);
}
