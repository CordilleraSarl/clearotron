// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — drives carryThrough over a run dir shaped like a preserved delivered clearance
// — THE MEASURE PRINTED A CATASTROPHE OVER SIX DELIVERED FINDINGS.
//
// `0 of 6 identifier(s) reach an arrival artifact`, and every named subject had in fact reached the
// client. The common-law surface writes its subject as "<entity> — <what they do>", and `nameFragments`
// split on `/ ; ,` and an ellipsis but NOT on the em-dash — so the fragment tested was the whole
// sentence, which appears nowhere downstream, while the ENTITY appears repeatedly. The identifier is a
// source URL and those do not travel either, so both keys failed and the row read as lost.
//
// WHY IT MATTERS MORE THAN A WRONG NUMBER: this is the measure the seam work is detected with. On the
// run it was found on it printed a false total collapse beside a REAL single loss. A measure that can
// print a false catastrophe next to a true failure gets the true one discounted.
//
// THE ARM THAT MATTERS IS THE SECOND ONE. Making a checker stop reporting is trivial and is the way
// this fix fails, so a real drop is driven beside the false one and must still be reported.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { carryThrough, nameFragments } from "../carry-through.mjs";

/** A run dir carrying one common-law surface and the three arrival artifacts. */
function runWith({ subjects, arrivals }) {
  const dir = mkdtempSync(join(tmpdir(), "carry-2051-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "common-law-findings.md"),
    "## Findings\n\n| Finding | URL |\n|---|---|\n"
    + subjects.map((s) => `| ${s.name} | ${s.url ?? ""} |`).join("\n") + "\n");
  writeFileSync(join(dir, "findings.json"), JSON.stringify({ findings: arrivals }));
  writeFileSync(join(dir, "narrative.md"), "# Narrative\n");
  writeFileSync(join(dir, "placements.json"), JSON.stringify({ placements: [] }));
  return dir;
}

const COMPOSITE = "Delphinus Medical Technologies — SoftVue breast ultrasound device";
const SOURCE_URL = "https://clinicaltrials.gov/study/NCT03257839";

test("2051 the em-dash separates a name from its description, so the entity is a join key", () => {
  const frs = nameFragments(COMPOSITE);
  assert.ok(frs.includes("Delphinus Medical Technologies"),
    `the entity must be testable on its own; got ${JSON.stringify(frs)}`);
  assert.ok(frs.length >= 2, "and the description stays a fragment too — more fragments can only move a row toward ARRIVED");
});

test("2051 a delivered common-law finding is not reported as reaching nothing", () => {
  // The identifier deliberately does NOT travel — that is the real shape: the source URL appears only
  // on the common-law surface. The entity name is what arrives, and it is what must be found.
  const dir = runWith({
    subjects: [{ name: COMPOSITE, url: SOURCE_URL }],
    arrivals: [{ subject: "Delphinus Medical Technologies", note: "device maker" }],
  });
  const r = carryThrough(dir);
  assert.equal(r.computable, true);
  assert.deepEqual(r.lost, [],
    "the entity arrived in findings.json; reporting it lost asserts a false fact about the product");
  assert.equal(r.subjects, 1, "…and it was actually examined, not skipped out of the population");
});

test("2051 A REAL DROP IS STILL REPORTED — the fix must not be `stop reporting`", () => {
  const dir = runWith({
    subjects: [
      { name: COMPOSITE, url: SOURCE_URL },                                  // arrives
      // its OWN url: rows dedup on the identifier, so sharing one collapses two subjects into one and
      // the second is never examined. My first draft of this fixture did exactly that and the arm
      // failed for its own reason — recorded because a control that silently tests nothing is the
      // failure mode this whole issue is about.
      { name: "Kurena Bioscience — contract manufacturer", url: "https://example.test/kurena" },
    ],
    arrivals: [{ subject: "Delphinus Medical Technologies", note: "device maker" }],
  });
  const r = carryThrough(dir);
  assert.equal(r.lost.length, 1, "a subject that reached no arrival artifact must still be reported");
  assert.match(r.lost[0].subject, /Kurena Bioscience/, "and it must be the one that genuinely dropped");
});

test("2051 a subject naming nothing testable is UNMEASURABLE, never `reached none`", () => {
  // The distinction this whole issue is about: "we could not join it" is not "the product lost it".
  const dir = runWith({ subjects: [{ name: "—", url: "" }], arrivals: [] });
  const r = carryThrough(dir);
  assert.deepEqual(r.lost, [], "an unjoinable subject must not be asserted as a product failure");
  assert.equal(r.unmeasurable.length, 1, "it belongs in its own bucket");
  assert.match(r.unmeasurable[0].why, /nothing testable/i, "…which names why, rather than leaving a reader to guess");
});
