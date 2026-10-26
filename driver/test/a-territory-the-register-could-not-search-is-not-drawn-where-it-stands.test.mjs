// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A TERRITORY THE REGISTER COULD NOT SEARCH IS NOT DRAWN ON "WHERE IT STANDS".
//
// The section chipped every planned country with no banded finding "Nothing found", reading the plan alone. A
// planned slice the register could not search is deferred on the run's plan-execution receipt, so a country that
// slice covers was chipped clean over a search that never happened. Such a country is now left off the section: no
// row, no chip and no new wording. A country where a finding sits keeps its band row, and a run whose receipt
// deferred nothing is drawn exactly as before. Every mark and owner is invented.
//
// SAFETY: driver.config reads env at module load and its pool-root default is the real archive, so the env is
// pinned before any product module is imported.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
const ROOT = mkdtempSync(join(tmpdir(), "clearotron-unsearched-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool-default"));
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
delete process.env.CLEAROTRON_MCP_URL;
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { driverDir } from "../../shared/driver-dir.mjs";
const { planTerritoriesOf } = await import("../publish/search-depth.mjs");
const { renderHtml } = await import("../publish/render.mjs");
const { parseReport } = await import("../publish/parse.mjs");
const { PUBLISH_INPUTS } = await import("../publish/publish-inputs.mjs");
const { STORE_PARTS } = await import("../degraded-parts.mjs");
const { publishReport } = await import("../publish/index.mjs");

after(() => rmSync(ROOT, { recursive: true, force: true }));

const REASON = "the provider cannot express this query";
const PLAN = { entries: [{ qid: "a", regions: ["JP", "KR"] }, { qid: "b", regions: ["FR"] }, { qid: "c", regions: ["KR"] }] };
const deferring = (...qids) => ({ deferred: qids.map((qid) => ({ qid, reason: REASON })) });

let n = 0;
const parsedReport = () => {
  const path = join(ROOT, `f-${++n}.report.md`);
  writeFileSync(path, ["---", "type: clearance-clearance", "matter: TMP8915", "title: QUILVANTE",
    "overall_label: LOW", "overall_badge: l1", "overall_caption: low overall.", "classes: 9 · 42",
    "jurisdiction: Japan, South Korea and France", "run: 2026-10-26", "---", "", "# Marks", ""].join("\n"));
  return parseReport(path);
};
// Read inside the section's own panel, as the render arms do: the page draws chips elsewhere too.
const panelOf = (html) => {
  const i = html.indexOf('class="panel where"');
  if (i === -1) return "";
  const j = html.indexOf('<div class="sec"', i);
  return j === -1 ? html.slice(i) : html.slice(i, j);
};
const drawn = (html) => {
  const panel = panelOf(html);
  return {
    rows: [...panel.matchAll(/<span class="rcode">([^<]*)<\/span>/g)].map((m) => m[1]),
    chips: [...panel.matchAll(/<span class="wchip" title="([^"]*)">/g)].map((m) => m[1]).sort(),
  };
};
const DEPTH = { counts: { recordsByCountry: { JP: 3, KR: 1, FR: 2 }, courtDecisions: "not-in-scope" } };
const IN_KR = [{ ordinal: 1, mark: "QUILVANTA", band: "Moderate", owner: { name: "Ostravel Quine Ltd", country: "KR", registrations: [
  { uri: "https://tm.example/mark/kr/4021", classes: ["9"], status: "Registered" }] },
  composite: 2, level: "B", dispute_type: "register-only", source: { source_type: "register-vendor" } }];

test("the territories of a planned slice the receipt deferred are open, and a receipt that deferred none adds nothing", () => {
  const before = { searched: ["JP", "KR", "FR"], unreached: [] };
  assert.deepEqual(planTerritoriesOf(PLAN), before, "a run with no receipt changed shape");
  assert.deepEqual(planTerritoriesOf(PLAN, null), before, "an absent receipt changed shape");
  assert.deepEqual(planTerritoriesOf(PLAN, { deferred: [] }), before, "a receipt that deferred nothing added an open list");
  assert.deepEqual(planTerritoriesOf(PLAN, deferring("a")).open, ["JP", "KR"]);
  // A deferred question the plan does not hold, a follow-up a worker added, names no planned territory.
  assert.deepEqual(planTerritoriesOf(PLAN, deferring("follow-up-1")), before, "a deferred question outside the plan opened a territory");
});

test("a country a deferred slice covers is not drawn, and a country with a finding keeps its band row", () => {
  const parsed = parsedReport();
  const plain = drawn(renderHtml(parsed, IN_KR, [], { searchDepth: DEPTH, planTerritories: planTerritoriesOf(PLAN) }));
  assert.deepEqual(plain, { rows: ["KR"], chips: ["France", "Japan"] },
    "premise: with nothing deferred, the finding's country is a row and the other two are chipped");
  const html = renderHtml(parsed, IN_KR, [], { searchDepth: DEPTH, planTerritories: planTerritoriesOf(PLAN, deferring("a")) });
  const open = drawn(html);
  assert.deepEqual(open.rows, ["KR"], "a country holding a finding lost its row because a deferred slice also covers it");
  assert.deepEqual(open.chips, ["France"], `a country only a deferred slice covers was chipped Nothing found: ${JSON.stringify(open.chips)}`);
  assert.doesNotMatch(panelOf(html), /Japan|>JP</, "the country left out is still drawn in the section");
  assert.ok(!html.includes(REASON), "the deferral's reason reached the page");
});

test("with every planned country deferred and no finding, the section is not drawn", () => {
  const html = renderHtml(parsedReport(), [], [], { searchDepth: DEPTH, planTerritories: planTerritoriesOf(PLAN, deferring("a", "b", "c")) });
  assert.doesNotMatch(html, /Where it stands/, "a section holding only countries nobody searched was drawn");
});

test("the publisher reads the receipt as an optional input that feeds the register part", () => {
  assert.equal(PUBLISH_INPUTS["_driver/plan-execution.json"], "optional", "a run with no receipt would be recorded as missing an input");
  assert.equal(STORE_PARTS["_driver/plan-execution.json"], "register");
});

// AT THE DOOR: the same run published with and without the receipt, through the ordinary publisher.
async function publish(tag, receipt) {
  const runDir = join(ROOT, `run-${tag}`);
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(join(runDir, "status.json"), JSON.stringify({ runId: `fixture-${tag}`, markName: "QUILVANTE" }));
  writeFileSync(join(runDir, "report.md"), "# Clearance report\n\nBody text.\n");
  writeFileSync(join(runDir, "findings.json"), JSON.stringify({ schema_version: 6, findings: [] }));
  writeFileSync(driverDir(runDir, "profile.json"), JSON.stringify({ key: `${tag}-key` }));
  writeFileSync(driverDir(runDir, "register-plan.json"), JSON.stringify(PLAN));
  if (receipt) writeFileSync(driverDir(runDir, "plan-execution.json"), JSON.stringify(receipt));
  const poolRoot = join(ROOT, `pool-${tag}`);
  mkdirSync(poolRoot, { recursive: true });
  const runId = `tmp8915-2026-10-26-${tag}`;
  await publishReport({ runId, codename: tag, runDir, poolRoot, poolUrl: "https://trademark.test", customerKey: `${tag}-key`,
    skipRegen: true, reportMd: join(runDir, "report.md"), findingsJson: join(runDir, "findings.json") });
  return readFileSync(join(poolRoot, runId, "report.html"), "utf8");
}

test("a published run whose receipt deferred a slice draws none of its countries, and one that deferred none is unchanged", async () => {
  const none = drawn(await publish("no-receipt", null));
  assert.deepEqual(none, { rows: [], chips: ["France", "Japan", "South Korea"] }, "premise: the plan's three countries are chipped");
  assert.deepEqual(drawn(await publish("nothing-deferred", { deferred: [] })), none, "a receipt that deferred nothing changed the section");
  assert.deepEqual(drawn(await publish("one-deferred", deferring("a"))), { rows: [], chips: ["France"] },
    "a country a deferred slice covers was chipped Nothing found on the published page");
});
