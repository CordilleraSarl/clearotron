// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives a mock pipeline whose register unit writes no result, on both engines
//
// A REGISTER SEARCH THAT CANNOT FINISH IS DELIVERED AS NOT SEARCHED, NEVER AS THE END OF THE RUN.
//
// A register unit that wrote no result once its attempts were spent ended the run with no report, though the run held
// every other unit. Now the unit and the planned slices its band never reached are recorded as the searches not
// completed. The resumed pass takes the unit as its band stands, without sending it again, and delivers: each slice is a
// deferred block with the shipped reason, none reads as searched, and the verdict is held off CLEAR. Every mark and
// owner is invented.
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
import { mkdtempSync as __mkdtemp } from "node:fs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "clearotron-testroot-")));
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { plainDeferralReason } from "../deferral-row.mjs";

const TEMP_DIRS = [];
after(() => { for (const d of TEMP_DIRS) rmSync(d, { recursive: true, force: true }); });
const tempDir = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); TEMP_DIRS.push(d); return d; };
const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
const CODEX = join(HERE, "mock-codex.mjs");
chmodSync(CLAUDE, 0o755);
chmodSync(CODEX, 0o755);
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
// The mock writes its bands without a register call behind them, which is not what this file is about.
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const JOB = { id: "test-job-unit-cannot-finish", msgId: "<unit-cannot-finish@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8204", markName: "QUILVANTE", classes: [9, 42], provider: "corsearch" };
const ENGINES = {
  claude: { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE },
  codex: { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" },
};
const KEYS = ["CLEAROTRON_CLAUDE_PATH", "CLEAROTRON_CODEX_PATH", "CLEAROTRON_AI_BILLING", "CODEX_API_KEY", "MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE",
  "CLEAROTRON_REGISTER_GAP_CLAMP"];
const AXIS = "primary-sweep";
// Only this unit's own dispatch names its band as the band artifact, so only its turns fail.
const FAIL_UNIT = `BAND ARTIFACT&&register-units/${AXIS}-band.json`;
const NOT_LANDED = plainDeferralReason("slice-not-landed");

async function runPass(root, engine, knobs = {}, codename = null) {
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries({ ...ENGINES[engine], CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", ...knobs }))
    pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  return pipeline({ ...JOB }, codename ? { codename } : {});
}
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const events = (runDir) => readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: a register unit that writes no result is delivered as not searched, and is not sent again`, async () => {
    const root = tempDir("clearotron-unit-cannot-finish-");
    const knobs = { MOCK_FAIL_STAGE: FAIL_UNIT, CLEAROTRON_REGISTER_GAP_CLAMP: "1" };
    const p1 = await runPass(root, engine, knobs);
    assert.equal(p1.postponed, true, `pass 1 did not park: ${JSON.stringify(p1).slice(0, 300)}`);
    const ev1 = events(p1.runDir);
    const routed = ev1.filter((e) => e.event === "part-not-completed");
    assert.deepEqual(routed.map((e) => [e.part, e.stage]), [["searches", `register-unit:${AXIS}`]], "the unit was not recorded as the searches not completed");
    const record = json(driverDir(p1.runDir, "not-completed", "searches.json"));
    assert.deepEqual(record.unfinished_units, [AXIS], "the record does not name the unit");
    assert.ok((record.slices ?? []).length > 0, "guard: the record holds no slice, so this proves nothing about delivering them");
    assert.ok(record.slices.every((s) => s.axis === AXIS && s.reason === NOT_LANDED), `a slice was recorded off the axis or without the shipped reason: ${JSON.stringify(record.slices.slice(0, 2))}`);
    const attempts1 = ev1.filter((e) => e.event === "attempt" && e.stage === `register-unit:${AXIS}`).length;
    assert.ok(attempts1 > 0, "guard: the unit was never sent on pass 1");

    const p2 = await runPass(root, engine, knobs, p1.codename);
    assert.equal(p2.ok, true, `the run did not deliver: ${JSON.stringify(p2).slice(0, 300)}`);
    const rd = p2.runDir;
    assert.ok(!existsSync(join(rd, ".failed")), "a delivered run carries a failure");
    const ev2 = events(rd);
    // The resumed pass takes the unit as its band stands: one delivery line for it, and not one more attempt.
    assert.equal(ev2.filter((e) => e.event === "unit-not-completed-delivery" && e.stage === `register-unit:${AXIS}`).length, 1, "the unit was not taken as it stands");
    assert.equal(ev2.filter((e) => e.event === "attempt" && e.stage === `register-unit:${AXIS}`).length, attempts1, "the unit was sent again on the pass that delivers");
    assert.equal(ev2.filter((e) => e.event === "part-not-completed").length, 1, "the searches were recorded again");
    assert.match(readFileSync(join(rd, "register-units", `${AXIS}.md`), "utf8"), new RegExp(`^# Register unit — ${AXIS}\\n`), "the unit's note is not the driver's account of its band");
    // Each recorded slice is the executor's own deferred block with the shipped reason; none reads as searched or as missing.
    const qids = new Set(record.slices.map((s) => s.qid));
    const receipt = json(driverDir(rd, "plan-execution.json"));
    assert.deepEqual((receipt.executed ?? []).filter((x) => qids.has(x.qid)).map((x) => x.qid), [], "a slice never reached reads as searched");
    assert.deepEqual((receipt.missing ?? []).filter((q) => qids.has(q)), [], "a slice never reached is still missing");
    const deferred = (receipt.deferred ?? []).filter((d) => qids.has(d.qid));
    assert.equal(deferred.length, qids.size, `a slice never reached is not deferred: ${deferred.length} of ${qids.size}`);
    assert.deepEqual(deferred.filter((d) => d.reason !== NOT_LANDED), [], "a slice is deferred without the shipped reason");
    assert.notEqual(p2.verdict, "CLEAR", "the verdict stayed CLEAR over slices nobody searched");
  });
}

test("the searches' record grows by a unit it does not list yet", async () => {
  const { unitsNotYetRecorded } = await import("../parts-not-completed.mjs");
  assert.deepEqual(unitsNotYetRecorded(null, [AXIS, AXIS, ""]), [AXIS]);
  assert.deepEqual(unitsNotYetRecorded({ unfinished_units: [AXIS] }, [AXIS]), [], "a unit listed was added again");
  assert.deepEqual(unitsNotYetRecorded({ unfinished_units: [AXIS] }, [AXIS, "incumbent-class"]), ["incumbent-class"]);
});

test("the slices a unit never reached are the planned ones its band holds no block for, a timed-out one excepted", async () => {
  const { slicesUnitNeverReached } = await import("../pipeline.mjs");
  const root = tempDir("clearotron-never-reached-");
  mkdirSync(join(root, "register-units"), { recursive: true });
  const P = { registerBand: (axis) => join(root, "register-units", `${axis}-band.json`) };
  const plan = { entries: [{ axis: AXIS, qid: "q-answered" }, { axis: AXIS, qid: "q-timed-out" }, { axis: AXIS, qid: "q-never" },
    { axis: AXIS, qid: "q-child", when: { runs_if_enumerated: "q-never" } }, { axis: "incumbent-class", qid: "q-other" }] };
  assert.deepEqual(slicesUnitNeverReached(P, plan, AXIS).map((s) => s.qid), ["q-answered", "q-timed-out", "q-never"], "with no band, every unguarded planned slice was never reached");
  writeFileSync(P.registerBand(AXIS), JSON.stringify([{ qid: "q-answered", state: "enumerated" },
    { qid: "q-timed-out", state: "incomplete", error: true, deferred: true, gateway_timeout: true }]));
  const never = slicesUnitNeverReached(P, plan, AXIS);
  assert.deepEqual(never, [{ axis: AXIS, qid: "q-never", reason: NOT_LANDED }], "a slice with a block was counted as never reached");
});
