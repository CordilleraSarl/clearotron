// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock pipeline on both engines, and reads what the reading step and the writer were sent.
//
// THE READING STEP AND THE WRITER ARE TOLD PLACEMENT'S ACCEPTED SET-ASIDES.
//
// Placement keeps its set-asides out of placements.json, and the band shape served to the later stages carries no
// placement decision, so the reading step and the writer never received the ground placement accepted for a record
// or a group's row. Ruled 2026-10-18: both are given the decisions that stand, under the approved introduction, each
// with its ground and the records it covers, read from the run's files when the message is built, so a decision
// survives a correction or a reload as it stands then. Nothing is printed where none stands. Own file = own process
// + own workspace root; the workspace and the call ledger are pinned before any driver module loads. Every mark and
// owner is invented.
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, mkdirSync, rmSync } from "node:fs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || mkdtempSync(join(tmpdir(), "clearotron-testroot-")));
const LEDGER = join(mkdtempSync(join(tmpdir(), "clearotron-setasides-ledger-")), "corsearch-calls.jsonl");
process.env.CLEAROTRON_REGISTER_CALL_LOG = LEDGER;
writeFileSync(LEDGER, "");

import { test } from "node:test";
import assert from "node:assert/strict";
const { placementSetAsideLines, messageCtxFor } = await import("../pipeline.mjs");
const { STAGES, paths, PLACEMENT_SET_ASIDES_INTRO } = await import("../stages.mjs");
const { buildBandShape, deriveRegisterPositions } = await import("../band-shape.mjs");
const { setAsideKeysOf, renderPlacementsJson } = await import("../placement-form.mjs");
const { unionPlacementForm } = await import("../placement-union.mjs");
const { writePlacementForm, readPlacementForm, readPlacementFormInput } = await import("../placement-form-io.mjs");
const { goodsWordCounter, goodsWordsMatched } = await import("../record-goods.mjs");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
const CODEX = join(HERE, "mock-codex.mjs");
chmodSync(CLAUDE, 0o755);
chmodSync(CODEX, 0o755);
process.env.CLEAROTRON_AI ||= "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

// ── the decisions as the two stages are told them, from a run's own files ──
const rec = (id, mark, owner) => ({ record_id: `/mark/eu/${id}`, mark_text: mark, owner_name: owner, classes: ["9"], status: "registered", jurisdictions: ["EU"] });
const BAND = [rec("a1", "QZORVAK", "Alpha Ltd"), rec("a2", "Plimbo", "Alpha Ltd"), rec("r1", "Drellux", "Delta AG"), rec("r2", "Vorrin", "Eta Kft")];
const GOODS = { a1: "joysticks", a2: "joysticks", r1: "printers", r2: "printers" };

function seedRun(t, rows) {
  const runDir = mkdtempSync(join(tmpdir(), "setasides-told-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(driverDir(runDir), { recursive: true });
  const positions = deriveRegisterPositions(BAND);
  const goods = { of: (r) => [{ classes: ["9"], text: GOODS[r.record_id.split("/").pop()] }], hits: goodsWordCounter(["joysticks"]), matched: goodsWordsMatched(["joysticks"]) };
  const { shape } = buildBandShape({ enumerated: BAND }, { targets: ["Qzorvak"], inScopeClasses: ["9"], positions, goods, keysOf: setAsideKeysOf(positions.positions) });
  const read = ["a", "b", "c", "d", "rest", "no_goods"].flatMap((g) => shape.groups[g].list.map((l) => l.key));
  const input = { floors: shape.floors.in_class_identical_or_near, positions: positions.positions, groups: shape.groups, served: { lines: new Set(read), records: new Set() } };
  const u = unionPlacementForm(null, { rows }, input);
  const P = paths(runDir);
  writeFileSync(P.registerNamedBand, JSON.stringify({ enumerated: BAND, crowds: [] }));
  writeFileSync(P.bandShape, JSON.stringify(shape));
  writeFileSync(P.registerPositions, JSON.stringify(positions));
  writePlacementForm(runDir, u.form);
  writeFileSync(driverDir(runDir, "reading-log.jsonl"), JSON.stringify({ ts: "2026-10-18T00:00:00Z", tool: "band_shape", args: { format: "md" },
    ok: true, part: 1, parts: 1, served_lines: read, session: "clearance-x-y-placement-inquiry" }) + "\n");
  writeFileSync(P.placementModel, JSON.stringify(renderPlacementsJson(u.form.rows)));
  return { P, shape };
}
const ROWS = [
  { select: "/mark/eu/a1", tier: "headline-candidate", reason: "identical, live, for the client's own goods" },
  { set_aside: "/mark/eu/a2", ground: "a different product, sold only to farmers" },
  { set_aside_group: "rest", count: 2, ground: "similar to none of the mark's forms" },
];
const DIGEST_ARGS = (P) => ({ paths: P, axes: ["primary-sweep"], intakeAsks: [] });
const WRITER_ARGS = (P) => ({ paths: P, job: {}, customerUnknown: false, profile: null, intakeAsks: [], enforcerSignals: null, framework: null,
  jxAim: null, registerOnly: false, crowdContext: null, dispatchBlocks: {}, findingsSurface: [] });

test("each standing set-aside is one line: a record's with its ground, a group's row with its count, the lines it covers and its ground", (t) => {
  const { P, shape } = seedRun(t, ROWS);
  assert.equal(shape.groups.rest.records, 2, "guard: two records in the rest");
  assert.deepEqual(placementSetAsideLines(P), [
    "- Plimbo — Alpha Ltd (/mark/eu/a2): set aside: a different product, sold only to farmers",
    "- group (rest)'s row, 2 records, covering 2 lines: similar to none of the mark's forms",
  ]);
});

test("the reading step and the writer read the approved introduction and the decisions under it; with none, neither is printed", (t) => {
  const { P } = seedRun(t, ROWS);
  for (const [name, args] of [["register-digest", DIGEST_ARGS], ["synthesis", WRITER_ARGS]]) {
    const text = String(STAGES[name].message(messageCtxFor(name, args(P))));
    assert.ok(text.includes(`${PLACEMENT_SET_ASIDES_INTRO}\n- Plimbo — Alpha Ltd (/mark/eu/a2): set aside: a different product, sold only to farmers\n- group (rest)'s row,`),
      `${name}: the decisions do not follow the introduction`);
  }
  const { P: none } = seedRun(t, [ROWS[0]]);
  for (const [name, args] of [["register-digest", DIGEST_ARGS], ["synthesis", WRITER_ARGS]])
    assert.ok(!String(STAGES[name].message(messageCtxFor(name, args(none)))).includes("Placement's accepted set-asides"), `${name}: the introduction printed with nothing under it`);
});

// ── a whole run, on each engine: what the reading step and the writer were sent ──
const JOB = { id: "test-job-sat", msgId: "<sat@x>", forwarder: "jordan", forwarderDomain: "example.com", ref: "TMP8303", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch" };
const ON_CODEX = { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" };
const GROUND = "the registration lapsed before the client's first use";

async function runMockPipeline(env) {
  const root = mkdtempSync(join(tmpdir(), "clearotron-sat-"));
  const calls = join(root, "engine-calls.jsonl");
  writeFileSync(LEDGER, "");
  for (const k of ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_PLACEMENT_SET_ASIDE", "MOCK_CLAUDE_CALL_LOG", "MOCK_CODEX_CALL_LOG", "CLEAROTRON_AI_BILLING", "CODEX_API_KEY", "CLEAROTRON_CODEX_PATH"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_CLAUDE_CALL_LOG: calls, MOCK_CODEX_CALL_LOG: calls, ...env,
  })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB });
  const prompts = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).prompt ?? "") : [];
  return { res, prompts };
}
const sent = (prompts, marker) => prompts.filter((p) => p.includes(marker));

for (const [engine, env] of [["claude", {}], ["codex", ON_CODEX]]) {
  test(`${engine}: a set-aside placement made reaches the reading step and the writer, read from the run when each message is built`, async () => {
    const { res, prompts } = await runMockPipeline({ ...env, MOCK_PLACEMENT_SET_ASIDE: GROUND });
    assert.equal(res.ok, true, JSON.stringify({ ok: res.ok, fail: res.fail, stage: res.failedStage }));
    const digest = sent(prompts, "You are register DIGEST mode"), writer = sent(prompts, "Produce the joint synthesis narrative");
    assert.ok(digest.length && writer.length, `guard: the ${engine} engine sent both stages`);
    for (const [who, list] of [["the reading step", digest], ["the writer", writer]]) {
      assert.ok(list[0].includes(PLACEMENT_SET_ASIDES_INTRO), `${who} was not told placement's set-asides`);
      assert.ok(new RegExp(`\\): set aside on its status: ${GROUND}`).test(list[0]), `${who} was not given the decision and its ground`);
    }
  });
}

test("THE CONTROL: a run whose placement set nothing aside tells neither stage of any", async () => {
  const { res, prompts } = await runMockPipeline({});
  assert.equal(res.ok, true);
  assert.ok(prompts.length > 0, "guard: the engine calls were logged");
  assert.ok(!prompts.some((p) => p.includes("Placement's accepted set-asides")), "a stage was told of set-asides placement never made");
});

// ── a reload, and a correction: the run parks after placement, before the reading step, and is resumed ──
// The reading step's turn is rate-limited on the first pass, so the run parks with placement's form on disk. Before
// the resume, `between` may change that form as a later placement pass would. Claude's engine; the list is read from
// the run's files, whatever engine sends it, and the arms above send it on both.
async function parkAndResume(between = null) {
  const root = mkdtempSync(join(tmpdir(), "clearotron-sat-resume-"));
  const calls = join(root, "engine-calls.jsonl");
  writeFileSync(LEDGER, "");
  for (const k of ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_PLACEMENT_SET_ASIDE", "MOCK_CLAUDE_CALL_LOG", "MOCK_CODEX_CALL_LOG", "CLEAROTRON_AI_BILLING", "CODEX_API_KEY",
    "CLEAROTRON_CODEX_PATH", "MOCK_CLAUDE_RATELIMIT", "MOCK_CLAUDE_RATELIMIT_MATCH"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_CLAUDE_CALL_LOG: calls,
    MOCK_PLACEMENT_SET_ASIDE: GROUND, MOCK_CLAUDE_RATELIMIT: String(Math.floor(Date.now() / 1000) + 3600), MOCK_CLAUDE_RATELIMIT_MATCH: "You are register DIGEST mode",
  })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  let first = null;
  try { first = await pipeline({ ...JOB }); } catch { /* a parked run may throw its park */ }
  const runDir = first?.runDir ?? null;
  assert.ok(runDir && existsSync(join(runDir, "status.json")), "guard: the first pass left a run to resume");
  const parkedAt = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).length : 0;
  if (between) between(runDir);
  delete process.env.MOCK_CLAUDE_RATELIMIT; delete process.env.MOCK_CLAUDE_RATELIMIT_MATCH;
  const codename = JSON.parse(readFileSync(join(runDir, "status.json"), "utf8")).codename;
  const { pipeline: resume } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await resume({ ...JOB }, { codename });
  const prompts = readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).slice(parkedAt).map((l) => JSON.parse(l).prompt ?? "");
  return { first, res, prompts, runDir };
}

test("claude: a set-aside survives a reload — the resumed reading step and writer are still told it", async () => {
  const { first, res, prompts } = await parkAndResume();
  assert.notEqual(first?.ok, true, "guard: the first pass parked before the reading step");
  assert.equal(res.ok, true, JSON.stringify({ ok: res.ok, fail: res.fail, stage: res.failedStage }));
  const digest = sent(prompts, "You are register DIGEST mode"), writer = sent(prompts, "Produce the joint synthesis narrative");
  assert.ok(digest.length && writer.length, "guard: the resume sent both stages");
  for (const [who, list] of [["the resumed reading step", digest], ["the resumed writer", writer]])
    assert.ok(list[0].includes(PLACEMENT_SET_ASIDES_INTRO) && list[0].includes(`: set aside on its status: ${GROUND}`), `${who} lost placement's set-aside`);
});

test("claude: a set-aside a later pass reversed is gone — the resumed stages are not told it", async () => {
  const { res, prompts } = await parkAndResume((runDir) => {
    // A later placement pass places the line the first pass set aside, over the form the run holds.
    const input = readPlacementFormInput(runDir);
    const held = readPlacementForm(runDir);
    const named = held.set_aside.map((e) => e.set_aside);
    assert.equal(named.length, 1, "guard: the first pass set one line aside");
    const { form } = unionPlacementForm(held, { rows: [{ select: named[0], tier: "sheet-2", reason: "the same mark, live in the class" }] }, input);
    writePlacementForm(runDir, form);
    writeFileSync(paths(runDir).placementModel, JSON.stringify(renderPlacementsJson(form.rows)));
  });
  // The delivery guard may hold this run: placement's files changed after the stage that wrote them, by hand here,
  // which is the material it refuses to deliver from. What the resumed stages were told is the arm's question.
  assert.ok(res, "guard: the resume ran");
  const digest = sent(prompts, "You are register DIGEST mode"), writer = sent(prompts, "Produce the joint synthesis narrative");
  assert.ok(digest.length && writer.length, "guard: the resume sent both stages");
  for (const p of [...digest, ...writer]) assert.ok(!p.includes(GROUND), "a stage was told a set-aside the later pass reversed");
});
