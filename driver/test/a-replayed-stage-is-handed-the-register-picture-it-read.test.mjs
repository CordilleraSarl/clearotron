// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-replayed-stage-is-handed-the-register-picture-it-read.test.mjs — each dispatch records the register picture it was
// handed, and an `--experiment` arm keeps that picture where the run still holds it, re-derives where it must, and
// says when its replay is not faithful.
//
// THE DEFECT. Every arm re-derived the band shape from the run's files as they stand now, so an arm meant to
// reproduce a pass was handed a later picture than the pass read whenever the run's inputs had grown since: on a saved
// R2 run the arm's set-aside block kept 2 of the pass's 5 group rows (measured by e2e, 2026-10-29). No run recorded
// which picture a stage was handed, so nothing could say so.
//
// Driven through the mock pipeline and the experiment rig. Every mark and name here is invented.
//
// Run:  node --test driver/test/a-replayed-stage-is-handed-the-register-picture-it-read.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";
import { replayOfDerivation } from "../derived-state.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
const ROOT = mkdtempSync(join(tmpdir(), "clearance-picture-"));
process.env.CLEAROTRON_AI = "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", CLAUDE);
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
process.env.CLEAROTRON_MAX_RETRIES = "0";
process.env.CLEAROTRON_RECOVERY_MAX = "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const PL = await import("../pipeline.mjs");
const job = { id: "job-TMPPICT1", msgId: "<TMPPICT1@x>", forwarder: "jordan", forwarderDomain: "example.com",
  ref: "TMPPICT1", markName: "MARK TMPPICT1", classes: [9, 41], provider: "corsearch" };
const events = (runDir) => readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

/** A live run dir, parked at synthesis after one recovery, as experiment-context.test.mjs builds its canonical run. */
let CANON = null;
async function canonicalRun() {
  if (CANON) return CANON;
  process.env.MOCK_VERDICT = "CLEAR";
  process.env.MOCK_SKEPTIC = "no flags surfaced";
  process.env.MOCK_FAIL_STAGE = "joint synthesis narrative";
  process.env.CLEAROTRON_RECOVERY_MAX = "1";
  let res;
  try { res = await PL.pipeline({ ...job }); } finally { process.env.CLEAROTRON_RECOVERY_MAX = "0"; delete process.env.MOCK_FAIL_STAGE; }
  assert.equal(res.postponed, true, "guard: the canonical run parks so its run dir stays live");
  CANON = { runDir: res.runDir, codename: basename(res.runDir).replace(/^\d{4}-\d\d-\d\d-/, "") };
  return CANON;
}
const arm = async (label, env = {}) => {
  const { codename } = await canonicalRun();
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  try {
    const ex = await PL.runExperiment({ ...job }, { codename, experiment: "register-digest", label });
    return JSON.parse(readFileSync(driverDir(ex.shadowDir, "experiment-context.json"), "utf8"));
  } finally { for (const k of Object.keys(env)) delete process.env[k]; }
};
const bandShapeOf = (receipt) => receipt.pictureReplay.find((r) => r.id === "band-shape");

test("a dispatch whose context holds the band shape records what it was handed, by content", async () => {
  const { runDir } = await canonicalRun();
  const row = events(runDir).filter((e) => e.event === "stage" && e.stage === "register-digest").pop();
  assert.ok(row, "guard: the run dispatched the reading step");
  const shape = (row.derivedState ?? []).find((d) => d.id === "band-shape");
  assert.ok(shape, "the dispatch recorded no picture");
  assert.ok(shape.writes.some((w) => w.name.endsWith("band-shape.json") && w.sha), "the shape it was handed is not identified");
  assert.ok(shape.reads.some((r) => r.name === "register-named-band.json" && r.sha), "the band it was derived from is not identified");
  assert.ok(shape.reads.some((r) => r.name === "_records"), "the records the band tools serve are not identified");
});

test("an arm that changes nothing keeps the picture its dispatch was handed, and says the replay is faithful", async () => {
  const receipt = await arm("unchanged");
  assert.deepEqual(bandShapeOf(receipt), { id: "band-shape", how: "kept", faithful: true, why: null });
  assert.equal(receipt.faithfulPicture, true);
  assert.ok(!receipt.derived.includes("band-shape"), "the shape was derived again");
});

test("a seeded arm derives the shape again, from the inputs its dispatch's own shape came from", async () => {
  const receipt = await arm("seeded", { CLEAROTRON_ORDER_PROBE_SEED: "3" });
  assert.deepEqual(bandShapeOf(receipt), { id: "band-shape", how: "re-derived", faithful: true, why: null });
  assert.ok(receipt.derived.includes("band-shape"), "the seed's change did not take effect");
});

test("a record the run gained after the dispatch makes the replay not faithful, and the receipt says why", async () => {
  const { runDir } = await canonicalRun();
  const later = join(runDir, "_records", "later-record.json");
  mkdirSync(dirname(later), { recursive: true });
  writeFileSync(later, JSON.stringify({ invented: true }));
  const receipt = await arm("after a later record");
  assert.equal(bandShapeOf(receipt).how, "re-derived");
  assert.equal(bandShapeOf(receipt).faithful, false);
  assert.match(bandShapeOf(receipt).why, /changed since the dispatch/);
  assert.equal(receipt.faithfulPicture, false);
});

test("a run that recorded no picture is never called faithful", () => {
  const now = [{ id: "band-shape", writes: [{ name: "_driver/band-shape.json", sha: "a" }], reads: [{ name: "register-named-band.json", sha: "b" }] }];
  for (const recorded of [null, [], [{ id: "grid-spec", writes: [], reads: [] }]]) {
    const r = replayOfDerivation("band-shape", recorded, now);
    assert.deepEqual([r.how, r.faithful], ["re-derived", false], JSON.stringify(recorded));
    assert.match(r.why, /no picture/);
  }
  // A file the dispatch found absent and that has appeared since is a changed picture.
  const absent = [{ id: "band-shape", writes: [{ name: "_driver/band-shape.json", sha: "a" }], reads: [{ name: "register-record-bodies.jsonl", sha: null }] }];
  const appeared = [{ id: "band-shape", writes: [{ name: "_driver/band-shape.json", sha: "a" }], reads: [{ name: "register-record-bodies.jsonl", sha: "c" }] }];
  assert.equal(replayOfDerivation("band-shape", absent, absent).how, "kept");
  assert.equal(replayOfDerivation("band-shape", absent, appeared).faithful, false);
});
