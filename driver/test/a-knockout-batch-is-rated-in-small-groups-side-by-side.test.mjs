// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT BATCH IS RATED IN GROUPS OF AT MOST THREE NAMES, SIDE BY SIDE, at most three turns at once. Each group is its own turn
// and writes only its own chunk. The lane joins every group before it composes the record, and the composed batch is the whole
// batch's: its scope is the frozen plan's, and every group's batch-wide caveat is kept once. A group that fails leaves the others'
// accepted work, and a resume runs only what failed. Names here are invented.
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

const { driverDir } = await import("../../shared/driver-dir.mjs");
const { knockoutInner } = await import("../pipeline-knockout.mjs");
const { KO_ASSESS_CHUNK, KO_STAGES, koChunks, koPaths } = await import("../stages-knockout.mjs");
const { answeredGrid } = await import("./knockout-grid-fixture.mjs");

const NAMES = ["QUILLBRAE", "MOSSVALE", "LANTERNWICK", "ODRAVEL", "NOVAPULSE", "IRONWHISK", "CLUVENDRA", "BRIMSTARE", "TALLOWMERE", "PEBBLEWAY"];
const MOCK_KEYS = ["MOCK_KO_ASSESS_HOLD_MS", "MOCK_KO_ASSESS_LOG", "MOCK_KO_GROUP_CONTEXT", "MOCK_KO_LATER_CAVEAT", "MOCK_FAIL_STAGE"];

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

test("a batch splits into groups of at most three names, in plan order", () => {
  assert.equal(KO_ASSESS_CHUNK, 3);
  const sizes = (n) => koChunks(NAMES.slice(0, n).map((name) => ({ name }))).map((g) => g.length);
  assert.deepEqual(sizes(1), [1]);
  assert.deepEqual(sizes(8), [3, 3, 2]);
  assert.deepEqual(sizes(10), [3, 3, 3, 1]);
  assert.deepEqual(koChunks(NAMES.map((name) => ({ name }))).flat().map((m) => m.name), NAMES, "every name in exactly one group, in order");
});

test("a group is told it is one of several, and may carry a caveat for the whole batch", () => {
  const K = koPaths(mkdtempSync(join(tmpdir(), "ko-groups-msg-")));
  const message = (chunkNo, chunkTotal) => KO_STAGES["knockout-assess"].message({ K, job: {}, chunkNo, chunkMarks: [{ name: "QUILLBRAE" }], chunkTotal,
    framework: { bands: [{ label: "High" }, { label: "Low" }] }, frameworkPath: null, probeNote: "" });
  assert.match(message(1, 3), /This batch is rated in 3 groups side by side, and code joins the groups' summaries in order\. Open your `chunkSummary` with a line for these names, not for the whole batch/);
  assert.match(message(1, 3), /As a CONTINUATION chunk you send `marks` and `chunkSummary`, and in `batch\.standardCaveats` only a qualification that holds for the whole batch/);
  assert.match(message(0, 3), /As the FIRST chunk you also send `batch`/);
  assert.doesNotMatch(message(0, 1), /groups side by side/, "a batch rated in one turn is told nothing about groups");
});

test("the groups run side by side, at most three at once, and the record composed from them is the whole batch's", async () => {
  const log = join(ROOT, "hold.jsonl");
  const r = await knockout("side-by-side", NAMES, { MOCK_KO_ASSESS_HOLD_MS: "1500", MOCK_KO_ASSESS_LOG: log,
    MOCK_KO_GROUP_CONTEXT: "only the first group's goods", MOCK_KO_LATER_CAVEAT: "A caveat a later group raised for the whole batch." });
  assert.equal(r.res?.ok, true, `the knockout did not deliver: ${r.thrown?.message ?? JSON.stringify(r.res)}`);
  const rows = readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((x) => x.chunk).sort(), [0, 1, 2, 3], "each group is its own turn");
  const inFlight = (t) => rows.filter((x) => x.start <= t && t < x.end).length;
  const most = Math.max(...rows.map((x) => inFlight(x.start)));
  assert.ok(most >= 2, "the groups overlapped");
  assert.ok(most <= 3, `${most} turns ran at once`);
  assert.deepEqual(r.findings.marks.map((m) => m.name), NAMES, "every name, in plan order");
  assert.equal(r.findings.batch.productContext, r.json(r.K.plan).batch.productContext, "the batch's scope is the plan's, not the first group's");
  assert.equal(r.findings.batch.standardCaveats.filter((c) => c === "A caveat a later group raised for the whole batch.").length, 1, "a later group's caveat is kept, once");
  const summary = r.findings.batch.executiveSummary;
  const at = (n) => summary.indexOf(n);
  assert.ok(NAMES.every((n) => at(n) >= 0) && at(NAMES[0]) < at(NAMES[3]) && at(NAMES[3]) < at(NAMES[9]), "the groups' summaries are joined in group order");
});

test("a group that fails leaves the others' work, and a resume runs only that group again", async () => {
  const names = NAMES.slice(0, 7);
  const failed = await knockout("one-fails", names, { MOCK_FAIL_STAGE: "You are rating chunk 2/3" });
  assert.ok(failed.thrown || failed.res?.ok === false, "the lane does not deliver with a group missing");
  for (const c of [0, 2]) assert.ok(existsSync(failed.K.assessChunk(c)), `group ${c + 1}'s accepted chunk is kept`);
  assert.equal(existsSync(failed.K.assessChunk(1)), false, "the failed group wrote nothing");
  const before = failed.journal.length;
  const resumed = await knockout("one-fails", names);
  assert.equal(resumed.res?.ok, true, `the resume did not deliver: ${resumed.thrown?.message ?? JSON.stringify(resumed.res)}`);
  const after = resumed.journal.slice(before).filter((e) => /^knockout-assess#/.test(String(e.stage)));
  assert.deepEqual(after.filter((e) => e.event === "stage").map((e) => e.stage), ["knockout-assess#1"], "only the failed group runs again");
  assert.deepEqual(after.filter((e) => e.event === "skip").map((e) => e.stage).sort(), ["knockout-assess#0", "knockout-assess#2"]);
});

test("the web sweep runs beside the register reading once the counts have passed, and not at all when no count was taken", async () => {
  const names = NAMES.slice(0, 2);
  const starts = [];
  const grid = async (spec) => { starts.push(Date.now()); return answeredGrid(spec, [{ title: "An invented listing", url: "https://example.test/listing" }]); };
  const FILING = { record_id: "/mark/em/invented-1", mark_text: names[0], owner_name: "Invented Owner GmbH", owner_country: "DE", status: "Registered", classes: [4], office: "em",
    raw: { classifications: [{ nice_class: 4, goods_services_text: "Candles; wicks." }] } };
  const held = { countExecutor: async (term, p) => ({ ok: true, total: term === names[0] && p.key === "identical" ? 1 : 0 }),
    // The listing takes a while, as a register's does, so a sweep that waited for it would start after it.
    recordLister: async (term) => { await new Promise((ok) => setTimeout(ok, 1500)); listed.push(Date.now()); return term === names[0] ? { ok: true, total: 1, records: [FILING] } : { ok: true, total: 0, records: [] }; } };
  const listed = [];
  const r = await knockout("sweep-beside", names, {}, { ...held, gridExecutor: grid });
  assert.equal(r.res?.ok, true, `the knockout did not deliver: ${r.thrown?.message ?? JSON.stringify(r.res)}`);
  assert.ok(listed.length > 0, "premise: the register was listed");
  assert.ok(starts.length === names.length && Math.min(...starts) < Math.max(...listed), "the sweep began while the register was still being read");
  starts.length = 0;
  const none = await knockout("no-count", names, {}, { gridExecutor: grid, countExecutor: async () => ({ ok: false, total: null, reason: "an invented outage" }) });
  assert.ok(none.thrown || none.res?.ok === false, "a batch with no count stops, as before");
  assert.equal(starts.length, 0, "and no web search is spent on it");
});
