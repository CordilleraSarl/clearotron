// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The stages that hold `search_run_artifacts` are told how to call it with one example file. A run judged
// by owner writes no register findings document and no placements, so an example naming one of those
// sends a model to read a file that is not there. Each stage's real message is built and the example read
// out of it; the floor says the three stages known to carry the sentence were reached.
import test from "node:test";
import assert from "node:assert/strict";
import { STAGES } from "../stages.mjs";
import { searchRunArtifacts } from "../skeptic-search.mjs";

// Files step 3 no longer writes: the register digest's findings and placement's recommendations.
const NOT_WRITTEN = ["register-findings.md", "register-findings.json", "placement-recommendations.md", "placements.json"];

// A ctx generous enough for any builder: every path resolves, every list is empty rather than absent.
const paths = new Proxy({}, { get: (_t, k) => (typeof k === "string" ? `<${k}>` : undefined) });
const ctx = () => ({
  paths, axes: [], intakeAsks: [], openDoubts: [], openAsks: [], registerOnly: false, framework: null,
  job: { mark: "TESTMARK", classes: [25], territories: ["CH"] }, profile: { key: "demo" }, run: { slug: "s", codename: "c" },
});

test("every artifact-search example names a file a run judged by owner still writes", () => {
  const examples = new Map();
  for (const [key, def] of Object.entries(STAGES)) {
    if (typeof def?.message !== "function") continue;
    let text;
    try { text = String(def.message(ctx())); } catch { continue; }
    const m = text.match(/search_run_artifacts`? tool — ONE file per call, named relative to the run directory \(e\.g\. "([^"]+)"\)/);
    if (m) examples.set(key, m[1]);
  }
  for (const stage of ["skeptic", "synthesis", "narrative-refutation"])
    assert.ok(examples.has(stage), `the ${stage} message was not built or carries no artifact-search example — the instrument reached nothing`);
  for (const [stage, file] of examples)
    assert.ok(!NOT_WRITTEN.includes(file), `the ${stage} stage's example names ${file}, which a run judged by owner never writes`);
});

test("the tool's own refusal, read back by the model, gives the same kind of example", () => {
  const refused = String(searchRunArtifacts("/nonexistent-run-dir", { file: 7, terms: ["x"] }).refused ?? "");
  const m = refused.match(/^search_file_missing:.*e\.g\. "([^"]+)"/);
  assert.ok(m, `the refusal carries no example to read: ${refused}`);
  assert.ok(!NOT_WRITTEN.includes(m[1]), `the refusal's example names ${m[1]}, which a run judged by owner never writes`);
});
