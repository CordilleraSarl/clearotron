// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lib/events.mjs — project the self-describing _driver/run.jsonl event log into an ordered DECISION timeline.
//
// run.jsonl is an append-only `{ts, event, ...}` log. Both the decision_timeline tool ("how did the verdict
// evolve?") and the run_changes tool ("what changed since T?") are folds over it, so they share this one lib
// (which also owns the single readEvents — previously copy-pasted in server.mjs + trace.mjs). Read-only.
//
// IMPORTANT honesty: the per-finding risk wording across digest versions is NOT recoverable on a normal run —
// the escalation re-digest / corrective re-synthesis overwrite register-findings.md / narrative.md IN PLACE
// (only an in-place re-dispatch snapshots into _history). What survives is every milestone
// + the output SHA per stage. So `changedFromPrevious` (consecutive same-stage output.sha differ) is the
// deterministic "this doc changed here" signal; the old-vs-new TEXT is gone unless a _history snapshot exists.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { readCapped } from "./util.mjs";
import { stepForStage } from "./driver.mjs";

export function readEvents(runDir) {
  try {
    return readCapped(driverDir(runDir, "run.jsonl"))
      .trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// — OWNER-APPROVED CLIENT-VISIBLE TEXT, verbatim (2026-08-18). This reaches a client's progress
// view. Do not re-word it, do not "tidy" the dash, and do not build a second copy: events.test.mjs pins
// the bytes, so a paraphrase fails there rather than reaching a client.
export const CLIENT_INCOMPLETE = "Screening: incomplete — flagged for review";

function phaseFor(stage) { const s = stepForStage(stage); return s ? s.label : null; }
function ratObj(source, text) { return text ? { source, text } : null; }

// Lazily read + cache the small run-local rationale source files (escalation reasons, the verdict head line).
function makeRationale(P) {
  let escalation, verdictHead;
  return {
    escalation() {
      if (escalation !== undefined) return escalation;
      escalation = null;
      try {
        if (P.skepticFlags && existsSync(P.skepticFlags)) {
          const lines = readFileSync(P.skepticFlags, "utf8").split("\n").map((l) => l.trim()).filter((l) => /escalat/i.test(l));
          if (lines.length) escalation = lines.join(" · ");
        }
      } catch { /* best-effort */ }
      return escalation;
    },
    verdictHead() {
      if (verdictHead !== undefined) return verdictHead;
      verdictHead = null;
      try {
        if (P.seniorEyeReview && existsSync(P.seniorEyeReview)) {
          const lines = readFileSync(P.seniorEyeReview, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
          // skip a leading bare verdict word line ("CLEAR" / "Verdict: BLOCKING") to surface the reasoning head
          verdictHead = lines.find((l) => !/^(verdict:\s*)?(CLEAR|CONDITIONAL|BLOCKING)\b/i.test(l)) ?? null;
        }
      } catch { /* best-effort */ }
      return verdictHead;
    },
  };
}

// One run.jsonl event → one timeline entry (or a generic passthrough — we never silently drop an event).
// Model identity is deliberately NOT projected here: decision_timeline / run_changes are narrative surfaces
// (read out in front of lawyers/clients); model attribution lives in get_telemetry only. The raw event keeps it.
function classify(e, st, rat) {
  const ts = e.ts ?? null;
  switch (e.event) {
    case "start":
      return { ts, kind: "start", decision: "run-started", agent: e.agent ?? null, resume: e.resume ?? false };
    case "axes":
      return { ts, kind: "axes", decision: "axes-decided", axes: e.axes ?? [] };
    case "stage":
    case "skip": {
      const label = e.stage;
      const sha = e.output?.sha ?? null;
      const seen = st.prevSha.has(label);
      const changedFromPrevious = seen ? (sha != null && sha !== st.prevSha.get(label)) : null;
      if (sha != null) st.prevSha.set(label, sha);
      const decision = e.event === "skip" ? "stage-skipped" : seen ? "stage-recomputed" : "stage-completed";
      return {
        ts, kind: e.event, phase: phaseFor(label), stage: label, decision,
        trigger: e.trigger ?? null,
        ok: e.ok ?? (e.event === "skip" ? true : null), outputSha: sha, changedFromPrevious,
      };
    }
    case "failover":
      return { ts, kind: "failover", phase: phaseFor(e.stage), stage: e.stage ?? null, decision: "model-failover", attempt: e.attempt ?? null };
    case "attempt":   // AD-4: the per-dispatch spine (gateway runStage) — projected compactly, cause kept
      return { ts, kind: "attempt", phase: phaseFor(e.stage), stage: e.stage ?? null,
        decision: e.ok ? "attempt-succeeded" : "attempt-failed", attempt: e.attempt ?? null, fail: e.fail ?? null };
    case "skeptic-escalation":
      return { ts, kind: "skeptic-escalation", phase: phaseFor("skeptic"), decision: "escalated-axes", escalated: e.escalated ?? [], rationale: ratObj("skeptic-flags.md", rat.escalation()) };
    case "escalation-skipped":
      return { ts, kind: "escalation-skipped", decision: "escalation-skipped", axis: e.axis ?? null, reason: e.reason ?? null };
    case "escalation-noop":
      return { ts, kind: "escalation-noop", decision: "axis-defended-in-place", axis: e.axis ?? null };
    case "verdict":
    case "verdict-2":
      return { ts, kind: e.event, phase: phaseFor("narrative-refutation"), decision: "verdict-emitted", verdict: e.verdict ?? null, rationale: ratObj("senior-eye-review.md", rat.verdictHead()) };
    case "delivered-with-open-questions":
      return { ts, kind: e.event, decision: "delivered-with-open-questions", verdict: e.verdict ?? null };
    // ── — THREE WRITERS, FIVE CAUSES, AND THIS SURFACE SAID ONE WORD ──────────────────────────
    //
    // `screen-gate-clean` is written from three places and they do not mean the same thing: two are
    // `recovered: true` (violations existed and a repair healed them) and one is the zero branch, which
    // since carries `cause` naming which of five reasons the gate saw nothing. All three rendered
    // as the single word `screen-gate-passed`, so two DRIVER DEFECTS — the findings file the gate reads
    // was never written, or was blank — were indistinguishable on a lawyer's timeline from a genuinely
    // clean gate.
    //
    // OWNER RULING (2026-08-18): when the screening safety-net could not actually inspect anything, the
    // client's progress view shows "Screening: incomplete — flagged for review". Clear wording appears
    // ONLY when the gate genuinely ran and found nothing. `CLIENT_INCOMPLETE` below is that string
    // VERBATIM and is not to be re-worded here — it is owner-approved client-visible text.
    //
    // WHICH CAUSES ARE "COULD NOT INSPECT": `findings-absent` (the file is not on disk) and
    // `findings-empty` (present but blank). Both are the gate reading nothing at all, and screen-gate.mjs
    // names them as driver defects "wearing a clean run's clothes".
    //
    // THE OTHER THREE INSPECTED, so they stay on the clear side — but the row is no longer collapsed:
    // `cause` and `recovered` travel, so a reader sees WHICH clear this was. That matters most for
    // `unnamed-drops-unarmed`, the DEFAULT mode, where the digest dropped rows on goods and this
    // configuration did not count them. screen-gate.mjs is explicit that folding it in with
    // `no-drop-rows` "would put a false label on the commonest path — the reader would be told the digest
    // dropped nothing on goods when it dropped and nobody counted". Carrying the cause is what keeps that
    // true here without alarming every ordinary run.
    //
    // A pre- event carries no `cause`. It is left `null` and stays on the clear side: this surface
    // must not retro-label old runs as incomplete on the strength of a field their engine never wrote.
    case "screen-gate-clean": {
      const cause = e.cause ?? null;
      const couldNotInspect = cause === "findings-absent" || cause === "findings-empty";
      return {
        ts, kind: e.event,
        decision: couldNotInspect ? "screen-gate-incomplete" : "screen-gate-passed",
        ...(couldNotInspect ? { display: CLIENT_INCOMPLETE } : {}),
        cause,
        recovered: e.recovered ?? false,
      };
    }
    case "screen-gate-violation":
      return { ts, kind: e.event, decision: "screen-gate-violation", count: e.count ?? null, uris: e.uris ?? [] };
    case "audit":
      return { ts, kind: "audit", decision: "audit-built", findings: e.findings ?? null, negatives: e.negatives ?? null, audit: e.audit ?? null };
    case "provider-usage":
      return { ts, kind: "provider-usage", decision: "usage-recorded", summary: { total: e.total ?? null, search: e.search ?? null, record_fetch: e.record_fetch ?? null } };
    case "manual-rerun":
      return { ts, kind: "manual-rerun", phase: phaseFor(e.stage), stage: e.stage ?? null, decision: "manual-rerun", snapshot: e.snapshot ?? null };
    case "failed":
      return { ts, kind: "failed", phase: phaseFor(e.stage), stage: e.stage ?? null, decision: "run-failed", reason: e.reason ?? null };
    default:
      return { ts, kind: e.event ?? "unknown", decision: e.event ?? "unknown" }; // generic passthrough
  }
}

// A SUCCEEDED attempt is not a decision. put one `attempt` row on run.jsonl per model dispatch, and
// with no kind filter here every stage began emitting BOTH `attempt-succeeded` and `stage-completed` —
// +61 entries on 269 (+23%) on the 2026-07-29 delivered run, roughly double on a correction-heavy one, on
// a surface this module's own header calls "read out in front of lawyers/clients". The winning dispatch is
// already told by `stage-completed`; repeating it is duplication, not narrative.
//
// A FAILED attempt is kept, deliberately: "this stage had to be re-dispatched, and here is the cause" is a
// fact the timeline could never state before (run.jsonl carried attempts:N with no causes). So the fold is
// one-sided — attempts survive here only when they say something `stage-completed` does not. Presentation
// only: no gate, verdict path or delivery decision reads the projected timeline.
const isNoiseEntry = (t) => t.kind === "attempt" && t.decision === "attempt-succeeded";

/**
 * projectTimeline(events, P, {sinceTs}) → { timeline, verdictHistory }.
 * `seq` is assigned over the FULL ordered log (stable), THEN sinceTs filters — so a poll cursor never
 * renumbers earlier entries. verdictHistory is [verdict, verdict-2?] in emission order.
 */
export function projectTimeline(events, P, { sinceTs, sinceSeq } = {}) {
  const st = { prevSha: new Map() };
  const rat = makeRationale(P);
  const full = [];
  let seq = 0;
  for (const e of events) {
    const entry = classify(e, st, rat);
    // seq is assigned over EVERY classified event, before any fold — a dropped entry must leave its number
    // unused, never compact the ones after it, or a `sinceSeq` cursor held by a poller would renumber (and
    // re-emit or skip) history it has already read.
    entry.seq = seq++;
    if (isNoiseEntry(entry)) continue;
    full.push(entry);
  }
  const verdictHistory = events.filter((e) => e.event === "verdict" || e.event === "verdict-2").map((e) => e.verdict ?? null);
  // Prefer the stable monotonic `seq` cursor: timestamps are millisecond-resolution and NOT unique, so a
  // `ts > sinceTs` re-poll would silently drop any trailing events that share the cursor's millisecond.
  let timeline = full;
  if (sinceSeq != null) timeline = full.filter((t) => t.seq > sinceSeq);
  else if (sinceTs) timeline = full.filter((t) => t.ts && String(t.ts) > String(sinceTs));
  return { timeline, verdictHistory };
}
