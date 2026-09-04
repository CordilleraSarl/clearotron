// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// stage-freshness.mjs — P2: a changed upstream artifact invalidates its consumers.
//
// THE DEFECT CLASS (copper-vault, 2026-07-21). `stageOnce`'s resume/idempotency skip asked exactly one
// question — "does my output exist and self-validate?" — and never looked at its inputs. So on the third
// attempt of that run `common-law-half:a`/`:b` were RECOMPUTED (trigger coverage-closure, output SHAs
// changed) at 08:38–08:40, and every stage that declares common-law as an input — register-digest,
// skeptic, synthesis, narrative-refutation, report-overview — skipped as "already done" and the run
// delivered at 08:41. The delivered report says "The common-law layer that would document any such user
// was not run this pass" while the run's own final common-law artifact documents that user as confirmed
// and critical. Two shipped artifacts contradicting each other, from a freshness bug with a factual
// signature.
//
// The dependency graph ALREADY EXISTS: stages.mjs `stageInputs(name, P, …)` declares every stage's inputs,
// and pipeline.mjs already logs `inputs: stageInputs(...).map(fileMeta)` — name, sha, size — for every
// stage that runs. It was declared and then ignored. This module makes it load-bearing rather than
// building a second, hand-maintained graph.
//
// WHAT THIS IS NOT. It is not the register-taint chain (register-taint.mjs: was THIS stage's own band
// touched by a kill-class attempt?) and not close-verify (close-verify.mjs: did the SAME detector's gap
// actually close?). Both are intra-stage integrity mechanisms and neither says anything about consumers.
// Cross-stage staleness was uncovered ground.
//
// CRASH-RESUME IS PRESERVED, and that is the point of keying on CONTENT rather than mtime: a crash
// changes no input bytes, so every stamp still matches and a pure crash-resume skips exactly as cheaply
// as it does today. Only a resume that actually CHANGED something upstream pays to recompute.
//
// POST-STAGE MUTATORS. Several artifacts are rewritten after the stage that authored them returns —
// findings.json by injectDeferralCoverage / enrichFindingDeadlines / consolidateFindingsFile (which
// RENUMBERS ordinals) / the coverage-floor clamp, and report.md by the front-matter injectors. None of
// them updated any recorded sha, so a consumer comparing against the authoring stamp would see a
// mismatch that no recompute could ever settle (the file legitimately differs from what the stage wrote).
// `restamp()` is how a mutator says "this change is accounted for" — it refreshes the artifact's sha
// wherever it appears in a stamp, so freshness tracks the file's CURRENT bytes.
//
// PURE except for the four thin IO wrappers at the bottom (repo doctrine: the decision logic tests
// offline). Missing/unreadable stamps ⇒ NOT stale — legacy runs, replay, and the first run after this
// ships all behave exactly as they do today.
//
// NO FEATURE FLAG, deliberately. This shipped briefly behind CLEAROTRON_STAGE_FRESHNESS defaulted off in
// production, which meant the one thing it protects — real delivery — was the one place it never ran.
// Code you cannot exercise is code you cannot trust, and a dormant env var is how a codebase grows a
// legacy branch nobody remembers. The staged-rollout property is structural instead: a run with no
// stamps is never stale, so the first run after this lands behaves exactly as it did before and only
// accrues enforcement as it writes its own stamps.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { join, basename } from "node:path";
import { driverDir, ensureDriverDir } from "../shared/driver-dir.mjs";   // — one definition of where `_driver/` is

const STAMP_DIR = "stage-inputs";
const sha12 = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 12);

/** sha of a file's current bytes, or null when absent/unreadable. PURE-ish (one read). */
export function shaOf(absPath) {
  try { return sha12(readFileSync(absPath)); } catch { return null; }
}

/**
 * The fingerprint of a stage's declared inputs: [{name, path, sha}], sorted by path for a stable record.
 * An ABSENT input is recorded with sha null — and absent-then-present is a change, which is correct: a
 * skeptic-flags file that did not exist when synthesis ran, and exists now, is new material.
 * PURE-ish (reads only the paths it is given).
 */
export function fingerprint(inputPaths = [], { label = null, project = null } = {}) {
  return [...new Set(inputPaths.filter(Boolean).map(String))].sort()
    .map((p) => {
      const e = { name: basename(p), path: p, sha: shaOf(p) };
      // — the PROJECTION, recorded beside the whole-file sha and never instead of it. Omitted
      // entirely when there is none, so every stage that has no projector writes byte-identically to
      // today and reconcileStamps' JSON.stringify equality keeps holding.
      const proj = project ? project(label, p) : null;
      if (typeof proj === "string" && proj) e.proj = proj;
      return e;
    });
}

/**
 * Compare a recorded fingerprint against the inputs' current state. PURE.
 * @returns {{stale: boolean, changed: Array<{name, was, now}>}}
 */
export function diffFingerprint(recorded, current) {
  if (!Array.isArray(recorded) || !recorded.length) return { stale: false, changed: [] };   // no stamp ⇒ legacy ⇒ never stale
  const now = new Map((current ?? []).map((e) => [e.path, e]));
  const changed = [];
  for (const e of recorded) {
    if (!now.has(e.path)) continue;                       // an input no longer declared — not this stage's staleness
    const cur = now.get(e.path);
    // — THE PROJECTION DECIDES ONLY WHEN BOTH SIDES ASKED THE SAME QUESTION. A report-card declares
    // the whole of findings.json and reads none of it — its finding arrives inline on the message — so a
    // corrective pass that edits ONE finding under a closed minimal-edit contract moved the whole-file sha
    // and made all 26 cards read stale. Re-deriving them cost 496,327 output tokens, 43 dispatches of
    // which 33 were repeats, and 1h29m: a third of that run's output and 29% of its wall clock.
    //
    // BOTH shas stay recorded. The whole-file sha keeps today's meaning for every stage that genuinely
    // reads the file, and the projection is consulted only where both the stamp and the current state
    // carry one. A card whose ordinal is no longer in the file records NO projection, falls back to the
    // whole-file compare and STAYS STALE — two absent projections must never compare equal, which is
    // exactly how this file family has shipped a silent pass before.
    if (e.proj && cur.proj) {
      if (cur.proj !== e.proj) changed.push({ name: e.name, was: e.proj, now: cur.proj, via: "projection" });
      continue;
    }
    if (cur.sha !== e.sha) changed.push({ name: e.name, was: e.sha, now: cur.sha });
  }
  return { stale: changed.length > 0, changed };
}

// ── IO wrappers ────────────────────────────────────────────────────────────────────────────────────────

const stampPath = (runDir, label) => driverDir(runDir, STAMP_DIR, `${label.replace(/[^\w.:-]/g, "_")}.json`);

/** Record the inputs a stage's CURRENT output was produced from. Best-effort; never throws. */
export function writeStamp(runDir, label, inputPaths, { project = null } = {}) {
  try {
    ensureDriverDir(runDir, STAMP_DIR);
    writeFileSync(stampPath(runDir, label), JSON.stringify({ label, ts: new Date().toISOString(), inputs: fingerprint(inputPaths, { label, project }) }, null, 2) + "\n");
  } catch { /* a stamp we could not write just means "not stale" downstream — never worse than today */ }
}

export function readStamp(runDir, label) {
  try { return JSON.parse(readFileSync(stampPath(runDir, label), "utf8")); } catch { return null; }
}

/** Is this stage's output stale with respect to its declared inputs' current bytes? Never throws. */
export function stageStaleness(runDir, label, inputPaths, { project = null } = {}) {
  const stamp = readStamp(runDir, label);
  if (!stamp) return { stale: false, changed: [] };       // legacy / first run after this ships ⇒ today's behaviour
  return diffFingerprint(stamp.inputs, fingerprint(inputPaths, { label, project }));
}

/**
 * A post-stage mutator rewrote `absPath` — account for it everywhere it is recorded, so the change does
 * not read as staleness no recompute could settle. Returns the number of stamps touched.
 */
export function restamp(runDir, absPath, { project = null } = {}) {
  let touched = 0;
  try {
    const dir = driverDir(runDir, STAMP_DIR);
    if (!existsSync(dir)) return 0;
    const sha = shaOf(absPath);
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      const p = join(dir, f);
      let doc;
      try { doc = JSON.parse(readFileSync(p, "utf8")); } catch { continue; }
      let hit = false;
      // — a mutator accounts for the PROJECTION too. Refreshing only the whole-file sha would leave
      // a stale projection that no recompute could settle — the mirror of the defect restamp exists for.
      for (const e of doc?.inputs ?? []) {
        if (e.path !== absPath) continue;
        if (e.sha !== sha) { e.sha = sha; hit = true; }
        // Only touch `proj` when a projector was SUPPLIED. A caller that passes none is not asserting
        // that there is no projection — it simply was not asked, and silently stripping one would move
        // the stage back to a whole-file compare without anyone saying so.
        if (project) {
          const proj = project(doc?.label ?? null, absPath);
          if (typeof proj === "string" && proj) { if (e.proj !== proj) { e.proj = proj; hit = true; } }
          else if ("proj" in e) { delete e.proj; hit = true; }   // no longer projectable ⇒ whole-file fallback
        }
      }
      if (hit) { writeFileSync(p, JSON.stringify(doc, null, 2) + "\n"); touched++; }
    }
  } catch { /* best-effort */ }
  return touched;
}

/**
 * TARGETED mid-pass restamp ( digest funnel): account for a sanctioned rewrite of `absPath`
 * in ONE stage's stamp only. The settlement flush re-emits register-findings AFTER skeptic/frame-diff
 * legitimately consumed the pre-settlement file — the same class of post-audit digest refinement the
 * end-of-pass reconcile blesses on a fresh run (legacy escalation/envelope re-digests also post-date
 * the skeptic). Those two stages' one-shot receipts forbid a post-settlement re-run, so on a RESUMED
 * pass (where they skipped and would otherwise read the flush as delivery-blocking staleness) their
 * stamps take the flush as accounted-for. Deliberately NOT the blanket restamp(): downstream
 * consumers (synthesis, the back half) must keep their staleness and recompute — that is the
 * contract, and under the funnel it fires once. Never throws.
 *
 * THE RETURN IS THREE FACTS, NOT ONE, and that is a fix for the defect class this module keeps
 * meeting ( follow-up, 2026-08-04). Every caller passes a LITERAL path; the declaration it has to
 * match lives in stages.mjs `stageInputs`. When re-aimed frame-diff's inputs at the register
 * evidence, the settlement flush's `restampStage(runDir, "frame-diff", P.registerFindings)` became a
 * guaranteed no-op — nobody edited that line, the list moved underneath it — and a boolean `false`
 * could not tell "the sha already matched" from "this stage does not declare that file at all". One is
 * a non-event; the other is a compensating mechanism pointed at nothing. So:
 *   stamped — the label has a stamp on disk (absent ⇒ the stage never ran / legacy run)
 *   matched — that stamp DECLARES absPath (false ⇒ the caller's literal path is aimed at nothing)
 *   changed — the recorded sha differed and was rewritten
 * Callers log a miss (`stamped && !matched`) rather than throwing: this module's contract is
 * best-effort by design — a stamp it cannot write just leaves the delivery gate as strict as today —
 * and turning a bookkeeping mismatch into a dead run would trade a cheap park for an expensive one.
 * Recording it makes the absence a finding.
 */
export function restampStage(runDir, label, absPath, { project = null } = {}) {
  const miss = { stamped: false, matched: false, changed: false };
  try {
    const p = stampPath(runDir, label);
    if (!existsSync(p)) return miss;
    const doc = JSON.parse(readFileSync(p, "utf8"));
    const sha = shaOf(absPath);
    let matched = false, changed = false;
    for (const e of doc?.inputs ?? []) {
      if (e.path !== absPath) continue;
      matched = true;
      if (e.sha !== sha) { e.sha = sha; changed = true; }
      if (project) {                                              // — account for the projection too
        const proj = project(label, absPath);
        if (typeof proj === "string" && proj) { if (e.proj !== proj) { e.proj = proj; changed = true; } }
        else if ("proj" in e) { delete e.proj; changed = true; }
      }
    }
    if (changed) writeFileSync(p, JSON.stringify(doc, null, 2) + "\n");
    return { stamped: true, matched, changed };
  } catch { return miss; /* best-effort — a miss just means the delivery gate stays as strict as today */ }
}

/** Drop a stage's stamp (used when its output is invalidated outright). */
export function clearStamp(runDir, label) {
  try { unlinkSync(stampPath(runDir, label)); } catch { /* absent is fine */ }
}

/**
 * Every stage on the delivery path that is stale with respect to its inputs. The delivery precondition:
 * a report may only ship when nothing it was built from has moved underneath it.
 * @param {(name: string) => string[]} inputsFor  label → declared input paths
 */
export function staleOnPath(runDir, labels, inputsFor, { project = null } = {}) {
  const out = [];
  for (const label of labels) {
    const { stale, changed } = stageStaleness(runDir, label, inputsFor(label) ?? [], { project });
    if (stale) out.push({ label, changed });
  }
  return out;
}

/**
 * END-OF-PASS RECONCILE — the answer to intra-pass driver normalization.
 *
 * Several driver-owned steps rewrite an artifact AFTER the stages that consumed it have already run in the
 * same pass: the named-band re-merge (deriveNamedBand), the common-law re-merge, quarantine/taint passes,
 * the supplemental fold, the report front-matter injectors. Those are deterministic re-derivations, not new
 * material — but they move the bytes, so a naive stamp taken at stage-completion time would report every
 * one of them as staleness on the NEXT pass and recompute stages for no reason. (Observed: a pure
 * crash-resume invalidating placement-inquiry via primary-sweep.md and skeptic via register-findings.md.)
 *
 * So a stamp records the RECONCILED state: at the end of a pass, every stage that has a stamp is
 * re-fingerprinted against the artifacts as they finally stand. The meaning becomes "as of the end of that
 * pass, this output was consistent with these inputs" — which is exactly the question a later pass asks.
 *
 * This does NOT weaken the copper-vault catch: there, common-law is recomputed DURING the next pass, and
 * the skip check compares against the PRIOR pass's reconciled stamp, so every consumer is still correctly
 * invalidated. It also runs strictly AFTER the delivery precondition, so an intra-pass staleness that
 * should block a delivery still blocks it.
 *
 * Called on both the success and failure paths — a failed pass leaves artifacts in a final state too, and
 * the resume after it must not pay for normalization that happened before the crash.
 *
 * `exclude` — the labels this pass flagged as DELIVERY-BLOCKING STALE (a consumer whose upstream input
 * genuinely moved and that was NOT recomputed against it — teal-gantry's placement-inquiry, stale against
 * a frame-reopened register band). Reconcile CANNOT tell that apart from a driver-side re-derivation: both
 * just move the bytes. So on the failure path, reconciling such a stage would silently re-fingerprint its
 * stamp to the new inputs and ERASE the very block — the resume would then see the stage "fresh", skip it,
 * and ship the internally-inconsistent report the delivery gate exists to reject. Excluding those labels
 * leaves their stamps stale so the resume (or an auto-recovery re-drive) recomputes them. On the SUCCESS
 * path this set is empty (nothing was blocked), so reconcile behaves exactly as before.
 */
export function reconcileStamps(runDir, inputsFor, exclude = null, { project = null } = {}) {
  const skip = exclude instanceof Set ? exclude : new Set(exclude ?? []);
  let touched = 0;
  try {
    const dir = driverDir(runDir, STAMP_DIR);
    if (!existsSync(dir)) return 0;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      const p = join(dir, f);
      let doc;
      try { doc = JSON.parse(readFileSync(p, "utf8")); } catch { continue; }
      if (!doc?.label) continue;
      // An exclude entry may be a full label OR a bare stage name — a bare name excludes every
      // axis-qualified stamp of that stage ("register-digest" covers "register-digest:primary-sweep").
      if (skip.has(doc.label) || skip.has(doc.label.replace(/:.*$/, ""))) continue;   // stays stale so the resume recomputes it
      const fresh = fingerprint(inputsFor(doc.label) ?? [], { label: doc.label, project });
      if (JSON.stringify(fresh) === JSON.stringify(doc.inputs)) continue;
      doc.inputs = fresh;
      doc.reconciledAt = new Date().toISOString();
      try { writeFileSync(p, JSON.stringify(doc, null, 2) + "\n"); touched++; } catch { /* best-effort */ }
    }
  } catch { /* best-effort */ }
  return touched;
}
