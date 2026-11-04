// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the pre-delivery goods repair end to end on the mock pipeline, with invented names
//
// THE GOODS REPAIR REACHES THE TEXT A GROUPED FINDING DISPLAYS.
//
// A finding written on goods the register cut is named at the delivery check once the run holds that record whole, and
// the writer's one repair is handed the complete statements. Under a delivery fold, a second filing of one conflict joins
// the first: the delivered finding is the object of the member the fold kept, carrying every member's citations. So the
// sentence the report displays and the citation of the record can come from different members, and a line naming only
// the citing member left the displayed sentence as it was. The line names both: the member whose text the report
// displays, for the claim, and the member that cites the record, for its goods comparison. Where one member is both, the
// single-finding line is handed. A record is handed to the repair once: the check after it, and the check of a resumed
// run, say what became of the claim instead.
//
// Each test ends at the delivered report, built from the record the fold made again after the writer's correction, and at
// the run's own record of the outcome.
//
// The scenario, from mock knobs: three findings, the second a second filing of the first (MOCK_FINDINGS_N,
// MOCK_FINDINGS_TWIN), so the fold delivers two. One record's band row carries its class 9 statement cut by the register
// (MOCK_BAND_GOODS_CUT), and after the writer's save the run's record log holds that record's whole body
// (MOCK_RECORD_GOODS_WHOLE). The writer's finding 1 says its class 9 goods list is cut and unread (MOCK_GOODS_CUT_CLAIM).
// The writer's delivery-check repair removes that sentence from the finding its line names for the claim, or saves its
// record again as it stands (MOCK_GOODS_REPAIR). A third filing and a second citation (MOCK_FINDINGS_TWIN=2,3,
// MOCK_FINDING_ALSO_CITES) give one record two citing members.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { claimsGoodsCut } from "../predelivery-lint.mjs";
import { recordGoods } from "../record-goods.mjs";
import { synthesisFindings, GOODS_STATEMENT_WHOLE, GOODS_CUT_CLAIM } from "./mock-stage-fixtures.mjs";

const TEMP_DIRS = [];
const tempDir = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); TEMP_DIRS.push(d); return d; };
after(() => { for (const d of TEMP_DIRS) rmSync(d, { recursive: true, force: true }); });

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const JOB = {
  id: "test-job", msgId: "<test@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8441", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};
const MOCK_KNOBS = ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FINDINGS_N", "MOCK_FINDINGS_TWIN", "MOCK_FINDING_ALSO_CITES", "MOCK_BAND_GOODS_CUT",
  "MOCK_RECORD_GOODS_WHOLE", "MOCK_GOODS_CUT_CLAIM", "MOCK_GOODS_REPAIR", "MOCK_FAIL_STAGE"];
const SCENARIO = { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FINDINGS_N: "3", MOCK_FINDINGS_TWIN: "2",
  MOCK_GOODS_CUT_CLAIM: "1", MOCK_GOODS_REPAIR: "correct" };
// The record whose band row the register cut and whose whole body the run holds by the delivery check.
const cutThenHeld = (uri) => ({ MOCK_BAND_GOODS_CUT: uri, MOCK_RECORD_GOODS_WHOLE: uri });
const FIRST = "/mark/us/90000001", SECOND = "/mark/us/90000002", THIRD = "/mark/us/90000003";

async function runPipeline(knobs, root = tempDir("clearotron-goods-fold-")) {
  for (const k of MOCK_KNOBS) delete process.env[k];
  for (const [k, v] of Object.entries({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", ...knobs })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB });
  return { res, root, events: readEvents(res.runDir) };
}
const readEvents = (runDir) => readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

// The two lines the writer's repair is handed, in the words the delivery check composes them in.
const STATEMENTS = `Class 9: "${GOODS_STATEMENT_WHOLE}"`;
const groupedLine = (shown, citing, uri) => `The displayed goods-text claim comes from finding ${shown}. The grouped finding cites ${uri} through finding ${citing}. `
  + `The run now holds these complete goods statements from that register record: ${STATEMENTS}. `
  + `Correct the claim in finding ${shown} where these statements resolve it. Reassess finding ${citing}'s goods comparison only where those statements affect it. `
  + "Change a rating only if the evidence requires it. Preserve unrelated findings and update only conclusions that depend on these changes.";
const singleLine = (ordinal, uri) => `Finding ${ordinal} cites ${uri}. Its earlier goods evidence was cut by the register. `
  + `The run now holds these complete goods statements from the register record: ${STATEMENTS}. `
  + "Reassess this finding's goods comparison on those statements, and correct any claim that they remain cut or unread. Change its rating only if the evidence requires it.";

// The writer's delivery-check repairs, as dispatched: every synthesis dispatch the run kept, earlier ones included.
const writersRepairs = (runDir) => readdirSync(driverDir(runDir)).filter((f) => f.startsWith("synthesis.attempt") && f.includes(".dispatch.txt"))
  .map((f) => readFileSync(driverDir(runDir, f), "utf8"))
  .filter((m) => m.includes("The deterministic pre-delivery checks found these faults in content rendered from that record"));
// The writer's record in its own numbering: as accepted just before its delivery-check repair, and as it stands.
const saved = (runDir, name) => JSON.parse(readFileSync(driverDir(runDir, "synthesis-calls", name), "utf8")).params.findings.findings;
const cites = (f, uri) => (f?.owner?.registrations ?? []).some((r) => r?.uri === uri);
const evidenceOf = (runDir, uri) => {
  const row = JSON.parse(readFileSync(driverDir(runDir, "goods-evidence.json"), "utf8")).records.find((r) => r.uri === uri);
  return [row?.source, row?.state];
};
// The goods of the last body the run's record log holds for the record, as the shared reader reads them.
const heldGoods = (runDir, uri) => {
  const rows = readFileSync(driverDir(runDir, "register-record-bodies.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
    .filter((r) => r.target === uri);
  return rows.length ? recordGoods(rows.at(-1).body) : null;
};
const WHOLE = [{ classes: ["9"], text: GOODS_STATEMENT_WHOLE }];
const foldOf = (runDir) => {
  const fold = JSON.parse(readFileSync(driverDir(runDir, "fold.json"), "utf8"));
  return [fold.merges, fold.map?.foldedToModel];
};
const delivered = (runDir) => JSON.parse(readFileSync(join(runDir, "findings.json"), "utf8")).findings;
// The `- net:` line of one finding's card in report.md: the sentence the report displays for it.
const netLineOf = (runDir, ordinal) => readFileSync(join(runDir, "report.md"), "utf8").split(/^## /m)
  .find((card) => card.split("\n").includes(`- ord: ${ordinal}`))?.split("\n").find((l) => l.startsWith("- net: ")) ?? null;
const published = (root, runDir) => {
  const { runId } = JSON.parse(readFileSync(join(runDir, "status.json"), "utf8"));
  return readFileSync(join(root, "pool", runId, "report.html"), "utf8");
};
// The findings the delivery check first named for goods the run now holds whole. A check of another family is not this
// test's subject: a member citing two records of one family also owes the senior-right check a fetch of the older one,
// which fails offline, and that flag no repair takes.
const goodsNamed = (events) => (events.find((e) => e.event === "predelivery-lint-failed")?.failures ?? []).filter((id) => id.startsWith("goods-held-whole"));
const handed = (events) => events.filter((e) => e.event === "goods-held-whole-handed").map((e) => e.records);
const outcome = (events) => events.filter((e) => e.event === "goods-held-whole").at(-1);
const goodsRepairs = (events) => events.filter((e) => e.event === "stage" && e.stage === "synthesis" && e.trigger === "lint-repair");
const CORRECTED = "1 finding(s) given complete goods statements by the delivery repair no longer say their goods are cut or unread; 0 still do";

test("a grouped finding whose displayed claim and citation come from different members is corrected where the report displays it", async () => {
  const { res, root, events } = await runPipeline({ ...SCENARIO, ...cutThenHeld(SECOND) });
  // CONTROLS — the scenario is the one described, or the claims below prove nothing.
  assert.deepEqual(evidenceOf(res.runDir, SECOND), ["search-row", "cut"], "the run did not record the second filing's goods as cut by the register");
  assert.deepEqual(heldGoods(res.runDir, SECOND), WHOLE, "the run does not hold the second filing's goods whole");
  assert.deepEqual(foldOf(res.runDir), [[{ kept: 1, dropped: [2] }], { 1: [1, 2], 2: [3] }],
    "the fold did not keep the writer's finding 1 and join its second filing to it");
  const before = saved(res.runDir, "accepted-before-repair.json");
  assert.deepEqual(before.filter((f) => f.net.includes(GOODS_CUT_CLAIM)).map((f) => f.ordinal), [1], "the claim is not member 1's alone");
  assert.deepEqual(before.filter((f) => cites(f, SECOND)).map((f) => f.ordinal), [2], "the record is not cited by member 2 alone");
  assert.deepEqual(goodsNamed(events), [`goods-held-whole:1:${SECOND}`], "the delivery check did not name delivered finding 1 for that record alone");

  // THE CLAIMS. The writer's repair names member 1 for the claim and member 2 for the citation.
  const repairs = writersRepairs(res.runDir);
  assert.equal(repairs.length, 1, `the writer was sent ${repairs.length} delivery-check repairs`);
  assert.ok(repairs[0].split("\n").includes(`- ${groupedLine(1, 2, SECOND)}`), "the writer's repair does not name both members");
  // The record the fold made again from the correction, and the report built from it.
  const now = delivered(res.runDir);
  assert.deepEqual(now.map((f) => f.ordinal), [1, 2], "the correction unfolded the delivered record");
  const one = now.find((f) => f.ordinal === 1);
  assert.deepEqual(one.owner.registrations.map((r) => r.uri), [FIRST, SECOND], "delivered finding 1 does not hold both filings");
  assert.equal(claimsGoodsCut(one), false, "delivered finding 1 still says its goods are cut or unread");
  assert.equal(netLineOf(res.runDir, 1), `- net: ${one.net}`, "finding 1's card does not display its corrected sentence");
  assert.ok(!readFileSync(join(res.runDir, "report.md"), "utf8").includes(GOODS_CUT_CLAIM), "the delivered report still displays the claim");
  assert.ok(!published(root, res.runDir).includes(GOODS_CUT_CLAIM), "the published report still displays the claim");
  // The run's record of the outcome.
  assert.deepEqual(handed(events), [[SECOND]], "the record was not handed to the repair exactly once");
  assert.deepEqual(outcome(events)?.unresolved, [], "the check after the repair still finds the claim");
  assert.equal(outcome(events)?.summary, CORRECTED);
  // What the line did not ask to change: member 2, named for its goods comparison only, and finding 3, not named at all.
  const after = saved(res.runDir, "accepted.json");
  assert.deepEqual(after.filter((f) => f.ordinal !== 1), before.filter((f) => f.ordinal !== 1), "the repair changed a finding the line did not ask it to");
  const [was, is] = [before, after].map((list) => list.find((f) => f.ordinal === 1));
  assert.deepEqual({ ...is, net: null }, { ...was, net: null }, "the repair changed finding 1 beyond its sentence");
  assert.equal(is.net, was.net.replace(` ${GOODS_CUT_CLAIM}`, ""), "the repair did not remove the claim alone");
  assert.equal(res.ok, true, JSON.stringify(res));
});

test("a grouped finding whose kept member cites the record itself is handed the single-finding line", async () => {
  const { res, events } = await runPipeline({ ...SCENARIO, ...cutThenHeld(FIRST) });
  // CONTROLS — the record is the kept member's own, and that member says its goods are cut.
  assert.deepEqual(evidenceOf(res.runDir, FIRST), ["search-row", "cut"], "the run did not record finding 1's goods as cut by the register");
  assert.deepEqual(heldGoods(res.runDir, FIRST), WHOLE, "the run does not hold finding 1's record whole");
  assert.deepEqual(foldOf(res.runDir), [[{ kept: 1, dropped: [2] }], { 1: [1, 2], 2: [3] }], "the fold did not keep the writer's finding 1");
  const before = saved(res.runDir, "accepted-before-repair.json");
  assert.deepEqual(before.filter((f) => f.net.includes(GOODS_CUT_CLAIM)).map((f) => f.ordinal), [1], "the claim is not member 1's alone");
  assert.deepEqual(before.filter((f) => cites(f, FIRST)).map((f) => f.ordinal), [1], "the record is not cited by member 1 alone");
  assert.deepEqual(goodsNamed(events), [`goods-held-whole:1:${FIRST}`], "the delivery check did not name delivered finding 1 for that record alone");

  // THE CLAIMS.
  const repairs = writersRepairs(res.runDir);
  assert.equal(repairs.length, 1, `the writer was sent ${repairs.length} delivery-check repairs`);
  const lines = repairs[0].split("\n");
  assert.ok(lines.includes(`- ${singleLine(1, FIRST)}`), "the writer's repair does not carry the single-finding line naming finding 1");
  assert.ok(!lines.some((l) => l.includes("The displayed goods-text claim comes from")), "one member was named as two");
  const one = delivered(res.runDir).find((f) => f.ordinal === 1);
  assert.equal(claimsGoodsCut(one), false, "delivered finding 1 still says its goods are cut or unread");
  assert.equal(netLineOf(res.runDir, 1), `- net: ${one.net}`, "finding 1's card does not display its corrected sentence");
  assert.deepEqual(handed(events), [[FIRST]]);
  assert.equal(outcome(events)?.summary, CORRECTED);
  assert.equal(res.ok, true, JSON.stringify(res));
});

test("where more than one member cites the record, the line names the first of them after the kept member", async () => {
  // The record is the third filing's own and the second filing cites it too: the member named is the first in the
  // fold's order, not the one whose own record it is.
  const { res, events } = await runPipeline({ ...SCENARIO, MOCK_FINDINGS_TWIN: "2,3", MOCK_FINDING_ALSO_CITES: `2:${THIRD}`, ...cutThenHeld(THIRD) });
  // CONTROLS — three filings fold into one, and two members, neither of them the kept one, cite the record.
  assert.deepEqual(foldOf(res.runDir), [[{ kept: 1, dropped: [2, 3] }], { 1: [1, 2, 3] }], "the three filings did not fold into the writer's finding 1");
  const before = saved(res.runDir, "accepted-before-repair.json");
  assert.deepEqual(before.filter((f) => cites(f, THIRD)).map((f) => f.ordinal), [2, 3], "the record is not cited by members 2 and 3 only");
  assert.deepEqual(before.filter((f) => f.net.includes(GOODS_CUT_CLAIM)).map((f) => f.ordinal), [1], "the claim is not member 1's alone");
  assert.deepEqual(evidenceOf(res.runDir, THIRD), ["search-row", "cut"], "the run did not record the third filing's goods as cut by the register");
  assert.deepEqual(heldGoods(res.runDir, THIRD), WHOLE, "the run does not hold the third filing's goods whole");
  assert.deepEqual(goodsNamed(events), [`goods-held-whole:1:${THIRD}`], "the delivery check did not name delivered finding 1 for that record alone");

  // THE CLAIMS.
  const repairs = writersRepairs(res.runDir);
  assert.equal(repairs.length, 1, `the writer was sent ${repairs.length} delivery-check repairs`);
  assert.ok(repairs[0].split("\n").includes(`- ${groupedLine(1, 2, THIRD)}`), "the writer's repair does not name member 1 for the claim and member 2 for the citation");
  const now = delivered(res.runDir);
  assert.deepEqual(now.map((f) => f.ordinal), [1], "the correction unfolded the delivered record");
  assert.equal(claimsGoodsCut(now[0]), false, "delivered finding 1 still says its goods are cut or unread");
  assert.equal(netLineOf(res.runDir, 1), `- net: ${now[0].net}`, "finding 1's card does not display its corrected sentence");
  assert.equal(outcome(events)?.summary, CORRECTED);
  assert.equal(res.ok, true, JSON.stringify(res));
});

test("a claim the writer leaves standing is kept as unresolved and displayed, and the record is not handed again", async () => {
  const { res, root, events } = await runPipeline({ ...SCENARIO, ...cutThenHeld(SECOND), MOCK_GOODS_REPAIR: "ignore" });
  // CONTROLS — the first test's scenario and line, and a writer that saved its record as it stood.
  assert.deepEqual(evidenceOf(res.runDir, SECOND), ["search-row", "cut"], "the run did not record the second filing's goods as cut by the register");
  assert.deepEqual(heldGoods(res.runDir, SECOND), WHOLE, "the run does not hold the second filing's goods whole");
  assert.deepEqual(goodsNamed(events), [`goods-held-whole:1:${SECOND}`], "the delivery check did not name delivered finding 1 for that record alone");
  const repairs = writersRepairs(res.runDir);
  assert.equal(repairs.length, 1, `the writer was sent ${repairs.length} delivery-check repairs`);
  assert.ok(repairs[0].split("\n").includes(`- ${groupedLine(1, 2, SECOND)}`), "the writer's repair does not name both members");
  assert.deepEqual(saved(res.runDir, "accepted.json"), saved(res.runDir, "accepted-before-repair.json"), "the writer's repair changed its record");

  // THE CLAIMS.
  assert.equal(goodsRepairs(events).length, 1, "a second goods repair ran");
  assert.deepEqual(handed(events), [[SECOND]], "the record was not handed exactly once");
  assert.deepEqual(outcome(events)?.unresolved, [`1:${SECOND}`], "the claim left standing is not recorded as unresolved");
  const receipt = JSON.parse(readFileSync(driverDir(res.runDir, "predelivery-lint.json"), "utf8"));
  const row = receipt.checks.find((c) => c.id === `goods-held-whole-unresolved:1:${SECOND}`);
  assert.deepEqual([row?.pass, row?.structural], [false, true], "the delivered receipt does not carry the unresolved claim as a row no repair takes");
  assert.ok(!receipt.failures.some((id) => id.startsWith("goods-held-whole:")), "the record was named for a repair again");
  // What the corrected run's report no longer shows, this one still does.
  assert.ok(netLineOf(res.runDir, 1)?.includes(GOODS_CUT_CLAIM), "finding 1's card does not display the claim left standing");
  assert.ok(published(root, res.runDir).includes(GOODS_CUT_CLAIM), "the published report does not display the claim left standing");
  assert.equal(res.ok, true, JSON.stringify(res));
});

// THE RESUME. A run that delivered cannot be resumed, so the first pass stops after the repair: at the card rebuilt from
// the corrected record. That card's dispatch carries finding 1's record, which holds the second filing's registration,
// with its sentence as it reads once the claim is gone. Finding 1's earlier card carries the claim, and finding 2's card
// holds no second filing. The resume then finishes the run. One two-pass run serves both tests below.
let resumed = null;
const resumeAfterTheRepair = () => (resumed ??= (async () => {
  for (const k of MOCK_KNOBS) delete process.env[k];
  const baseNet = JSON.parse(synthesisFindings(null)).findings[0].net;
  const stop = ["record_report_card", SECOND, `"net": ${JSON.stringify(baseNet)},`].join("&&");
  const first = await runPipeline({ ...SCENARIO, ...cutThenHeld(SECOND), MOCK_FAIL_STAGE: stop });
  const pass1 = { ...first, delivered: existsSync(join(first.res.runDir, ".delivered")),
    evidence: evidenceOf(first.res.runDir, SECOND), held: heldGoods(first.res.runDir, SECOND) };
  delete process.env.MOCK_FAIL_STAGE;
  // A first pass that delivered leaves nothing to resume, and the controls below say so.
  if (pass1.delivered || first.res.ok) return { pass1, res: first.res, events: first.events, pass2: [] };
  const { codename } = JSON.parse(readFileSync(join(first.res.runDir, "status.json"), "utf8"));
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB }, { codename });
  const events = readEvents(res.runDir);
  const at = events.findIndex((e) => e.event === "start" && e.resume === true);
  return { pass1, res, events, pass2: at >= 0 ? events.slice(at) : [] };
})());

test("a resumed run does not hand the record again, and runs no second goods repair", async () => {
  const { pass1, res, events, pass2 } = await resumeAfterTheRepair();
  // CONTROLS — the first pass handed the record once and stopped after the repair, before delivery; the resume delivered.
  assert.deepEqual(pass1.evidence, ["search-row", "cut"], "the first pass did not record the second filing's goods as cut by the register");
  assert.deepEqual(pass1.held, WHOLE, "the first pass does not hold the second filing's goods whole");
  assert.deepEqual(goodsNamed(pass1.events), [`goods-held-whole:1:${SECOND}`], "the first pass's check did not name delivered finding 1");
  assert.deepEqual(handed(pass1.events), [[SECOND]], "the first pass did not hand the record");
  assert.ok(pass1.events.some((e) => e.event === "stage" && e.stage === "report-card:1" && e.trigger === "stale-repair" && e.fail === "nonzero_exit_1"),
    "the first pass did not stop at the card rebuilt from the corrected record");
  assert.deepEqual([pass1.res.ok, pass1.delivered], [false, false], "the first pass delivered, so nothing was resumed");
  assert.ok(pass2.length, "no resumed pass is in the run's record");
  assert.equal(res.ok, true, JSON.stringify(res));

  // THE CLAIMS, across both passes.
  assert.deepEqual(handed(events), [[SECOND]], "the resume handed the record again");
  assert.equal(goodsRepairs(events).length, 1, "the resume ran a second goods repair");
  assert.ok(!pass2.some((e) => e.event === "predelivery-lint-failed" && e.failures.some((id) => id.startsWith("goods-held-whole:"))),
    "the resumed check named the record for a repair again");
  assert.deepEqual(JSON.parse(readFileSync(driverDir(res.runDir, "goods-held-whole-handed.json"), "utf8")).records, [SECOND]);
});

// A KNOWN GAP, held as a todo until the check reads the evidence as the writer had it. A resumed pass derives
// goods-evidence.json again from the bodies the run holds by then, so the record no longer reads as the cut search answer
// the writer had, and the check finds no outcome for it.
test("a resumed run keeps the outcome of the record handed before it", {
  todo: "a resumed pass derives the goods evidence again from the bodies it holds, so the record handed no longer reads as the writer had it",
}, async () => {
  const { res, pass2 } = await resumeAfterTheRepair();
  // CONTROLS — delivered finding 1 still cites the record it was handed, and no longer says its goods are cut.
  const one = delivered(res.runDir).find((f) => f.ordinal === 1);
  assert.ok(cites(one, SECOND), "delivered finding 1 no longer cites the record");
  assert.equal(claimsGoodsCut(one), false, "delivered finding 1 still says its goods are cut or unread");
  // THE CLAIM: the resumed check sorts the outcome of the record handed before it, as corrected.
  const last = outcome(pass2);
  assert.ok(last, "the resumed pass recorded no goods outcome");
  assert.deepEqual(last.unresolved, []);
  assert.equal(last.summary, CORRECTED, "the resumed check did not keep the outcome of the record handed before it");
});
