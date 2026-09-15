// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives BOTH real publishers and reads what they wrote into the pool
// Every tier goes to the program as the vendor's alias (opus, sonnet, haiku), so the tier a stage asks for
// no longer names the model that ran. The id the engine reported for each turn is the record: it is on
// every attempt row as `modelActual`, and a published run carries the distinct ids, in first-use order, on
// meta.json and report-data.json and as one closing line of each report's scope section.
//
// What the arms hold:
//   - servedModels reads `modelActual`, never the requested tier; first use decides the order across stage
//     files; the run log and the driver's code-side rows are not turns; the CLI's `<synthetic>` label is
//     not a model; null means nothing was read and [] means turns ran and named no model;
//   - servedModelsLine names Claude only when every id is a Claude id, treats an id as text, and is empty
//     for nothing, so a run with no record renders as it was delivered;
//   - each real publisher, given a run whose attempt rows name served models, writes them to meta.json,
//     report-data.json and the rendered scope section, and the control run with no rows writes none;
//   - the native-language steps count too. Each step that writes a record (the candidate step, the judge of
//     web listings, the reading of the register) is run for real and its model is listed; a run mixing them
//     with stage turns keeps first-use order across both; a run whose only turns were those steps publishes
//     the line; and a label for a message no model wrote is still not a model;
//   - a native-language turn that ran and named no model is still a turn. Driven through the real engine
//     door against a stand-in Claude program (a turn the program answered itself, failed or not, and a
//     stream that never named a model): the run reads [], never null, its tokens reach the run's rollup,
//     and a run made only of such a turn publishes [] and no line. The CONTROLS: the same door with a
//     served turn lists its model, and a call no provider served (an injected step, a configuration the
//     engine door refused) is still not a turn, so a run made only of it still reads null.
//
// SAFETY: driver.config reads env at module load and its pool-root default is the real archive, so the
// env is pinned before any product module is imported.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
const ROOT = mkdtempSync(join(tmpdir(), "served-models-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool-default"));
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
pinEnv(process.env, "CLEAROTRON_DATABASE", "corsearch");
delete process.env.CLEAROTRON_MCP_URL;
import { test } from "node:test";
import assert from "node:assert/strict";
import { driverDir } from "../../shared/driver-dir.mjs";
const { servedModels, rollupTokens } = await import("../tokens.mjs");
const { servedModelsLine } = await import("../publish/render.mjs");
const { publishReport } = await import("../publish/index.mjs");
const { publishKnockout } = await import("../publish/knockout.mjs");
const { runJxCandidateFold } = await import("../jx.mjs");
const { runJxSerpGrid, runJxNativeread } = await import("../jx-units.mjs");

const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
function runWith(tag, files) {
  const runDir = join(ROOT, `run-${tag}`);
  mkdirSync(driverDir(runDir), { recursive: true });
  for (const [name, rows] of Object.entries(files)) writeFileSync(driverDir(runDir, name), jsonl(rows));
  return runDir;
}

test("servedModels: the ids the engine reported, distinct, in the order each first served, across stage files", () => {
  const runDir = runWith("order", {
    // Directory order is not the order the turns ran: a reader taking files in name order would put
    // sonnet first, because `a-sweep` sorts before `b-frame` while its turns came later.
    "a-sweep.jsonl": [
      { ts: "2026-09-14T10:05:00.000Z", model: "sonnet", modelActual: "claude-sonnet-5" },
      { ts: "2026-09-14T10:06:00.000Z", model: "haiku", modelActual: "claude-haiku-4-5-20251001" },
    ],
    "b-frame.jsonl": [
      { ts: "2026-09-14T10:01:00.000Z", model: "opus", modelActual: "claude-opus-5" },
      { ts: "2026-09-14T10:07:00.000Z", model: "opus", modelActual: "claude-opus-5" },
      { ts: "2026-09-14T10:02:00.000Z", model: "opus", modelActual: null },
      // The CLI's own label for a message no model wrote, earlier than every served turn.
      { ts: "2026-09-14T10:00:30.000Z", model: "opus", modelActual: "<synthetic>" },
    ],
    // Earlier than every turn, so either would lead the list if it were read as one.
    "run.jsonl": [{ ts: "2026-09-14T09:00:00.000Z", model: "opus", modelActual: "claude-opus-4-8" }],
    "plan.jsonl": [{ ts: "2026-09-14T09:30:00.000Z", model: "code", modelUsed: "code:execute-plan", modelActual: "gpt-5.6-sol" }],
  });
  assert.deepEqual(servedModels(runDir), ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"]);
});

test("servedModels: null when nothing was read, [] when turns ran and none named a model", () => {
  assert.equal(servedModels(join(ROOT, "no-such-run")), null, "no telemetry directory is nothing read");
  assert.equal(servedModels(runWith("log-only", { "run.jsonl": [{ ts: "2026-09-14T10:00:00.000Z", event: "start" }] })), null,
    "a run log alone holds no turn");
  assert.equal(servedModels(runWith("code-only", { "plan.jsonl": [{ ts: "2026-09-14T10:00:00.000Z", model: "code", modelUsed: "code:execute-plan" }] })), null,
    "the driver's own rows are not provider turns");
  assert.deepEqual(servedModels(runWith("unreported", { "x.jsonl": [{ ts: "2026-09-14T10:00:00.000Z", model: "sonnet", modelActual: null }] })), [],
    "a turn ran and named no model, which is not the same as nothing read");
  assert.deepEqual(servedModels(runWith("synthetic-only", { "x.jsonl": [{ ts: "2026-09-14T10:00:00.000Z", model: "opus", modelActual: "<synthetic>" }] })), [],
    "a turn the CLI answered itself, with no model behind it, named no model");
});

test("servedModelsLine: one line, Claude named only when every id is Claude's, ids as text, nothing for nothing", () => {
  for (const none of [null, undefined, [], ["", "  "]]) assert.equal(servedModelsLine(none), "", `${JSON.stringify(none)} renders nothing`);
  assert.match(servedModelsLine(["claude-opus-5", "claude-sonnet-5"]), /Prepared with Claude: claude-opus-5, claude-sonnet-5\./);
  const codex = servedModelsLine(["gpt-5.6-sol"]);
  assert.match(codex, /Prepared with: gpt-5\.6-sol\./);
  assert.doesNotMatch(codex, /Claude/, "a Codex run is not prepared with Claude");
  assert.doesNotMatch(servedModelsLine(["claude-opus-5", "gpt-5.6-sol"]), /Claude:/, "a mixed list names no single vendor");
  assert.doesNotMatch(servedModelsLine(["<b>claude-opus-5</b>"]), /<b>/, "an id is text, never markup");
});

const FRAMEWORK = { framework_key: "house-triage", title: "t", bands: [
  { label: "Very High", tone: "severe" }, { label: "High", tone: "high" }, { label: "Medium", tone: "medium" },
  { label: "Manageable", tone: "low" }, { label: "Low", tone: "minimal" }] };
const markDoc = (name) => ({
  name, rating: "Medium", bullets: ["Synthetic fixture for the served-model record."],
  findings: [{ ordinal: 1, name: "Look-alike listing", owner: "Kurena SA", band: "Medium",
    net: "A listing under a closely similar name is live on a marketplace.", type: "Active Business", evidence: [] }],
});
const ROWS = [
  { ts: "2026-09-14T10:01:00.000Z", model: "opus", modelActual: "claude-opus-5" },
  { ts: "2026-09-14T10:02:00.000Z", model: "haiku", modelActual: "claude-haiku-4-5-20251001" },
];

async function publish(tag, product, rows, prepare = null) {
  const runDir = join(ROOT, `pub-${tag}`);
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(join(runDir, "status.json"), JSON.stringify({ runId: `fixture-${tag}`, markName: "KURENA" }));
  writeFileSync(join(runDir, "report.md"), "# Clearance report\n\nBody text.\n");
  writeFileSync(join(runDir, "findings.json"), JSON.stringify({ schema_version: 6, findings: [] }));
  writeFileSync(driverDir(runDir, "profile.json"), JSON.stringify({ key: `${tag}-key` }));
  if (rows) writeFileSync(driverDir(runDir, "matter-frame.jsonl"), jsonl(rows));
  if (prepare) await prepare(runDir);
  const poolRoot = join(ROOT, `pool-${tag}`);
  mkdirSync(poolRoot, { recursive: true });
  const runId = `tmp0775-2026-09-14-${tag}`;
  const common = { runId, codename: tag, runDir, poolRoot, poolUrl: "https://trademark.test", customerKey: `${tag}-key`, skipRegen: true };
  if (product === "clearance") await publishReport({ ...common, reportMd: join(runDir, "report.md"), findingsJson: join(runDir, "findings.json") });
  else await publishKnockout({ ...common, findings: { marks: [markDoc("KURENA")] }, framework: FRAMEWORK, overall: "Medium" });
  const read = (name) => readFileSync(join(poolRoot, runId, name), "utf8");
  return { meta: JSON.parse(read("meta.json")), data: JSON.parse(read("report-data.json")), html: read("report.html") };
}

/** The rendered scope section alone, so a line elsewhere on the page cannot pass for one in it. */
function scopeOf(html) {
  const at = html.indexOf('<details class="scope">');
  assert.ok(at >= 0, "the page rendered no scope section, so nothing below can be read");
  const end = html.indexOf("</details>", at);
  assert.ok(end > at, "the scope section never closes");
  return html.slice(at, end);
}

for (const product of ["clearance", "knockout"]) {
  test(`a ${product} run publishes the models that served it on meta.json, report-data.json and the scope section`, async () => {
    const { meta, data, html } = await publish(`served-${product}`, product, ROWS);
    const ids = ["claude-opus-5", "claude-haiku-4-5-20251001"];
    assert.deepEqual(meta.servedModels, ids, "meta.json");
    assert.deepEqual(data.servedModels, ids, "report-data.json");
    assert.match(scopeOf(html), /Prepared with Claude: claude-opus-5, claude-haiku-4-5-20251001\./, "the scope section's closing line");
  });

  test(`the CONTROL: a ${product} run with no attempt rows publishes no served models and no line`, async () => {
    const { meta, data, html } = await publish(`none-${product}`, product, null);
    assert.equal("servedModels" in meta, false, "meta.json keeps its earlier shape when nothing was read");
    assert.equal(data.servedModels, null, "report-data.json says nothing was read");
    assert.doesNotMatch(scopeOf(html), /Prepared with/, "no line is rendered for a run with no record");
  });
}

// ── The native-language steps ─────────────────────────────────────────────────────────────────────────
// Those steps write their own records, `_driver/jx-completions.jsonl`, one row per call. Measured
// 2026-09-14: a run whose only turns were those steps published no served models and no line, so a model
// used only there (Haiku reading the Chinese register, say) was left off the report. Each step below is the
// real one, run with its turn injected, so what is read is the record the step itself writes.

const HAIKU = "claude-haiku-4-5-20251001";
const CANDIDATE = { term: "诺瓦脉冲", romanization: "NUO WA MAI CHONG", kind: "phonetic", rationale: "sound-alike" };
const JOB = { markName: "NOVAPULSE", jurisdictions: ["CN"], goods: "game software", classes: [9] };
const tick = () => new Promise((r) => setTimeout(r, 5));   // so two records never share a millisecond

/** The candidate step, whose turn reports `model`. */
async function candidateStep(runDir, model) {
  mkdirSync(driverDir(runDir), { recursive: true });
  const ctx = {
    run: { runDir }, paths: { registerPlan: join(mkdtempSync(join(ROOT, "plan-")), "register-plan.json") },
    job: JOB, profile: {}, searchPolicy: { components: { jxLanes: true } },
    registerPlan: { schema_version: 1, plan_version: 1, job_key: "t", entries: [
      { qid: "primary-sweep:exact:novapulse", axis: "primary-sweep", predicate: "exact",
        term: "NOVAPULSE", nice_classes: ["9"], regions: ["CN"], expected_kind: "enumerate" }] },
  };
  const r = await runJxCandidateFold(ctx, JOB, { jxExecutor: async () => ({ ok: true, candidates: [CANDIDATE], tookMs: 5, model }) },
    { inScopeClasses: ["9"] });
  assert.equal(r.folded, 1, `the candidate step must run for its record to mean anything: ${JSON.stringify(r)}`);
}

/** A run that has already folded its candidates, as the two later steps expect to find it. */
function laterStepCtx(runDir) {
  mkdirSync(driverDir(runDir), { recursive: true });
  return { run: { runDir, slug: "novapulse", codename: "served" }, job: JOB,
    searchPolicy: { components: { jxLanes: true } }, gridVariants: ["NOVAPULSE"],
    jxLanes: { schema: 1, lanes: { zh: { depth: "candidates", jurisdictions: ["CN"] } },
      fold: { lanes: { zh: { accepted: [{ qid: "jx-zh-0", ...CANDIDATE }], refused: [], cnipaSubgroups: [{ class: 9, groups: ["0901"] }] } } } } };
}

/** The judge of web listings, whose turn reports `model`. One marketplace answers, so the judge has work. */
async function judgeStep(runDir, model) {
  const ctx = laterStepCtx(runDir);
  const serpExecutor = async ({ term, platform }) => (platform === "taobao.com"
    ? { ok: true, hits: [{ title: `${term} 旗舰店`, url: "https://item.taobao.com/item/123", snippet: "listing" }], tookMs: 1 }
    : { ok: true, hits: [], tookMs: 1 });
  const jxJudge = async ({ hits }) => ({ ok: true, tookMs: 1, usage: { input: 10, output: 5 }, model,
    judgments: hits.map((h) => ({ id: h.id, classification: "listing-candidate", note: "a shop page" })) });
  const r = await runJxSerpGrid(ctx, JOB, { serpExecutor, jxJudge }, {});
  assert.equal(r.ran, true, `the judge step must run for its record to mean anything: ${r.cause ?? ""}`);
}

/** The reading of the register, whose turn reports `model`. */
async function readingStep(runDir, model) {
  const ctx = laterStepCtx(runDir);
  mkdirSync(join(runDir, "register-units"), { recursive: true });
  writeFileSync(join(runDir, "register-units", "transliteration-numeric.md"), "| 诺瓦脉冲 | https://reg.example/tm/555 | live |");
  const r = await runJxNativeread(ctx, JOB, { nativereadExecutor: async () => ({ ok: true, items: [], tookMs: 1, usage: { input: 10, output: 5 }, model }) }, {});
  assert.equal(r.ran, true, `the reading step must run for its record to mean anything: ${r.cause ?? ""}`);
}

test("servedModels: each native-language step's record names the model it reported", async () => {
  for (const [name, step] of [["candidate", candidateStep], ["judge", judgeStep], ["reading", readingStep]]) {
    const runDir = join(ROOT, `jx-only-${name}`);
    await step(runDir, HAIKU);
    assert.deepEqual(servedModels(runDir), [HAIKU], `a run whose only turn was the ${name} step lists the model that did it`);
  }
});

test("servedModels: first use decides the order across stage turns and native-language steps", async () => {
  const runDir = join(ROOT, "jx-mixed");
  mkdirSync(driverDir(runDir), { recursive: true });
  // File names chosen so directory order disagrees with the order the turns ran in.
  writeFileSync(driverDir(runDir, "z-matter-frame.jsonl"), jsonl([{ ts: new Date().toISOString(), model: "opus", modelActual: "claude-opus-5" }]));
  await tick();
  await candidateStep(runDir, HAIKU);
  await tick();
  writeFileSync(driverDir(runDir, "a-synthesis.jsonl"), jsonl([{ ts: new Date().toISOString(), model: "sonnet", modelActual: "claude-sonnet-5" }]));
  assert.deepEqual(servedModels(runDir), ["claude-opus-5", HAIKU, "claude-sonnet-5"]);
});

// The Claude adapter no longer hands on this label (see the stand-in arms below), but records written
// before it refused the label carry it, and a step handed one by any other route must not list it.
test("the CONTROL: a bracketed label on a native-language record is not listed as a model", async () => {
  const runDir = join(ROOT, "jx-synthetic");
  await candidateStep(runDir, "<synthetic>");
  assert.deepEqual(servedModels(runDir), [], "a turn ran and named no model");
});

for (const product of ["clearance", "knockout"]) {
  test(`a ${product} run whose only turns were native-language steps publishes the model that did them`, async () => {
    const { meta, data, html } = await publish(`jx-only-${product}`, product, null, (runDir) => readingStep(runDir, HAIKU));
    assert.deepEqual(meta.servedModels, [HAIKU], "meta.json");
    assert.deepEqual(data.servedModels, [HAIKU], "report-data.json");
    assert.match(scopeOf(html), /Prepared with Claude: claude-haiku-4-5-20251001\./, "the scope section's closing line");
  });
}

// ── A native-language turn that ran and named no model ────────────────────────────────────────────────
// The steps above inject their turn. These go through the engine door a real run uses, against a stand-in
// for the Claude program that prints the stream it is handed, because the shape that matters is the one
// the adapter produces: for a turn the program answered itself it reports no model at all (the label is
// refused), and a row naming no model used to be read as a call never made. A run made only of such a
// turn then read null, "nothing was looked at", and its tokens were in no total.

const STANDIN = join(ROOT, "standin-claude.mjs");
writeFileSync(STANDIN, `#!/usr/bin/env node
if (process.argv.includes("--version")) { process.stdout.write("2.1.270 (Claude Code)\\n"); process.exit(0); }
if (!process.stdin.isTTY) { process.stdin.resume(); for await (const _ of process.stdin) { /* the prompt */ } }
for (const ev of JSON.parse(process.env.STANDIN_EVENTS || "[]")) process.stdout.write(JSON.stringify(ev) + "\\n");
process.exit(Number(process.env.STANDIN_EXIT || 0));
`);
chmodSync(STANDIN, 0o755);

const USAGE = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const ITEMS = '{"items":[]}';
const REFUSAL = "API Error: 404 The deployment for this model does not exist.";
const initEvent = (model) => ({ type: "system", subtype: "init", session_id: "standin", ...(model ? { model } : {}), apiKeySource: "none", tools: [] });
const said = (model, text) => ({ type: "assistant", session_id: "standin",
  message: { role: "assistant", ...(model ? { model } : {}), content: [{ type: "text", text }] } });
const result = (text, isError) => ({ type: "result", subtype: "success", is_error: isError, result: text, session_id: "standin", usage: USAGE });
const TURNS = {
  served: { events: [initEvent(HAIKU), said(HAIKU, ITEMS), result(ITEMS, false)], exit: 0 },
  "answered itself and failed": { events: [initEvent(HAIKU), said("<synthetic>", REFUSAL), result(REFUSAL, true)], exit: 1 },
  "answered itself and exited 0": { events: [initEvent(HAIKU), said("<synthetic>", ITEMS), result(ITEMS, false)], exit: 0 },
  "never named a model": { events: [initEvent(null), said(null, ITEMS), result(ITEMS, false)], exit: 0 },
};
// Settings that would point the engine door somewhere other than the stand-in, held off for each turn.
const HELD_OFF = ["CLEAROTRON_JX_FIXTURES", "CLAUDE_CODE_USE_FOUNDRY", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_BEDROCK",
  "ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY"];

/** The reading of the register with no turn injected, so it takes the engine door to the stand-in. */
async function readingThroughTheDoor(runDir, turn, engine = "anthropic-agent") {
  const ctx = laterStepCtx(runDir);
  mkdirSync(join(runDir, "register-units"), { recursive: true });
  writeFileSync(join(runDir, "register-units", "transliteration-numeric.md"), "| 诺瓦脉冲 | https://reg.example/tm/555 | live |");
  const env = { CLEAROTRON_AI: engine, CLEAROTRON_AI_BILLING: "subscription",
    STANDIN_EVENTS: JSON.stringify(turn.events), STANDIN_EXIT: String(turn.exit) };
  const saved = Object.fromEntries([...Object.keys(env), ...HELD_OFF].map((k) => [k, process.env[k]]));
  const savedPath = envFrom(process.env, "CLEAROTRON_CLAUDE_PATH");
  for (const k of HELD_OFF) delete process.env[k];
  Object.assign(process.env, env);
  pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", STANDIN);
  try { await runJxNativeread(ctx, JOB, {}, {}); }
  finally {
    for (const [k, v] of Object.entries(saved)) { if (v == null) delete process.env[k]; else process.env[k] = v; }
    pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", savedPath);
  }
  const rows = readFileSync(driverDir(runDir, "jx-completions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(rows.length, 1, "the step writes one record for its one call");
  return rows[0];
}

const UNNAMED = {
  "answered itself and failed": "a native-language turn the program answered itself, and that failed, is a turn that named no model",
  "answered itself and exited 0": "a native-language turn the program answered itself, and that closed as a success, is a turn that named no model",
  "never named a model": "a native-language turn whose stream never named a model is a turn that named no model",
};
for (const [name, title] of Object.entries(UNNAMED)) {
  test(title, async () => {
    const runDir = join(ROOT, `jx-door-${name.replace(/\W+/g, "-")}`);
    const row = await readingThroughTheDoor(runDir, TURNS[name]);
    assert.equal(row.engine, "anthropic", `the call must have reached the program for this arm to mean anything: ${JSON.stringify(row)}`);
    assert.equal("model" in row, false, "no model is named, neither the label nor the session's configured one");
    assert.equal(row.modelActual, null, "the record says a turn ran and named no model");
    assert.deepEqual(servedModels(runDir), [], "a turn ran and named no model, which is not the same as nothing read");
    const t = rollupTokens(runDir);
    assert.equal(t.total.attempts, 1, "the turn is counted");
    assert.equal(t.total.input, 10, "the tokens it reported reach the run's total");
    assert.equal(t.total.output, 20);
    assert.equal(t.byStage["jx-completions"]?.attempts, 1);
    assert.deepEqual(Object.keys(t.byModel), ["anthropic/no-model-reported"], "keyed under a name that says the model is missing");
  });
}

test("the CONTROL: a native-language turn the program served, through the same door, lists its model", async () => {
  const runDir = join(ROOT, "jx-door-served");
  const row = await readingThroughTheDoor(runDir, TURNS.served);
  assert.equal(row.modelActual, HAIKU);
  assert.deepEqual(servedModels(runDir), [HAIKU]);
  assert.equal(rollupTokens(runDir).total.attempts, 1);
});

test("the CONTROLS: a native-language call no provider served is not a turn, so a run made only of it reads null", async () => {
  const injected = join(ROOT, "jx-injected-no-model");
  await readingStep(injected, undefined);
  assert.equal(servedModels(injected), null, "an injected step made no provider call");
  assert.equal(rollupTokens(injected).total.attempts, 0);

  const refused = join(ROOT, "jx-door-refused");
  const row = await readingThroughTheDoor(refused, TURNS.served, "no-such-engine");
  assert.equal(row.engine, "not-provider-billed", `the engine door must refuse for this arm to mean anything: ${JSON.stringify(row)}`);
  assert.equal("modelActual" in row, false, "a refused configuration dispatched nothing");
  assert.equal(servedModels(refused), null);
  assert.equal(rollupTokens(refused).total.attempts, 0);
});

for (const product of ["clearance", "knockout"]) {
  test(`a ${product} run whose only turn named no model publishes an empty list and no line`, async () => {
    const { meta, data, html } = await publish(`jx-unnamed-${product}`, product, null,
      (runDir) => readingThroughTheDoor(runDir, TURNS["answered itself and failed"]));
    assert.deepEqual(meta.servedModels, [], "meta.json says a turn ran and named no model");
    assert.deepEqual(data.servedModels, [], "report-data.json");
    assert.doesNotMatch(scopeOf(html), /Prepared with/, "no model is named, so no line is rendered");
  });
}
