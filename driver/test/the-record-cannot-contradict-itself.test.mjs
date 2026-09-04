// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// / / — ONE MECHANISM IN THREE ORGANS: the evidence is recorded, no consumer is joined
// to it, and the claim beside it is free to contradict it.
//
// the attempt row's headline was the ENGINE's self-report; the driver's own verdict sat two
//          fields away as `fail`, and a watcher keyed on the headline saw sixty successes.
// the reviewer's cited defects were already parsed by a function this pipeline imports; the
//          BLOCKING sidecar wrote `reasons: []` beside them.
// the pre/post findings diff already saw the deletion; the outcome it derived from it was
//          `findings-changed`, which is the label that reads as the flag having landed.
//
// The controls matter more than the defect arms here. Each defect has a neighbouring shape that must NOT
// trip — an honest failure, a corrected finding, a clean success — because a flag that fires on all of
// them says nothing, and that is how the original contradiction survived being looked at.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { runStage, registerEngine } from "../gateway.mjs";
import { buildCorrectionsApplied, correctionsAppliedTable, correctionsWorklist } from "../corrections-feedforward.mjs";
import { parseCorrections, countCitedDefects } from "../verify.mjs";
import { riskStatement, bindRecommendation, deriveDisplayVerdict } from "../findings-model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// ── the gateway harness (instrumentation-house-rule.test.mjs's, verbatim) — offline, $0 ─────────────
async function withEngine(name, runTurn, fn) {
  registerEngine({ name, runTurn });
  const saved = { CLEAROTRON_AI: process.env.CLEAROTRON_AI, CLEAROTRON_RETRY_BACKOFF_MS: process.env.CLEAROTRON_RETRY_BACKOFF_MS };
  process.env.CLEAROTRON_AI = name;
  process.env.CLEAROTRON_RETRY_BACKOFF_MS = "0";
  try { return await fn(); }
  finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
// THE SELF-REPORT UNDER TEST: the envelope of a turn that ended cleanly believing it had succeeded.
const claimsSuccess = (extra = {}) => ({
  code: 0, killed: false, wall: 2, stdout: "ok", stderr: "", laneWaitMs: 0,
  json: { status: "ok", summary: "success", result: { meta: { agentMeta: {} }, payloads: [{ text: "done" }] } },
  usage: { input: 5, output: 9, cacheRead: 0, cacheWrite: 0, total: 14 }, sessionRef: "s", ...extra,
});
const readStageRows = (dir, stage) =>
  readFileSync(driverDir(dir, `${stage}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));

const withRun = async (prefix, fn) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(driverDir(dir), { recursive: true });
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

// ── ───────────────────────────────────────────────────────────────────────────────────────────

test("#1061 THE INCIDENT: the seat says success and writes nothing — the row's verdict is the DRIVER's", async () => {
  // 2026-08-16 15:08–15:25, knockout-assess: three attempts, status=ok, summary="success", wrote:false,
  // fail=missing_file. The honest half of the row was always there. The headline was not.
  await withRun("rec1061-a-", async (dir) => {
    const out = join(dir, "knockout-assess-0.json");
    const r = await withEngine("fake-claims-success", async () => claimsSuccess(),   // writes NOTHING
      () => runStage("knockout-assess", { agent: "clawdi", sessionKey: "k", message: "m", model: "opus",
        thinking: "medium", timeoutSec: 600, expectFile: out, runDir: dir, maxRetries: 0 }));
    assert.equal(r.ok, false);
    assert.match(r.fail, /^missing_file:/, "the fixture must reproduce the incident's failure class");

    const row = readStageRows(dir, "knockout-assess")[0];
    assert.equal(row.ok, false, "THE DEFECT: the row's own verdict must be the driver's, and it failed this attempt");
    assert.equal(row.wrote, false, "…the honest half, unchanged");
    assert.ok(row.fail, "…and the cause, unchanged");
    assert.equal(row.selfReportContradicted, true,
      "the engine claimed the turn completed and the driver failed it — the contradiction is the finding, "
      + "and it is what separates a seat that knows it failed from one that ended believing it had succeeded");
    // The self-report is EVIDENCE and must survive, under a name that says whose claim it is.
    assert.equal(row.engineStatus, "ok", "the engine's own status must still be readable — deleting it would "
      + "destroy the only record of what the seat believed");
    assert.equal(row.engineSummary, "success", "…and its own word for itself");
    assert.equal(row.status, undefined,
      "a field named `status` is what a watcher keys on; while it held the ENGINE's answer, sixty failed "
      + "attempts read as sixty successes. Nothing on this row may be named `status` again");
    assert.equal(row.summary, undefined, "…and the same for `summary`");
  });
});

test("#1061 THE 60-RECORD SUB-SHAPE: it wrote the file, the file was rejected, and the row still says failed", async () => {
  // Round 892dd88e: 30 cards × 2 attempts, ALL sixty carrying status:"ok", summary:"success", code:0,
  // wrote:true, output.present:true beside a populated `fail`. A check keyed on `wrote` sees none of them.
  await withRun("rec1061-b-", async (dir) => {
    const out = join(dir, "card.md");
    const r = await withEngine("fake-writes-junk", async () => { writeFileSync(out, "# card\n"); return claimsSuccess(); },
      () => runStage("report-card", { agent: "clawdi", sessionKey: "k", message: "m", model: "opus",
        thinking: "medium", timeoutSec: 600, expectFile: out, runDir: dir, maxRetries: 0,
        validate: () => ({ ok: false, reason: "invalid_file:card.md:missing:card+detail" }) }));
    assert.equal(r.ok, false);

    const row = readStageRows(dir, "report-card")[0];
    assert.equal(row.wrote, true, "the fixture must be the OTHER sub-shape — this dispatch did emit a file");
    assert.equal(row.output.present, true, "…and the file is on disk");
    assert.equal(row.ok, false, "…and the row still says the attempt failed");
    assert.equal(row.selfReportContradicted, true,
      "a fix keyed on `wrote` alone would have missed all sixty of these — the contradiction is between the "
      + "engine's claim and the DRIVER's verdict, not between the claim and the file");
  });
});

test("#1061 CONTROL: an honestly-reported failure is not a contradiction", async () => {
  // The discriminating control. `selfReportContradicted` must mean "the engine claimed success", not
  // "this attempt failed" — a flag that fires on every failure carries no information at all.
  await withRun("rec1061-c-", async (dir) => {
    const out = join(dir, "o.md");
    const r = await withEngine("fake-honest-error", async () => claimsSuccess({ code: 1, json: { status: "error" } }),
      () => runStage("s", { agent: "clawdi", sessionKey: "k", message: "m", model: "opus", thinking: "medium",
        timeoutSec: 600, expectFile: out, runDir: dir, maxRetries: 0 }));
    assert.equal(r.ok, false, "it failed");

    const row = readStageRows(dir, "s")[0];
    assert.equal(row.ok, false, "…and the row says so");
    assert.equal(row.engineStatus, "error", "…because the ENGINE said so too");
    assert.equal(row.selfReportContradicted, undefined,
      "nothing contradicted anything here — the engine reported the failure and the driver agreed. If this "
      + "arm ever reds, the flag has degraded into a synonym for `!ok` and stops naming the defect");
  });
});

test("#1061 CONTROL: a clean success says ok and claims no contradiction", async () => {
  await withRun("rec1061-d-", async (dir) => {
    const out = join(dir, "o.md");
    const r = await withEngine("fake-clean", async () => { writeFileSync(out, "x"); return claimsSuccess(); },
      () => runStage("s", { agent: "clawdi", sessionKey: "k", message: "m", model: "opus", thinking: "medium",
        timeoutSec: 600, expectFile: out, runDir: dir, maxRetries: 0 }));
    assert.equal(r.ok, true);
    const row = readStageRows(dir, "s")[0];
    assert.equal(row.ok, true);
    assert.equal(row.selfReportContradicted, undefined);
    assert.equal(row.engineSummary, "success", "the self-report rides every row, not only the contradicted ones");
  });
});

// ── ───────────────────────────────────────────────────────────────────────────────────────────

const BLOCKING_REVIEW = [
  "VERDICT: BLOCKING",
  "",
  "- [kind: fact] Finding 4 asserts NOVARTIS uses the mark in class 5; the cited page does not say that.",
  "- [kind: rating] Finding 9's band is HIGH on a record that never issued.",
  "",
  "## PLAN-EXECUTION CHECK",
  "- every planned channel was swept",
].join("\n");

test("#1065 the grounds a BLOCKING sidecar lacked were already parsed by a function the pipeline imports", () => {
  // The whole of this fix. `parseCorrections` is imported at pipeline.mjs:33 and is what the corrective
  // pass is handed; it walks the same lines `countCitedDefects` counts. Nothing needed extracting — the
  // two halves were simply never joined, which is this family's mechanism stated in one sentence.
  const cited = parseCorrections(BLOCKING_REVIEW).map((r) => r.text).filter(Boolean);
  assert.equal(cited.length, 2, "the two flagged defects, and NOT the PLAN-EXECUTION CHECK bullet below them");
  assert.match(cited[0], /NOVARTIS/, "the ground is the reviewer's own sentence, not a count of sentences");
  assert.equal(countCitedDefects(BLOCKING_REVIEW), cited.length,
    "the count and the list must come from one walk — a second copy of that walk is how the two drift apart");
});

test("#1065 populating a BLOCKING sidecar's reasons moves NO client-visible text", () => {
  // The safety claim this change rests on, pinned so it cannot quietly stop being true. Both client
  // sentences are fixed strings on BLOCKING and neither reads `reasons`. If someone later makes BLOCKING
  // render its reasons, this arm reds — and that is the signal that the sidecar change now reaches a
  // reader and needs the test lane, not that the assertion is stale.
  const grounds = parseCorrections(BLOCKING_REVIEW).map((r) => r.text);
  assert.ok(grounds.length, "the fixture must actually carry grounds, or this arm compares nothing to nothing");
  assert.equal(riskStatement({ tier: "HIGH", verdict: "BLOCKING", reasons: grounds }),
    riskStatement({ tier: "HIGH", verdict: "BLOCKING", reasons: [] }));
  assert.equal(bindRecommendation("proceed to file", "BLOCKING", grounds),
    bindRecommendation("proceed to file", "BLOCKING", []));
  const derived = deriveDisplayVerdict({ verdict: "BLOCKING", reasons: grounds, kinds: { reviewerCited: true }, findings: [] });
  assert.deepEqual(derived.conditions, grounds, "…and the grounds DO reach the record, which is the point");
});

test("#1065 the sidecar writer carries the grounds and refuses an empty BLOCKING", () => {
  // Source-anchored, because `writeVerdictSidecar` is a closure inside the delivery function and cannot be
  // called from here. The two claims asserted are the ones a later edit would break silently: that the
  // BLOCKING arm reads the review at all, and that the invariant is stated over the value WRITTEN rather
  // than over the branch that fills it.
  const SRC = readFileSync(join(HERE, "..", "pipeline.mjs"), "utf8");
  const at = SRC.indexOf('if (verdict === "BLOCKING") {\n        let cited = []');
  assert.ok(at > 0, "the #1065 grounds arm is gone from the sidecar writer — a BLOCKING verdict is shipping "
    + "its decision without its grounds again");
  assert.match(SRC.slice(at, at + 600), /parseCorrections\(readFileSync\(P\.seniorEyeReview/,
    "the grounds are no longer read from the reviewer's own file");
  assert.match(SRC, /verdict === "BLOCKING" && !reasonsOut\.length\)\s*\n\s*throw new Error/,
    "the invariant no longer guards the WRITTEN value — a guard that holds only while the code above it is "
    + "remembered is not a guard");
  // The grounds must stay local to this write. `clampReasons` outlives the call and the degenerate re-ask
  // below can flip the same run to CLEAR and write again; grounds pushed into the shared array would ride
  // into the CLEAR sidecar as its `reasons` — a verdict claiming conditions it does not have, which is
  // this file's own subject arriving through its own fix.
  const arm = SRC.slice(at, SRC.indexOf("const reasonsOut", at));
  assert.ok(!/clampReasons\.push|clampKinds\.\w+\s*=/.test(arm),
    "the BLOCKING grounds are being pushed into the run-scoped clamp state again — a re-asked CLEAR would "
    + "then ship the reviewer's blocking defects as its own conditions");
  assert.match(SRC, /reasons: reasonsOut, kinds: kindsOut/,
    "the sidecar writes the shared clamp state again rather than the value the invariant just checked");
  // The ordering that keeps a degenerate review recoverable: the sidecar is written BEFORE the re-ask.
  assert.ok(SRC.indexOf("let cited = []") < SRC.indexOf("reviewer-degenerate-reask"),
    "the grounds arm moved after the degenerate re-ask — if the empty case ever throws before that re-ask "
    + "runs, a recoverable reviewer defect becomes a StageFailure that ends the run");
});

// ── ───────────────────────────────────────────────────────────────────────────────────────────

const finding = (ordinal, mark, extra = {}) => ({ ordinal, mark, owner: { name: `${mark} Holdings` }, disposition: "live", band: "HIGH", ...extra });
const flag = (n, text, ordinals = null) => ({ n, kind: "fact", typed: true, text, ordinals });

test("#1067 THE DEFECT: a flagged finding that is GONE is reported as removed, by name", () => {
  // The incident: a corrective pass, given a flagged fact (a named-owner use), DELETED the fact rather
  // than correcting it. The flag went away and the report did not become true.
  const pre = { findings: [finding(4, "DELPHI"), finding(9, "VENZY")] };
  const post = { findings: [finding(9, "VENZY")] };                      // DELPHI simply gone
  const [row] = buildCorrectionsApplied([flag(1, "Finding 4 — DELPHI's owner use is not supported by the cited page", [4])], pre, post);
  assert.equal(row.outcome, "findings-removed",
    "a deletion must not be reported as `findings-changed` — that is the outcome which reads as the flag "
    + "having landed, and it is what let round 1's deletion through");
  assert.deepEqual(row.removed, ["DELPHI"],
    "…and it names WHICH fact left the report, because a reader cannot act on the bare fact that one did");
});

test("#1067 CONTROL: a finding that was actually CORRECTED still reads findings-changed", () => {
  // Without this arm the fix could be "call everything a removal", which protects nobody and buries the
  // real ones under noise.
  const pre = { findings: [finding(4, "DELPHI", { disposition: "live" })] };
  const post = { findings: [finding(4, "DELPHI", { disposition: "withdrawn", withdrawn_reason: "the cited page does not support the use" })] };
  const [row] = buildCorrectionsApplied([flag(1, "Finding 4 — DELPHI's owner use is not supported", [4])], pre, post);
  assert.equal(row.outcome, "findings-changed", "it is still there and it moved — that is a correction");
  assert.deepEqual(row.removed, [], "nothing was removed, and the field says so rather than being absent");
});

test("#1067 a removal WINS over a change on the same flag", () => {
  // The precedence that decides whether this is visible in practice: a flag naming several findings where
  // one vanished and the others moved is a removal. Reporting the majority outcome buries it exactly where
  // it was buried before.
  const pre = { findings: [finding(4, "DELPHI"), finding(6, "VENZY"), finding(7, "PHINIA")] };
  const post = { findings: [finding(6, "VENZY", { band: "MEDIUM" }), finding(7, "PHINIA", { band: "MEDIUM" })] };
  const [row] = buildCorrectionsApplied([flag(1, "Findings 4, 6, 7 — the bands are overstated", [4, 6, 7])], pre, post);
  assert.equal(row.outcome, "findings-removed");
  assert.deepEqual(row.removed, ["DELPHI"], "only the one that actually left, not every finding the flag named");
});

test("#1067 the recheck's table names the deletion and says it is a failure until ruled otherwise", () => {
  const pre = { findings: [finding(4, "DELPHI")] };
  const post = { findings: [] };
  const applied = buildCorrectionsApplied([flag(1, "Finding 4 — DELPHI's owner use is unsupported", [4])], pre, post);
  const table = correctionsAppliedTable(applied);
  assert.match(table, /findings-removed: DELPHI/, "the row must carry the name into the document the recheck reads");
  assert.match(table, /IS a failure until you rule otherwise/,
    "…and the table must say what the outcome MEANS. The recheck that caught this once did so on its own "
    + "judgement; a legend it can read is what makes the catch structural rather than fortunate");
  assert.match(table, /withdrawal .* belongs in the record AS a withdrawal/,
    "…including the legitimate move, or the note reads as 'never remove anything' and gets ignored");
});

test("#1067 the corrective pass is TOLD that deletion is not an available move", () => {
  // The constraint belongs where the moves are chosen. The recheck is the second net, not the first.
  const worklist = correctionsWorklist([flag(1, "Finding 4 — DELPHI's owner use is unsupported", [4])]);
  assert.match(worklist, /REMOVING A FLAGGED FINDING DOES NOT ANSWER ITS FLAG/);
  assert.match(worklist, /WITHDRAWN with its reason recorded, never deleted/,
    "correct-or-escalate needs the escalation route named, or the only stated option is 'do nothing'");
  assert.equal(correctionsWorklist([]), "", "…and an empty worklist stays empty — no flags, no lecture");
});
