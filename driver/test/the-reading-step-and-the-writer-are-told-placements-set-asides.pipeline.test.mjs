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
const { placementSetAsideLines, messageCtxFor, standingPlacementDecisions, writePlacementDecisions, DERIVATION_RUNNERS } = await import("../pipeline.mjs");
const { writeStamp, staleOnPath } = await import("../stage-freshness.mjs");
const { STAGES, paths, PLACEMENT_SET_ASIDES_INTRO, stageInputs } = await import("../stages.mjs");
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

// `into` seeds an existing run again, as a later pass rewrites its files; a record whose goods are null has none on file.
function seedRun(t, rows, { band = BAND, goodsOf = GOODS, into = null } = {}) {
  const runDir = into ?? mkdtempSync(join(tmpdir(), "setasides-told-"));
  if (!into) t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(driverDir(runDir), { recursive: true });
  const positions = deriveRegisterPositions(band);
  const goodsText = (r) => goodsOf[r.record_id.split("/").pop()];
  const goods = { of: (r) => (goodsText(r) == null ? null : [{ classes: ["9"], text: goodsText(r) }]), hits: goodsWordCounter(["joysticks"]), matched: goodsWordsMatched(["joysticks"]) };
  const { shape } = buildBandShape({ enumerated: band }, { targets: ["Qzorvak"], inScopeClasses: ["9"], positions, goods, keysOf: setAsideKeysOf(positions.positions) });
  const read = ["a", "b", "c", "d", "rest", "no_goods"].flatMap((g) => shape.groups[g].list.map((l) => l.key));
  const input = { floors: shape.floors.in_class_identical_or_near, positions: positions.positions, groups: shape.groups, served: { lines: new Set(read), records: new Set() } };
  const u = unionPlacementForm(null, { rows }, input);
  const P = paths(runDir);
  writeFileSync(P.registerNamedBand, JSON.stringify({ enumerated: band, crowds: [] }));
  writeFileSync(P.bandShape, JSON.stringify(shape));
  writeFileSync(P.registerPositions, JSON.stringify(positions));
  writePlacementForm(runDir, u.form);
  writeFileSync(driverDir(runDir, "reading-log.jsonl"), JSON.stringify({ ts: "2026-10-18T00:00:00Z", tool: "band_shape", args: { format: "md" },
    ok: true, part: 1, parts: 1, served_lines: read, session: "clearance-x-y-placement-inquiry" }) + "\n");
  writeFileSync(P.placementModel, JSON.stringify(renderPlacementsJson(u.form.rows)));
  return { P, shape, input, form: u.form };
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
    "- group (rest)'s row, 2 records in the group, covering 2 lines: similar to none of the mark's forms",
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

test("a group's row counts beside what placement placed and named: the lines it covers, and only the floors it leaves", (t) => {
  // The rest holds three lines: one placed, one set aside by name, one the row covers. Group (b) holds two floors,
  // identical marks for goods the client does not sell, below a thousand records, so its row covers neither; one is
  // placed, so the row leaves only the other.
  const band = [rec("a1", "QZORVAK", "Alpha Ltd"), rec("b1", "Qzorvak", "Beta GmbH"), rec("b2", "QZORVAK", "Gamma SA"),
    rec("r1", "Drellux", "Delta AG"), rec("r2", "Vorrin", "Eta Kft"), rec("r3", "Zentrix", "Kappa Oy")];
  const goodsOf = { a1: "joysticks", b1: "printers", b2: "printers", r1: "printers", r2: "printers", r3: "printers" };
  const { P, shape } = seedRun(t, [
    { select: "/mark/eu/a1", tier: "headline-candidate", reason: "identical, live, for the client's own goods" },
    { select: "/mark/eu/b1", tier: "sheet-2", reason: "identical, live in the class" },
    { select: "/mark/eu/r1", tier: "watchlist-annex", reason: "a near owner in the client's market" },
    { set_aside: "/mark/eu/r2", ground: "a different product, sold only to farmers" },
    { set_aside_group: "rest", count: 3, ground: "similar to none of the mark's forms" },
    { set_aside_group: "b", count: 2, ground: "identical marks in the class for goods unrelated to the client's" },
  ], { band, goodsOf });
  assert.deepEqual([shape.groups.rest.records, shape.groups.b.records], [3, 2], "guard: three lines in the rest, two floors in (b)");
  const by = Object.fromEntries(standingPlacementDecisions(P).filter((d) => d.kind === "group").map((d) => [d.group, d]));
  assert.equal(by.rest.covers_lines, 1, "the row was said to cover a line placement placed or named");
  assert.deepEqual(by.b.floors_not_covered, ["/mark/eu/b2"], "a floor placement placed was listed among the ones the row leaves");
  assert.ok(placementSetAsideLines(P).includes("- group (rest)'s row, 3 records in the group, covering 1 lines: similar to none of the mark's forms"));
});

test("a long list of floors a row leaves names the file that holds every one", (t) => {
  const { P } = seedRun(t, ROWS);
  const decisions = [{ kind: "group", group: "b", records: 30, covers_lines: 0, ground: "identical marks in the class for goods unrelated to the client's",
    floors_not_covered: Array.from({ length: 23 }, (_, i) => `/mark/eu/f${i}`) }];
  const [line] = placementSetAsideLines(P, decisions);
  assert.ok(line.endsWith(`/mark/eu/f19, and 3 more, all listed in ${P.placementDecisions}`), line);
  writeFileSync(P.placementDecisions, JSON.stringify({ schema_version: 1, decisions }, null, 2) + "\n");
  assert.equal(JSON.parse(readFileSync(P.placementDecisions, "utf8")).decisions[0].floors_not_covered.length, 23, "the named file holds the whole list");
});

test("a change to a decision alone leaves the reading step and the writer stale, and the same decisions written again do not", (t) => {
  const { P, input, form } = seedRun(t, ROWS);
  writePlacementDecisions(P);
  const inputsFor = (label) => stageInputs(label, P, { axes: [] });
  for (const label of ["register-digest", "synthesis"]) {
    assert.ok(inputsFor(label).includes(P.placementDecisions), `guard: ${label} declares the decisions`);
    writeStamp(P.runDir, label, inputsFor(label));
  }
  writePlacementDecisions(P);
  assert.deepEqual(staleOnPath(P.runDir, ["register-digest", "synthesis"], inputsFor), [], "the same decisions, written again, made a reader stale");
  // A later pass changes only the ground of the set-aside by name: the placements the stages carry stay byte for byte.
  const placementsBefore = readFileSync(P.placementModel, "utf8");
  const { form: later } = unionPlacementForm(form, { rows: [{ set_aside: "/mark/eu/a2", ground: "a product for farmers alone, sold through farm co-operatives" }] }, input);
  writePlacementForm(P.runDir, later);
  writeFileSync(P.placementModel, JSON.stringify(renderPlacementsJson(later.rows)));
  assert.equal(readFileSync(P.placementModel, "utf8"), placementsBefore, "guard: the carried placements are unchanged");
  writePlacementDecisions(P);
  const stale = staleOnPath(P.runDir, ["register-digest", "synthesis"], inputsFor);
  assert.deepEqual(stale.map((s2) => s2.label), ["register-digest", "synthesis"], "a reader that already ran was not made stale by the changed ground");
  assert.ok(stale.every((s2) => JSON.stringify(s2.changed).includes("placement-decisions.json")));
});

test("a group's row that comes to cover another line at the same count leaves the reading step, the writer and the review stale", (t) => {
  // Two lines of other marks, one with goods on file and one without: the one with goods is the rest's only line, and
  // the row on the rest covers it. Swapping which of the two has goods on file moves the other line into the rest and
  // this one out, so the rest still holds one record and the row still covers one line, under the same ground.
  const band = [rec("a1", "QZORVAK", "Alpha Ltd"), rec("r1", "Drellux", "Delta AG"), rec("r2", "Vorrin", "Eta Kft")];
  const rows = [
    { select: "/mark/eu/a1", tier: "headline-candidate", reason: "identical, live, for the client's own goods" },
    { set_aside_group: "rest", count: 1, ground: "similar to none of the mark's forms" },
  ];
  const first = seedRun(t, rows, { band, goodsOf: { a1: "joysticks", r1: "printers", r2: null } });
  const { P } = first;
  assert.deepEqual(first.shape.groups.rest.list.map((l) => l.record_id), ["/mark/eu/r1"], "guard: the rest holds r1's line alone");
  const readers = ["register-digest", "synthesis", "narrative-refutation"];
  const inputsFor = (label) => stageInputs(label, P, { axes: [] });
  writePlacementDecisions(P);
  for (const label of readers) {
    assert.ok(inputsFor(label).includes(P.placementDecisions), `guard: ${label} declares the decisions`);
    writeStamp(P.runDir, label, inputsFor(label));
  }
  const before = readFileSync(P.placementDecisions, "utf8");
  const second = seedRun(t, rows, { band, goodsOf: { a1: "joysticks", r1: null, r2: "printers" }, into: P.runDir });
  assert.deepEqual(second.shape.groups.rest.list.map((l) => l.record_id), ["/mark/eu/r2"], "guard: the rest now holds r2's line alone");
  writePlacementDecisions(P);
  const rest = (text) => JSON.parse(text).decisions.find((d) => d.kind === "group" && d.group === "rest");
  const [was, now] = [rest(before), rest(readFileSync(P.placementDecisions, "utf8"))];
  assert.deepEqual([now.records, now.covers_lines, now.ground], [was.records, was.covers_lines, was.ground], "guard: the swap kept the count, the lines covered and the ground");
  assert.deepEqual(placementSetAsideLines(P), ["- group (rest)'s row, 1 records in the group, covering 1 lines: similar to none of the mark's forms"],
    "the line the stages are told changed with the members it does not name");
  assert.notEqual(readFileSync(P.placementDecisions, "utf8"), before, "the decisions file stayed byte for byte when the row came to cover another line");
  assert.deepEqual(staleOnPath(P.runDir, readers, inputsFor).map((s2) => s2.label), readers,
    "a stage that read the row was not made stale by the change of what the row covers");
  // the same members, written again, change nothing
  for (const label of readers) writeStamp(P.runDir, label, inputsFor(label));
  writePlacementDecisions(P);
  assert.deepEqual(staleOnPath(P.runDir, readers, inputsFor), [], "the same members, written again, made a stage stale");
});

test("a shape derived again writes placement's decisions again, so a row it no longer supports reaches the stages that read them", (t) => {
  const runDir = mkdtempSync(join(tmpdir(), "setasides-shape-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(driverDir(runDir), { recursive: true });
  const P = paths(runDir);
  writeFileSync(P.variantManifestModel, JSON.stringify({ schema_version: 1, mark: "QZORVAK", dominant_element: "QZORVAK",
    elements: [{ value: "QZORVAK", kind: "distinctive" }], variants: [{ value: "QZORVAK", category: "core" }],
    incumbent_classes: [], watchlist_owners: [], goods_words: ["joysticks"], product_words: ["joysticks"] }));
  const withGoods = (r, text) => ({ ...r, raw: { classifications: [{ nice_class: 9, goods_services_text: text, goods_services_language: "en", goods_services_text_truncated: false }] } });
  const band = [withGoods(rec("a1", "QZORVAK", "Alpha Ltd"), "joysticks"), withGoods(rec("r1", "Drellux", "Delta AG"), "printers"),
    withGoods(rec("r2", "Vorrin", "Eta Kft"), "printers")];
  const ctx = { paths: P, job: { markName: "Qzorvak", classes: [9] }, profile: null, run: { slug: "qz", codename: "shape" } };
  const derive = (enumerated) => { writeFileSync(P.registerNamedBand, JSON.stringify({ enumerated, crowds: [] })); assert.ok(DERIVATION_RUNNERS["band-shape"](ctx)); };
  derive(band);
  assert.ok(!existsSync(P.placementDecisions), "a shape derived before placement ran wrote placement's decisions");
  // placement places the identical mark and sets the rest aside by its row, having read every line
  const shape = JSON.parse(readFileSync(P.bandShape, "utf8"));
  assert.deepEqual(shape.groups.rest.list.map((l) => l.record_id).sort(), ["/mark/eu/r1", "/mark/eu/r2"], "guard: two lines in the rest");
  const read = ["a", "b", "c", "d", "rest", "no_goods"].flatMap((g) => shape.groups[g].list.map((l) => l.key));
  writeFileSync(driverDir(runDir, "reading-log.jsonl"), JSON.stringify({ ts: "2026-10-19T00:00:00Z", tool: "band_shape", args: { format: "md" },
    ok: true, part: 1, parts: 1, served_lines: read, session: "clearance-qz-shape-placement-inquiry" }) + "\n");
  const { form } = unionPlacementForm(null, { rows: [
    { select: "/mark/eu/a1", tier: "headline-candidate", reason: "identical, live, for the client's own goods" },
    { set_aside_group: "rest", count: 2, ground: "similar to none of the mark's forms" },
  ] }, readPlacementFormInput(runDir));
  writePlacementForm(runDir, form);
  writeFileSync(P.placementModel, JSON.stringify(renderPlacementsJson(form.rows)));
  writePlacementDecisions(P);
  assert.ok(standingPlacementDecisions(P).some((d) => d.kind === "group" && d.group === "rest"), "guard: the row on the rest stands");
  const readers = ["register-digest", "synthesis", "narrative-refutation"];
  const inputsFor = (label) => stageInputs(label, P, { axes: [] });
  for (const label of readers) writeStamp(P.runDir, label, inputsFor(label));
  // the same shape derived again changes nothing
  derive(band);
  assert.deepEqual(staleOnPath(P.runDir, readers, inputsFor), [], "the same shape, derived again, made a stage stale");
  // the band gains a line in the rest that placement never read: the row taken for two records stands no longer
  derive([...band, withGoods(rec("r3", "Zentrix", "Kappa Oy"), "printers")]);
  assert.ok(!standingPlacementDecisions(P).some((d) => d.kind === "group" && d.group === "rest"), "guard: the row on the rest stands no longer");
  assert.deepEqual(JSON.parse(readFileSync(P.placementDecisions, "utf8")).decisions.filter((d) => d.kind === "group"), [],
    "the decisions file still holds a row the shape no longer supports");
  assert.deepEqual(staleOnPath(P.runDir, readers, inputsFor).map((s2) => s2.label), readers,
    "a stage that read the row was not made stale when the shape stopped supporting it");
});

// ── a whole run, on each engine: what the reading step and the writer were sent ──
const JOB = { id: "test-job-sat", msgId: "<sat@x>", forwarder: "jordan", forwarderDomain: "example.com", ref: "TMP8303", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch" };
const ON_CODEX = { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" };
const GROUND = "the registration lapsed before the client's first use";

async function runMockPipeline(env) {
  const root = mkdtempSync(join(tmpdir(), "clearotron-sat-"));
  const calls = join(root, "engine-calls.jsonl");
  writeFileSync(LEDGER, "");
  for (const k of ["MOCK_VERDICT", "MOCK_VERDICT_DEFECTS", "MOCK_SKEPTIC", "MOCK_PLACEMENT_SET_ASIDE", "MOCK_CLAUDE_CALL_LOG", "MOCK_CODEX_CALL_LOG", "CLEAROTRON_AI_BILLING", "CODEX_API_KEY", "CLEAROTRON_CODEX_PATH",
    "MOCK_CLAUDE_RATELIMIT", "MOCK_CLAUDE_RATELIMIT_MATCH", "MOCK_CODEX_RATELIMIT", "MOCK_CODEX_RATELIMIT_MATCH"]) delete process.env[k];
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
const PARK_KNOBS = ["MOCK_CLAUDE_RATELIMIT", "MOCK_CLAUDE_RATELIMIT_MATCH", "MOCK_CODEX_RATELIMIT", "MOCK_CODEX_RATELIMIT_MATCH"];
async function parkAndResume(between = null, { parkAt = "You are register DIGEST mode", engine = "claude", env = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "clearotron-sat-resume-"));
  const calls = join(root, "engine-calls.jsonl");
  writeFileSync(LEDGER, "");
  for (const k of ["MOCK_VERDICT", "MOCK_VERDICT_DEFECTS", "MOCK_SKEPTIC", "MOCK_PLACEMENT_SET_ASIDE", "MOCK_CLAUDE_CALL_LOG", "MOCK_CODEX_CALL_LOG", "CLEAROTRON_AI_BILLING", "CODEX_API_KEY",
    "CLEAROTRON_CODEX_PATH", ...PARK_KNOBS]) delete process.env[k];
  const park = engine === "codex" ? { ...ON_CODEX, MOCK_CODEX_RATELIMIT: "1", MOCK_CODEX_RATELIMIT_MATCH: parkAt }
    : { MOCK_CLAUDE_RATELIMIT: String(Math.floor(Date.now() / 1000) + 3600), MOCK_CLAUDE_RATELIMIT_MATCH: parkAt };
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_CLAUDE_CALL_LOG: calls, MOCK_CODEX_CALL_LOG: calls, MOCK_PLACEMENT_SET_ASIDE: GROUND, ...park, ...env,
  })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  let first = null;
  try { first = await pipeline({ ...JOB }); } catch { /* a parked run may throw its park */ }
  const runDir = first?.runDir ?? null;
  assert.ok(runDir && existsSync(join(runDir, "status.json")), "guard: the first pass left a run to resume");
  const parkedAt = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).length : 0;
  if (between) between(runDir);
  for (const k of PARK_KNOBS) delete process.env[k];
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

test("claude: a change to a decision alone, after the reading step and the writer ran, has both run again with it on the resume", async () => {
  // The run parks at the review, after the reading step and the writer were told the set-aside. Before the resume, a
  // later placement pass changes only its ground: the placements the stages carry stay as they were, and the
  // decisions file both stages declare changes. The resume runs both again, and they are told the new ground.
  const NEW = "the registration lapsed, and the owner let its renewal pass";
  const { res, prompts } = await parkAndResume((runDir) => {
    const P = paths(runDir);
    const input = readPlacementFormInput(runDir);
    const held = readPlacementForm(runDir);
    const { form } = unionPlacementForm(held, { rows: [{ set_aside: held.set_aside[0].set_aside, ground: NEW, on: "status" }] }, input);
    // The placements file is left as the run wrote it: the change renders to the same placements.
    assert.deepEqual(renderPlacementsJson(form.rows), JSON.parse(readFileSync(P.placementModel, "utf8")), "guard: the carried placements are unchanged");
    writePlacementForm(runDir, form);
    writePlacementDecisions(P);
  }, { parkAt: "Adversarially refute" });
  assert.ok(res, "guard: the resume ran");
  const digest = sent(prompts, "You are register DIGEST mode"), writer = sent(prompts, "Produce the joint synthesis narrative");
  assert.ok(digest.length && writer.length, "a reader whose decision changed was not run again on the resume");
  for (const [who, list] of [["the reading step", digest], ["the writer", writer]]) {
    assert.ok(list.at(-1).includes(`: set aside on its status: ${NEW}`), `${who} was not told the changed ground`);
    assert.ok(!list.at(-1).includes(GROUND), `${who} was still told the old ground`);
  }
});

// ── a narrow repair of the writer: no general order to check the grounds, the decisions file still among its inputs ──
// Ruled 2026-10-19: the lint repair and the strict-parse re-emits fix only what they name, so they are not handed the
// set-asides with the order to check each ground. A fresh correction still is (the tests below).
for (const [engine, env] of [["claude", {}], ["codex", ON_CODEX]]) {
  test(`${engine}: the writer's lint repair is not told placement's set-asides, and still names the decisions file among its inputs`, async () => {
    const { prompts } = await runMockPipeline({ ...env, MOCK_NARRATIVE_OVER_CAP: "1", MOCK_PLACEMENT_SET_ASIDE: GROUND });
    const repairs = prompts.filter((p) => p.includes("The deterministic pre-delivery checks found these faults"));
    assert.ok(repairs.length, `guard: the ${engine} engine sent the writer its lint repair`);
    for (const p of repairs) {
      assert.ok(!p.includes(PLACEMENT_SET_ASIDES_INTRO), "the lint repair was handed the order to check each set-aside's ground");
      assert.ok(p.includes("placement-decisions.json"), "the lint repair lost the decisions file from its inputs");
    }
    const writer = sent(prompts, "Produce the joint synthesis narrative");
    assert.ok(writer.length && writer[0].includes(PLACEMENT_SET_ASIDES_INTRO), "guard: the writer's first dispatch was told the set-aside");
  });
}

test("the four narrow repairs, and no other follow-up of the writer or the reading step, dispatch without the set-asides", async () => {
  const { NARROW_REPAIR_TRIGGERS } = await import("../pipeline.mjs");
  const { REPAIR_COMPOSERS, composerFor } = await import("../repair-composers.mjs");
  const narrow = ["*:lint-repair", "synthesis:finding-reemit", "synthesis:action-reemit", "synthesis:ask-answer-reemit"];
  assert.deepEqual(narrow.map((k) => composerFor(k)?.trigger).filter((t) => !NARROW_REPAIR_TRIGGERS.has(t)), [],
    "a narrow repair dispatches with a trigger the set-asides switch does not know");
  assert.deepEqual([...NARROW_REPAIR_TRIGGERS].sort(), narrow.map((k) => composerFor(k).trigger).sort(), "the switch holds a trigger no narrow repair uses");
  const wider = REPAIR_COMPOSERS.filter((c) => !narrow.includes(c.key) && /^(synthesis|register-digest)(:|$)/.test(String(c.key)) && NARROW_REPAIR_TRIGGERS.has(c.trigger));
  assert.deepEqual(wider.map((c) => c.key), [], "a substantive correction of the writer or the reading step would lose the set-asides");
});

// ── a fresh correction of the writer: given the decisions as they stand, on each engine ──
const CORRECTION = "your earlier synthesis is not in your context, and you do NOT redo it from scratch";
const REVIEW_ASKS = { MOCK_VERDICT: "CONDITIONAL", MOCK_VERDICT_DEFECTS: "- the first review's point about the coined element (probe)" };

for (const [engine, env] of [["claude", {}], ["codex", ON_CODEX]]) {
  test(`${engine}: the writer's correction, a fresh session, is told placement's set-aside with its ground`, async () => {
    const { res, prompts } = await runMockPipeline({ ...env, ...REVIEW_ASKS, MOCK_PLACEMENT_SET_ASIDE: GROUND });
    assert.ok(res, "guard: the run ran");
    const corrections = sent(prompts, CORRECTION);
    assert.ok(corrections.length, `guard: the ${engine} engine sent the writer a correction`);
    assert.ok(corrections[0].includes(PLACEMENT_SET_ASIDES_INTRO) && corrections[0].includes(`: set aside on its status: ${GROUND}`),
      "the correction lost the set-aside its first dispatch was told");
  });

  test(`${engine}: a set-aside a later pass reversed is gone from the writer's correction after the resume`, async () => {
    const { prompts } = await parkAndResume((runDir) => {
      // A later placement pass places the line the first pass set aside, before the correction runs again.
      const input = readPlacementFormInput(runDir);
      const held = readPlacementForm(runDir);
      const { form } = unionPlacementForm(held, { rows: [{ select: held.set_aside[0].set_aside, tier: "sheet-2", reason: "the same mark, live in the class" }] }, input);
      writePlacementForm(runDir, form);
      writeFileSync(paths(runDir).placementModel, JSON.stringify(renderPlacementsJson(form.rows)));
      writePlacementDecisions(paths(runDir));
    }, { parkAt: CORRECTION, engine, env: REVIEW_ASKS });
    const corrections = sent(prompts, CORRECTION);
    assert.ok(corrections.length, `guard: the resume on ${engine} sent the writer a correction`);
    for (const p of corrections) assert.ok(!p.includes(GROUND), "a correction was told a set-aside the later pass reversed");
  });
}
