// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT IS SCORED ON THE CHANNELS IT CITES.
//
// The scorer's sources axis asks whether each channel the reference names was searched, and it answers
// from the text of the run's own records. It read only the clearance lane's: the plan-execution record,
// the register plan, the grid ledgers. The knockout lane writes none of those. Where it looked is in
// what it cites, the evidence addresses on its findings and the pages its research notes name, so every
// knockout printed every channel ABSENT, measured on a run whose findings cited the reference's own
// store nine times (2026-09-24).
//
// The seam is the text the CLI script assembles, and the script has no exports, so the instrument is a
// SUBPROCESS over a run built here, the same reason knockout-buckets-carry-the-ordinal.test.mjs exists.

import { test } from "node:test";
import { pinEnvAll } from "../../shared/env-aliases.mjs";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCORE = join(REPO, "scripts", "score.mjs");

// Three channels: one only a finding cites, one only a research note names, one neither does. The third
// is the control: reading more files must not turn an unsearched channel into a searched one.
const CITED = "store.example.invalid";
const NOTED = "apps.example.invalid";
const NEVER = "unsearched.example.invalid";

const GOLD = {
  schema_version: 1,
  scenario: "BF7",
  source: "synthetic fixture, this test — never a real matter",
  register: [{ mark: "ZEPHYR CORP" }],
  counts: [{ mark: "ZEPHYR", territory: "US", live: 3 }],
  channels: [CITED, NOTED, NEVER],
};

const KNOCKOUT = {
  marks: [{
    name: "ZEPHYR",
    rating: "Medium",
    findings: [
      { ordinal: 1, name: "ZEPHYRA", band: "Medium", type: "Active Business", evidence: [`https://${CITED}/app/1`] },
    ],
  }],
};

const RESEARCH = `# ZEPHYR\n\nA game of that name is listed at https://${NOTED}/item/2, with no owner named.\n`;

function sourcesOf({ research = true } = {}) {
  const store = mkdtempSync(join(tmpdir(), "ko-sources-store-"));
  const run = mkdtempSync(join(tmpdir(), "ko-sources-run-"));
  try {
    mkdirSync(join(store, "baselines"));
    writeFileSync(join(store, "baselines", "BF7.gold.json"), JSON.stringify(GOLD, null, 2));
    writeFileSync(join(run, "knockout-findings.json"), JSON.stringify(KNOCKOUT, null, 2));
    if (research) {
      mkdirSync(join(run, "research"));
      writeFileSync(join(run, "research", "zephyr.md"), RESEARCH);
    }
    const r = spawnSync("node", [SCORE, "BF7", "--run", run, "--json"], {
      encoding: "utf8",
      // Both scrubbed before ours is set: an inherited CLEAROTRON_E2E_DIR would point this at the config
      // store's real gold sets, which are client matter.
      env: pinEnvAll({ ...process.env }, { CLEAROTRON_E2E_DIR: store, CLEAROTRON_WORK_DIR: "" }),
    });
    assert.equal(r.status, 0, `score.mjs refused the fixture:\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.ok(Array.isArray(out.sources), "the JSON output carries no sources axis");
    return Object.fromEntries(out.sources.map((s) => [s.channel, s.searched]));
  } finally {
    rmSync(store, { recursive: true, force: true });
    rmSync(run, { recursive: true, force: true });
  }
}

test("a channel a knockout finding cites as evidence counts as searched", () => {
  assert.equal(sourcesOf()[CITED], true);
});

test("a channel a knockout research note names counts as searched", () => {
  assert.equal(sourcesOf()[NOTED], true);
});

test("a channel the run cites nowhere is still ABSENT", () => {
  assert.equal(sourcesOf()[NEVER], false);
});

test("a knockout that wrote no research notes is still read from its findings", () => {
  const s = sourcesOf({ research: false });
  assert.equal(s[CITED], true);
  assert.equal(s[NOTED], false);
});
