// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// register-taint.mjs — timeout-taint detection for register-unit passes (copper-lattice 2026-07-08).
//
// THE DEFECT CLASS: a register-unit attempt is SIGKILLed at the wall mid-work; its PARTIAL band writes
// survive on disk (the executor's merge never clobbers); the same-stage retry then "succeeds" by
// validating the poisoned band — and a self-reported clean written by the killed attempt ships. The
// stage never THREW, so no recovery loop engaged. This module derives, from the per-attempt stage
// jsonl (`_driver/register-unit:<axis>.jsonl`, append-only, survives every park/--resume), a
// code-readable verdict: was the material that produced the CURRENT band touched by a kill-class
// attempt?
//
// THE RULE (bandPassTaint): rows are scanned in order. A SUPERSEDING success is a fresh full pass
// (not a followup — an escalation/envelope followup RESUMES the prior session and PATCHES its output,
// so it can never launder a tainted base). tainted ⟺ a kill-class row sits BOTH after the FIRST
// superseding success (a kill that mutated a band that had already passed validation — the incident
// class) AND after the PREVIOUS superseding success (the region feeding the current band; an older
// taint a later fresh full pass rebuilt over is superseded). No success at all + any kill ⇒ tainted
// (killed, never recovered — the open-country 3×414 class).
//
// Deliberately NOT tainted (2026-07-10 corpus audit, 70 runs): the plain retry ladder — attempt 1
// killed BEFORE any success, attempt 2 a fresh-key FULL-PROMPT redo that the validator then passed
// (teal-lattice and ~10 more corpus runs; benign every time — the fresh attempt rebuilds its own
// blocks and the artifact is gated on the final state). The incident class is different in kind: the
// kill landed on an already-validated band (a frame-reopen/escalation followup SIGKILLed mid-write),
// and the follow-on "success" validated the mutated file — copper-lattice, ashen-vault,
// marble-bastion all wear exactly that shape. Properties:
//   - attempt-1-clean fresh pass SUPERSEDES old taint (no explicit clear-write to forget);
//   - a kill before the first-ever success never taints (the normal retry ladder);
//   - a followup that succeeds after a post-success kill stays tainted (it patched, didn't replace);
//   - a LATER invocation that died killed (no success after it) taints — its writes are in the merge.
//
// Kill-class rows (isTaintRow): fail timeout/status_timeout, exit code 137, killed, or the engine's
// hardWall/stalled signals. `lane_wedge` and `rate_limited` are EXCLUDED on purpose: a 0-token wedge
// wrote nothing, and a 429 postpones the whole run through its own machinery.
//
// Legacy rows (pre-taint-chain runs, incl. copper-lattice) lack `followup`/`killed`/`signals`; the
// fail/code discriminators still classify them, and followup detection falls back to key-reuse (a
// followup resumes a key that already succeeded — a fresh pass never does).
//
// PURE over pre-read lines (repo doctrine: tests offline); readRegisterTaint is the one IO wrapper.
// Missing/unreadable jsonl ⇒ untainted — legacy runs and replay stay no-op safe.

import { readFileSync, existsSync, readdirSync } from "node:fs";

import { driverDir } from "../shared/driver-dir.mjs";   //

export const TAINT_FAIL_RE = /^timeout$|^status_timeout$/;

export function isTaintRow(row) {
  if (!row || typeof row !== "object") return false;
  const fail = String(row.fail ?? "");
  if (fail === "lane_wedge" || fail === "rate_limited") return false;
  return TAINT_FAIL_RE.test(fail)
    || row.code === 137
    || row.killed === true
    || row.signals?.hardWall === true
    || row.signals?.stalled === true;
}

// bandPassTaint(jsonlLines) -> { tainted, evidence:[{ts, attempt, fail, code, wall}] }
export function bandPassTaint(lines) {
  const rows = [];
  for (const line of lines ?? []) {
    const s = typeof line === "string" ? line.trim() : "";
    if (!s) continue;
    try { rows.push(JSON.parse(s)); } catch { /* a torn tail line never blocks the verdict */ }
  }
  const seenSuccessKeys = new Set();
  let lastReset = -1;   // the T1 taint-rerun's OWN clean attempt-1 success — a deliberate full rebuild
  const supersedes = rows.map((r, i) => {
    const success = r && typeof r === "object" && r.fail == null && r.attempt != null;
    const followup = r?.followup === true || (success && r.key != null && seenSuccessKeys.has(r.key));
    if (success && r.key != null) seenSuccessKeys.add(r.key);
    // the driver's taint-rerun (fan-in T1) is the sanctioned CLEARING pass: force-fresh, full prompt.
    // Only its attempt-1-clean success clears (a killed-then-retried T1 validated a mutated band —
    // never laundered). Legacy runs never carry the suffix, so replay verdicts are untouched.
    if (success && !followup && r.attempt === 1 && /-taint-rerun/.test(String(r.key ?? ""))) lastReset = i;
    return success && !followup;
  });
  const firstSup = supersedes.indexOf(true);
  const lastSup = supersedes.lastIndexOf(true);
  const prevSup = lastSup > 0 ? supersedes.lastIndexOf(true, lastSup - 1) : -1;
  // floor: a kill only counts past the FIRST validated pass (post-success mutation, the incident
  // class), past the PREVIOUS superseding success (a later fresh full pass rebuilds the band), and
  // past the last taint-rerun clearing pass. No success at all ⇒ floor -1 ⇒ any kill taints.
  const floor = Math.max(firstSup, prevSup, lastReset);
  const evidence = [];
  for (let i = floor + 1; i < rows.length; i += 1) {
    const r = rows[i];
    if (isTaintRow(r)) evidence.push({ ts: r.ts ?? null, attempt: r.attempt ?? null, fail: r.fail ?? null, code: r.code ?? null, wall: r.wall ?? null });
  }
  return { tainted: evidence.length > 0, evidence };
}

// IO wrapper: per-axis verdicts from the run dir. Absent jsonl ⇒ untainted (legacy/replay-safe).
export function readRegisterTaint(runDir, axes) {
  const out = {};
  for (const axis of axes ?? []) {
    const p = driverDir(runDir, `register-unit:${axis}.jsonl`);
    if (!existsSync(p)) { out[axis] = { tainted: false, evidence: [] }; continue; }
    let lines;
    try { lines = readFileSync(p, "utf8").split("\n"); }
    catch { out[axis] = { tainted: false, evidence: [] }; continue; }
    out[axis] = bandPassTaint(lines);
  }
  return out;
}

// The fan-in receipt (_driver/register-taint.json) carries a per-axis status:
//   active    — taint detected, recovery not yet succeeded (fresh; the park path throws on these)
//   resolved  — a fresh clean pass / envelope close superseded it (nothing left to act on)
//   disclosed — late resume, audit spine locked: the LEDGER keeps treating it as a gap (deferred →
//               clamp + client-gate withhold) but the VALIDATOR stays quiet — the existing digest is
//               not forced into a rewrite loop under a locked narrative.
// Two readers, two contracts:

// Ledger relabel (loadCoverageLedger): every axis whose taint is UNRESOLVED — receipt statuses
// active|disclosed; no receipt ⇒ the jsonl truth (resume-before-fan-in, legacy runs).
export function readActiveTaintAxes(runDir) {
  const rec = readTaintReceipt(runDir);
  if (rec) return Object.entries(rec.axes ?? {}).filter(([, v]) => v?.status === "active" || v?.status === "disclosed").map(([a]) => a);
  return jsonlTaintedAxes(runDir);
}

// Validator gate (verify.registerFindings): only UNACKNOWLEDGED taint fails a clean claim — receipt
// status "active" (or no receipt at all, the archived/replay case: the copper-lattice flip). A
// resolved or disclosed axis never re-fails the digest.
export function readUnacknowledgedTaintAxes(runDir) {
  const rec = readTaintReceipt(runDir);
  if (rec) return Object.entries(rec.axes ?? {}).filter(([, v]) => v?.status === "active").map(([a]) => a);
  return jsonlTaintedAxes(runDir);
}

function readTaintReceipt(runDir) {
  try {
    const p = driverDir(runDir, "register-taint.json");
    if (!existsSync(p)) return null;
    const rec = JSON.parse(readFileSync(p, "utf8"));
    return rec && typeof rec === "object" ? rec : null;
  } catch { return null; }
}

function jsonlTaintedAxes(runDir) {
  try {
    const dd = driverDir(runDir);
    const axes = readdirSync(dd).filter((f) => f.startsWith("register-unit:") && f.endsWith(".jsonl"))
      .map((f) => f.slice("register-unit:".length, -".jsonl".length));
    if (!axes.length) return [];
    const t = readRegisterTaint(runDir, axes);
    return axes.filter((a) => t[a]?.tainted);
  } catch { return []; }
}
