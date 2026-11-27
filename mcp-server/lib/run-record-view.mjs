// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// run-record-view.mjs — THE RUN'S OWN RECORD, AS A CONNECTOR MAY HAND IT ON (design, 2026-11-27).
//
// What a connector returns to a person or their assistant is user output, with full access as without. A run's event
// log (`run.jsonl`), its per-attempt logs and its `status.json` are its private diagnostic record: they hold the reason
// as the engine reported it, exception text, private paths, validator messages and raw repair records. A door that
// reads them hands on what was measured and what it belongs to: the time, the tokens, the calls, the model, the attempt,
// the step and the event. Nothing written in prose, and nothing the run stopped on: its stage and its kind stay in the
// record. A failed attempt keeps the fact, as `failed: true`.
//
// ALLOWLISTS, so a field added to a log later reaches no door until somebody names it here. These are the same reads a
// company's session never makes (get_telemetry is sealed from it, and status.json and run.jsonl are not among the
// documents it may open), which is why the cut is written here rather than in lib/audit-view.mjs.

// The measured facts of one log row, and what they belong to. Every value under these names is a number, a boolean, a
// time, a short code naming a step, event, lane, engine or model, or an object of those.
const MEASURED = new Set([
  "ts", "event", "stage", "axis", "phase", "attempt", "attempts", "ok", "trigger", "lane", "laneAttempt", "laneAttempts",
  "engine", "model", "modelActual", "modelUsed", "modelSelector", "modelBasis", "authMode", "provider",
  "tokens", "usage", "outputTokens", "inputBytes", "tokensComplete", "tokensPerSec", "bytes", "findingsBytes", "growthBytes", "growthPct",
  "wall", "wallSec", "duration_ms", "activeMs", "quiescentMs", "runMinutes", "sweepMinutes",
  "actualHours", "quotedHours", "turnaroundHours", "turnaroundLowHours", "turnaroundHighHours",
  "toolCalls", "toolCallsByName", "toolCallsErroredByName", "toolCallsRefused", "mcpToolCalls", "commandToolCalls",
  "toolWaitMs", "toolWaitByTool", "cache_hits", "calls", "count", "counts", "total", "billed", "apiBilled", "costBand",
  "byModel", "byStage", "byEngine", "byAuthMode", "byBilling", "billingComposition",
  "priorAttempts", "retries", "recoveryAttempts", "recoveryLane", "parkedAt", "resumesAt", "recoveryResumesAt", "resetsAt",
  "waitedMin", "parks", "statedResets",
]);
// The events that record the run stopping: their stage is the stage it stopped at.
const STOPPED = new Set(["failed", "refused"]);

/** One log row as a door may hand it on. */
export function measuredRow(e) {
  if (!e || typeof e !== "object") return e;
  const out = {};
  for (const [k, v] of Object.entries(e)) if (MEASURED.has(k)) out[k] = v;
  if (STOPPED.has(e.event)) delete out.stage;
  if (e.fail != null && e.fail !== false) out.failed = true;
  return out;
}

// What a run's status says about where it stands and what it spent. Its failure fields, `lastStage` on a stopped run
// and its recovery history's reasons are the record's; the history keeps when each park happened and how long it waited.
const STATUS_FIELDS = ["schema", "id", "runId", "slug", "codename", "date", "agent", "lane", "state", "tier", "markName",
  "marks", "ref", "classes", "product", "url", "caption", "reports", "stepN", "stepTotal", "stepIndex", "stepLabel",
  "stageLabel", "lastStage", "startedAt", "updatedAt", "resumedAt", "endedAt", "deliveredAt", "resetsAt", "recoveryResumesAt",
  "recoveryAttempts", "recoveryMax", "recoveryLane", "attempts", "sendPending", "stoppable", "tokens", "economics",
  "providerUsage", "registersServed"];
export function statusView(s) {
  if (!s || typeof s !== "object") return s;
  const out = {};
  for (const k of STATUS_FIELDS) if (k in s) out[k] = s[k];
  if (s.state === "failed" || s.state === "refused") delete out.lastStage;
  if (Array.isArray(s.recoveryHistory)) out.recoveryHistory = s.recoveryHistory.map(measuredRow);
  return out;
}

/** A log's text, row by row. A row that is not JSON is not handed on. */
export function measuredLogText(text) {
  return String(text ?? "").split("\n").filter((l) => l.trim()).map((l) => {
    try { return JSON.stringify(measuredRow(JSON.parse(l))); } catch { return null; }
  }).filter(Boolean).join("\n");
}

// The run's own record, by the names read_artifact and search know it by.
export const RECORD_NAMES = new Set(["status.json", "run.jsonl"]);
export function recordText(name, text) {
  if (name === "run.jsonl") return measuredLogText(text);
  if (name === "status.json") {
    try { return JSON.stringify(statusView(JSON.parse(text)), null, 2); } catch { return ""; }
  }
  return text;
}

/** get_coverage: whether each part exists and passed its check, never the check's own message. */
export function coverageView(c) {
  if (!c || typeof c !== "object") return c;
  const strip = (rows) => (Array.isArray(rows) ? rows.map(({ reason: _r, ...rest }) => rest) : rows);
  return { ...c, registerAxes: strip(c.registerAxes), artifacts: strip(c.artifacts) };
}

/**
 * trace: the lineage as it stands, each step's failed attempt as a fact rather than its message, and the billed counts
 * only when they were counted. A step's name is how trace is asked (its `target`), so the steps it walks stay named.
 */
export function traceView(t) {
  if (!t || typeof t !== "object") return t;
  const node = (n) => {
    if (!n || typeof n !== "object") return n;
    const { fail, ...rest } = n;
    const out = { ...rest };
    if (fail != null && fail !== false) out.failed = true;
    if (Array.isArray(n.upstream)) out.upstream = n.upstream.map(node);
    return out;
  };
  const out = { ...t };
  if (t.emittingStage) out.emittingStage = node(t.emittingStage);
  if (t.providerUsage && typeof t.providerUsage === "object" && "error" in t.providerUsage) out.providerUsage = null;
  return out;
}
