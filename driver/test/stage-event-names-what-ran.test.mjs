// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// stage-event-names-what-ran.test.mjs —, reopened as status:regressed.
//
// THE STAGE EVENT IS THE LINE A READER SKIMS, AND IT NAMED THE WRONG VENDOR. On round 21f9b0ad the
// register-unit:primary-sweep attempt row carried `model: gpt-5.6-sol / modelActual: gpt-5.6-sol`, and the
// stage event written milliseconds later carried `model: anthropic/claude-sonnet-5`. Fully
// vendor-qualified, and wrong. A whole round read as Anthropic once on exactly this.
//
// It was never a measurement gap. The truthful values have been on the attempt rows since — the
// token accounting that reads them was re-confirmed truthful on the same round and its certification is
// undisturbed. The ladder simply never handed either value BACK to its caller, so the stage event had
// nothing to write but the ASSIGNED alias, resolved through an Anthropic-shaped catalog.
//
// SCOPE, per the reopen: the stage-event model field only. Nothing here touches byModel, per-attempt
// modelUsed, or which model any stage is assigned.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = (f) => readFileSync(join(ROOT, f), "utf8");
const GUARD = "#694 stage-event writer population";

// The precedence under test, stated once as data so the assertions below cannot drift from each other.
const pick = (r, assigned) => r.modelWire ?? r.modelUsed ?? assigned;

test("THE DEFECT: a codex attempt no longer yields an Anthropic stage line", () => {
  const r = { modelWire: "gpt-5.6-sol", modelUsed: "gpt-5.6-sol" };
  assert.equal(pick(r, "anthropic/claude-sonnet-5"), "gpt-5.6-sol",
    "the stage event still names the ASSIGNED model — that is the field that made a round read as Anthropic");
});

test("the WIRE outranks the resolver: what ran beats what was asked", () => {
  // An unhonoured override is an error and not a substitution, but where the two legitimately
  // differ the provider's own word is the one a reader needs.
  assert.equal(pick({ modelWire: "gpt-5.6-sol", modelUsed: "openai/gpt-5.6" }, "anthropic/x"), "gpt-5.6-sol");
});

test("a stream that states no model falls back to the ENGINE's resolution, not the catalog's", () => {
  // modelActual is null whenever the wire never reported an id. The engine that owns the vocabulary
  // still resolved the request; the Anthropic-shaped catalog alias is a worse answer than that.
  assert.equal(pick({ modelWire: null, modelUsed: "openai/gpt-5.6" }, "anthropic/claude-sonnet-5"), "openai/gpt-5.6");
});

test("with NEITHER, the row is exactly as informative as before — never less", () => {
  // The legacy value is the last resort, so no path regresses: a caller that reports nothing gets what it
  // has always got. A fix that made some rows null would trade a wrong answer for a missing one.
  for (const r of [{}, { modelWire: null, modelUsed: null }, { modelWire: undefined }])
    assert.equal(pick(r, "anthropic/claude-sonnet-5"), "anthropic/claude-sonnet-5",
      `${JSON.stringify(r)} lost the legacy fallback`);
});

test("the gateway HANDS BACK what it already knew, on every exit", () => {
  // The values existed on the attempt rows and stopped there. All three exits must carry them or the
  // fix covers only the paths someone happened to test — the shape, a mechanism reaching some
  // writers and not their siblings.
  const g = src("driver/gateway.mjs");
  const returns = [...g.matchAll(/return \{ ok: (?:true|false),[^\n]*/g)].map((m) => m[0]);
  // FOUR, not three. My first pass wired the success, identical-signature and exhausted exits and missed
  // the rate-limited/park return — this assertion is what found it, which is the whole reason it counts
  // the exits instead of naming them.
  assert.ok(returns.length >= 4, `expected every runStage exit, found ${returns.length}`);
  for (const [i, line] of returns.entries()) {
    assert.match(line, /modelWire: lastModelWire/, `runStage exit ${i + 1} drops the wire model`);
    assert.match(line, /modelUsed: lastModelUsed/, `runStage exit ${i + 1} drops the resolved model`);
  }
  assert.match(g, /if \(modelActual\) lastModelWire = modelActual;/,
    "the wire model is captured unconditionally — an attempt whose stream stated none must not erase a "
    + "previous attempt's truthful value");
});

test("the KNOCKOUT lane's stage event too — it is written by the runner the clearance's is", () => {
  // Found by counting stage-event writers instead of assuming one. pipeline-knockout.mjs wrote its own copy,
  // and it carried the same assigned alias, so a codex knockout named an Anthropic model on the skim line.
  // Both lanes now write it through the shared stage runner, so the Knockout's row has no copy of its own to
  // drift: it reaches the same writer, and hands it its assignment only as the last resort.
  const k = src("driver/pipeline-knockout.mjs");
  assert.match(k, /runLaneStage\(KNOCKOUT_LANE,/, "the knockout lane no longer runs its stages through the shared runner");
  assert.ok(!/event: *"stage",/.test(k), "the knockout lane writes a stage event of its own again");
  assert.match(k, /selector: model,/, "the knockout lane no longer hands the runner its assigned model as the selector");
  assert.match(src("driver/stage-runner.mjs"), /model: r\.modelWire \?\? r\.modelUsed \?\? s\.selector/,
    "the shared stage event still names the assigned model");
});

test("the CODE-SIDE lane is untouched — nothing ran, and it says so", () => {
  // The direct-execute lane writes `model: "code:execute-plan"`. That is not a defect to fix; replacing
  // it with a model id would invent an author for work no model did.
  assert.match(src("driver/pipeline.mjs"), /model: "code:execute-plan"/,
    "the code-side lane stopped declaring itself code — a stage with no model must never name one");
});

test("the stage event reads the result, not the assignment", () => {
  // THE AGENT-DISPATCH one, not the code-side lane. pipeline.mjs's direct-execute lane writes
  // `model: "code:execute-plan"`, which is already truthful (no model ran) and must stay exactly as it is. The
  // agent-dispatch event is the shared stage runner's, and the clearance hands it the assignment, resolved
  // through the catalog, only as its selector and last resort.
  const p = src("driver/stage-runner.mjs");
  const at = p.indexOf(`event: "stage", stage: s.label`);
  assert.ok(at > 0, "the agent-dispatch stage event moved — this assertion is measuring nothing");
  const row = p.slice(at, at + 1800);
  assert.match(row, /model: r\.modelWire \?\? r\.modelUsed \?\? s\.selector/,
    "the stage event no longer prefers what actually ran");
  assert.ok(!/model: s\.selector,/.test(row),
    "the bare assigned-alias write is back on the stage event — the defect this file exists for");
  const c = src("driver/stage-dispatch.mjs");
  assert.match(c, /runLaneStage\(CLEARANCE_LANE,/, "the clearance no longer runs its stages through the shared runner");
  assert.match(c, /selector: resolveModel\(model\),/, "the clearance no longer hands the runner its catalog selector");
});

test("COUNTING, not naming: every agent stage-event writer carries BOTH fields", () => {
  // Ruled condition. Naming the writers passes on an incomplete fix — which is how this shipped: the
  // clearance lane was fixed and the knockout lane's own copy was not. Counting fails instead.
  // ONE writer now serves both agent lanes (stage-runner.mjs), so the list is one long; the population test below
  // still counts every writer in the tree, so a lane that grew its own copy again would fail there.
  const writers = [
    ["driver/stage-runner.mjs", /event: "stage", stage: s\.label/],
  ];
  const found = [];
  for (const [file, head] of writers) {
    const src_ = src(file);
    const at = src_.search(head);
    if (at < 0) continue;
    const row = src_.slice(at, at + 2200);
    assert.match(row, /model: r\.modelWire \?\? r\.modelUsed \?\?/, `${file}: the stage event does not name what RAN`);
    assert.match(row, /modelSelector:/, `${file}: the stage event carries no selector — resume evidence would have to join another file`);
    found.push(file);
  }
  assert.equal(found.length, writers.length,
    `expected every agent stage-event writer to be found and fixed; matched ${found.length}: ${found.join(", ")}`);
});

test("the writer POPULATION is the whole driver tree, not the two files I happened to fix", (t) => {
  // Counting only inside the two files I edited is the SAME defect as naming the writers, moved up one
  // level: a new lane file with its own stage event leaves the count at two-files-worth and the guard
  // green. The corpus is therefore every tracked .mjs under driver/ — `driver/*.mjs` is a git pathspec,
  // so the wildcard crosses slashes and driver/engine/, driver/publish/ and driver/e2e/ are all in it.
  // driver/test/ is excluded because fixtures legitimately write stage events.
  const files = trackedFiles(GUARD, { root: ROOT, pathspec: ["driver/*.mjs"] });
  if (files === null) { t.skip(skipReason(GUARD)); return; }   // no checkout — SKIPPED loudly, never a silent pass
  const sites = [];
  for (const f of nonEmpty(files, "files")) {
    if (f.startsWith("driver/test/")) continue;
    const n = (src(f).match(/event: *"stage",/g) ?? []).length;
    if (n) sites.push(`${f} x${n}`);
  }
  const total = sites.reduce((a, s) => a + Number(s.split(" x")[1]), 0);
  // TWO: the shared stage runner, which both agent lanes write through (fixed above), + the code-side lane, which
  // declares `code:execute-plan` because no model ran and is excluded by reason, not by oversight. A third must be
  // fixed or excluded HERE, deliberately — not discovered on a receipt the way the Knockout's own copy was.
  assert.equal(total, 2,
    `the stage-event writer population changed (${total} across ${sites.length} file(s): ${sites.join(", ")}). `
    + `Expected 2 — the shared runner both agent lanes write through + the code-side lane. A new writer must carry `
    + `model/modelSelector or be excluded here on the record.`);
});

test("the codex shape: a GPT-written stage no longer labels itself Anthropic", () => {
  // The reason the issue exists, as a value case. Reporting-only — measured: recoverWinningAttempt reads
  // the ATTEMPT telemetry, never this event, so no resume was ever steered by it. What was wrong is the
  // line a reader skims, and on a codex round it named the wrong vendor entirely.
  const r = { modelWire: "gpt-5.6-sol", modelUsed: "gpt-5.6-sol" };
  const shown = r.modelWire ?? r.modelUsed ?? "anthropic/claude-sonnet-5";
  const selector = "anthropic/claude-sonnet-5";                 // what the assignment resolves to
  assert.equal(shown, "gpt-5.6-sol", "the skim line still names Anthropic for GPT's work");
  assert.notEqual(shown, selector, "the two fields collapsed — the whole point is that they differ here");
  assert.match(selector, /^anthropic\//, "and the selector keeps its catalog shape for the resume reader");
});
