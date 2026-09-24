// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock pipeline end to end with a register gap
// copper-lattice e2e (offline mock): the deliver-conditional floor exercised ON in its own process (the
// legacy pipeline.mock harness runs with the clamp off — its scenarios share one frozen root/slug and
// predate it), and a recall store left on disk from before its removal, which no run reads or writes.
// Mirrors pipeline.mock.test.mjs's harness; every run is billable-call-free (mock engine).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
// band-truth gate (2026-07-14): OFF in hermetic harnesses — mock runs never dial the provider, so the
// production call ledger can never evidence their bands; the dedicated band-truth-gate tests turn it ON.
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP = "1";   // ON — the clamp under test
// code-side saturation-probe (2026-07-14): OFF in this legacy harness — its scenarios script the AGENT
// member; the dedicated satprobe-codeside tests exercise the code-side path with an injected executor.
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const JOB = {
  id: "test-job", msgId: "<test@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8439", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};

// config.workspaceRoot freezes at FIRST import — every run in this file lands under ROOT.
const ROOT = mkdtempSync(join(tmpdir(), "clearotron-mock-gap-"));
const SLUG_DIR = join(ROOT, "workspace-clawdi", "studio", "clearance-search", "tmp8439-project-novapulse");

async function runPipeline(env, jobPatch = {}, opts = {}) {
  for (const k of ["MOCK_VERDICT", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_LEDGER_LIMITED"]) delete process.env[k];
  for (const [k, v] of Object.entries({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: ROOT, CLEAROTRON_REPORTS_DIR: join(ROOT, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_AGENT: "clawdi", ...env })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB, ...jobPatch }, opts);
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events };
}

test("a recall store left on disk is neither read nor written, and changes nothing about the run", async () => {
  // The store from before the removal stays where it was, in both of its old places: the workspace file
  // per mark and the matter-sibling file. It holds a live in-scope conflict this scenario never carries,
  // and an in-window opposition window on the registration it does carry. Either one used to clamp.
  const storeDir = join(ROOT, "workspace-clawdi", "studio", "clearance-search", "_known-conflicts");
  mkdirSync(storeDir, { recursive: true });
  mkdirSync(SLUG_DIR, { recursive: true });
  const soon = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const storePath = join(storeDir, "project-novapulse.json");
  const legacyPath = join(SLUG_DIR, "_known-conflicts.json");
  const store = JSON.stringify({ schema_version: 3, marks: { "project novapulse": [
    { uri: "/mark/us/99999999", mark_text: "GHOST MARK", classes: [9], status: "live", owner: "Ghost Owner LLC",
      source: "auto:delivery some-prior-run", ts: "2026-07-01T00:00:00Z", terminal: "delivered" },
    { uri: "/mark/us/90000001", mark_text: "PROJECT NOVAPULSE", classes: [9], status: "live", opposition_end: soon,
      deadline_source_uri: "/mark/us/90000001", source: "auto:delivery prior-run", ts: "2026-07-01T00:00:00Z", terminal: "delivered" },
  ] } }, null, 2);
  const legacy = JSON.stringify({ schema_version: 1, marks: { "project novapulse": [
    { uri: "/mark/us/90491258", mark_text: "OLD LEDGER ROW", classes: [9], status: "live", source: "auto:delivery earlier", ts: "2026-07-07T00:00:00Z" },
  ] } }, null, 2);
  writeFileSync(storePath, store);
  writeFileSync(legacyPath, legacy);

  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.verdict, "CLEAR", "nothing remembered clamps the verdict any more");
  assert.equal(readFileSync(storePath, "utf8"), store, "the workspace store is byte-identical after a delivery");
  assert.equal(readFileSync(legacyPath, "utf8"), legacy, "and so is the matter-sibling file");
  const recallEvents = events.filter((e) => /known-conflicts|recall-regression|deadline-carry|register-recall/.test(String(e.event)));
  assert.deepEqual(recallEvents, [], "no run event reads, writes or judges the store");
  assert.equal(existsSync(driverDir(res.runDir, "register-recall.json")), false, "no recall receipt is written");
  const plan = JSON.parse(readFileSync(driverDir(res.runDir, "register-plan.json"), "utf8"));
  assert.deepEqual(plan.entries.filter((e) => /^recall-/.test(String(e.qid))).map((e) => e.qid), [], "no recall search enters the plan");
  const integ = JSON.parse(readFileSync(driverDir(res.runDir, "reasoning-integrity.json"), "utf8"));
  assert.ok(!integ.tripFlags.some((f) => /^(recall-regression|deadline-carry):/.test(f)), "the reviewer is handed no recall flag");
});

test("supplemental_lane contract e2e: a hand-authored (qid-less) band block FAILS the unit — the transcription lane is closed", async () => {
  process.env.MOCK_BAND_UNPLANNED = "1";
  try {
    const { res } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
    assert.equal(res.ok, false);
    assert.match(String(res.failedStage ?? ""), /^register-unit:/);
    assert.match(String(res.reason ?? ""), /band_block_unplanned/);
  } finally { delete process.env.MOCK_BAND_UNPLANNED; }
});

test("the coverage floor names itself, and names which of its inputs fired", async () => {
  // A material dominant-element omission the reopen does not close is one of the floor's inputs; it
  // stands in here for all of them, since the event's shape is the same whichever fires.
  process.env.MOCK_FRAME_DIFF = "reopen";
  try {
    const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" },
      { ref: null, id: "frame-gap-floor-scenario" });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.verdict, "CONDITIONAL", "a disclosed gap clamps CLEAR→CONDITIONAL");
    const clamp = events.find((e) => e.event === "coverage-floor-clamp" && e.cause === "coverage");
    // — THE EVENT SAYS WHICH FLOOR EMITTED IT, AND WHICH OF THAT FLOOR'S INPUTS FIRED.
    // Three sites emit this event with the same from/to, so before `cause` a reader counting "how often
    // does a disclosed gap clamp a verdict" got a number mixing three unrelated causes.
    assert.ok(clamp, `the coverage floor names itself rather than being inferred from an optional key: ${JSON.stringify(events.filter((e) => e.event === "coverage-floor-clamp"))}`);
    assert.ok(Array.isArray(clamp.causes) && clamp.causes.length >= 1,
      `this floor is six causes under one name, so it lists the ones that fired: ${JSON.stringify(clamp.causes)}`);
    assert.ok(!clamp.causes.includes("deadlineCarry"), "the deadline-carry input went with the recall store");
  } finally { delete process.env.MOCK_FRAME_DIFF; }
});


// ── THE THREE CLAMP SITES ARE TELLABLE APART BY `cause` ALONE ───────────────────────────────────
//
// Two of them fired three milliseconds apart on a production run and read as one decision logged
// twice. They were two decisions wearing one name, and the test lane reasonably discounted one.
// Asserted over the SOURCE because the property is about all three sites while a mock run trips one
// floor at a time: an arm driving a single run cannot see two causes collide, which is the defect.
test("tracker 636 every coverage-floor-clamp site carries its own cause, and no two share one", () => {
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  const sites = [...src.matchAll(/event: "coverage-floor-clamp", cause: "([a-z-]+)"/g)].map((m) => m[1]);
  assert.equal(sites.length, 3, `all three clamp sites must carry a cause; found ${sites.length}`);
  assert.equal(new Set(sites).size, 3,
    `two clamp sites share a cause and are indistinguishable again: ${sites.join(", ")}`);
  // The event name itself is deliberately NOT split: it is a true statement about the effect, and
  // something downstream may already count clamps in aggregate. A discriminator is additive.
  assert.equal((src.match(/event: "coverage-floor-clamp"/g) ?? []).length, 3,
    "the event keeps one name — three names would break an aggregate counter");
});
