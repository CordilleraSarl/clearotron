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
//     report-data.json and the rendered scope section, and the control run with no rows writes none.
//
// SAFETY: driver.config reads env at module load and its pool-root default is the real archive, so the
// env is pinned before any product module is imported.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
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
const { servedModels } = await import("../tokens.mjs");
const { servedModelsLine } = await import("../publish/render.mjs");
const { publishReport } = await import("../publish/index.mjs");
const { publishKnockout } = await import("../publish/knockout.mjs");

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

async function publish(tag, product, rows) {
  const runDir = join(ROOT, `pub-${tag}`);
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(join(runDir, "status.json"), JSON.stringify({ runId: `fixture-${tag}`, markName: "KURENA" }));
  writeFileSync(join(runDir, "report.md"), "# Clearance report\n\nBody text.\n");
  writeFileSync(join(runDir, "findings.json"), JSON.stringify({ schema_version: 6, findings: [] }));
  writeFileSync(driverDir(runDir, "profile.json"), JSON.stringify({ key: `${tag}-key` }));
  if (rows) writeFileSync(driverDir(runDir, "matter-frame.jsonl"), jsonl(rows));
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
