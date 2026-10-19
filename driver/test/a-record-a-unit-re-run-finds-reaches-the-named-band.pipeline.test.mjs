// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock pipeline through a park and a resume on both engines, beside a direct test of the merge
//
// A RECORD A UNIT'S RE-RUN FINDS REACHES THE NAMED BAND.
//
// After the band's first merge, a register unit can be re-run in its own session: for the cross-check's questions, a
// frame-reopen sweep, the skeptic's escalation, or the envelope close. A narrow sub-query adds blocks to its axis band,
// and placement, the reading step and the writer read the named band. Only the code-side recheck merged again, so the
// records those re-runs found reached none of them. Now the named band is merged again whenever an axis band moved since
// the last merge, whatever the unit's notes did, and a moved band counts as a change for the reading step. Own file =
// own process + own workspace root; the workspace and the call ledger are pinned before any driver module loads, so
// driver modules are imported dynamically. Every mark and owner is invented.
import { mkdtempSync as __mkdtemp, writeFileSync as __write } from "node:fs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "clearotron-testroot-")));
const LEDGER = __join(__mkdtemp(__join(__tmpdir(), "clearotron-remerge-ledger-")), "corsearch-calls.jsonl");
process.env.CLEAROTRON_REGISTER_CALL_LOG = LEDGER;
__write(LEDGER, "");
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, chmodSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
const CODEX = join(HERE, "mock-codex.mjs");
chmodSync(CLAUDE, 0o755);
chmodSync(CODEX, 0o755);
process.env.CLEAROTRON_AI ||= "anthropic-agent";
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const ADDED = "/mark/us/90000077";   // the record mockUnitBandWrite adds on a warm re-run of MOCK_ESCALATION_ADDS_FLOOR's axis
const ON_CODEX = { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" };

// ── the merge itself: a band that moved is merged again, whatever the unit's notes did ──
test("an axis band that moves while the unit's notes stand is merged again into the named band, and one that did not move is not", async (t) => {
  const { deriveNamedBand, remergeIfBandsMoved } = await import("../pipeline.mjs");
  const { paths } = await import("../stages.mjs");
  const runDir = mkdtempSync(join(tmpdir(), "remerge-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(driverDir(runDir), { recursive: true });
  const P = paths(runDir);
  const rec = (id, owner) => ({ record_id: `/mark/eu/${id}`, mark_text: "QZORVAK", classes: [9], status: "Registered", owner_name: owner,
    owner_country: "DE", screen_verdict: "surface:in-scope-live" });
  const block = (n, records) => ({ state: "enumerated", qid: `supp:primary-sweep:t:${n}`, query: "primary-sweep / exact-in-class-live", total_hits: records.length, records });
  mkdirSync(dirname(P.registerBand("primary-sweep")), { recursive: true });
  writeFileSync(P.registerBand("primary-sweep"), JSON.stringify([block(1, [rec("a1", "Alpha Ltd")])]));
  writeFileSync(P.registerUnit("primary-sweep"), "# primary-sweep\n\nThe unit's notes, which the re-run leaves as they are.\n");
  const ctx = { paths: P, axes: ["primary-sweep"], job: { markName: "QZORVAK", classes: [9] }, profile: null, run: { slug: "qz", codename: "remerge" } };
  deriveNamedBand(ctx);
  const ids = () => JSON.parse(readFileSync(P.registerNamedBand, "utf8")).enumerated.map((r) => r.record_id);
  assert.deepEqual(ids(), ["/mark/eu/a1"], "guard: the first merge holds the first record");
  assert.equal(remergeIfBandsMoved(ctx, "escalation"), false, "a band that did not move was merged again");
  const notes = readFileSync(P.registerUnit("primary-sweep"), "utf8");
  writeFileSync(P.registerBand("primary-sweep"), JSON.stringify([block(1, [rec("a1", "Alpha Ltd")]), block(2, [rec("b1", "Beta GmbH")])]));
  assert.equal(remergeIfBandsMoved(ctx, "escalation"), true, "a band that moved was not merged again");
  assert.deepEqual(ids(), ["/mark/eu/a1", "/mark/eu/b1"], "the record the re-run added is not in the named band");
  assert.equal(readFileSync(P.registerUnit("primary-sweep"), "utf8"), notes, "guard: the unit's notes did not change");
  assert.equal(remergeIfBandsMoved(ctx, "escalation"), false, "the same band was merged again");
  const ev = readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(ev.filter((e) => e.event === "named-band-remerged").map((e) => e.why), ["escalation"]);
});

// ── whole runs: a resumed run whose warm re-run adds a live identical record ──
const JOB = {
  id: "test-job-remerge", msgId: "<remerge@x>", forwarder: "jordan", forwarderDomain: "example.com",
  ref: "TMP8921", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};
const PARK_AT_DIGEST = "You are register DIGEST mode";
const ESCALATE = "- transliteration-numeric extra script group looks thin\n\n## Escalation decisions\nESCALATE: transliteration-numeric — sweep the extra script group";

async function runMockPipeline(root, env, codename = null) {
  for (const k of ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_PLACEMENT_NO_SIBLING", "MOCK_ESCALATION_ADDS_FLOOR",
    "CLEAROTRON_AI_BILLING", "CODEX_API_KEY", "CLEAROTRON_CODEX_PATH"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0",
    MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", ...env,
  })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB }, codename ? { codename } : {});
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events };
}

// Pass 1 parks after placement; pass 2 resumes, and the warm re-run of `axis` adds the record. The repeated placement
// pass hands back nothing new, so the record is a floor nobody answered.
async function resumeWithAddedRecord(engineEnv, axis, extra) {
  const root = mkdtempSync(join(tmpdir(), "clearotron-remerge-"));
  const p1 = await runMockPipeline(root, { ...engineEnv, MOCK_FAIL_STAGE: PARK_AT_DIGEST });
  assert.equal(p1.res.failedStage, "register-digest", `guard: pass 1 parks at the reading step (parked at ${p1.res.failedStage})`);
  const codename = JSON.parse(readFileSync(join(p1.res.runDir, "status.json"), "utf8")).codename;
  const n1 = p1.events.length;
  const p2 = await runMockPipeline(root, { ...engineEnv, ...extra, MOCK_ESCALATION_ADDS_FLOOR: axis, MOCK_PLACEMENT_NO_SIBLING: "1" }, codename);
  const rd = p2.res.runDir;
  const json = (f) => JSON.parse(readFileSync(f, "utf8"));
  return { p2, ev2: p2.events.slice(n1), rd, json,
    inAxisBand: JSON.stringify(json(join(rd, "register-units", `${axis}-band.json`))).includes(ADDED),
    inNamedBand: json(join(rd, "register-named-band.json")).enumerated.some((r) => r.record_id === ADDED),
    floorInShape: json(driverDir(rd, "band-shape.json")).floors.in_class_identical_or_near.some((f) => f.record_id === ADDED),
    duty: existsSync(driverDir(rd, "floor-duty.json")) ? json(driverDir(rd, "floor-duty.json")) : null,
    verdict: existsSync(driverDir(rd, "verdict.json")) ? json(driverDir(rd, "verdict.json")) : null };
}

// The escalation's re-run, on both engines: the band is merged again, the moved band queues the reading step's re-run,
// and the record reaches the recall reconciliation, which never saw it before. What the reading step then writes about it
// is the model's answer: on this path the mock reading step writes no row for the new record, so the whole chain to
// delivery is driven on the envelope close below.
for (const [engine, env] of [["claude", {}], ["codex", ON_CODEX]]) {
  test(`${engine}: a record the skeptic's escalation adds reaches the named band, its shape and the reading step's next pass`, async () => {
    const r = await resumeWithAddedRecord(env, "transliteration-numeric", { MOCK_SKEPTIC: ESCALATE });
    assert.ok(r.ev2.some((e) => e.event === "stage" && e.stage === "register-unit:transliteration-numeric" && e.trigger === "escalation"), "guard: the escalation re-ran the unit");
    assert.ok(r.inAxisBand, "guard: the re-run added the record to its axis band");
    assert.deepEqual(r.ev2.filter((e) => e.event === "named-band-remerged").map((e) => e.why), ["escalation"]);
    assert.ok(r.inNamedBand, "the record the escalation found is not in the named band");
    assert.ok(r.floorInShape, "the band shape does not list the record as a floor");
    assert.ok(r.ev2.some((e) => e.event === "digest-queued" && e.trigger === "escalation"), "the moved band did not queue the reading step's re-run");
    const recall = r.ev2.filter((e) => e.event === "recall-reconciliation");
    assert.ok(recall.some((e) => e.trigger === "settlement-flush" && e.candidates === 22), `the record did not reach the recall reconciliation: ${JSON.stringify(recall.map((e) => [e.trigger, e.candidates]))}`);
  });
}

test("claude: a record the envelope close adds reaches the named band, the shape and the floor of the repeated placement pass", async () => {
  const r = await resumeWithAddedRecord({}, "primary-sweep", {});
  assert.ok(r.ev2.some((e) => e.event === "stage" && e.stage === "register-unit:primary-sweep" && e.trigger === "envelope"), "guard: the envelope close re-ran the unit");
  assert.ok(r.inAxisBand, "guard: the re-run added the record to its axis band");
  assert.deepEqual(r.ev2.filter((e) => e.event === "named-band-remerged").map((e) => e.why), ["envelope"]);
  assert.ok(r.inNamedBand && r.floorInShape, "the record the envelope close found is not in the named band and its shape");
  assert.ok(r.duty.rows.some((f) => f.record_id === ADDED && f.disposition === "unanswered"), "the repeated pass's floor does not count the record");
  assert.equal(r.verdict.verdict, "CONDITIONAL");
});
