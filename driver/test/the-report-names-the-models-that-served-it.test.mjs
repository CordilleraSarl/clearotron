// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives BOTH real publishers and reads what they wrote into the pool
// Every tier goes to the program as the vendor's alias (opus, sonnet, haiku), so the tier a stage asks for
// no longer names the model that ran. The id the engine reported for each turn is the record: it is on
// every attempt row as `modelActual`, and a published run carries the distinct ids, in first-use order, on
// meta.json and report-data.json and as one closing line of each report's scope section.
//
// What the tests hold:
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
//     engine door refused) is still not a turn, so a run made only of it still reads null;
//   - what a cloud calls the model. Amazon's and Google's spellings of a Claude id read as the dated Claude
//     id, and the same model reached two ways is listed once. A name a company gave its own deployment never
//     reaches the report: a turn under the Claude engine that reports one prints as Claude and the tier the
//     turn asked for, each tier once, on a stage turn and a native-language turn alike, and in a run that
//     mixes them with a Claude id. Both real publishers are driven, and the name is absent from meta.json,
//     report-data.json and the whole page. The kind of row decides where the request is read, so a
//     deployment named after its tier still reads as that tier. Only an id shaped like a Claude model id
//     prints as itself: a name that merely begins `claude-`, or wraps itself in Amazon's form, reads as the
//     tier. One model in two cases or two clouds' version marks is one entry, and a request in Amazon's
//     spelling is read as the tier it names. Fable is a tier like the other three: a fable turn under a
//     deployment name prints as Fable, from both publishers, read for the report alone because the
//     gateway's family comparison leaves fable unknown. The CONTROLS: a Codex id prints as reported, a
//     served fable id prints as itself, and a deployment whose tier cannot be read is left off rather than
//     printed, so a run made only of it reads [] and publishes no line.
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

/**
 * The rendered FOOTER alone, so a line elsewhere on the page cannot pass for one in it.
 *
 * This read the scope fold until 2026-09-17. The fold is gone — the redesign took the coverage narrative
 * off the client's page — and the owner ruled the same day that this line belongs in the footer with the
 * matter and the framework. What is pinned is unchanged and is the reason the helper exists at all: the
 * line must be in the REGION that is meant to carry it, not merely somewhere in the document. Widening
 * these arms to search the whole page would have turned every one of them green while saying nothing
 * about where a reader meets the sentence.
 */
function footerOf(html) {
  const at = html.indexOf("<footer>");
  assert.ok(at >= 0, "the page rendered no footer, so nothing below can be read");
  const end = html.indexOf("</footer>", at);
  assert.ok(end > at, "the footer never closes");
  return html.slice(at, end);
}

for (const product of ["clearance", "knockout"]) {
  test(`a ${product} run publishes the models that served it on meta.json, report-data.json and the footer`, async () => {
    const { meta, data, html } = await publish(`served-${product}`, product, ROWS);
    const ids = ["claude-opus-5", "claude-haiku-4-5-20251001"];
    assert.deepEqual(meta.servedModels, ids, "meta.json");
    assert.deepEqual(data.servedModels, ids, "report-data.json");
    assert.match(footerOf(html), /Prepared with Claude: claude-opus-5, claude-haiku-4-5-20251001\./, "the footer's provenance line");
  });

  test(`the CONTROL: a ${product} run with no attempt rows publishes no served models and no line`, async () => {
    const { meta, data, html } = await publish(`none-${product}`, product, null);
    assert.equal("servedModels" in meta, false, "meta.json keeps its earlier shape when nothing was read");
    assert.equal(data.servedModels, null, "report-data.json says nothing was read");
    assert.doesNotMatch(footerOf(html), /Prepared with/, "no line is rendered for a run with no record");
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

// The Claude adapter no longer hands on this label (see the stand-in tests below), but records written
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
    assert.match(footerOf(html), /Prepared with Claude: claude-haiku-4-5-20251001\./, "the footer's provenance line");
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
    assert.equal(row.engine, "anthropic", `the call must have reached the program for this test to mean anything: ${JSON.stringify(row)}`);
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
  assert.equal(row.engine, "not-provider-billed", `the engine door must refuse for this test to mean anything: ${JSON.stringify(row)}`);
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
    assert.doesNotMatch(footerOf(html), /Prepared with/, "no model is named, so no line is rendered");
  });
}

// ── What a cloud calls the model ──────────────────────────────────────────────────────────────────────
// Through a cloud, the id a turn reports may be that cloud's spelling of a Claude model, or a name the
// company gave its own deployment. The first is the Claude model it names. The second is a company's
// internal name and never reaches its client's report: the turn prints as Claude and the tier it asked
// for. meta.json, report-data.json and the rendered line agree because the list is mapped once, where it
// is read.

const at = (minute) => `2026-09-14T10:${String(minute).padStart(2, "0")}:00.000Z`;
/** A stage attempt row as the gateway writes it: `model` is the tier asked for, `modelActual` the wire's id. */
const stageRow = (minute, tier, served, engine = "anthropic-agent") => ({ ts: at(minute), model: tier, modelActual: served, engine });
const DEPLOYED = "acme-cn-reader";
const SERVED_BY_DEPLOYMENT = { events: [initEvent(DEPLOYED), said(DEPLOYED, ITEMS), result(ITEMS, false)], exit: 0 };
const COMPANY = /acme/i;

test("servedModels: Amazon's spellings of a Claude id read as the dated Claude id", () => {
  const runDir = runWith("bedrock", { "matter-frame.jsonl": [
    stageRow(1, "opus", "us.anthropic.claude-opus-4-1-20250805-v1:0"),
    stageRow(2, "sonnet", "anthropic.claude-sonnet-4-20250514-v1:0"),
    stageRow(3, "haiku", "eu.anthropic.claude-haiku-4-5-20251001-v1:0"),
    // An inference profile's full address carries the company's account number, which is not a model.
    stageRow(4, "opus", "arn:aws:bedrock:us-east-1:111122223333:inference-profile/global.anthropic.claude-opus-4-1-20250805-v1:0"),
    // The same model reached directly is the same model, listed once.
    stageRow(5, "opus", "claude-opus-4-1-20250805"),
  ] });
  assert.deepEqual(servedModels(runDir), ["claude-opus-4-1-20250805", "claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"]);
});

test("servedModels: Google's spelling of a Claude id reads as the dated Claude id", () => {
  const runDir = runWith("vertex", { "matter-frame.jsonl": [
    stageRow(1, "opus", "claude-opus-4-1@20250805"),
    stageRow(2, "sonnet", "claude-sonnet-4-5@20250929"),
    stageRow(3, "opus", "claude-opus-4-1-20250805"),
  ] });
  assert.deepEqual(servedModels(runDir), ["claude-opus-4-1-20250805", "claude-sonnet-4-5-20250929"]);
});

test("servedModels: a company's deployment name reads as Claude and the tier its turn asked for, each tier once", () => {
  const runDir = runWith("deployed", { "matter-frame.jsonl": [
    stageRow(1, "opus", "acme-gold-7"),
    stageRow(2, "opus", "acme-gold-8"),
    // Named after another tier: the tier the turn asked for decides, never the name.
    stageRow(3, "sonnet", "acme-haiku-east"),
    stageRow(4, "haiku", "acme-bronze-1"),
  ] });
  assert.deepEqual(servedModels(runDir), ["Opus", "Sonnet", "Haiku"]);
});

test("servedModels: a native-language turn served under a deployment name reads as Claude and the tier those steps ask for", async () => {
  const runDir = join(ROOT, "jx-door-deployed");
  const row = await readingThroughTheDoor(runDir, SERVED_BY_DEPLOYMENT);
  assert.equal(row.engine, "anthropic", `the call must have reached the program for this test to mean anything: ${JSON.stringify(row)}`);
  assert.equal(row.modelActual, DEPLOYED, "the record keeps what the program reported; only what is published is mapped");
  assert.deepEqual(servedModels(runDir), ["Haiku"]);
});

test("servedModels: a run mixing a Claude id with deployment names keeps first-use order and names each tier once", async () => {
  const runDir = runWith("mixed-deployed", { "matter-frame.jsonl": [
    stageRow(1, "opus", "claude-opus-5"),
    stageRow(2, "haiku", "acme-bronze-1"),
  ] });
  await readingThroughTheDoor(runDir, SERVED_BY_DEPLOYMENT);   // a later haiku turn, under a second deployment
  const ids = servedModels(runDir);
  assert.deepEqual(ids, ["claude-opus-5", "Haiku"]);
  assert.match(servedModelsLine(ids), /Prepared with Claude: claude-opus-5, Haiku\./);
});

test("the CONTROL: a Codex run's ids read as reported", () => {
  const runDir = runWith("codex", { "matter-frame.jsonl": [
    stageRow(1, "opus", "gpt-5.6-sol", "openai-agent"),
    stageRow(2, "haiku", "gpt-5.6-sol", "openai-agent"),
  ] });
  assert.deepEqual(servedModels(runDir), ["gpt-5.6-sol"]);
});

test("servedModels: whose turn it was is read from the vendor of its engine, and an engine nobody places is left off", () => {
  // Every engine the closed vendor table places under Anthropic maps a deployment name to its tier, and an
  // engine it does not name is left off rather than printed as reported.
  const read = (engine, served, tier = "opus") => servedModels(runWith(`vendor-${engine}-${served}`, { "x.jsonl": [stageRow(1, tier, served, engine)] }));
  assert.deepEqual(read("anthropic-direct", "acme-gold"), ["Opus"], "an Anthropic engine printed a deployment name");
  assert.deepEqual(read("anthropic-completions", "acme-gold", "sonnet"), ["Sonnet"], "an Anthropic engine printed a deployment name");
  assert.deepEqual(read("claude-agent-v2", "acme-gold"), [], "an engine no table places printed its id as reported");
  // CONTROLS: an OpenAI engine's id is its model's own name, and a Claude id is one on any engine.
  assert.deepEqual(read("openai", "gpt-5.6-luna"), ["gpt-5.6-luna"]);
  assert.deepEqual(read("claude-agent-v2", "claude-opus-5"), ["claude-opus-5"]);
});

test("servedModels: a row with no engine stamp is read as Claude's only when its id could be Claude's", () => {
  const unstamped = (tag, served) => servedModels(runWith(`unstamped-${tag}`, { "x.jsonl": [
    { ts: at(1), model: "opus", modelActual: served }] }));
  assert.deepEqual(unstamped("gpt", "gpt-5.6-sol"), ["gpt-5.6-sol"], "another vendor's id was printed as a Claude tier");
  assert.deepEqual(unstamped("o-series", "o4-mini"), ["o4-mini"], "another vendor's id was printed as a Claude tier");
  // CONTROL: a deployment name on an unstamped row still reads as the tier, never as the name.
  assert.deepEqual(unstamped("deployment", "acme-gold"), ["Opus"]);
});

test("servedModels: a fable turn under a deployment name reads as Claude and Fable, the tier it asked for", () => {
  // Fable is a tier like the other three: a stage reaches it through the synthesis override, and its turn
  // served under a company's deployment name prints as the tier, never the name. The control that stood
  // here held that such a run listed nothing, because the tier reader did not place fable; reading it is
  // the change, made visibly.
  const ids = servedModels(runWith("fable-deployed", { "matter-frame.jsonl": [
    stageRow(1, "fable", "acme-fable-a"), stageRow(2, "fable", "acme-fable-b")] }));
  assert.deepEqual(ids, ["Fable"], "a fable turn under a deployment name was left off, or printed as the name");
  assert.match(servedModelsLine(ids), /Prepared with Claude: Fable\./);
  assert.match(servedModelsLine(["Fable", "gpt-5.6-sol"]), /Prepared with: Claude Fable, gpt-5\.6-sol\./, "the tier word says its vendor beside another vendor's id");
  // CONTROL: a served fable id is a Claude model's name and prints as itself, as it did before.
  const own = servedModels(runWith("fable-own-id", { "matter-frame.jsonl": [stageRow(1, "fable", "claude-fable-5-1")] }));
  assert.deepEqual(own, ["claude-fable-5-1"]);
  assert.match(servedModelsLine(own), /Prepared with Claude: claude-fable-5-1\./);
});

test("servedModels: a fable request is read for the report alone, whatever name served it and however it is spelled", () => {
  // The gateway's family comparison places none of these and must not: it reads fable as unknown, so a fable
  // turn is never refused for what served it. The report reads the tier itself: under a name that begins
  // with the word or with another tier, and for a request in a pinned id's spelling. Each is read on its own
  // run, so a failure names the case.
  const asked = Object.fromEntries([["fable-prod", "fable"], ["opus-deployment", "fable"], ["acme-fable-a", "claude-fable-5-1"]]
    .map(([served, tier], i) => [`${tier} served as ${served}`,
      servedModels(runWith(`fable-asked-${i}`, { "matter-frame.jsonl": [stageRow(1, tier, served)] }))]));
  assert.deepEqual(asked, { "fable served as fable-prod": ["Fable"], "fable served as opus-deployment": ["Fable"],
    "claude-fable-5-1 served as acme-fable-a": ["Fable"] }, "a fable request's tier was not read, or the name was printed");
});

test("the CONTROL: a deployment whose tier cannot be read is left off the list, never printed", () => {
  // A request for a tier this build does not know gives no tier word to print, and the name must not be
  // printed, so a run made only of such turns lists nothing and renders no line.
  const ids = servedModels(runWith("unplaced-tier", { "matter-frame.jsonl": [
    stageRow(1, "claude-unknown-tier", "acme-unknown-a"), stageRow(2, "claude-unknown-tier", "acme-unknown-b")] }));
  assert.deepEqual(ids, [], "a turn ran, so the list is not null, and no deployment name is listed");
  assert.equal(servedModelsLine(ids), "", "nothing is listed, so no line is rendered");
});

test("servedModels: a deployment named after its tier reads as the tier its stage row asked for", () => {
  // The kind of row says where the request is recorded, whatever the two fields hold: a stage row's
  // `model` is its request even when the served id is spelled the same. Read as a native-language row,
  // each of these would print as the tier those steps ask for, Haiku.
  const runDir = runWith("named-after-tier", { "matter-frame.jsonl": [
    stageRow(1, "opus", "opus"),
    stageRow(2, "sonnet", "sonnet"),
  ] });
  assert.deepEqual(servedModels(runDir), ["Opus", "Sonnet"]);
});

// Ids that have the shape of a Claude model's name, as the catalog, the tests above and Anthropic's
// older models spell them, including a context-window mark the program may report beside the model.
const CLAUDE_IDS = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001", "claude-opus-4-8",
  "claude-opus-4-1-20250805", "claude-sonnet-4-20250514", "claude-sonnet-4-5-20250929", "claude-3-5-sonnet-20241022",
  "claude-3-opus-20240229", "claude-3-5-haiku-20241022", "claude-opus-5[1m]"];
// Names that only begin like one, each with the tier its turn asked for. A `latest` alias is among them:
// it is a pointer the provider moves, never the name of the model a turn reports.
// A family with no version names no model: it is what an operator types for a deployment of that tier, so
// a Sonnet deployment's name on a turn that asked for Haiku reads as Haiku.
const NOT_CLAUDE_IDS = [["claude-acme-prod", "opus"], ["Claude-Acme-EU", "sonnet"], ["claude-opus-4-1-acmelegal", "opus"],
  ["anthropic.claude-acme-private-v1:0", "haiku"], ["claude-opus-5[acme]", "opus"],
  ["claude-sonnet-4-5@latest", "sonnet"], ["claude-3-7-sonnet-latest", "sonnet"],
  ["claude-opus", "opus"], ["claude-sonnet", "haiku"], ["claude-fable", "sonnet"]];
// Each table is read whole and compared once, so a failure shows every entry, not only the first.
const readEach = (tag, pairs) => Object.fromEntries(pairs.map(([id, tier], i) =>
  [id, servedModels(runWith(`${tag}-${i}`, { "x.jsonl": [stageRow(1, tier, id)] }))]));

test("servedModels: an id shaped like a Claude model id prints as itself", () => {
  assert.deepEqual(readEach("claude-shape", CLAUDE_IDS.map((id) => [id, "sonnet"])),
    Object.fromEntries(CLAUDE_IDS.map((id) => [id, [id]])));
});

test("servedModels: a name that only begins like a Claude id reads as the tier its turn asked for", () => {
  assert.deepEqual(readEach("not-claude", NOT_CLAUDE_IDS),
    Object.fromEntries(NOT_CLAUDE_IDS.map(([id, tier]) => [id, [tier[0].toUpperCase() + tier.slice(1)]])),
    "none of these is a Claude model's name");
});

test("servedModels: one model in two cases, or with a cloud's version mark, is one entry", () => {
  const runDir = runWith("spellings", { "x.jsonl": [
    stageRow(1, "opus", "US.ANTHROPIC.CLAUDE-OPUS-4-1-20250805-V1:0"),
    stageRow(2, "opus", "claude-opus-4-1-20250805"),
    // Google marks the version of an older model before the date; Amazon writes the same mark as -v2:0.
    stageRow(3, "sonnet", "claude-3-5-sonnet-v2@20241022"),
    stageRow(4, "sonnet", "anthropic.claude-3-5-sonnet-20241022-v2:0"),
    stageRow(5, "sonnet", "claude-3-5-sonnet-20241022"),
  ] });
  assert.deepEqual(servedModels(runDir), ["claude-opus-4-1-20250805", "claude-3-5-sonnet-20241022"]);
});

test("servedModels: a request in Amazon's spelling is read as the tier it names", () => {
  const runDir = runWith("amazon-request", { "x.jsonl": [stageRow(1, "us.anthropic.claude-opus-4-1-20250805-v1:0", "acme-gold")] });
  assert.deepEqual(servedModels(runDir), ["Opus"]);
});

test("servedModelsLine: a tier word is Claude's, and says so itself in a list that names another vendor", () => {
  assert.match(servedModelsLine(["Opus"]), /Prepared with Claude: Opus\./);
  assert.match(servedModelsLine(["claude-opus-5", "Haiku"]), /Prepared with Claude: claude-opus-5, Haiku\./);
  assert.match(servedModelsLine(["Opus", "gpt-5.6-sol"]), /Prepared with: Claude Opus, gpt-5\.6-sol\./);
});

for (const product of ["clearance", "knockout"]) {
  test(`a ${product} run served through Amazon and Google publishes the Claude ids`, async () => {
    const { meta, data, html } = await publish(`cloud-ids-${product}`, product, [
      stageRow(1, "opus", "us.anthropic.claude-opus-4-1-20250805-v1:0"),
      stageRow(2, "sonnet", "claude-sonnet-4-5@20250929"),
    ]);
    const ids = ["claude-opus-4-1-20250805", "claude-sonnet-4-5-20250929"];
    assert.deepEqual(meta.servedModels, ids, "meta.json");
    assert.deepEqual(data.servedModels, ids, "report-data.json");
    assert.match(footerOf(html), /Prepared with Claude: claude-opus-4-1-20250805, claude-sonnet-4-5-20250929\./, "the footer's provenance line");
    assert.doesNotMatch(html, /anthropic\.claude|@20250929|-v1:0/, "no cloud's spelling reaches the page");
  });

  test(`a ${product} run served under a company's deployment names publishes Claude and the tiers, never the names`, async () => {
    const { meta, data, html } = await publish(`deployed-${product}`, product, [
      stageRow(1, "opus", "acme-gold-7"),
      stageRow(2, "sonnet", "acme-silver-2"),
      stageRow(3, "haiku", "acme-bronze-1"),
      stageRow(4, "opus", "acme-gold-8"),
    ]);
    assert.deepEqual(meta.servedModels, ["Opus", "Sonnet", "Haiku"], "meta.json");
    assert.deepEqual(data.servedModels, ["Opus", "Sonnet", "Haiku"], "report-data.json");
    assert.match(footerOf(html), /Prepared with Claude: Opus, Sonnet, Haiku\./, "the footer's provenance line");
    for (const [where, text] of [["meta.json", JSON.stringify(meta)], ["report-data.json", JSON.stringify(data)], ["the page", html]])
      assert.doesNotMatch(text, COMPANY, `${where} carries no deployment name`);
  });

  test(`a ${product} run mixing a Claude id, a deployment name and a native-language step publishes each tier once`, async () => {
    // The stage's deployment serves Sonnet, so Haiku can come only from the native-language step's record.
    const { meta, data, html } = await publish(`mixed-deployed-${product}`, product, [
      stageRow(1, "opus", "claude-opus-5"),
      stageRow(2, "sonnet", "acme-silver-2"),
    ], (runDir) => readingThroughTheDoor(runDir, SERVED_BY_DEPLOYMENT));
    assert.deepEqual(meta.servedModels, ["claude-opus-5", "Sonnet", "Haiku"], "meta.json");
    assert.deepEqual(data.servedModels, ["claude-opus-5", "Sonnet", "Haiku"], "report-data.json");
    assert.match(footerOf(html), /Prepared with Claude: claude-opus-5, Sonnet, Haiku\./, "the footer's provenance line");
    for (const [where, text] of [["meta.json", JSON.stringify(meta)], ["report-data.json", JSON.stringify(data)], ["the page", html]])
      assert.doesNotMatch(text, COMPANY, `${where} carries no deployment name`);
  });

  test(`a ${product} run whose deployments are named after a tier, or only begin like a Claude id, publishes the tiers`, async () => {
    const { meta, data, html } = await publish(`named-like-claude-${product}`, product, [
      stageRow(1, "opus", "opus"),
      stageRow(2, "sonnet", "claude-acme-prod-eu"),
      stageRow(3, "haiku", "anthropic.claude-acme-private-v1:0"),
    ]);
    assert.deepEqual(meta.servedModels, ["Opus", "Sonnet", "Haiku"], "meta.json");
    assert.deepEqual(data.servedModels, ["Opus", "Sonnet", "Haiku"], "report-data.json");
    assert.match(footerOf(html), /Prepared with Claude: Opus, Sonnet, Haiku\./, "the footer's provenance line");
    for (const [where, text] of [["meta.json", JSON.stringify(meta)], ["report-data.json", JSON.stringify(data)], ["the page", html]])
      assert.doesNotMatch(text, COMPANY, `${where} carries no deployment name`);
  });

  test(`a ${product} run whose fable turns are served under a deployment name publishes Claude and Fable, never the name`, async () => {
    const { meta, data, html } = await publish(`fable-deployed-${product}`, product, [
      stageRow(1, "fable", "acme-fable-a"),
      stageRow(2, "fable", "acme-fable-b"),
    ]);
    assert.deepEqual(meta.servedModels, ["Fable"], "meta.json");
    assert.deepEqual(data.servedModels, ["Fable"], "report-data.json");
    assert.match(footerOf(html), /Prepared with Claude: Fable\./, "the footer's provenance line");
    for (const [where, text] of [["meta.json", JSON.stringify(meta)], ["report-data.json", JSON.stringify(data)], ["the page", html]])
      assert.doesNotMatch(text, COMPANY, `${where} carries no deployment name`);
  });

  test(`the CONTROL: a ${product} run whose fable turn reports its own Claude id publishes that id`, async () => {
    const { meta, data, html } = await publish(`fable-own-id-${product}`, product, [stageRow(1, "fable", "claude-fable-5-1")]);
    assert.deepEqual(meta.servedModels, ["claude-fable-5-1"], "meta.json");
    assert.deepEqual(data.servedModels, ["claude-fable-5-1"], "report-data.json");
    assert.match(footerOf(html), /Prepared with Claude: claude-fable-5-1\./, "the footer's provenance line");
  });

  test(`the CONTROL: a ${product} run on Codex publishes its ids as reported`, async () => {
    const { meta, data, html } = await publish(`codex-${product}`, product, [stageRow(1, "opus", "gpt-5.6-sol", "openai-agent")]);
    assert.deepEqual(meta.servedModels, ["gpt-5.6-sol"], "meta.json");
    assert.deepEqual(data.servedModels, ["gpt-5.6-sol"], "report-data.json");
    const scope = footerOf(html);
    assert.match(scope, /Prepared with: gpt-5\.6-sol\./, "the footer's provenance line");
    assert.doesNotMatch(scope, /Claude/, "a Codex run is not prepared with Claude");
  });
}
