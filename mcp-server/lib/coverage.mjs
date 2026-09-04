// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lib/coverage.mjs — what was searched vs what's a gap. Per-artifact validity (verify.mjs validators),
// per-axis register-unit presence, the coverage-ledger marker, and the negative-results count. Read-only.

import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { REGISTER_AXES, validators, hasCoverageLedgerRow } from "./driver.mjs";
import { loadFindings } from "./findings.mjs";

// verify.mjs keys are the paths()-style camelCase artifact names.
//
// — REPORTED_ARTIFACTS and NOT_REPORTED below are a CLOSED PARTITION of the driver's `validators`,
// enforced at LOAD by assertValidatorCoverage(). This was a hand-copied 12-name mirror of a 21-key map in
// another package, and it failed in the worst available direction: a validator added upstream was simply
// never run here, `check()` never called for it, and `complete` still returned TRUE. A completeness
// surface that answers "yes" about an artifact it does not know exists is the absence-reads-as-a-pass
// shape, on the surface whose entire job is to say what was and was not covered.
//
// Four artifacts were sitting in exactly that gap — findings, frameDiff, doubtClosure, reportOverview —
// with findings.json among them: the single most-consumed artifact in the run, invisible to the coverage
// answer. They are reported now.
//
// `required` vs `optional` is the same distinction the old hardcoded `a.name !== "caseLaw" && a.name !==
// "clientSummary"` filter drew one line further down; it lives here so a new artifact states its own
// gating status instead of inheriting one by omission.
export const REPORTED_ARTIFACTS = {
  matterContext: "required",
  variantManifest: "required",
  commonLaw: "required",
  placement: "required",
  registerFindings: "required",
  skepticFlags: "required",
  narrative: "required",
  seniorEyeReview: "required",
  report: "required",
  audit: "required",
  // — the machine contract the report, the verdict, the actions register and the delivery gate are
  // all keyed to. OPTIONAL rather than required only because archived pre-Phase-1 runs predate the file
  // and must not retro-read as incomplete; its presence and validity are now reported either way.
  findings: "optional",
  caseLaw: "optional",          // degrades, never blocks ( D2 — an absent case-law layer is a stated limit)
  clientSummary: "optional",    // RETIRED stage; archived runs still carry it
  frameDiff: "optional",        // written only when the blind pass produced a model to diff
  doubtClosure: "optional",     // condition-only — written only when stitch-open doubts exist
  reportOverview: "optional",   // present on any delivered run; absent on a run that failed before drafting
};

// Validators deliberately NOT on this surface, each with the reason. Without this half the check could
// only run one way and a validator could be dropped upstream while its key sat here forever.
export const NOT_REPORTED = {
  registerUnit: "reported PER AXIS by coverage() below, against REGISTER_AXES — a single row would hide which axis is missing",
  commonLawHalf: "a per-half intermediate the driver merges into commonLaw in code; downstream never sees a half",
  reportCard: "one file per finding ordinal — a single row cannot say which card is missing; the cards ride list_findings",
  blindFrame: "validates blind-frame-model.json, which has no paths() entry on this surface (an engine-internal frame check, never a client coverage question)",
};

// Load-time gate (the KNOWN_PROFILE_KEYS discipline): every validator must be consciously placed on one
// side or the other, and neither side may name a validator that no longer exists. A dead key or a
// forgotten new artifact is rejected when this module loads, not discovered from a wrong answer later.
// `table` is the validator map to check against — the driver's own by default, injectable so the gate can
// be exercised directly against a validator nobody placed (which is otherwise unreachable from a test).
export function assertValidatorCoverage(table = validators) {
  const known = Object.keys(table);
  const unplaced = known.filter((k) => !(k in REPORTED_ARTIFACTS) && !(k in NOT_REPORTED));
  if (unplaced.length) throw new Error(`lib/coverage.mjs: validator(s) ${unplaced.join(", ")} are neither reported nor declared out — a new artifact must choose, else artifactStatus() silently omits it and coverage().complete answers "yes" about a file it never checked. Add to REPORTED_ARTIFACTS (required|optional) or NOT_REPORTED (with the reason).`);
  const dead = [...Object.keys(REPORTED_ARTIFACTS), ...Object.keys(NOT_REPORTED)].filter((k) => !known.includes(k));
  if (dead.length) throw new Error(`lib/coverage.mjs: ${dead.join(", ")} name no validator in verify.mjs — a dead key or a typo is rejected at load`);
  const bad = Object.entries(REPORTED_ARTIFACTS).filter(([, v]) => v !== "required" && v !== "optional");
  if (bad.length) throw new Error(`lib/coverage.mjs: ${bad.map(([k, v]) => `${k}="${v}"`).join(", ")} — gating must be "required" or "optional"`);
}
assertValidatorCoverage();

const VALIDATOR_KEYS = Object.keys(REPORTED_ARTIFACTS);

function check(key, path) {
  const exists = existsSync(path);
  let valid = null, reason = "";
  if (exists && validators[key]) {
    try { const r = validators[key](path, readFileSync(path, "utf8")); valid = r.ok; reason = r.reason; }
    catch (e) { valid = false; reason = e.message; }
  }
  return { name: key, file: basename(path), exists, valid, reason };
}

export function artifactStatus(P) {
  return VALIDATOR_KEYS.filter((k) => P[k]).map((k) => check(k, P[k]));
}

export function coverage(P) {
  const axes = REGISTER_AXES.map((ax) => {
    const path = P.registerUnit(ax);
    const r = check("registerUnit", path);
    return { axis: ax, present: r.exists, valid: r.valid, reason: r.reason };
  });
  const regFindings = existsSync(P.registerFindings) ? readFileSync(P.registerFindings, "utf8") : "";
  const findings = loadFindings(P);
  const artifacts = artifactStatus(P);
  // "complete" counts the artifacts declared `required` above; the `optional` ones degrade, not block.
  // (This was a hardcoded two-name exclusion; the gating now rides the same declaration the key set does,
  // so adding an artifact cannot accidentally make every past run incomplete — or silently non-gating.)
  const required = artifacts.filter((a) => REPORTED_ARTIFACTS[a.name] === "required");
  return {
    coverageLedgerPresent: hasCoverageLedgerRow(regFindings),
    registerAxes: axes,
    findings: findings.findings.length,
    negativeResults: findings.negatives.length,
    artifacts,
    complete: required.every((a) => a.exists && a.valid !== false),
    note: "A register-unit marked present+valid was swept. The coverage-ledger marker confirms the digest recorded confirmed-clean / coverage-limited / deferred rows; 'deferred' means a documented GAP, not a clean negative.",
  };
}
