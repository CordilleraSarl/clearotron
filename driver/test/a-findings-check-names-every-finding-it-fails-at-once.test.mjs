// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the findings record's checks, on invented records
//
// A FINDINGS CHECK NAMES EVERY FINDING IT FAILS, AT ONCE.
//
// The record's per-finding checks stopped at the first finding that failed one. A correction owing three use-check
// receipts was told of one, supplied it, and failed on the next: on a test run of a crowded matter the writer's
// corrective pass after review failed three times this way, on three findings in turn, and was rolled back with the
// review's flags unapplied until a later repair. Each check now gathers every finding it fails, in record order, and
// names them all in one failure, so one corrective attempt can supply every receipt. Every mark and owner is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { parseFrameworkManifest } from "../framework.mjs";
import { recordSynthesis } from "../synthesis-record.mjs";
import { validators } from "../verify.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";

const FIVE = parseFrameworkManifest({
  schema_version: 1, framework_key: "five-rung-test", title: "Invented five-rung ladder", source_deck: "none", entity_label: "the company",
  bands: [{ label: "Very High", tone: "severe" }, { label: "High", tone: "high" }, { label: "Medium", tone: "medium" },
    { label: "Manageable", tone: "low" }, { label: "Low", tone: "minimal" }],
  structure: { kind: "bands" },
});
const NARRATIVE = {
  spine: "Dominant-element analysis. The shared element carries both marks, and a register would weigh it first. "
    + "The conflicting registration covers the same distinctive element in the filed class, and the goods overlap.",
  verdict: "The identical registration in the searched class drives the read, and the position is adverse on the current filing.",
  coverage: { read: "The instructed registers were enumerated to completeness on the named band." },
};
const OWNERS = [["Qorvalen Holdings", "VELTRIN"], ["Brannick Tooling", "ORVANTE"], ["Selmora Labs", "KESTRIN"], ["Ostravel Quine", "QUILVANTA"]];

/** The validator's verdict on a record whose findings each assert use; `receipted` carries a use-check receipt. */
function verdictOn(receipted) {
  const dir = mkdtempSync(join(tmpdir(), "every-finding-"));
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(driverDir(dir, "framework.json"), JSON.stringify(FIVE, null, 2));
  const doc = JSON.parse(synthesisFindings(dir));
  const base = doc.findings[0];
  doc.findings = OWNERS.map(([owner, mark], i) => {
    const f = structuredClone(base);
    f.ordinal = i + 1;
    f.mark = mark;
    f.owner.name = owner;
    f.owner.registrations[0].uri = `/mark/us/9300000${i + 1}`;
    if (f.meters?.mark_similarity) f.meters.mark_similarity.source = f.owner.registrations[0].uri;
    f.band = "Medium";
    f.use_check = receipted.includes(i + 1) ? { source: `https://market.example/listing-${i + 1}`, quality: "independent" } : null;
    return f;
  });
  const r = recordSynthesis(dir, { findings: doc, narrative: NARRATIVE });
  assert.ok(r.written, `the record was not written: ${r.refused ?? ""}`);
  return validators.findings(join(dir, "narrative.md"), readFileSync(join(dir, "narrative.md"), "utf8"));
}

test("every finding owing a use-check receipt is named in the one failure, in record order", () => {
  const v = verdictOn([2]);
  assert.equal(v.ok, false, "premise: three findings asserting use with no receipt passed");
  assert.match(v.reason, /finding_use_check_missing:1,3,4\b/, `the failure did not name every finding that owes a receipt: ${v.reason}`);
});

test("a single finding owing a receipt is named as it always was, and a record that owes none passes", () => {
  assert.match(verdictOn([1, 2, 3]).reason, /finding_use_check_missing:4\b/);
  assert.equal(verdictOn([1, 2, 3, 4]).ok, true);
});
