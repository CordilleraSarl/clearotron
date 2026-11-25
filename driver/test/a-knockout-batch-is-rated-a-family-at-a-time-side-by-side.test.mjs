// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT BATCH IS RATED ONE FAMILY PER TURN, SIDE BY SIDE, at most eight turns at once; a name with no family is rated alone.
// Each group is its own turn and writes only its own chunk. The lane joins every group before it composes the record, and the
// composed batch is the whole batch's: its scope is the frozen plan's, and every group's batch-wide caveat is kept once. A group that
// fails leaves the others' accepted work, and a resume runs only what failed. Names here are invented.
import { mkdirSync, mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "ko-groups-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", join(ROOT, "work"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
pinEnv(process.env, "CLEAROTRON_DATABASE", "signa");
pinEnv(process.env, "CLEAROTRON_REGISTER_CALL_LOG", join(ROOT, "register-calls.jsonl"));
pinEnv(process.env, "CLEAROTRON_REGISTER_RECORD_LOG", undefined);
pinEnv(process.env, "CLEAROTRON_SIGNA_ANSWER_MEMORY", undefined);
pinEnv(process.env, "CLEAROTRON_INSTRUCTIONS_DIR", undefined);
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", join(HERE, "mock-claude.mjs"));
pinEnv(process.env, "CLEAROTRON_CODEX_PATH", join(HERE, "mock-codex.mjs"));
process.env.CLEAROTRON_MAX_RETRIES = "0";
process.env.CLEAROTRON_RECOVERY_MAX = "0";
process.env.MOCK_VERDICT = "CLEAR";
process.env.MOCK_SKEPTIC = "no flags surfaced";

import { test } from "node:test";
import assert from "node:assert/strict";
import { ASSESS_SENTENCES } from "./ruled-sentences-knockout-assess.mjs";

const { driverDir } = await import("../../shared/driver-dir.mjs");
const { knockoutInner, frameworkEchoFault } = await import("../pipeline-knockout.mjs");
const { KO_ASSESS_CHUNK, KO_STAGES, koChunks, koPaths, groupRecordsDoc, calibrationExcerptOf } = await import("../stages-knockout.mjs");
const { answeredGrid } = await import("./knockout-grid-fixture.mjs");

const NAMES = ["QUILLBRAE", "MOSSVALE", "LANTERNWICK", "ODRAVEL", "NOVAPULSE", "IRONWHISK", "CLUVENDRA", "BRIMSTARE", "TALLOWMERE", "PEBBLEWAY"];
const MOCK_KEYS = ["MOCK_KO_ASSESS_HOLD_MS", "MOCK_KO_ASSESS_LOG", "MOCK_KO_GROUP_CONTEXT", "MOCK_KO_LATER_CAVEAT", "MOCK_KO_NAME_QUALIFICATION", "MOCK_KO_FIRST_FRAMEWORK", "MOCK_KO_LATER_FRAMEWORK", "MOCK_FAIL_STAGE", "MOCK_CLAUDE_RATELIMIT", "MOCK_CLAUDE_RATELIMIT_MATCH", "MOCK_KO_MATERIAL", "MOCK_KO_CORRECTED_BAND", "MOCK_KO_CORRECT_CANCEL_AT", "MOCK_KO_CORRECT_HOLD_MS"];

/** One knockout of these names through the lane, on the mock engine. What the run left, whether or not it delivered. */
async function knockout(codename, names, env = {}, executors = {}) {
  for (const k of MOCK_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries({ CLEAROTRON_AI: "anthropic-agent", ...env })) process.env[k] = v;
  const id = `ko-${codename}`;
  const studioRoot = join(ROOT, "studio", id);
  const dir = join(studioRoot, "clearance-search", "runs", "quillbrae", `2026-11-06-${codename}`);
  mkdirSync(driverDir(dir), { recursive: true });
  const run = { runDir: dir, studioRoot, slug: "quillbrae", date: "2026-11-06", codename, archiveDir: join(studioRoot, "archive", `2026-11-06-${codename}`) };
  const job = { id, markName: names[0], marks: names.map((name) => ({ name })), classes: [4], jurisdictions: ["EU"], forwarder: "jordan", msgId: `<${id}@x>`, ref: `E2E-${codename}` };
  const ctx = { run, job, agent: "mailagent", paths: { runDir: dir }, profile: {}, searchPolicy: { level: "knockout-register", stageLabel: "Knockout + register", components: { registerProbe: true } } };
  let res = null, thrown = null;
  try {
    res = await knockoutInner(ctx, job, {
      recordLister: async () => ({ ok: true, total: 0, records: [] }),
      countExecutor: async () => ({ ok: true, total: 0 }),
      gridExecutor: async (spec) => answeredGrid(spec, [{ title: "An invented listing", url: "https://example.test/listing" }]),
      ...executors,
      sweepExecutor: async () => ({ ok: true, text: "An invented trader sells candles. https://example.test/trader" }),
    });
  } catch (e) { thrown = e; }
  const at = existsSync(dir) ? dir : run.archiveDir;
  const json = (p) => JSON.parse(readFileSync(p, "utf8"));
  const journal = !existsSync(driverDir(at, "run.jsonl")) ? [] : readFileSync(driverDir(at, "run.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { res, thrown, dir: at, json, journal, K: koPaths(at),
    findings: existsSync(join(at, "knockout-findings.json")) ? json(join(at, "knockout-findings.json")) : null };
}

test("a batch splits into one group per family, a name with no family alone, in the plan's order", () => {
  assert.equal(KO_ASSESS_CHUNK, 1);
  const rows = (n) => NAMES.slice(0, n).map((name) => ({ name }));
  const sizes = (n, families = null) => koChunks(rows(n), families).map((g) => g.length);
  assert.deepEqual(sizes(1), [1]);
  assert.deepEqual(sizes(8), [1, 1, 1, 1, 1, 1, 1, 1], "with no families every name is rated alone");
  const families = [["odravel", "QUILLBRAE"], ["NOVAPULSE", "MOSSVALE", "IRONWHISK"]];
  assert.deepEqual(koChunks(rows(7), families).map((g) => g.map((m) => m.name)),
    [["QUILLBRAE", "ODRAVEL"], ["MOSSVALE", "NOVAPULSE", "IRONWHISK"], ["LANTERNWICK"], ["CLUVENDRA"]],
    "a family's names in plan order, the families in the order of their first name, every name once");
  assert.deepEqual(koChunks(rows(7), families).flat().map((m) => m.name).sort(), NAMES.slice(0, 7).sort(), "every name in exactly one group");
});

test("a group's message is its own job: one name's words or a family's, and no batch duties", () => {
  const K = koPaths(mkdtempSync(join(tmpdir(), "ko-groups-msg-")));
  const message = (names) => KO_STAGES["knockout-assess"].message({ K, job: {}, chunkNo: 0, chunkMarks: names.map((name) => ({ name })), chunkTotal: 3,
    framework: { bands: [{ label: "High" }, { label: "Low" }] }, frameworkPath: null, probeNote: "" });
  const one = message(["QUILLBRAE"]);
  assert.match(one, /^You are rating one name for a Knockout screen\.$/m);
  const CAVEAT_DUTY = ASSESS_SENTENCES.caveatsForTheOrderQualificationsForTheName;
  assert.ok(one.includes(`You send \`marks\` and \`chunkSummary\`. ${CAVEAT_DUTY} Use the supplied frozen framework. Open your \`chunkSummary\` with a line for this name`), "a name rated alone is told where an order-wide and a name's own qualification go");
  const family = message(["QUILLBRAE", "QUILBRAE", "QUILL BRAE"]);
  assert.match(family, /^You are rating a group of closely related names for a Knockout screen\. Each name is a client choice and gets its own rating and reasons\.$/m);
  assert.ok(family.includes(`You send \`marks\` and \`chunkSummary\`. ${CAVEAT_DUTY} Use the supplied frozen framework. Open your \`chunkSummary\` with a line for each name`), "a family is told the same");
  for (const m of [one, family]) assert.doesNotMatch(m, /whole report/, "the earlier caveat clause is gone");
  for (const m of [one, family]) assert.doesNotMatch(m, /As the FIRST chunk|CONTINUATION chunk|groups side by side/, "a group carries no duty for the batch");
  // A source the order holds still has to bear on the particular name (design, 2026-11-24), alone or in a group.
  for (const m of [one, family]) assert.match(m, /A source's presence in the order does not establish that it supports the claim\./, "the order-wide caveat on sources is missing");
});

test("the groups run side by side, at most eight at once, and the record composed from them is the whole batch's", async () => {
  const log = join(ROOT, "hold.jsonl");
  const r = await knockout("side-by-side", NAMES, { MOCK_KO_ASSESS_HOLD_MS: "1500", MOCK_KO_ASSESS_LOG: log,
    MOCK_KO_GROUP_CONTEXT: "only the first group's goods", MOCK_KO_LATER_CAVEAT: "A caveat a later group raised for the whole batch.",
    MOCK_KO_NAME_QUALIFICATION: JSON.stringify({ LANTERNWICK: "This holds for LANTERNWICK alone: its lamps are sold only through its own shop." }) });
  assert.equal(r.res?.ok, true, `the knockout did not deliver: ${r.thrown?.message ?? JSON.stringify(r.res)}`);
  const rows = readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((x) => x.chunk).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], "each name is its own turn");
  const inFlight = (t) => rows.filter((x) => x.start <= t && t < x.end).length;
  const most = Math.max(...rows.map((x) => inFlight(x.start)));
  assert.ok(most >= 2, "the groups overlapped");
  assert.ok(most <= 8, `${most} turns ran at once`);
  assert.deepEqual(r.findings.marks.map((m) => m.name), NAMES, "every name, in plan order");
  assert.equal(r.findings.batch.productContext, r.json(r.K.plan).batch.productContext, "the batch's scope is the plan's, not the first group's");
  assert.equal(r.findings.batch.standardCaveats.filter((c) => c === "A caveat a later group raised for the whole batch.").length, 1, "a later group's caveat is kept, once");
  // The same held order carries an order-wide qualification and one name's own: through the merger, each stays where its group put it.
  const own = /holds for LANTERNWICK alone/;
  assert.ok(!r.findings.batch.standardCaveats.some((c) => own.test(String(c))), "a name's own qualification is not an order-wide caveat");
  assert.deepEqual(r.findings.marks.filter((m) => own.test(m.assessment)).map((m) => m.name), ["LANTERNWICK"], "a name's own qualification stays in that name's assessment");
  const summary = r.findings.batch.executiveSummary;
  const at = (n) => summary.indexOf(n);
  assert.ok(NAMES.every((n) => at(n) >= 0) && at(NAMES[0]) < at(NAMES[3]) && at(NAMES[3]) < at(NAMES[9]), "the groups' summaries are joined in group order");
});

test("each group is pointed at its own names' held filings, and the whole record stays for the checks", async () => {
  // One invented filing per name, so every name's share of the record is its own.
  const filing = (name) => ({ record_id: `tm_${name.toLowerCase()}`, mark_text: name, owner_name: "Brightmoor Candle Co", status: "Registered", classes: [4] });
  const names = NAMES.slice(0, 7);
  const r = await knockout("group-filings", names, {}, { recordLister: async (term) => ({ ok: true, total: null, records: names.includes(term) ? [filing(term)] : [] }) });
  assert.equal(r.res?.ok, true, `the knockout did not deliver: ${r.thrown?.message ?? JSON.stringify(r.res)}`);
  const whole = r.json(r.K.registerRecords);
  assert.deepEqual(whole.marks.map((m) => m.name).sort(), [...names].sort(), "the full record holds every name");
  const groups = koChunks(names.map((name) => ({ name })));
  for (const [c, group] of groups.entries()) {
    // The dispatch names the run's live folder, with the platform's separator; the record is read where the delivered run now sits.
    const dispatch = readFileSync(driverDir(r.dir, `knockout-assess#${c}.attempt1.dispatch.txt`), "utf8");
    const named = dispatch.split("\n").find((l) => l.startsWith("THE REGISTER FILINGS THIS RUN ALREADY FETCHED — ")) ?? "";
    assert.match(named, new RegExp(`[\\\\/]_driver[\\\\/]register-records\\.group-${c}\\.json\\. `), `group ${c + 1} is not pointed at its own filings`);
    const slice = r.json(r.K.groupRegisterRecords(c));
    assert.deepEqual(slice.marks.map((m) => m.name), group.map((m) => m.name), `group ${c + 1}'s slice holds other names`);
    assert.equal(slice.schema, whole.schema, "the slice keeps the record's own fields");
  }
});

test("every group's rating carries the calibration of the run's worked examples, read once for the run", async () => {
  const names = NAMES.slice(0, 3);
  const r = await knockout("calibration", names, {});
  assert.equal(r.res?.ok, true, `the knockout did not deliver: ${r.thrown?.message ?? JSON.stringify(r.res)}`);
  const ref = "skills/clearance-search/worked-examples.md";
  const want = calibrationExcerptOf(readFileSync(join(HERE, "..", "skills", "clearance-search", "worked-examples.md"), "utf8"), ref);
  for (const c of koChunks(names.map((name) => ({ name }))).keys()) {
    const dispatch = readFileSync(driverDir(r.dir, `knockout-assess#${c}.attempt1.dispatch.txt`), "utf8");
    assert.ok(dispatch.includes(want), `group ${c + 1} does not carry the house calibration`);
  }
  const journal = readFileSync(driverDir(r.dir, "run.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((e) => e.event === "knockout-calibration");
  assert.deepEqual(journal.map((e) => [e.ref, e.chars]), [[ref, want.length]], "the calibration is read once for the run, and the journal names it");
});

test("a group's cut of the record keeps every field but the other names", () => {
  const doc = { schema: 2, provider: "invented", marks: [{ name: "QUILLBRAE", records: [] }, { name: "MOSSVALE", records: [] }] };
  assert.deepEqual(groupRecordsDoc(doc, [" quillbrae "]), { schema: 2, provider: "invented", marks: [{ name: "QUILLBRAE", records: [] }] });
  assert.deepEqual(groupRecordsDoc({ schema: 2 }, ["QUILLBRAE"]).marks, []);
});

test("a group that fails leaves the others' work, and a resume runs only that group again", async () => {
  const names = NAMES.slice(0, 7);
  const failed = await knockout("one-fails", names, { MOCK_FAIL_STAGE: `Rate ONLY these marks (one entry each, names verbatim): ${names[1]}.` });
  assert.ok(failed.thrown || failed.res?.ok === false, "the lane does not deliver with a group missing");
  for (const c of [0, 2, 3, 4, 5, 6]) assert.ok(existsSync(failed.K.assessChunk(c)), `group ${c + 1}'s accepted chunk is kept`);
  assert.equal(existsSync(failed.K.assessChunk(1)), false, "the failed group wrote nothing");
  const before = failed.journal.length;
  const resumed = await knockout("one-fails", names);
  assert.equal(resumed.res?.ok, true, `the resume did not deliver: ${resumed.thrown?.message ?? JSON.stringify(resumed.res)}`);
  const after = resumed.journal.slice(before).filter((e) => /^knockout-assess#/.test(String(e.stage)));
  assert.deepEqual(after.filter((e) => e.event === "stage").map((e) => e.stage), ["knockout-assess#1"], "only the failed group runs again");
  assert.deepEqual(after.filter((e) => e.event === "skip").map((e) => e.stage).sort(), [0, 2, 3, 4, 5, 6].map((c) => `knockout-assess#${c}`));
});

test("a group that meets a rate limit starts no further group, and a resume rates only what did not finish", async () => {
  const log = join(ROOT, "limited.jsonl");
  const limited = await knockout("rate-limited", NAMES, { MOCK_KO_ASSESS_HOLD_MS: "1500", MOCK_KO_ASSESS_LOG: log,
    MOCK_CLAUDE_RATELIMIT: String(Math.floor(Date.now() / 1000) + 3600), MOCK_CLAUDE_RATELIMIT_MATCH: `Rate ONLY these marks (one entry each, names verbatim): ${NAMES[0]}.` });
  assert.ok(limited.thrown || limited.res?.ok === false, "the lane does not deliver with groups missing");
  const sent = limited.journal.filter((e) => /^knockout-assess#/.test(String(e.stage)) && e.event === "stage").map((e) => Number(e.stage.split("#")[1])).sort((a, b) => a - b);
  assert.deepEqual(sent, [0, 1, 2, 3, 4, 5, 6, 7], "a group was sent into the limit after it was met");
  for (const c of [1, 2, 3, 4, 5, 6, 7]) assert.ok(existsSync(limited.K.assessChunk(c)), `group ${c + 1}, already running, kept its work`);
  for (const c of [0, 8, 9]) assert.equal(existsSync(limited.K.assessChunk(c)), false, `group ${c + 1} has no chunk`);
  const before = limited.journal.length;
  const resumed = await knockout("rate-limited", NAMES);
  assert.equal(resumed.res?.ok, true, `the resume did not deliver: ${resumed.thrown?.message ?? JSON.stringify(resumed.res)}`);
  const after = resumed.journal.slice(before).filter((e) => /^knockout-assess#/.test(String(e.stage)));
  assert.deepEqual(after.filter((e) => e.event === "stage").map((e) => e.stage).sort(), ["knockout-assess#0", "knockout-assess#8", "knockout-assess#9"], "only the unfinished groups are rated again");
  assert.deepEqual(resumed.findings.marks.map((m) => m.name), NAMES);
});

test("the batch's framework is the frozen one, and a group that echoes another stops composition", async () => {
  const frozen = { source: "house-triage", ladder: ["Very High", "High", "Medium", "Manageable", "Low"] };
  assert.equal(frameworkEchoFault(undefined, frozen), null, "a group need not echo it");
  assert.equal(frameworkEchoFault({ source: "House-Triage", ladder: frozen.ladder.map((label) => ({ label })) }, frozen), null, "a difference in shape is not a different framework");
  assert.match(String(frameworkEchoFault({ source: "another-framework", ladder: frozen.ladder }, frozen)), /names the framework "another-framework"/);
  assert.match(String(frameworkEchoFault({ ladder: ["High", "Low"] }, frozen)), /not the frozen framework's/);
  // The first group's echo is checked like any other: it is not the source of the batch's framework.
  for (const [label, knob, group, why] of [
    ["first-other-name", { MOCK_KO_FIRST_FRAMEWORK: JSON.stringify({ source: "another-framework" }) }, 1, /names the framework "another-framework"/],
    ["first-other-ladder", { MOCK_KO_FIRST_FRAMEWORK: JSON.stringify({ ladder: ["Severe", "Mild"] }) }, 1, /not the frozen framework's/],
    ["later-other-name", { MOCK_KO_LATER_FRAMEWORK: JSON.stringify({ source: "another-framework" }) }, 2, /names the framework "another-framework"/],
    ["later-other-ladder", { MOCK_KO_LATER_FRAMEWORK: JSON.stringify({ ladder: ["Severe", "Mild"] }) }, 2, /not the frozen framework's/],
  ]) {
    const r = await knockout(label, NAMES.slice(0, 4), knob);
    assert.ok(r.thrown || r.res?.ok === false, `${label}: a batch with a group rated on another framework is not delivered`);
    const said = String(r.thrown?.message ?? r.res?.reason ?? JSON.stringify(r.res));
    assert.match(said, new RegExp(`knockout_compose_framework: group ${group} `), `${label}: ${said}`);
    assert.match(said, why, `${label}: ${said}`);
  }
  const fine = await knockout("frozen-framework", NAMES.slice(0, 4));
  assert.equal(fine.res?.ok, true, `the knockout did not deliver: ${fine.thrown?.message ?? JSON.stringify(fine.res)}`);
  const frozenOnDisk = fine.json(driverDir(fine.dir, "framework.json"));
  assert.deepEqual(fine.findings.framework, { source: frozenOnDisk.framework_key, ladder: frozenOnDisk.bands.map((b) => b.label) }, "the composed framework is the frozen one");
});

test("a stop asked for while the corrections run starts no queued correction, and reaches the run as a stop, not a failed correction", async () => {
  // One defect on each of the ten names, each its own group, so ten corrections and two of them queued behind the first eight. The
  // first asks the run to stop while the others are still running.
  const defects = NAMES.map((_, i) => i).map((i) => ({ kind: "contradiction", mark: NAMES[i], finding: 1, problem: "The first conflict is rated below what its own evidence shows." }));
  const r = await knockout("stopped-in-correction", NAMES, { MOCK_KO_MATERIAL: JSON.stringify(defects), MOCK_KO_CORRECTED_BAND: "High",
    MOCK_KO_CORRECT_CANCEL_AT: "0", MOCK_KO_CORRECT_HOLD_MS: "1500" });
  const sent = r.journal.filter((e) => /^knockout-correct#/.test(String(e.stage)) && e.event === "stage").map((e) => e.stage).sort();
  assert.deepEqual(sent, [0, 1, 2, 3, 4, 5, 6, 7].map((c) => `knockout-correct#${c}`).sort(), "a queued correction was sent after the stop");
  assert.equal(r.thrown, null, `the lane threw: ${r.thrown?.message}`);
  assert.equal(r.res?.cancelled, true, `the stop did not reach the run as a stop: ${JSON.stringify(r.res)}`);
  assert.equal(r.res?.failedStage, "knockout-correct", "the run stopped somewhere other than the corrections");
  const work = r.json(driverDir(r.dir, "knockout-correction-work.json"));
  assert.equal(work.stoodDown, undefined, "the stop was recorded as a failed correction");
  assert.equal(r.journal.filter((e) => e.stage === "knockout-review" && e.event === "stage").length, 1, "the corrected record was looked at again after the stop");
});
