// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE CARRY-THROUGH ROWS ARE WITHHELD LIKE EVERY OTHER NAME. A subject lands in carry-through's `lost`
// because it reached no downstream artifact, so it is in neither the findings nor the scored buckets,
// and the redaction had nothing to match it against: `--json` printed `carry_through.lost[]`'s subject,
// URL and section heading in clear, and the human output printed the same row under REACHED NONE.
//
// Driven through the real boundary, a subprocess over a fixture run, for the reason
// `score-boundary-carries-ordinal.test.mjs` gives: the wiring lives in a CLI script with no exports.
// Every arm has its control, the same run scored with `--names`, which must still carry the words.
import { test } from "node:test";
import { pinEnvAll } from "../../shared/env-aliases.mjs";   // — a spread carries EVERY spelling, so an override must clear every spelling
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { protectedStrings, carryThroughRows } from "../score-redaction.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCORE = join(REPO, "scripts", "score.mjs");

// Invented names, never a scenario's.
const GOLD = {
  schema_version: 1,
  scenario: "CT1",
  source: "synthetic fixture, this test — never a real matter",
  register: [{ mark: "ALPHA" }],
};
const FINDINGS = { findings: [{ ordinal: 1, mark: "ALPHA", owner: { name: "Alpha Holdings" }, band: { label: "High" } }] };
// One common-law row that reaches no arrival artifact: its entity, its site and its heading are all
// matter text, and none of them appears in the findings or the reference.
const COMMON_LAW = [
  "## Common-law users of Zephyrine",
  "",
  "| Mark | URL |",
  "|---|---|",
  "| Zephyrine Quillworks — makes quills | https://zephyrinequill.example/shop |",
  "",
].join("\n");
const LEAKS = ["Zephyrine", "Quillworks", "zephyrinequill.example", "Common-law users"];
// The human output prints the subject and the URL, never the section heading.
const HUMAN_LEAKS = LEAKS.slice(0, 3);

function score(...flags) {
  const store = mkdtempSync(join(tmpdir(), "score-carry-store-"));
  const run = mkdtempSync(join(tmpdir(), "score-carry-run-"));
  try {
    mkdirSync(join(store, "baselines"));
    writeFileSync(join(store, "baselines", "CT1.gold.json"), JSON.stringify(GOLD, null, 2));
    writeFileSync(join(run, "findings.json"), JSON.stringify(FINDINGS, null, 2));
    writeFileSync(join(run, "common-law-findings.md"), COMMON_LAW);
    writeFileSync(join(run, "narrative.md"), "# narrative\n");
    const r = spawnSync("node", [SCORE, "CT1", "--run", run, ...flags], {
      encoding: "utf8",
      // BOTH names scrubbed before ours is set. An inherited CLEAROTRON_E2E_DIR would point this at the
      // config store's real gold sets, which are live client matter.
      env: pinEnvAll({ ...process.env }, { CLEAROTRON_E2E_DIR: store, CLEAROTRON_WORK_DIR: "" }),
    });
    assert.equal(r.status, 0, `score.mjs refused the fixture:\n${r.stderr}`);
    return r.stdout;
  } finally {
    rmSync(store, { recursive: true, force: true });
    rmSync(run, { recursive: true, force: true });
  }
}

const absent = (text, label, words = LEAKS) => {
  for (const w of words) assert.ok(!text.toLowerCase().includes(w.toLowerCase()), `${label} printed carry-through text in clear: ${w}`);
};
const present = (text, label, words = LEAKS) => {
  for (const w of words) assert.ok(text.toLowerCase().includes(w.toLowerCase()), `${label} lost carry-through text it should print: ${w}`);
};

test("the default --json withholds a lost row's subject, URL and heading, and keeps the row", () => {
  const j = JSON.parse(score("--json"));
  absent(JSON.stringify(j), "--json");
  assert.equal(j.carry_through.lost.length, 1, "redaction must not drop the row it withholds");
  assert.equal(j.carry_through.lost[0].checkedBy, "identifier and name", "a fixed-vocabulary field stays readable");
  assert.deepEqual(j.names_unclassified, [], "every key the carry-through rows add is classified");
});

test("CONTROL: --json --names over the same run prints all three", () => {
  const j = JSON.parse(score("--json", "--names"));
  present(JSON.stringify(j), "--json --names");
  assert.equal(j.carry_through.lost.length, 1);
});

test("the default human output withholds the row under REACHED NONE", () => {
  const out = score();
  assert.match(out, /REACHED NONE — common-law-findings\.md \(1\)/, "the row's heading line must still print, with its count");
  absent(out, "the human output", HUMAN_LEAKS);
});

test("CONTROL: the human output with --names prints the row", () => {
  present(score("--names"), "the human output with --names", HUMAN_LEAKS);
});

test("only the entity before the dash is a name: the description's words are not derived", () => {
  // Collected whole as a name, `makes` and `quills` would become derived protected words and tokenise
  // every such word the scorer prints. The cell is withheld whole as prose instead.
  const rows = carryThroughRows({ lost: [{ subject: "Zephyrine Quillworks — makes quills", section: "Common-law users", identifier: "https://zephyrinequill.example/shop" }] });
  const { names, prose, unclassified } = protectedStrings({ carry: rows });
  assert.ok(names.has("Zephyrine Quillworks"));
  assert.ok(names.has("https://zephyrinequill.example/shop"));
  assert.ok(prose.has("Zephyrine Quillworks — makes quills"));
  assert.ok(prose.has("Common-law users"));
  for (const w of ["makes", "quills"]) assert.ok(![...names].some((n) => n.toLowerCase() === w), `${w} is a description word and must not be a protected name`);
  assert.deepEqual(unclassified, []);
});

test("CONTROL: a register URI is not collected, for the reason record_id is safe", () => {
  const rows = carryThroughRows({ lost: [{ subject: "ALPHA", identifier: "/mark/eu/018000001" }] });
  const { names } = protectedStrings({ carry: rows });
  assert.ok(names.has("ALPHA"));
  assert.ok(![...names].some((n) => n.includes("/mark/")), "a register URI is an office and a number, not a name");
});
