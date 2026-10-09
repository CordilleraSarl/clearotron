// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A FINDING IS CHECKED BY ITS RUNG'S RISK, NOT BY ITS PLACE ON THE LADDER — AND THE ONE SEARCH ASKS ABOUT
// ENFORCEMENT TOO.
//
// The actual-use check covered findings "above the framework's lowest band". Every client's ladder names its
// own rungs, and the bottom one means different things: "Manageable" is the lowest rung of a four-rung
// ladder and the second-lowest of a five-rung one, where "Low" sits beneath it. So a Manageable finding was
// skipped for one client and checked for another, though both ladders tag Manageable as low risk. The owner
// ruled on 2026-10-09: check every finding the client's own ladder tags medium risk or higher, skip low risk
// on every ladder, and ask the same search for the owner's enforcement record.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { parseFrameworkManifest, materialBand, materialBandLabels, materialBandPhrase } from "../framework.mjs";
import { STAGES, paths } from "../stages.mjs";
import { recordSynthesis } from "../synthesis-record.mjs";
import { validators } from "../verify.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";

const ladder = (key, bands) => parseFrameworkManifest({
  schema_version: 1, framework_key: key, title: `Invented ${key} ladder`, source_deck: "none", entity_label: "the company", bands,
  structure: { kind: "bands" },
});
const FIVE = ladder("five-rung-test", [{ label: "Very High", tone: "severe" }, { label: "High", tone: "high" },
  { label: "Medium", tone: "medium" }, { label: "Manageable", tone: "low" }, { label: "Low", tone: "minimal" }]);
const FOUR = ladder("four-rung-test", [{ label: "Very High", tone: "severe" }, { label: "High", tone: "high" },
  { label: "Moderate", tone: "medium" }, { label: "Manageable", tone: "low" }]);

test("medium risk or higher is read off each rung's own tag, so Manageable is low risk on both ladders", () => {
  for (const [m, checked, skipped] of [[FIVE, ["Very High", "High", "Medium"], ["Manageable", "Low"]],
    [FOUR, ["Very High", "High", "Moderate"], ["Manageable"]]]) {
    for (const b of checked) assert.equal(materialBand(m, b), true, `${m.framework_key}: ${b} is not checked`);
    for (const b of skipped) assert.equal(materialBand(m, b), false, `${m.framework_key}: ${b} is checked`);
    assert.deepEqual(materialBandLabels(m), checked);
  }
  assert.equal(materialBand(FIVE, "Nonsense"), false, "a word that is not a band is never material");
  assert.equal(materialBandPhrase(FIVE), "Very High, High or Medium");
  assert.equal(materialBandPhrase(FOUR), "Very High, High or Moderate");
});

test("the writer is told which rungs to check, by name, and to ask the same search about enforcement", () => {
  const msg = STAGES.synthesis.message({ paths: paths("/r"), job: {}, profile: null, framework: FOUR });
  assert.ok(msg.includes("run the scoped use check (phase2-execution.md Step 3.5) on EVERY finding banded Very High, High or Moderate"),
    "the rungs to check are not named from the client's own ladder");
  assert.ok(msg.includes("ask in the SAME query for the owner's enforcement record"), "the enforcement question is not asked");
  assert.ok(msg.includes('where it finds none, the enforcer is "low" with basis "inferred-from-signal"'), "the nothing-found answer is not set");
  assert.ok(msg.includes('on a finding banded Very High, High or Moderate, not only use-negatives'), "the use_check line still draws the line by position");
  assert.ok(!msg.includes("ABOVE the framework's lowest band"), "a line by position is still dictated");
  const bare = STAGES.synthesis.message({ paths: paths("/r"), job: {}, profile: null });
  assert.ok(bare.includes("on EVERY finding banded medium risk or higher"), "with no framework, the rule is stated in words");
});

test("on a five-rung ladder, a Manageable finding is no longer held to the use receipt, and a Medium one still is", () => {
  const dir = mkdtempSync(join(tmpdir(), "rung-risk-"));
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(driverDir(dir, "framework.json"), JSON.stringify(FIVE, null, 2));
  const doc = (over) => { const d = JSON.parse(synthesisFindings(dir)); Object.assign(d.findings[0], over); return d; };
  const narrative = {
    spine: "Dominant-element analysis. The shared element carries both marks, and a register would weigh it first. "
      + "The conflicting registration covers the same distinctive element in the filed class, and the goods overlap.",
    verdict: "The identical registration in the searched class drives the read, and the position is adverse on the current filing.",
    coverage: { read: "The instructed registers were enumerated to completeness on the named band." },
  };
  // The finding asserts use ("not-confirmed") and carries no use_check: the receipt gate's own shape.
  const gate = (band) => {
    const r = recordSynthesis(dir, { findings: doc({ band, use_check: null }), narrative });
    assert.ok(r.written, `${band}: not recorded: ${r.refused ?? ""}`);
    const narrativePath = join(dir, "narrative.md");
    return validators.findings(narrativePath, readFileSync(narrativePath, "utf8"));
  };
  const low = gate("Manageable");
  assert.equal(low.ok, true, `a low-risk finding was held to the use receipt: ${low.reason ?? ""}`);
  const medium = gate("Medium");
  assert.equal(medium.ok, false, "a medium-risk finding asserting use with no receipt passed");
  assert.match(medium.reason, /finding_use_check_missing:1/);
});
