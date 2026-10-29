// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE MARKS A RUN SEARCHED, AND THE FOLDER NAMED FOR ONE OF THEM, ARE WITHHELD LIKE EVERY OTHER NAME. A
// knockout run's subject roll is the marks it searched. A mark with a finding reached the redaction through
// that finding's row, and a mark without one reached it only where the reference spelled it the same way, so
// the `coverage:` line named some marks and masked others. The `run:` line prints the run's path, and the
// run's folder is its slug, built from the mark.
//
// Driven through the real boundary, a subprocess over a fixture run, as the carry-through test is. Every arm
// has its control, the same run scored with `--names`, which must still carry the words.
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

// Invented names, never a scenario's. The reference declares no `covers_marks`, so the coverage line names
// every mark the run searched, and neither mark has a finding.
const GOLD = { schema_version: 1, scenario: "KT1", source: "synthetic fixture, this test — never a real matter", register: [{ mark: "TARNWICK" }],
  counts: [{ mark: "TARNWICK", classes: [16], identical: { min: 0, max: 2 }, close_variations: ["TARN-WICK"] }] };
// OSTEND is searched alone and is also a word of BRINDLEWICK OSTEND, so it is a derived word as well as a
// given name: the lines the scorer authors drop derived words, and they printed it.
const KNOCKOUT = { marks: [{ name: "QUILLMERE", findings: [] }, { name: "BRINDLEWICK OSTEND", findings: [] }, { name: "OSTEND", findings: [] }] };
// The folder's mark part is no mark the run searched: a batch is named for its order, not for each mark.
const SLUG = "tmpkt1fixture-tarnfold";
const LEAKS = [/quillmere/i, /brindlewick/i, /ostend/i];

function score(...flags) {
  const store = mkdtempSync(join(tmpdir(), "score-marks-store-"));
  const root = mkdtempSync(join(tmpdir(), "score-marks-run-"));
  const run = join(root, SLUG, "2026-10-29-fixture-folder");
  try {
    mkdirSync(join(store, "baselines"));
    writeFileSync(join(store, "baselines", "KT1.gold.json"), JSON.stringify(GOLD, null, 2));
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, "knockout-findings.json"), JSON.stringify(KNOCKOUT, null, 2));
    const r = spawnSync("node", [SCORE, "KT1", "--run", run, ...flags], {
      encoding: "utf8",
      // BOTH names scrubbed before ours is set. An inherited CLEAROTRON_E2E_DIR would point this at the
      // config store's real gold sets, which are live client matter.
      env: pinEnvAll({ ...process.env }, { CLEAROTRON_E2E_DIR: store, CLEAROTRON_WORK_DIR: "" }),
    });
    return { ...r, out: r.stdout + r.stderr };
  } finally {
    rmSync(store, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}

test("the coverage line names no searched mark when names are withheld", () => {
  const r = score();
  assert.equal(r.status, 0, r.out);
  const line = r.stdout.split("\n").find((l) => l.startsWith("coverage:"));
  assert.ok(line, "the coverage line is printed");
  for (const leak of LEAKS) assert.doesNotMatch(line, leak);
  assert.match(line, /searched 3 marks/, "the line still says how many marks the run searched");
});

test("the run line does not print the folder named for the mark", () => {
  const r = score();
  const line = r.stdout.split("\n").find((l) => l.startsWith("run:"));
  assert.ok(line, "the run line is printed");
  assert.doesNotMatch(line, /tarnfold/i);
  assert.match(line, /2026-10-29-fixture-folder/, "the run's own folder, which carries no mark, still shows");
});

test("nothing in the whole masked output names a searched mark or the folder", () => {
  const r = score();
  for (const leak of [...LEAKS, /tarnfold/i]) assert.doesNotMatch(r.out, leak);
});

test("the --json payload names no searched mark either", () => {
  const r = score("--json");
  assert.equal(r.status, 0, r.out);
  JSON.parse(r.stdout);
  for (const leak of LEAKS) assert.doesNotMatch(r.stdout, leak);
});

test("CONTROL: with --names both marks and the folder are printed", () => {
  const r = score("--names");
  assert.equal(r.status, 0, r.out);
  for (const leak of LEAKS) assert.match(r.stdout, leak);
  assert.match(r.stdout, new RegExp(SLUG));
});
