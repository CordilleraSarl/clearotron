// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// record-discard.mjs — HALF ONE: each seam writes down what it just did to each record, at the
// moment it does it, with its own reason.
//
// ── why this exists ──────────────────────────────────────────────────────────────────────────────────
//
// The shipped trace (/) asked ONE pass to answer a question that spans two moments that never
// coexist. A record discarded at screening is gone by the time `findings.json` is written; the findings
// do not exist at the moment the record is discarded. Whichever end a single pass runs at, it guesses
// about the other — and `deriveRecordCarry` ran inside `register-digest`, which is BEFORE `synthesis`
// authors `findings.json` (stages.mjs STAGE_ORDER). So the join ran against `[]` and every retrieved
// record that DID become a finding was recorded as having stopped at an earlier seam, naming that seam,
// confidently and wrongly.
//
// It was accidentally correct on the runs that go wrong: `UPSTREAM_STALE_REPAIR` carries a
// `register-digest` entry, so a run that trips the delivery freshness gate re-runs the digest AFTER
// synthesis and sees a populated file. The instrumentation was right exactly when someone was already
// looking at a failure, and wrong on the runs nobody inspects.
//
// This module is the half that cannot guess, because it only ever writes down what a pass JUST DID.
// `record-carry.mjs` is the other half, and it cannot guess either because both sides exist by the time
// it runs. Same shape as `dispatch-record.mjs`: record it where it happens rather than
// reconstructing it later. The two should look like each other, and they do.
//
// ── RECONSTRUCTION IS THE BUG, NOT A FALLBACK ────────────────────────────────────────────────────────
//
// A reason authored by a LATER step about an EARLIER step's decision is exactly how the shipped version
// came to report a clean run as a total loss. Nothing in this module reads a downstream artifact, and
// nothing downstream may author a row into this ledger. `scripts/record-carry-probe.mjs` reconstructs a
// ledger for runs that predate this file — that is a probe on a finished run, it is labelled
// `basis: "reconstructed"` everywhere it surfaces, and it must never be wired into the pipeline.
//
// ── THE WINNER RULE, because the seams re-run ────────────────────────────────────────────────────────
//
// `register-digest` dispatches from at least six triggers and `synthesis` from five, so one record gets
// several rows at one seam. Append-only rows with no cancellation would read a record that was absent
// from `placements.json` on pass 1 and present on pass 2 as DROPPED — the shipped defect with its sign
// flipped, which is not an improvement.
//
//   **At each seam, the LAST row wins. A later `carried` cancels an earlier `discarded`.**
//
// That is why every pass records its verdict on every record it saw, not only its discards: a carry has
// to be able to cancel, and a ledger of discards alone has nothing to cancel with. `foldDiscardLedger`
// is the only reader of that rule and it is pure, so the rule is testable without a run.
//
// ── what a row costs ─────────────────────────────────────────────────────────────────────────────────
//
// The placement seam is the expensive one: it sees the whole band. On a 5,410-record run that is 5,410
// rows per placement pass. Rows are one line of JSON with no `detail` on a carry and `detail` clipped to
// 300 chars on a discard. Measured shape and byte cost are in `driver/test/record-discard.test.mjs`; the
// number is in the PR body rather than left to be discovered.

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //

import { normalizeRecordUri } from "./registry-fidelity.mjs";

export const RECORD_DISCARD_SCHEMA_VERSION = 1;

/** `_driver/record-discard.jsonl` — append-only, one row per record per seam per pass. */
export const DISCARD_LEDGER_NAME = "record-discard.jsonl";

/**
 * The seams that author rows here, in pipeline order.
 *
 * The SCREEN is deliberately absent. It already authors its own verdict onto the band record
 * (`rec.screen.screen_verdict`, read by `screenVerdict` in record-carry.mjs) at the moment it decides,
 * which is what this module exists to achieve. Re-authoring it into the ledger would be a second copy of
 * one decision, and two copies of a decision are how they come to disagree.
 */
export const DISCARD_SEAMS = ["placement", "digest", "synthesis"];

/** What a pass did with a record. `carried` cancels an earlier `discarded` at the same seam. */
export const DISCARD_VERDICTS = ["carried", "discarded"];

const clip = (s, n = 300) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * The rows ONE pass of ONE seam contributes. PURE — the caller owns the write.
 *
 * `saw` is every record that pass had in front of it; `carried` is the subset it passed on. The delta is
 * this pass's discards, and it is a fact this pass holds: the next pass overwrites `placements.json` /
 * `register-findings.md` / `findings.json`, so nobody downstream can recover it.
 *
 * `outcome` is the pass's OWN completion, stamped here rather than looked up later. A pass that did not
 * complete discards nothing — whatever it left on disk is partial, and a record its partial output does
 * not name cannot be distinguished between considered-and-not-selected and never reached at all. Those
 * rows carry `verdict: "discarded"` with `reason_source: "step-structural"` and a reason naming the
 * incompletion, so the fact survives; they are never silently folded into ordinary drops.
 */
export function seamRows({ seam, stage, trigger = null, pass = 1, completed = true,
  saw = [], carried = [], reasonFor = null, evidence = "" } = {}) {
  if (!DISCARD_SEAMS.includes(seam)) return [];
  const carriedSet = new Set();
  for (const u of carried) {
    const n = normalizeRecordUri(u?.uri ?? u);
    if (n) carriedSet.add(n);
  }
  const rows = [];
  const seen = new Set();
  for (const rec of Array.isArray(saw) ? saw : []) {
    const uri = normalizeRecordUri(rec?.uri ?? rec);
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    if (carriedSet.has(uri)) {
      rows.push({ seam, stage, trigger, pass, uri, verdict: "carried" });
      continue;
    }
    if (!completed) {
      rows.push({
        seam, stage, trigger, pass, uri, verdict: "discarded",
        reason: `${seam}:stage-incomplete`, reason_source: "step-structural",
        detail: clip(`UPSTREAM ABSENCE, NOT JUDGMENT — ${stage} did not complete this pass${evidence ? ` (${evidence})` : ""}, so whatever it left on disk is PARTIAL and a record it does not name cannot be distinguished between considered-and-not-selected and never reached at all`),
      });
      continue;
    }
    const r = typeof reasonFor === "function" ? reasonFor(rec, uri) : null;
    rows.push({
      seam, stage, trigger, pass, uri, verdict: "discarded",
      reason: r?.reason ?? `${seam}:not-selected`,
      reason_source: r?.reason_source ?? "step-silent",
      detail: clip(r?.detail ?? `${stage} completed this pass and did not carry this record forward; no ground for this record was recorded`),
    });
  }
  return rows;
}

/**
 * Append rows to the ledger. NEVER THROWS — the same doctrine as `recordDispatch` and the methodology
 * witness: a record that cannot be kept must not fail a turn.
 *
 * Three-valued like `outputMeta`: `null` when there is no run directory, `{present:false, error}` when
 * the write failed, `{present:true, rows}` when it landed. An absence is a record, never a silence.
 */
export function appendDiscardRows(runDir, rows) {
  if (!runDir) return null;
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return { present: true, rows: 0, bytes: 0 };
  try {
    const dir = driverDir(runDir);
    mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString();
    const text = list.map((r) => JSON.stringify({ ts, ...r })).join("\n") + "\n";
    appendFileSync(join(dir, DISCARD_LEDGER_NAME), text);
    return { present: true, rows: list.length, bytes: Buffer.byteLength(text, "utf8") };
  } catch (e) {
    return { present: false, rows: 0, bytes: 0, error: String(e?.message ?? e).slice(0, 120) };
  }
}

/**
 * Fold the ledger to one verdict per record per seam, applying the winner rule. PURE.
 *
 * Takes the ledger TEXT (the pipeline owns the read). Torn trailing lines are ignored, never thrown on —
 * this is disclosure, and a half-written last line must not cost the whole trace.
 *
 * Returns `{ present, rows, byUri, seams, passes }`. `present:false` for an absent or empty ledger, which
 * is a legitimate state on every run archived before and MUST NOT read as "no record was discarded".
 * `record-carry.mjs` refuses to claim a recorded basis without it.
 */
export function foldDiscardLedger(ledgerText) {
  const text = String(ledgerText ?? "");
  const byUri = new Map();
  const seams = new Set();
  const passes = new Map();
  let rows = 0, torn = 0;
  for (const ln of text.split("\n")) {
    if (!ln.trim()) continue;
    let e; try { e = JSON.parse(ln); } catch { torn++; continue; }
    const uri = normalizeRecordUri(e?.uri);
    const seam = String(e?.seam ?? "");
    if (!uri || !DISCARD_SEAMS.includes(seam)) continue;
    rows++;
    seams.add(seam);
    const pk = `${seam}:${e?.stage ?? ""}:${e?.pass ?? 0}:${e?.trigger ?? ""}`;
    passes.set(pk, (passes.get(pk) ?? 0) + 1);
    let m = byUri.get(uri);
    if (!m) { m = {}; byUri.set(uri, m); }
    m[seam] = e;   // THE WINNER RULE: last row at this seam wins, so a later carry cancels a discard
  }
  return { present: rows > 0, rows, torn, byUri, seams: [...seams], passes: passes.size };
}

/**
 * The seam a record stopped at, per the folded ledger, or `null` when the ledger carried it past every
 * seam that spoke. Walks the seams in pipeline order and returns the FIRST that discarded it — a record
 * cannot be discarded at placement and judged at synthesis, so an earlier discard is the ending. PURE.
 */
export function ledgerEnding(folded, uri) {
  const m = folded?.byUri?.get(normalizeRecordUri(uri));
  if (!m) return null;
  for (const seam of DISCARD_SEAMS) {
    const r = m[seam];
    if (r && r.verdict === "discarded") return r;
  }
  return null;
}

/** Did any seam speak about this record at all. PURE. */
export function ledgerSpoke(folded, uri) {
  return Boolean(folded?.byUri?.has(normalizeRecordUri(uri)));
}
