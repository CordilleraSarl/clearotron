// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// e2e-first-time.mjs — "first time", read from the whole run record.
//
// THE DEFINITION (ruled 2026-09-25): a run passes first time with zero failures and zero retries of any
// kind its record shows, recoveries, re-asks and repairs included, read from the run record and never
// from the attempt count. A stage's attempt number misses most of them: a form repair turn, a warm rung
// refunded because it never reached the model, a turn rescued at its wall, a failure turned into an ok by
// quarantine, a tool call that failed inside a turn, a refused item, and a second cycle after a recovery
// all leave the stage's own count where it was.
//
// IT RECORDS AND NEVER GRADES. A retry can be a guard working; the harness lists each row with its kind,
// stage, engine and model and the reader decides, as the ledger beside it already does for retries. The
// engine and model ride every row, so a difference across engines stays visibly confounded.
//
// "NOT RECORDED" IS NOT ZERO. A kind the run record cannot show is named as not recorded on every line,
// and a run with no model-attempt record at all answers "cannot tell", never "yes".
//
// A pure leaf: node:fs and node:path plus shared/driver-dir.mjs, which the harness already imports, so it
// cannot drag driver.config.mjs, whose unset-env defaults are PRODUCTION, into the harness.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { driverDir, labelOfDriverFile } from "../shared/driver-dir.mjs";

// What no file of the run record holds, stated on every answer. The register's own HTTP retries are
// written to the provider call log, which is per machine, not per run; and a tool result whose text reports a
// failure while its call settles ok carries no marker the call log keeps.
export const NOT_RECORDED = [
  "register calls the provider retried inside one tool call (the call log is per machine, not per run)",
  "a tool result that reports a failure in its text while the call settles ok",
];

// Run-log events that are a failure, a retry, a recovery, a repair or a refusal, by name. Read by
// pattern as well, so an event added later under one of these words is listed rather than missed.
const EVENT_KINDS = [
  [/^form-repair$/, "form repair turn"],
  [/^warm-rung$/, "warm rung"],
  [/^attempt-prevented$/, "attempt the ladder cut"],
  [/recover|park|resum/, "recovery"],
  [/repair/, "repair"],
  [/quarantin/, "quarantine"],
  [/reattempt|retry/, "retry"],
  [/-refused$/, "refused item"],
  [/^failed$/, "run failed"],
];
const kindOfEvent = (name) => EVENT_KINDS.find(([re]) => re.test(String(name ?? "")))?.[1] ?? null;

const clip = (s, n = 140) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * Every row of the record that keeps a run from being first time. PURE; never throws on odd input.
 *
 * @param attempts  [{stage, row, code}] — every numbered row of `_driver/<stage>.jsonl`, in file order;
 *                  `code` marks a row with no engine, a code-side step
 * @param runLog    the parsed rows of `_driver/run.jsonl`, in order
 * @param status    status.json
 * @param markers   {postponed, failed} — the run's queue markers, parsed, or null
 * @param toolCalls the parsed rows of `_driver/tool-calls.jsonl`
 * @param repairs   the parsed rows of `_driver/register-repair.jsonl`
 * @param discards  the parsed rows of `_driver/record-discard.jsonl`
 * @returns {{firstTime: boolean|null, rows, codeSteps, notRecorded}}
 */
export function firstTimeRows({ attempts = [], runLog = [], status = {}, markers = {}, toolCalls = [], repairs = [], discards = [] } = {}) {
  const rows = [];
  const engineOf = new Map();
  const add = (kind, stage, attempt, cause, row = null) => {
    const who = row ?? engineOf.get(stage) ?? {};
    rows.push({ kind, stage: stage ?? null, attempt: attempt ?? null, cause: clip(cause),
      engine: who.engine ?? null, model: who.modelActual ?? who.model ?? null });
  };
  let codeSteps = 0;
  const seenAttempt = new Map();   // stage → highest attempt number read so far, in row order
  for (const { stage, row, code } of Array.isArray(attempts) ? attempts : []) {
    if (!row || typeof row !== "object") continue;
    // A code-side step writes a numbered row with no engine and no verdict of its own: not an engine
    // attempt, never a pass or a failure.
    if (code || row.ok === null || row.ok === undefined) { codeSteps++; continue; }
    if (row.engine || row.modelActual || row.model) engineOf.set(stage, row);
    const n = Number(row.attempt);
    const prior = seenAttempt.get(stage) ?? 0;
    if (Number.isFinite(n) && n <= prior) add("second cycle", stage, n, `attempt ${n} again after attempt ${prior} in the same stage record — a recovery or resume ran the stage again`, row);
    if (Number.isFinite(n)) seenAttempt.set(stage, Math.max(prior, n));
    if (row.ok === false) add("failed attempt", stage, n, row.fail ?? "no cause recorded", row);
    else if (Number.isFinite(n) && n > 1) add("retry", stage, n, `attempt ${n} succeeded`, row);
    if (row.rescued) add("rescue", stage, n, `rescued: ${row.rescued}`, row);
    if (row.selfReportContradicted === true && row.ok !== false) add("self-report contradicted", stage, n, "the model reported done and its file said otherwise", row);
    if (Number(row.toolCallsRefused) > 0) add("refused tool call", stage, n, `${row.toolCallsRefused} tool call(s) refused in the turn`, row);
  }
  for (const e of Array.isArray(runLog) ? runLog : []) {
    if (e?.event === "attempt") continue;   // the stage records above are the attempt rows
    const kind = kindOfEvent(e?.event);
    if (!kind) continue;
    if (e.event === "warm-rung" && e.rung_free === true) {
      add("refunded warm rung", e.stage, e.attempt, e.reason ?? "a warm turn never reached the model");
      continue;
    }
    add(kind, e.stage ?? e.fromStage ?? null, e.attempt ?? null, `${e.event}${e.reason ? `: ${e.reason}` : e.fail ? `: ${e.fail}` : e.rule ? `: ${e.rule}` : ""}`);
  }
  if (Number(status?.recoveryAttempts) > 0) add("recovery", status.failedStage ?? null, null, `status records ${status.recoveryAttempts} recovery attempt(s)`);
  if (status?.resumedAt) add("recovery", null, null, `resumed at ${status.resumedAt}`);
  if (markers?.postponed) add("recovery", markers.postponed.stage ?? null, null, `parked${markers.postponed.parkKind ? ` (${markers.postponed.parkKind})` : ""}`);
  if (markers?.failed) add("run failed", markers.failed.stage ?? null, null, markers.failed.reason ?? markers.failed.terminalKind ?? "the run's failure marker");
  for (const r of Array.isArray(repairs) ? repairs : []) add("register repair", r?.axis ?? r?.stage ?? "register", null, r?.reason ?? r?.kind ?? "a register repair row");
  for (const d of Array.isArray(discards) ? discards : []) {
    if (/:stage-incomplete$/.test(String(d?.reason ?? ""))) add("incomplete pass", d.stage ?? d.seam ?? null, d.pass ?? null, `${d.seam ?? "a"} pass did not complete`);
  }
  // A tool call that failed inside a turn. The call log names no stage, so each is placed by the time
  // windows of the attempts it fell in; where two concurrent stages overlap it, both are named.
  const windows = (Array.isArray(runLog) ? runLog : []).filter((e) => e?.event === "attempt" && e.ts && Number(e.wall) > 0)
    .map((e) => ({ stage: e.stage, attempt: e.attempt, end: Date.parse(e.ts), start: Date.parse(e.ts) - Number(e.wall) * 1000 }));
  const failedCalls = (Array.isArray(toolCalls) ? toolCalls : []).filter((c) => c?.event === "settled" && c.ok === false);
  for (const c of failedCalls) {
    const t = Date.parse(c.ts);
    const at = windows.filter((w) => t >= w.start && t <= w.end);
    const stage = at.length ? [...new Set(at.map((w) => w.stage))].join(" or ") : null;
    add("failed tool call", stage ?? "stage not recorded", at.length === 1 ? at[0].attempt : null, `${c.server ?? "?"}/${c.tool ?? "?"} settled ok:false`);
  }
  const engineRows = (Array.isArray(attempts) ? attempts : []).filter(({ row, code }) => row && !code && row.ok !== null && row.ok !== undefined).length;
  const firstTime = engineRows === 0 ? null : rows.length === 0;
  return { firstTime, rows, codeSteps, notRecorded: NOT_RECORDED };
}

/** The one line the ledger prints, then one line per row. PURE. */
export function firstTimeLines(ft) {
  const nr = `not recorded: ${ft.notRecorded.join("; ")}`;
  const code = ft.codeSteps ? ` ${ft.codeSteps} code step(s) are not engine attempts and count neither way.` : "";
  if (ft.firstTime === null) return [`first time: CANNOT TELL — the run record holds no engine attempt row.${code} (${nr})`];
  if (ft.firstTime) return [`first time: yes — the run record shows no failure, retry, repair, rescue or refusal.${code} (${nr})`];
  return [`first time: no — ${ft.rows.length} row(s) in the run record.${code} (${nr})`,
    ...ft.rows.map((r) => `    ${r.kind} · ${r.stage ?? "no stage"}${r.attempt != null ? ` attempt ${r.attempt}` : ""} · ${r.engine ?? "engine not recorded"}/${r.model ?? "model not recorded"} — ${r.cause}`)];
}

const readJsonl = (p) => {
  try {
    return readFileSync(p, "utf8").split("\n").filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
};
const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

/** The run record, read from a run directory. Absent files read as empty; the answer says what it could not see. */
export function readRunRecord(runDir) {
  const dd = driverDir(runDir);
  const attempts = [];
  let files = [];
  try { files = readdirSync(dd).filter((f) => f.endsWith(".jsonl") && !["run.jsonl", "tool-calls.jsonl", "register-repair.jsonl", "record-discard.jsonl"].includes(f)); } catch { /* no _driver */ }
  for (const f of files.sort()) {
    const stage = labelOfDriverFile(f);
    // A model-turn record carries its engine; a numbered row with none is a code-side step, kept so it is
    // counted as one rather than dropped — the same line the ledger beside this draws.
    for (const row of readJsonl(join(dd, f))) if (Number.isFinite(Number(row?.attempt))) attempts.push({ stage, row, code: !("engine" in row) });
  }
  const marker = (name) => (existsSync(join(runDir, name)) ? (readJson(join(runDir, name)) ?? { reason: "the marker is present and not readable" }) : null);
  return {
    attempts,
    runLog: readJsonl(join(dd, "run.jsonl")),
    status: readJson(join(runDir, "status.json")) ?? {},
    markers: { postponed: marker(".postponed"), failed: marker(".failed") },
    toolCalls: readJsonl(join(dd, "tool-calls.jsonl")),
    repairs: readJsonl(join(dd, "register-repair.jsonl")),
    discards: readJsonl(join(dd, "record-discard.jsonl")),
  };
}
