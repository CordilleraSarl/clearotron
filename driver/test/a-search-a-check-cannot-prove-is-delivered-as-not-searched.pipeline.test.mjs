// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives a mock pipeline whose register band no ledger call evidences, on both engines
//
// A SEARCH A CHECK CANNOT PROVE RAN IS DELIVERED AS NOT SEARCHED, NEVER AS CLEAN (874).
//
// A band check whose recovery was spent ended the run with the stop notice, though the run held every other slice.
// Now the slices the check could not prove ran are recorded, taken out of the band and delivered as open rows: the
// plan join files each as deferred with its shipped reason, the coverage form gives it a row the write-up may not
// call clean, the verdict is held off CLEAR over it, the workbook carries the shipped "Register" row, and the page
// chips none of their territories "Nothing found". Every mark and owner is invented.
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
import { slicesNotYetRecorded } from "../parts-not-completed.mjs";
import { plainDeferralReason } from "../deferral-row.mjs";
import { planTerritoriesOf } from "../publish/search-depth.mjs";
import { renderHtml } from "../publish/render.mjs";
import { parseReport } from "../publish/parse.mjs";

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

const JOB = { id: "test-job-unproven-band", msgId: "<unproven-band@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8194", markName: "ORBANTIQ", classes: [9, 41], provider: "corsearch" };
const ENGINES = {
  claude: { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE },
  codex: { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" },
};
const KEYS = ["CLEAROTRON_CLAUDE_PATH", "CLEAROTRON_CODEX_PATH", "CLEAROTRON_AI_BILLING", "CODEX_API_KEY", "MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE",
  "CLEAROTRON_BAND_TRUTH_GATE", "CLEAROTRON_REGISTER_CALL_LOG", "MOCK_PLAN_DROP_QID", "MOCK_PLAN_DROP_STICKY"];
const NOT_VERIFIED = plainDeferralReason("not-verified-closed");
const NOT_COMPLETED = "it could not be completed this run, so it is left open here rather than reported as clean";

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
  test(`${engine}: a band no ledger call evidences is taken out slice by slice, and the run delivers the rest with the slices open`, async () => {
    const root = tempDir("clearotron-unproven-band-");
    // The ledger exists and holds no call, so every band the mock wrote reads as authored; no executor lane rebuilds it.
    const ledger = join(root, "calls.jsonl");
    writeFileSync(ledger, "");
    const knobs = { CLEAROTRON_BAND_TRUTH_GATE: "1", CLEAROTRON_REGISTER_CALL_LOG: ledger, CLEAROTRON_REGISTER_GAP_CLAMP: "1" };
    const p1 = await runPass(root, engine, knobs);
    assert.equal(p1.postponed, true, `pass 1 did not park: ${JSON.stringify(p1).slice(0, 300)}`);
    const ev1 = events(p1.runDir);
    const gated = [...new Set(ev1.filter((e) => e.event === "band-truth-gate").map((e) => e.axis))];
    assert.ok(gated.length > 0, "guard: the band-truth gate never fired, so this proves nothing");
    const routed = ev1.filter((e) => e.event === "part-not-completed");
    assert.deepEqual(routed.map((e) => [e.part, e.stage]), [["searches", "fan-in"]], "every unproven band was not taken in one park");
    const record = json(driverDir(p1.runDir, "not-completed", "searches.json"));
    assert.deepEqual([...new Set(record.slices.map((s) => s.axis))].sort(), [...gated].sort(), "the record does not hold every gated axis");
    assert.ok(record.slices.every((s) => s.reason === NOT_VERIFIED), "a slice was recorded without the shipped reason");

    const p2 = await runPass(root, engine, knobs, p1.codename);
    assert.equal(p2.ok, true, `the run did not deliver: ${JSON.stringify(p2).slice(0, 300)}`);
    const rd = p2.runDir;
    assert.ok(!existsSync(join(rd, ".failed")), "a delivered run carries a failure");
    const qids = new Set(record.slices.map((s) => s.qid));
    // Each slice is the executor's own deferred block, with the shipped reason, and the band as it was is kept.
    for (const axis of gated) {
      const band = json(join(rd, "register-units", `${axis}-band.json`));
      const taken = band.filter((b) => qids.has(b.qid));
      assert.ok(taken.length > 0 && taken.every((b) => b.error === true && b.deferred === true && b.reason === NOT_VERIFIED && (b.sample ?? []).length === 0),
        `${axis}: a slice was not taken out as a deferred block: ${JSON.stringify(taken.slice(0, 2))}`);
      assert.ok(existsSync(join(rd, "register-units", `${axis}-band.json.before-taken-out`)), `${axis}: the band as it was is not kept`);
    }
    // The plan join files each as deferred with its reason; the axis reads deferred; the form gives each an open row.
    // None of them reads as searched or as never reaching the register. Each the join files as deferred carries the
    // shipped reason; a child the plan runs only once its parent enumerates is skipped, marked as the parent having
    // erred; a block the plan never named is unplanned.
    const receipt = json(driverDir(rd, "plan-execution.json"));
    assert.deepEqual((receipt.executed ?? []).filter((x) => qids.has(x.qid)).map((x) => x.qid), [], "a slice taken out reads as searched");
    assert.deepEqual((receipt.missing ?? []).filter((q) => qids.has(q)), [], "a slice taken out reads as never reaching the register");
    const deferredTaken = (receipt.deferred ?? []).filter((d) => qids.has(d.qid));
    assert.ok(deferredTaken.length > 0, "guard: no slice taken out was filed as deferred");
    assert.deepEqual(deferredTaken.filter((d) => d.reason !== NOT_VERIFIED), [], "a slice taken out is deferred without its reason");
    assert.deepEqual((receipt.skipped ?? []).filter((x) => qids.has(x.qid) && x.parent_error !== true), [], "a skipped child reads as its parent having crowded");
    // An axis with a slice filed as deferred reads deferred. A waiting family's slices await the reading turn's judgment
    // whatever their blocks say, and that state is never clean either.
    const deferredAxes = new Set(record.slices.filter((s) => deferredTaken.some((d) => d.qid === s.qid)).map((s) => s.axis));
    assert.ok(deferredAxes.size > 0, "guard: no axis has a slice filed as deferred");
    for (const axis of deferredAxes)
      assert.equal(receipt.skeleton.find((s) => s.axis === axis)?.state, "deferred", `${axis}: the axis does not read deferred`);
    const form = json(driverDir(rd, "register-coverage-form.form.json"));
    const rows = (form.rows ?? []).filter((r) => qids.has(r.qid));
    assert.ok(rows.length > 0 && rows.every((r) => r.open === true && r.status !== "confirmed-clean"), `a slice's form row could be read as clean: ${JSON.stringify(rows.slice(0, 2))}`);
    // Nothing of a slice taken out is counted as read.
    const merged = json(join(rd, "register-named-band.json"));
    const mergedRows = [...(merged.enumerated ?? []), ...(merged.crowds ?? [])].filter((b) => qids.has(b?.qid) && (b.records ?? b.sample ?? []).length);
    assert.deepEqual(mergedRows, [], "the merged band still carries a record of a slice taken out");
    // No territory a slice taken out covers is chipped "Nothing found".
    const open = new Set(planTerritoriesOf(json(driverDir(rd, "register-plan.json")), receipt)?.open ?? []);
    const regions = json(driverDir(rd, "register-plan.json")).entries.filter((e) => qids.has(e.qid)).flatMap((e) => e.regions ?? []);
    assert.deepEqual(regions.filter((r) => !open.has(r)), [], "a territory a slice taken out covers would be chipped Nothing found");
    // The verdict is held off CLEAR over the open slices, and the workbook carries the shipped Register row.
    assert.notEqual(p2.verdict, "CLEAR", "the verdict stayed CLEAR over slices nobody searched");
    assert.ok(events(rd).some((e) => e.event === "coverage-floor-clamp"), "the clamp did not hold the verdict");
    const row = json(driverDir(rd, "degraded-parts.json")).rows.find((r) => /(^|\/ )Register$/.test(r.area));
    assert.match(row?.note ?? "", /it could not be completed this run, so it is left open here rather than reported as clean$/, "the workbook's row is not the shipped gap row");
  });
}

const NOT_LANDED = plainDeferralReason("slice-not-landed");
for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: a planned slice that never reached the register is added to the band open, and the run delivers the rest`, async () => {
    const root = tempDir("clearotron-not-landed-");
    // The slice's block never lands, and its follow-up does not land it either.
    const knobs = { CLEAROTRON_BAND_TRUTH_GATE: "0", CLEAROTRON_REGISTER_GAP_CLAMP: "1", MOCK_PLAN_DROP_QID: "+merch", MOCK_PLAN_DROP_STICKY: "1" };
    try {
      const p1 = await runPass(root, engine, knobs);
      assert.equal(p1.postponed, true, `pass 1 did not park: ${JSON.stringify(p1).slice(0, 300)}`);
      const routed = events(p1.runDir).filter((e) => e.event === "part-not-completed");
      assert.deepEqual(routed.map((e) => [e.part, e.stage]), [["searches", "fan-in"]], "the slice was not taken in one park");
      const record = json(driverDir(p1.runDir, "not-completed", "searches.json"));
      assert.ok(record.slices.length > 0 && record.slices.every((x) => x.qid.endsWith("+merch") && x.reason === NOT_LANDED),
        `the record does not hold the slice that never landed, with its reason: ${JSON.stringify(record.slices)}`);
      const p2 = await runPass(root, engine, knobs, p1.codename);
      assert.equal(p2.ok, true, `the run did not deliver: ${JSON.stringify(p2).slice(0, 300)}`);
      const receipt = json(driverDir(p2.runDir, "plan-execution.json"));
      const qids = new Set(record.slices.map((x) => x.qid));
      assert.deepEqual((receipt.missing ?? []).filter((q) => qids.has(q)), [], "the slice still reads as missing");
      assert.deepEqual((receipt.deferred ?? []).filter((d) => qids.has(d.qid)).map((d) => d.reason), record.slices.map(() => NOT_LANDED),
        "the slice is not deferred with its reason");
      const band = json(join(p2.runDir, "register-units", `${record.slices[0].axis}-band.json`));
      assert.ok(record.slices.every((x) => band.some((b) => b.qid === x.qid && b.error === true && b.deferred === true)), "the slice was not added to its band as a deferred block");
      assert.notEqual(p2.verdict, "CLEAR", "the verdict stayed CLEAR over a slice nobody searched");
    } finally { delete process.env.MOCK_PLAN_DROP_STICKY; }
  });
}

test("the reason codes the band's checks name render as the shipped sentences, never as a code", () => {
  assert.equal(plainDeferralReason("collapsed-slice"), NOT_COMPLETED, "a collapsed slice's code did not render the shipped sentence");
  assert.equal(NOT_VERIFIED, "nothing in the run's own record confirms it was searched, so it is left open rather than assumed done");
});

test("the searches' record grows only by slices it does not hold, so a failure naming none new ends the run", () => {
  const held = { slices: [{ axis: "primary-sweep", qid: "q1", reason: NOT_VERIFIED }] };
  assert.deepEqual(slicesNotYetRecorded(held, [{ axis: "primary-sweep", qid: "q1", reason: NOT_VERIFIED }]), [], "a slice held was added again");
  assert.deepEqual(slicesNotYetRecorded(held, [{ axis: "primary-sweep", qid: "q2", reason: NOT_VERIFIED }, { axis: "primary-sweep", qid: "q2", reason: NOT_VERIFIED }]),
    [{ axis: "primary-sweep", qid: "q2", reason: NOT_VERIFIED }], "a new slice was not added once");
  assert.deepEqual(slicesNotYetRecorded(null, [{ qid: "q3" }, { axis: "primary-sweep" }]), [], "a slice with no axis or no qid was recorded");
});

test("a territory a deferred slice covers is open, and the page chips none of them Nothing found", () => {
  const plan = { entries: [{ qid: "a", regions: ["JP", "KR"] }, { qid: "b", regions: ["FR"] }] };
  assert.deepEqual(planTerritoriesOf(plan), { searched: ["JP", "KR", "FR"], unreached: [] }, "a run with no receipt changed shape");
  assert.deepEqual(planTerritoriesOf(plan, { deferred: [] }), { searched: ["JP", "KR", "FR"], unreached: [] }, "nothing deferred added an open list");
  const territories = planTerritoriesOf(plan, { deferred: [{ qid: "a", reason: NOT_VERIFIED }] });
  assert.deepEqual(territories.open, ["JP", "KR"]);
  const depth = { counts: { recordsByCountry: { JP: 3, KR: 1, FR: 2 }, courtDecisions: "not-in-scope" } };
  const dir = tempDir("clearotron-open-chips-");
  writeFileSync(join(dir, "f.report.md"), ["---", "type: clearance-clearance", "matter: TMP8194", "title: ORBANTIQ",
    "overall_label: LOW", "overall_badge: l1", "overall_caption: low overall.", "classes: 9 · 41", "jurisdiction: Japan, Korea and France",
    "run: 2026-10-22", "---", "", "# Marks", ""].join("\n"));
  const parsed = parseReport(join(dir, "f.report.md"));
  // Read inside the section's own panel, as the render arms do: the page draws chips elsewhere too.
  const chips = (html) => {
    const i = html.indexOf('class="panel where"');
    const j = i === -1 ? -1 : html.indexOf('<div class="sec"', i);
    const panel = i === -1 ? "" : (j === -1 ? html.slice(i) : html.slice(i, j));
    return [...panel.matchAll(/<span class="wchip" title="([^"]*)">/g)].map((m) => m[1]);
  };
  const before = chips(renderHtml(parsed, [], [], { searchDepth: depth, planTerritories: { searched: ["JP", "KR", "FR"], unreached: [] } }));
  assert.equal(before.length, 3, `premise: every country is chipped with nothing open: ${JSON.stringify(before)}`);
  const withOpen = chips(renderHtml(parsed, [], [], { searchDepth: depth, planTerritories: territories }));
  assert.equal(withOpen.length, 1, `a country a deferred slice covers was chipped Nothing found: ${JSON.stringify(withOpen)}`);
  assert.ok(!before.every((c) => withOpen.includes(c)), "the chips did not change with the open territories");
});

test("a slice taken out of the band keeps the axis's other blocks, and taking it out twice changes nothing", async () => {
  const { takeSlicesOutOfTheBand } = await import("../pipeline.mjs");
  const root = tempDir("clearotron-take-out-");
  mkdirSync(join(root, "register-units"), { recursive: true });
  const at = join(root, "register-units", "primary-sweep-band.json");
  const kept = { state: "enumerated", qid: "q-kept", query: "ORBANTIQ (exact)", total_hits: 1, fetched: 1, sample: [{ record_id: "/mark/em/1" }] };
  writeFileSync(at, JSON.stringify([kept, { state: "enumerated", qid: "q-out", query: "ORBANTIQ (fuzzy)", total_hits: 2, fetched: 2, sample: [{ record_id: "/mark/em/2" }] }]));
  const P = { registerBand: (axis) => join(root, "register-units", `${axis}-band.json`) };
  const slices = [{ axis: "primary-sweep", qid: "q-out", reason: NOT_VERIFIED }, { axis: "primary-sweep", qid: "q-never-ran", reason: NOT_VERIFIED }];
  assert.equal(takeSlicesOutOfTheBand(P, slices).length, 2);
  const band = json(at);
  assert.deepEqual(band[0], kept, "the axis's other block moved");
  assert.deepEqual(band.slice(1).map((b) => [b.qid, b.error, b.deferred, b.reason, b.query, b.sample.length]),
    [["q-out", true, true, NOT_VERIFIED, "ORBANTIQ (fuzzy)", 0], ["q-never-ran", true, true, NOT_VERIFIED, "q-never-ran", 0]]);
  assert.ok(readFileSync(`${at}.before-taken-out`, "utf8").includes("/mark/em/2"), "the band as it was is not kept");
  assert.equal(takeSlicesOutOfTheBand(P, slices).length, 0, "a slice already taken out was taken out again");
});
