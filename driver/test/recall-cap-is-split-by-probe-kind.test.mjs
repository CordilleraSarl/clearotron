// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock pipeline end to end to exercise the recall budget
//
// — THE CAP IS TWO BUDGETS, AND THIS DRIVES THE CALL SITE, NOT A HELPER.
//
// The admission rule is four lines inline in pipeline.mjs's recall fold. A unit test over an extracted
// predicate would pass with the fold still spending one shared counter, which is the defect: an arm that
// tests the helper leaves the call site unwatched. So this seeds a store with MORE ROWS THAN THE OLD CAP
// COULD SERVE and reads the receipt the run actually wrote.
//
// Its own root and slug, deliberately: the sibling registergap harness shares one root across its
// scenarios and seeds the same mark, and a store this file grows to eight rows would reach those runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
process.env.CLEAROTRON_RECALL_TRIPWIRE = "1";      // the fold under test is gated on this

const JOB = {
  id: "recall-cap-job", msgId: "<recall-cap@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP9171", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};
const ROOT = mkdtempSync(join(tmpdir(), "prelim-mock-recallcap-"));
const SLUG_DIR = join(ROOT, "workspace-clawdi", "studio", "prelim-search", "tmp9171-project-novapulse");

// EIGHT rows, every one class-overlapping so the material-first ranking leaves store order intact, and
// every one carrying an owner so each row mints BOTH a mark probe and an owner probe. Eight rows is the
// discriminating size: 16 probes against the old shared cap of 10 served five rows and dropped three
// marks; against split caps it serves all eight marks and stops the OWNER lane at five.
const ROWS = Array.from({ length: 8 }, (_, i) => ({
  uri: `/mark/us/9000000${i}`,
  mark_text: `FROSTBERRY VARIANT ${i + 1}`,
  owner: `Frostberry Holdings ${i + 1} LLC`,
  classes: [9],
  status: "live",
  source: "auto:delivery",
  ts: "2026-07-07T00:00:00Z",
}));

const kindOf = (qid) => (String(qid).startsWith("recall-owner-") ? "owner" : "mark");

test("#917: the recall cap is two budgets — every mark probe dispatches, the owner lane stops at five", async () => {
  mkdirSync(SLUG_DIR, { recursive: true });
  writeFileSync(join(SLUG_DIR, "_known-conflicts.json"),
    JSON.stringify({ schema_version: 1, marks: { "project novapulse": ROWS } }, null, 2));

  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: ROOT,
    CLEAROTRON_REPORTS_DIR: join(ROOT, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0",
    CLEAROTRON_AGENT: "clawdi", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    // The provider is REQUIRED and has no default. The full-suite harness injects it, so a file
    // that leans on that runs green in the suite and dies alone — 's defect. Set here instead, and
    // BOTH spellings of the renamed variable: driver.config.mjs reads them through `spellingsOf`, and
    // setting only one leaves whatever the other holds to win the disagreement.
    CLEAROTRON_DATABASE: "corsearch", CLEAROTRON_DATABASE: "corsearch",
  })) pinEnv(process.env, k, v);

  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline(JOB, {});
  assert.equal(res.ok, true, JSON.stringify(res));

  const receipt = JSON.parse(readFileSync(driverDir(res.runDir, "register-recall.json"), "utf8"));
  const dispatched = receipt.directives.map((d) => d.qid);
  const overflow = (receipt.overflow ?? []).map((o) => o.qid);

  const dispatchedMarks = dispatched.filter((q) => kindOf(q) === "mark");
  const dispatchedOwners = dispatched.filter((q) => kindOf(q) === "owner");

  // THE ASSERTION THAT IS RED ON THE OLD CODE. One shared cap of 10 served five rows, so three of the
  // eight marks never dispatched. The mark lane's cap is the population, so every one of them does.
  assert.equal(dispatchedMarks.length, 8,
    `every mark probe must dispatch; got ${dispatchedMarks.length} — ${JSON.stringify(dispatched)}`);

  // The owner lane holds at today's five, which is what "portfolio behaviour unchanged" means.
  assert.equal(dispatchedOwners.length, 5,
    `the owner lane stops at its own cap; got ${dispatchedOwners.length}`);

  // ...and the three it refused are the ONLY things over cap. Also red on the old code, where the
  // overflow carried three marks beside them.
  assert.equal(overflow.length, 3, `only the over-cap owner probes overflow; got ${JSON.stringify(overflow)}`);
  assert.ok(overflow.every((q) => kindOf(q) === "owner"),
    `no mark probe may overflow while the mark lane is under its cap; got ${JSON.stringify(overflow)}`);

  // The receipt states BOTH budgets. A single `cap` number cannot describe two lanes, and a reader of
  // this artifact is the person asking why a term was not searched.
  assert.deepEqual(receipt.cap, { mark: 50, owner: 5 }, "the receipt records both caps");
  assert.equal(receipt.schema_version, 2, "the cap shape changed, so the receipt's version did");
});
