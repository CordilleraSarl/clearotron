// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The plan used to search the client's main word in the incumbent's own classes on every matter with an
// incumbent alert. It asked nothing about any company and was not held to the client's classes, so it
// went (ruled 2026-09-25): one fewer counted search per run. The incumbent step itself stays: its unit
// still spawns on the alert, and it asks an owner's marks from the records the sweeps return.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compileRegisterPlan, variantsFingerprint } from "../register-plan.mjs";
import { parseVariantManifestModel } from "../variant-manifest-model.mjs";
import { capabilitiesFor } from "../register-capabilities.mjs";
import { decideAxes } from "../coverage-ledger.mjs";

const MODEL = {
  schema_version: 1, mark: "GLIMBEX", dominant_element: "GLIMBEX",
  elements: [{ value: "GLIMBEX", kind: "distinctive" }],
  variants: [{ value: "GLIMBECKS", category: "phonetic", rationale: "sound-alike" }],
  incumbent_classes: ["9", "41"],
};
const manifest = (incumbent_classes) => parseVariantManifestModel(JSON.stringify({ ...MODEL, incumbent_classes }));
const compile = (incumbent_classes) => compileRegisterPlan({
  manifest: manifest(incumbent_classes),
  job: { jobKey: "t-incumbent-alert", classes: ["9"], jurisdictions: ["EU"] },
  capabilities: capabilitiesFor("free-tier"),
});

test("an incumbent alert compiles no search of the client's word in the incumbent's classes", () => {
  const plan = compile(["9", "41"]);
  assert.ok(plan.entries.length > 0, "the premise: the plan compiled");
  assert.deepEqual(plan.entries.filter((e) => e.axis === "incumbent-class").map((e) => e.qid), [],
    "the plan dictates nothing on the incumbent step");
  assert.deepEqual(plan.entries.filter((e) => (e.nice_classes ?? []).map(String).includes("41")).map((e) => e.qid), [],
    "no entry reaches the incumbent's class the client did not instruct");
  assert.deepEqual(compile([]).entries.map((e) => e.qid), plan.entries.map((e) => e.qid),
    "the incumbent classes change no entry");
});

test("the incumbent classes leave the fingerprint, because they change no entry", () => {
  assert.equal(variantsFingerprint(manifest(["9", "41"])), variantsFingerprint(manifest([])));
});

test("the incumbent step still spawns on the alert, so its axis is not gone", () => {
  assert.ok(decideAxes(JSON.stringify(MODEL)).includes("incumbent-class"));
});

test("the register manual's incumbent paragraph asks in the matter's classes and markets", () => {
  const unit = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "clearance-register", "unit.md"), "utf8");
  const para = unit.split("\n").find((l) => l.startsWith("- **`incumbent-class`**"));
  assert.ok(para?.includes("`register_enumerate` the named band in the matter's in-scope Nice set and markets"),
    "the paragraph carries the approved sentence");
  assert.doesNotMatch(unit, /incumbent's primary classes/, "no line sends the unit to the incumbent's own classes");
});
