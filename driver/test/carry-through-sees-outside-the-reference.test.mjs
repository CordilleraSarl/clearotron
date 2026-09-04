// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE TWO MEASUREMENTS MUST BE VISIBLY DIFFERENT, AND ONLY A PLANT OUTSIDE THE REFERENCE SHOWS IT.
//
// Every bucket `score.mjs` prints is built from REFERENCE entries. `withheld` — the bucket role-e2e
// calls "the one that changes what you fix" — therefore rises only when the mark the run dropped is a
// mark the lawyer's list happens to name. On R2 `ed1d7248` the reviewer returned BLOCKING on two live
// in-class rights the run retrieved and dropped, and the scorer printed `withheld 0`. Both numbers were
// correct. Nothing measured the rest of the seam.
//
// So the arm that discriminates plants a subject the run carries, does not report, AND that the
// reference does not name. A test whose plant is inside the reference passes on a scorer that never
// gained a second measure at all — `withheld` alone would rise and the assertion would be satisfied.
//
// The control matters as much as the plant: the same fixture with the subject ARRIVING must report
// nothing. Without it this file cannot fail, because "reports the plant" is also what a measure that
// flags every row does.
import { test } from "node:test";
import { pinEnvAll } from "../../shared/env-aliases.mjs";   // — a spread carries EVERY spelling, so an override must clear every spelling
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCORE = join(REPO, "scripts", "score.mjs");

const ALPHA_URI = "/mark/us/ALPHA000000000000000000000000000001";
const ZETA_URI = "/mark/us/ZETA0000000000000000000000000000001";

// The reference names ALPHA and says nothing about ZETA. That is the whole point of the fixture.
const GOLD = {
  schema_version: 1,
  scenario: "CT1",
  source: "synthetic fixture, this test — never a real matter",
  register: [{ mark: "ALPHA" }],
};

const registerFindings = () => [
  "# Register findings — ALPHA (synthetic fixture)",
  "",
  "**Record identity.** The `URI` column is the canonical record identity.",
  "",
  "## Findings — Mark: ALPHA",
  "",
  "### Risk-relevant (orchestrator: Sheet 1 candidates)",
  "",
  "| URI | Mark | Owner | Country | Classes |",
  "|---|---|---|---|---|",
  `| ${ALPHA_URI} | ALPHA | Alpha Holdings | US | 9 |`,
  `| ${ZETA_URI} | ZETA CORP | Zeta Corporation | US | 9 |`,
  // Carries no identifier and its subject cell names nothing testable. Must be reported UNMEASURABLE,
  // never "arrived": the empty string is contained in every text, which was a real free pass once.
  "| — | (device mark, no word element) | Delta SA | US | 9 |",
  // Same name, no identifier, TWO different must-arrive sections. Keyed on the bare name these merge
  // and one is silently dropped from the population — measured on three of four preserved runs.
  "| — | OMEGA | Omega One | US | 9 |",
  "",
  "### Incumbent-context (orchestrator: Sheet 2 candidates)",
  "",
  "| URI | Mark | Owner | Country | Classes |",
  "|---|---|---|---|---|",
  "| — | OMEGA | Omega Two | US | 9 |",
  "",
  // Shaped like the real thing: a Mark column carrying no URI. Measured across four preserved runs,
  // Negative-results rows hold a mark name and ZERO identifiers (25, 33, 16 and 44 rows). The heading
  // is what excludes them, and this row is here so that exclusion is exercised rather than assumed.
  "### Negative results (orchestrator: Sheet \"Negative Results\")",
  "",
  "| URI | Mark | Status |",
  "|---|---|---|",
  "| — | ZZZ-NOTHING | no results |",
  "",
].join("\n");

/**
 * @param {boolean} zetaArrives  whether the planted subject reaches the downstream artifacts.
 */
function scoreFixture(zetaArrives) {
  const store = mkdtempSync(join(tmpdir(), "carry-through-store-"));
  const run = mkdtempSync(join(tmpdir(), "carry-through-run-"));
  try {
    mkdirSync(join(store, "baselines"));
    writeFileSync(join(store, "baselines", "CT1.gold.json"), JSON.stringify(GOLD, null, 2));

    const arriving = [{ mark: "ALPHA", uri: ALPHA_URI, owner: { name: "Alpha Holdings" }, band: { label: "High" } }];
    if (zetaArrives) arriving.push({ mark: "ZETA CORP", uri: ZETA_URI, owner: { name: "Zeta Corporation" }, band: { label: "Low" } });

    writeFileSync(join(run, "register-findings.md"), registerFindings());
    writeFileSync(join(run, "findings.json"), JSON.stringify({ findings: arriving }, null, 2));
    writeFileSync(join(run, "narrative.md"),
      `ALPHA (${ALPHA_URI}) is the position this matter turns on.` + (zetaArrives ? ` ZETA CORP (${ZETA_URI}) is also carried.` : ""));
    writeFileSync(join(run, "placements.json"), JSON.stringify(arriving.map((f) => ({ mark: f.mark, uri: f.uri, sheet: 1 })), null, 2));

    // The run's own claim that everything this axis found is reported — acceptance 2. The band file is
    // what ties a dropped record back to the axis that claims it.
    writeFileSync(join(run, "register-coverage-ledger.json"), JSON.stringify(
      [{ axis: "primary-sweep", scope: "", status: "confirmed-clean", reason: "synthetic fixture" }], null, 2));
    mkdirSync(join(run, "register-units"));
    writeFileSync(join(run, "register-units", "primary-sweep-band.json"), JSON.stringify(
      { records: [{ uri: ALPHA_URI, mark: "ALPHA" }, { uri: ZETA_URI, mark: "ZETA CORP" }] }, null, 2));
    // Retrieved corpus, so `withheld`'s own scope line has something real to count against.
    writeFileSync(join(run, "register-named-band.json"), JSON.stringify(
      { records: [{ mark: "ALPHA", uri: ALPHA_URI }, { mark: "ZETA CORP", uri: ZETA_URI }] }, null, 2));

    const r = spawnSync("node", [SCORE, "CT1", "--run", run, "--json"], {
      encoding: "utf8",
      // Scrubbed before ours is set: an inherited CLEAROTRON_E2E_DIR points at the config store's real gold
      // sets, which are live client matter, and the fixture would read as clean against them.
      env: pinEnvAll({ ...process.env }, { CLEAROTRON_E2E_DIR: store, CLEAROTRON_WORK_DIR: "" }),
    });
    assert.equal(r.status, 0, `score.mjs refused the fixture:\n${r.stderr}`);
    return JSON.parse(r.stdout);
  } finally {
    rmSync(store, { recursive: true, force: true });
    rmSync(run, { recursive: true, force: true });
  }
}

test("a subject the run carried and dropped is reported even though the reference never names it", () => {
  const out = scoreFixture(false);
  const ct = out.carry_through;

  assert.ok(ct, "score.mjs --json must carry the measure; --json bypasses print(), so an absent key here "
    + "hides it from every automated reader");
  assert.equal(ct.computable, true, `the fixture should be measurable: ${ct.reason}`);

  const lost = ct.lost.map((l) => l.subject);
  assert.deepEqual(lost.sort(), ["OMEGA", "OMEGA", "ZETA CORP"],
    `the planted subject must be reported, alongside the two same-named rows: got ${JSON.stringify(lost)}`);
  assert.equal(ct.lost.find((l) => l.subject === "ZETA CORP").identifier, ZETA_URI,
    "acceptance 1 asks for the identifier, not just the name — a name alone cannot be looked up");
});

test("`withheld` stays 0 on the same run, so the two are visibly different measurements", () => {
  const out = scoreFixture(false);

  assert.equal(out.buckets.withheld.length, 0,
    "ZETA is outside the reference, so it cannot raise `withheld` — if this ever rises, the fixture has "
    + "stopped testing what the issue is about and the plant is no longer outside the reference");
  assert.ok(out.carry_through.lost.some((l) => l.subject === "ZETA CORP"),
    "…while the carry-through measure sees it. One run, two numbers, and that is the point");
});

test("the run's own confirmed-clean claim is contradicted rather than read", () => {
  const cov = scoreFixture(false).carry_through.coverage;

  assert.equal(cov.computable, true, `the coverage claim should be checkable: ${cov.reason}`);
  assert.equal(cov.conflicts.length, 1, "one axis claims confirmed-clean while carrying the dropped record");
  assert.equal(cov.conflicts[0].axis, "primary-sweep");
  assert.equal(cov.conflicts[0].identifier, ZETA_URI);
});

test("the decomposition reconciles to the population it claims to describe", () => {
  const ct = scoreFixture(false).carry_through;

  // Three buckets over one population. If they stop summing to it, rows are being dropped somewhere
  // between the parse and the report and every number above becomes unreadable — the failure mode is
  // silent, because each bucket on its own still looks plausible.
  assert.equal(ct.subjects + ct.notExpected + ct.unmeasurable.length, ct.distinct,
    `subjects ${ct.subjects} + notExpected ${ct.notExpected} + unmeasurable ${ct.unmeasurable.length} `
    + `must equal the ${ct.distinct} distinct subject rows`);
  assert.equal(ct.unmeasurable.length, 1,
    "the device-mark row names nothing testable and must be reported as such rather than counted arrived");
  assert.equal(ct.notExpected, 1, "the Negative-results row is excluded by its own heading");
  assert.ok(ct.rawRows >= ct.distinct, "dedup may only reduce the row count");
});

test("a no-identifier row is not merged with a same-named row in another section", () => {
  // THROUGH THE REAL PATH, not through the parser. An arm that calls subjectRows() directly proves the
  // rows parse and says nothing about the dedup key that consumes them — and the key is where the bug
  // was. Verified by mutation: reverting the key to the bare name leaves a subjectRows-only arm green.
  const ct = scoreFixture(false).carry_through;

  const omega = ct.lost.filter((l) => l.subject === "OMEGA");
  assert.equal(omega.length, 2,
    `both OMEGA rows must survive as distinct subjects — got ${omega.length}. One means the no-identifier `
    + "key merged two rows that sit in different sections, and the population lost one silently");
  assert.notEqual(omega[0].section, omega[1].section, "…and what distinguishes them is the section");
});

test("CONTROL — the same fixture with the subject ARRIVING reports nothing", () => {
  // Without this arm the file cannot fail: a measure that flagged every row would pass all three tests
  // above. This is the negative the others rest on.
  const out = scoreFixture(true);

  assert.ok(!out.carry_through.lost.some((l) => l.subject === "ZETA CORP"),
    `the planted subject arrived in this arm, so it may not be reported: ${JSON.stringify(out.carry_through.lost)}`);
  assert.equal(out.carry_through.coverage.conflicts.length, 0,
    "and the coverage claim stands when the record it covers actually arrives");
  assert.ok(out.carry_through.subjects >= 2,
    "the control must still have CHECKED the subjects — zero lost out of zero checked is not a pass");
});
