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

test("#694 THE DEFECT: a codex attempt no longer yields an Anthropic stage line", () => {
  const r = { modelWire: "gpt-5.6-sol", modelUsed: "gpt-5.6-sol" };
  assert.equal(pick(r, "anthropic/claude-sonnet-5"), "gpt-5.6-sol",
    "the stage event still names the ASSIGNED model — that is the field that made a round read as Anthropic");
});

test("#694 the WIRE outranks the resolver: what ran beats what was asked", () => {
  // An unhonoured override is an error and not a substitution, but where the two legitimately
  // differ the provider's own word is the one a reader needs.
  assert.equal(pick({ modelWire: "gpt-5.6-sol", modelUsed: "openai/gpt-5.6" }, "anthropic/x"), "gpt-5.6-sol");
});

test("#694 a stream that states no model falls back to the ENGINE's resolution, not the catalog's", () => {
  // modelActual is null whenever the wire never reported an id. The engine that owns the vocabulary
  // still resolved the request; the Anthropic-shaped catalog alias is a worse answer than that.
  assert.equal(pick({ modelWire: null, modelUsed: "openai/gpt-5.6" }, "anthropic/claude-sonnet-5"), "openai/gpt-5.6");
});

test("#694 with NEITHER, the row is exactly as informative as before — never less", () => {
  // The legacy value is the last resort, so no path regresses: a caller that reports nothing gets what it
  // has always got. A fix that made some rows null would trade a wrong answer for a missing one.
  for (const r of [{}, { modelWire: null, modelUsed: null }, { modelWire: undefined }])
    assert.equal(pick(r, "anthropic/claude-sonnet-5"), "anthropic/claude-sonnet-5",
      `${JSON.stringify(r)} lost the legacy fallback`);
});

test("#694 the gateway HANDS BACK what it already knew, on every exit", () => {
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

test("#694 the KNOCKOUT lane's stage event too — it has its own copy", () => {
  // Found by counting stage-event writers instead of assuming one. pipeline-knockout.mjs writes its own,
  // and it carried the same assigned alias, so a codex knockout named an Anthropic model on the skim line.
  const k = src("driver/pipeline-knockout.mjs");
  assert.match(k, /model: r\.modelWire \?\? r\.modelUsed \?\? model/,
    "the knockout stage event still names the assigned model");
});

test("#694 the CODE-SIDE lane is untouched — nothing ran, and it says so", () => {
  // The direct-execute lane writes `model: "code:execute-plan"`. That is not a defect to fix; replacing
  // it with a model id would invent an author for work no model did.
  assert.match(src("driver/pipeline.mjs"), /model: "code:execute-plan"/,
    "the code-side lane stopped declaring itself code — a stage with no model must never name one");
});

test("#694 the stage event reads the result, not the assignment", () => {
  const p = src("driver/pipeline.mjs");
  // THE AGENT-DISPATCH one, not the code-side lane. pipeline.mjs has TWO stage events and `indexOf`
  // finds the wrong one: the direct-execute lane at ~3319 writes `model: "code:execute-plan"`, which is
  // already truthful (no model ran) and must stay exactly as it is. This assertion pointed at it and
  // reported the agent path unfixed — the test was right that something was wrong and wrong about what.
  const at = p.indexOf(`event: "stage", stage: label, trigger: opts.trigger`);
  assert.ok(at > 0, "the agent-dispatch stage event moved — this assertion is measuring nothing");
  const row = p.slice(at, at + 1800);   // the field sits behind its own reasoning block
  assert.match(row, /model: r\.modelWire \?\? r\.modelUsed \?\? resolveModel\(model\)/,
    "the stage event no longer prefers what actually ran");
  assert.ok(!/model: resolveModel\(model\),/.test(row),
    "the bare assigned-alias write is back on the stage event — that IS #694");
});

test("#694 COUNTING, not naming: every agent stage-event writer carries BOTH fields", () => {
  // Ruled condition. Naming the writers passes on an incomplete fix — which is how this shipped: the
  // clearance lane was fixed and the knockout lane's own copy was not. Counting fails instead.
  const writers = [
    ["driver/pipeline.mjs", /event: "stage", stage: label, trigger: opts\.trigger/],
    ["driver/pipeline-knockout.mjs", /event: "stage", stage: label, lane: "knockout"/],
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

test("#694 the writer POPULATION is the whole driver tree, not the two files I happened to fix", (t) => {
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
  // THREE: two agent lanes (both fixed above) + the code-side lane, which declares `code:execute-plan`
  // because no model ran and is excluded by reason, not by oversight. A fourth must be fixed or
  // excluded HERE, deliberately — not discovered on a receipt the way this one was.
  assert.equal(total, 3,
    `the stage-event writer population changed (${total} across ${sites.length} file(s): ${sites.join(", ")}). `
    + `Expected 3 — two agent lanes + the code-side lane. A new writer must carry model/modelSelector or be `
    + `excluded here on the record.`);
});

test("#694 the codex shape: a GPT-written stage no longer labels itself Anthropic", () => {
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
