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
import { atomicWrite, driverDir, ensureDriverDir, paths, readJson } from "./run-record.mjs";   // — one definition of where `_driver/` is
import { runLog, note } from "./log.mjs";
import { parseFindingsJsonLenient } from "./findings-model.mjs";

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
  try { return readJson(stampPath(runDir, label)); } catch { return null; }
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
      try { doc = readJson(p); } catch { continue; }
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
    const doc = readJson(p);
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
      try { doc = readJson(p); } catch { continue; }
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

// ── findings.json: one write, and its stamp choice stated where it is made ─────────────────────────────
//
// findings.json is the record every client surface renders from, and a dozen driver arms rewrite it after
// synthesis has written it. Each rewrite makes one of two choices about the stamps. It can leave them alone,
// so the stages that read the file read it as moved and run again: the comment above `injectFrontMatter`
// in pipeline.mjs says that is what those rewrites are for. Or it can settle the stamp of a one-shot stage,
// which has no in-process re-run and would otherwise park the run at the delivery gate. `writeFindings` is
// the one place both choices are made, so a write that settles nothing says so by passing nothing.
//
// `settleOneShotStamp` and `projectStageInput` sit here for that reason: the write cannot reach them in
// pipeline.mjs, which imports this module.

// ── — WHAT A STAGE COMPARES INSTEAD OF THE WHOLE FILE ──────────────────────────────────────────
// A `report-card:N` declares findings.json and READS NONE OF IT: its finding arrives inline on the
// message as ctx.finding, and the file is declared so the freshness gate sees it move at all. So a
// sanctioned late arm that edits ONE finding — corrective synthesis, a verdict recheck — moved the
// whole-file sha and made all 26 cards read stale at the delivery gate. The tail repair then re-derived
// them: 496,327 output tokens, 48.0M cache read, 43 dispatches of which 33 were repeats, 1h29m. A third
// of that run's output and 29% of its wall clock, re-deriving work already on disk and already valid.
//
// The projection is EXACTLY WHAT THE STAGE WAS FED — the finding object at that ordinal, serialized the
// way the card's own message serializes it. Deliberately not canonicalized: the message renders the raw
// object, so a key reordering genuinely changes what the model saw and must genuinely read as stale.
//
// A NULL PROJECTION IS A FALLBACK, NEVER A PASS. Ordinal absent from the current file, an unreadable or
// rejected findings.json, any throw — all return null, the compare falls back to the whole-file sha, and
// the card stays stale. Ordinals are safe to key on because consolidateFindingsFile RENUMBERS before the
// cards are dispatched, and a renumber that moves a finding away from ordinal N changes N's projection,
// which is correctly stale.
//
// This is NOT the settleOneShotStamp blessing warns about: nothing is declared settled and no
// artifact is blessed past a live consumer. And it narrows what is COMPARED, never what is DECLARED —
// narrowing the declaration would let a card be repaired ahead of its stale upstream, which is the one
// thing item 15a exists to prevent, and dependency-repair.test.mjs pins that edge.
export function projectStageInput(label, absPath) {
  if (typeof label !== "string" || !label.startsWith("report-card:")) return null;
  if (basename(String(absPath ?? "")) !== "findings.json") return null;
  const ord = Number(label.slice("report-card:".length));
  if (!Number.isFinite(ord)) return null;
  try {
    const doc = parseFindingsJsonLenient(readFileSync(absPath, "utf8"));
    const f = (doc?.findings ?? []).find((x) => Number(x?.ordinal) === ord);
    if (!f) return null;
    return createHash("sha256").update(JSON.stringify(f)).digest("hex").slice(0, 12);
  } catch { return null; }
}

/**
 * follow-up (2026-08-04) — account for a SANCTIONED in-pass rewrite in a ONE-SHOT stage's stamp.
 *
 * A one-shot stage reads its evidence at a fixed seam and has no in-process re-run: frame-diff's own
 * contract says "NO in-process re-diff". When a later arm legitimately rewrites an artifact such a
 * stage declared, there is no repair to schedule — the delivery precondition simply reads it stale and
 * parks the run, which pays a park plus a full re-drive to re-dispatch a stage whose every consumer
 * already ran. `restampStage` is the sanctioned-rewrite mechanism (the settlement flush's own idiom);
 * this wraps it so every call site says WHICH artifacts moved and WHY, in one place.
 *
 * NARROW ON PURPOSE. `files` is the list the calling arm actually rewrote, never "everything this stage
 * declares": blessing the whole declaration would quietly widen the grant every time an input is added,
 * and a blind-frame model or a manifest that moves between passes is NEW MATERIAL that must still force
 * the diff (the copper-vault catch).
 *
 * AND IT IS NOT SILENT WHEN IT MATCHES NOTHING. Every `files` entry is a literal path whose declaration
 * lives in stages.mjs; moved frame-diff's list and turned an existing restamp call into a
 * guaranteed no-op that nothing recorded. A file this label does not declare now lands a `restamp-miss`
 * row in run.jsonl — the absence becomes a finding, and the next input-list move cannot go unnoticed.
 * Logged rather than thrown: the freshness module is best-effort by contract, and killing a run over
 * bookkeeping would trade a cheap park for a dead one.
 */
export function settleOneShotStamp(runDir, label, files, why) {
  const changed = [], missed = [];
  for (const f of files.filter(Boolean)) {
    const r = restampStage(runDir, label, f, { project: projectStageInput });
    if (r.changed) changed.push(f);
    if (r.stamped && !r.matched) missed.push(f);
  }
  for (const f of missed) {
    runLog(runDir, { event: "restamp-miss", stage: label, path: f, why });
    note(`stage-freshness: restamp of ${label} against ${basename(f)} matched nothing — ${label} does not declare that file (${why}); the compensating rewrite is aimed at nothing`);
  }
  if (changed.length) runLog(runDir, { event: "one-shot-stamp-settled", stage: label, why, changed });
  return { changed, missed };
}

/**
 * Write the run's findings.json, then settle the stamp of each one-shot stage in `settles`.
 *
 * `doc` is the record as an object, written the way every site wrote it before (two-space JSON and a
 * final newline), or as text, written exactly as given: a restore puts back the bytes it saved. The write
 * is atomic and throws as `atomicWrite` does, so a caller's existing `try` still decides what a failed
 * write means. `why` names the arm; it reaches run.jsonl only through a settlement, so a write that
 * settles nothing adds no row. Returns what each settlement changed and missed, by stage.
 */
export function writeFindings(runDir, doc, { why, settles = [] } = {}) {
  const file = paths(runDir).findings;
  atomicWrite(file, typeof doc === "string" ? doc : JSON.stringify(doc, null, 2) + "\n");
  const settled = {};
  for (const label of settles) settled[label] = settleOneShotStamp(runDir, label, [file], why);
  return { file, settled };
}
