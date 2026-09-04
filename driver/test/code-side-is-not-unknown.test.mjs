// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — `tokens.byEngine` and `tokens.byAuthMode` filed the driver's own code-side dispatch under
// `unknown`, beside genuinely unattributed rows, while `run-economics.byBilling` filed the SAME dispatch
// honestly as `code|not-provider-billed`. Two rollups, one run, one dispatch, two answers.
//
// The bucket is the point. `unknown` is supposed to mean "a dispatch we could not attribute", and
// role-e2e doctrine reads a non-empty `unknown` byEngine as a real signal. Putting a known,
// self-declaring, zero-token step in it does not mislabel one row — it destroys what the bucket is FOR.
//
// The fix imports `isCodeSide` from run-economics rather than copying it, and these tests pin both
// halves: that code-side rows leave `unknown`, and that genuinely unstamped rows STAY in it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { rollupTokens } from "../tokens.mjs";
import { isCodeSide } from "../run-economics.mjs";

function mkRun(stages) {
  const runDir = mkdtempSync(join(tmpdir(), "prelim-1226-"));
  mkdirSync(driverDir(runDir));
  for (const [stage, records] of Object.entries(stages)) {
    writeFileSync(driverDir(runDir, `${stage}.jsonl`), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }
  return runDir;
}

// The real shape, from pipeline.mjs's plan executor: no `engine` key, no `authMode` key, no usage.
const CODE_ROW = { attempt: 1, model: "code", modelUsed: "code:execute-plan", usage: null };
// A row that predates the modelUsed stamp — `model: "code"` alone must still be recognised.
const CODE_ROW_UNSTAMPED = { attempt: 1, model: "code", usage: null };
// Genuinely unattributed: a real dispatch that spent tokens and carries no engine stamp at all.
const UNSTAMPED_ROW = { attempt: 1, model: "opus", usage: { input: 10, output: 2000 } };

test("#1226 a code-side dispatch is filed as what it says it is, NOT as unknown", () => {
  const runDir = mkRun({ "execute-plan": [CODE_ROW] });
  try {
    const r = rollupTokens(runDir);
    assert.equal(r.byEngine.unknown, undefined, "the code-side row is still in the bucket that means 'we could not attribute this'");
    assert.equal(r.byAuthMode.unknown, undefined, "same, on the billing-mode axis");
    assert.equal(r.byEngine.code.attempts, 1);
    assert.equal(r.byAuthMode["not-provider-billed"].attempts, 1);
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("#1226 a row predating the modelUsed stamp is code-side too — `model: \"code\"` alone is enough", () => {
  // examples/sample-run's frozen status.json keys this row as byModel `code`, not `code:execute-plan`,
  // so this shape is not hypothetical: it is what the shipped example actually contains.
  const runDir = mkRun({ "execute-plan": [CODE_ROW_UNSTAMPED] });
  try {
    const r = rollupTokens(runDir);
    assert.equal(r.byEngine.code.attempts, 1, "the older code-side shape fell back into unknown");
    assert.equal(r.byAuthMode["not-provider-billed"].attempts, 1);
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("#1226 THE BUCKET KEEPS ITS MEANING: a genuinely unstamped row is still VISIBLY unknown", () => {
  // The forbidden outcome. Emptying `unknown` would 'fix' this issue by deleting the signal it exists to
  // carry — and tokens.test.mjs already pins that an unstamped row buckets visibly and is never dropped.
  const runDir = mkRun({ "register-digest": [UNSTAMPED_ROW], "execute-plan": [CODE_ROW] });
  try {
    const r = rollupTokens(runDir);
    assert.equal(r.byEngine.unknown.output, 2000, "the unattributed row stopped being visible");
    assert.equal(r.byEngine.unknown.attempts, 1, "the code-side row is still being counted as unattributed");
    assert.equal(r.byEngine.code.attempts, 1);
    assert.equal(r.byAuthMode.unknown.output, 2000);
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("#1226 every axis still sums to total — the fix must re-key, never drop", () => {
  const runDir = mkRun({
    "register-digest": [UNSTAMPED_ROW, { attempt: 1, model: "haiku", engine: "openai-agent", authMode: "api-key", usage: { input: 5, output: 7 } }],
    "execute-plan": [CODE_ROW],
  });
  try {
    const r = rollupTokens(runDir);
    for (const axis of ["byEngine", "byAuthMode", "byModel", "byStage"]) {
      const sum = Object.values(r[axis]).reduce((a, b) => a + b.output, 0);
      assert.equal(sum, r.total.output, `${axis} no longer sums to total`);
      const att = Object.values(r[axis]).reduce((a, b) => a + b.attempts, 0);
      assert.equal(att, r.total.attempts, `${axis} lost or double-counted an attempt`);
    }
    assert.equal(r.total.attempts, 3);
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("#1226 byModel was already right and is UNCHANGED — only the two broken axes move", () => {
  const runDir = mkRun({ "execute-plan": [CODE_ROW] });
  try {
    const r = rollupTokens(runDir);
    assert.ok(r.byModel["code:execute-plan"], "byModel stopped naming the code-side step correctly");
    assert.equal(r.byModel["code:execute-plan"].attempts, 1);
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("#1226 the two rollups now AGREE about the same dispatch — that disagreement was the report", () => {
  const runDir = mkRun({ "execute-plan": [CODE_ROW] });
  try {
    const r = rollupTokens(runDir);
    // byBilling's key is `engine|authMode|model`; the tokens axes must name the same engine and mode.
    const engines = Object.keys(r.byEngine);
    const modes = Object.keys(r.byAuthMode);
    assert.deepEqual(engines, ["code"], `tokens.byEngine says ${JSON.stringify(engines)}, run-economics says code`);
    assert.deepEqual(modes, ["not-provider-billed"], `tokens.byAuthMode says ${JSON.stringify(modes)}`);
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("#1226 ONE definition of code-side, not two — the copy is what let them drift apart", () => {
  // A second copy in tokens.mjs would pass every test above on the day it was written and diverge the
  // first time the marker changes, re-opening exactly this issue. Pin the import, and pin its absence.
  const src = readFileSync(new URL("../tokens.mjs", import.meta.url), "utf8");
  assert.match(src, /import \{[^}]*\bisCodeSide\b[^}]*\} from "\.\/run-economics\.mjs"/,
    "tokens.mjs no longer imports the shared predicate");
  assert.doesNotMatch(src, /(const|let|function)\s+isCodeSide/,
    "tokens.mjs grew its OWN copy of isCodeSide — that is the drift this fix exists to prevent");
  // and the shared one really is the predicate both modules mean
  assert.equal(isCodeSide({ model: "code" }), true);
  assert.equal(isCodeSide({ modelUsed: "code:execute-plan" }), true);
  assert.equal(isCodeSide({ model: "opus", modelUsed: "anthropic/claude-opus-5" }), false);
  assert.equal(isCodeSide({}), false, "an empty row must not read as code-side");
});
