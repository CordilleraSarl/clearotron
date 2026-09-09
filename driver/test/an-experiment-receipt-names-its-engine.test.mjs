// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// an-experiment-receipt-names-its-engine.test.mjs — an arm's receipt says which engine served it.
//
//. `_driver/experiment-context.json` recorded `model: resolveModel(model)`, and
// `resolveModel` is ENGINE-BLIND: it maps a stage's TIER through the Anthropic alias table whichever
// adapter is about to run. Measured — an arm dispatched under `CLEAROTRON_AI=openai-agent` recorded
// `anthropic/claude-opus-5` while its own attempt record said `openai-agent` and a codex model.
//
// An A/B between two engines is the thing `--experiment` exists for. Both arms' receipts would have said
// the same thing, and nothing would have looked wrong — the failure is quiet, which is why it needs a
// guard rather than a reader's attention.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { telemetryDelta, refuseToCompare, engineOf } from "../compare.mjs";
import { resolveModel } from "../driver.config.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");

test("1967 resolveModel is engine-blind — the defect, stated as a measurement not a memory", () => {
  // This is the behaviour the receipt used to trust. It is CORRECT for what it is for (one alias table,
  // one namespace) and wrong as an answer to "which engine ran": it never consults one.
  assert.equal(resolveModel("claude-opus-5"), "anthropic/claude-opus-5");
  // A tier resolves into the Anthropic namespace with no engine in the question at all.
  const underCodex = resolveModel("claude-opus-5");
  assert.match(underCodex, /^anthropic\//,
    "resolveModel stopped mapping into the Anthropic namespace — if that changed, this issue's premise did too");
});

test("1967 the receipt records the ENGINE and the TIER, and synthesises no vendor id", () => {
  const src = readFileSync(join(DRIVER, "pipeline.mjs"), "utf8");
  const receipt = src.slice(src.indexOf("// ── 5. THE CONTEXT RECEIPT"), src.indexOf("experiment-context.json"));
  assert.ok(receipt.length > 0, "the context receipt block moved — this guard is reading nothing");
  assert.match(receipt, /engine: experimentEngineName\(\)/,
    "the receipt does not record which engine will serve the arm");
  assert.match(receipt, /modelTier: model \?\? null/,
    "the receipt does not record the tier it was dispatched with");
  assert.equal(/model: resolveModel\(model\)/.test(receipt), false,
    "the receipt still synthesises a vendor-namespaced model id from a tier, through an engine-blind "
    + "resolver — this is the defect");
});

test("1967 compare refuses two records that are INDISTINGUISHABLE, and compares ones that are not", () => {
  const a = { engine: "anthropic-agent", modelUsed: "claude-opus-5" };
  const b = { engine: "openai-agent", modelUsed: "gpt-5.6-sol" };

  const both = telemetryDelta(a, b);
  assert.match(both, /engine/, "the table does not show the engine at all");
  assert.match(both, /anthropic-agent/);
  assert.match(both, /openai-agent/);
  assert.equal(/REFUSING TO COMPARE/.test(both), false, "it refused two arms that both name their engine");

  // THE DEFECT: two arms that read the same. The receipt resolved a tier through an engine-blind table,
  // so a codex arm and an Anthropic arm both said `anthropic/claude-opus-5` — nothing tells them apart.
  const twin = telemetryDelta({ model: "anthropic/claude-opus-5" }, { model: "anthropic/claude-opus-5" });
  assert.match(twin, /REFUSING TO COMPARE/, "two identical-looking arms were compared anyway");
  assert.match(twin, /nothing here that tells these two apart/);
  assert.equal(/output sha/.test(twin), false,
    "it printed the table underneath the refusal — a refusal that still shows the answer is not one");
});

test("1967 the refusal is NARROW — an incomplete record is not an indistinguishable one", () => {
  // A first version refused whenever either side lacked an engine. That is too wide: comparing two
  // attempts of one stage in one run is legitimate, the engine is constant there, and older records carry
  // no such field. An existing suite arm caught it, which is why the rule is what it is.
  const byModel = telemetryDelta({ modelUsed: "opus", wall: 100 }, { modelUsed: "gpt", wall: 50 });
  assert.equal(/REFUSING TO COMPARE/.test(byModel), false,
    "two records with DIFFERENT models are distinguishable by model — refusing them is noise, and noise "
    + "is how a check gets turned off");
  assert.match(byModel, /opus[\s\S]*gpt/);

  // One side naming an engine is enough to tell them apart.
  assert.equal(refuseToCompare({ engine: "openai-agent" }, {}), null);
  assert.equal(refuseToCompare({}, { engine: "openai-agent" }), null);
});

test("1967 an engine is NAMED, never inferred — blank and whitespace are absent", () => {
  assert.equal(engineOf({ engine: "openai-agent" }), "openai-agent");
  for (const bad of [undefined, null, "", "   "]) {
    assert.equal(engineOf({ engine: bad }), null, `${JSON.stringify(bad)} was taken for an engine name`);
  }
  // A whitespace engine on BOTH sides, same model: indistinguishable, so refused.
  assert.ok(refuseToCompare({ engine: "  ", model: "m" }, { engine: "", model: "m" }),
    "a whitespace engine passed as named on both sides");
});

test("1967 a non-default-engine arm is distinguishable from a default one by the receipt ALONE", () => {
  // Acceptance's third item, and the one the old receipt failed: with no cross-reference to the attempt
  // record, two arms on different engines must not read identically.
  const def = { engine: "anthropic-agent", modelTier: "opus" };
  const alt = { engine: "openai-agent", modelTier: "opus" };
  assert.notEqual(JSON.stringify(def), JSON.stringify(alt),
    "two arms on different engines serialise identically — the receipt cannot tell them apart");
  assert.notEqual(telemetryDelta(def, alt).includes("anthropic-agent"), false);
});

// ── THE RATING AUTHORITY THE ARM RAN UNDER ───────────────────────────────────────────────────────────
//
// `whatIfRun` resolves the profile correctly and returned it IN MEMORY ONLY: a walk of a real
// experiment directory for either `ratedUnder` or the resolved key found nothing, and `matter-frame`
// writes no `framework.json` into the experiment either. So the answer was right and unauditable, and a
// future regression would be as silent as the one this was opened on.
//
// ✕ THESE ARE SOURCE-LEVEL GUARDS, like the two above and for the same reason: the receipt is built
// inside a pipeline function with no seam a unit test can reach, and splitting one open to test it
// would remove the seam's only consumer. What they can prove is that the field is written and from the
// FROZEN sidecar. What they cannot prove is the value on a real arm's disk — that needs a drive, and it
// is the acceptance criterion on the issue.

test("268 the receipt records the rating authority the arm ran under, from the FROZEN sidecar", () => {
  const src = readFileSync(join(DRIVER, "pipeline.mjs"), "utf8");
  const receipt = src.slice(src.indexOf("// ── 5. THE CONTEXT RECEIPT"), src.indexOf("experiment-context.json"));
  assert.ok(receipt.length > 0, "the context receipt block moved — this guard is reading nothing");
  assert.match(receipt, /ratedUnder: ctx\.profile\?\.profileKey \?\? null/,
    "the receipt does not record which rating authority produced the arm");
  // FROM THE SIDECAR, never a fresh resolve. Re-resolving mid-run is the drift the profile freeze
  // exists to forbid, and a receipt that did it would record a key the run never rated under.
  assert.doesNotMatch(receipt, /ratedUnder:\s*resolveProfile\(/,
    "the receipt must read the frozen sidecar, not re-resolve the profile");
});

test("268 the MATCHING profile is recorded, so no-mismatch stops standing in for a positive fact", () => {
  // `profile-mismatch` existed and its counterpart did not, so "the profile was right" was carried by
  // the ABSENCE of a row — and an absence cannot tell "it matched" from "the probe never ran" from
  // "this run predates the probe". Three facts, one empty grep.
  const src = readFileSync(join(DRIVER, "pipeline.mjs"), "utf8");
  assert.match(src, /event: "profile-resolved", sidecar: sidecar\.profileKey, resolved: current\.key/,
    "the matching case writes no row, so it is still an absence standing in for a fact");
  // The anti-vacuity control: the row this one is the counterpart of must still be there, or the pair
  // has been refactored and this guard is asserting half a mechanism.
  assert.match(src, /event: "profile-mismatch", sidecar: sidecar\.profileKey, resolved: current\.key/,
    "the mismatch row is gone — this guard's counterpart no longer exists");
});
