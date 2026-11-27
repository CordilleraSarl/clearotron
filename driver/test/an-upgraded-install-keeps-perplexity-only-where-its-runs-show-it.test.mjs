// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN UPGRADED INSTALLATION IS GIVEN PERPLEXITY ONCE, AND ONLY WHERE ITS OWN RUNS SHOW RESEARCH RAN THERE
// (web-research-upgrade.mjs).
//
// The evidence is a run's record of research Perplexity completed: a question or grid in its call log, a replay
// excluded, or a Knockout sweep Perplexity completed. A key, a refused order, a Knockout whose web half was skipped or
// failed, and a fixture or injected sweep are not evidence. A run on any other service, or recorded with none, means
// the record cannot settle it and nothing is written. A setting already named, valid or not, is the operator's choice
// and stands. Archived runs count as live ones do.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { questionRecordsPath, searchRecordsPath } from "../engine/mcp/own-search.mjs";
import { installationRunDirs, researchOnRecord, webResearchToAdd, UPGRADE_NOTE } from "../web-research-upgrade.mjs";
import { runRequiredNames } from "../run-requirements.mjs";
import { studioDirFor } from "../../shared/pre-rename-spellings.mjs";

const TEMP = [];
after(() => { for (const d of TEMP) rmSync(d, { recursive: true, force: true }); });
const workspace = () => { const d = mkdtempSync(join(tmpdir(), "web-research-upgrade-")); TEMP.push(d); return d; };

let seq = 0;
/** One run folder under `root`'s workspace, live or archived, holding the given `_driver` files. */
function aRun(root, { archived = false, readingLog = null, sweep = null, choices = null, ownRecords = false } = {}) {
  const studio = studioDirFor(join(root, "workspace-main"));
  const dir = archived ? join(studio, "archive", "2026-10", "probe-slug", `run-${++seq}`) : join(studio, "probe-slug", `run-${++seq}`);
  mkdirSync(join(dir, "_driver"), { recursive: true });
  writeFileSync(join(dir, "status.json"), JSON.stringify({ state: "delivered", codename: `probe-${seq}` }));
  const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  if (readingLog) writeFileSync(join(dir, "_driver", "reading-log.jsonl"), jsonl(readingLog));
  if (sweep) writeFileSync(join(dir, "_driver", "knockout-sweep.jsonl"), jsonl(sweep));
  if (choices) writeFileSync(join(dir, "_driver", "run-choices.json"), JSON.stringify({ schema: 1, engine: "anthropic-agent", register: null, ...choices }));
  if (ownRecords) { mkdirSync(dirname(searchRecordsPath(dir)), { recursive: true }); writeFileSync(searchRecordsPath(dir), jsonl([{ query: "probe", outcome: "results" }])); }
  return dir;
}
const asked = (over = {}) => ({ tool: "perplexity_research", args: { task: "who uses the name", ...over.args }, ok: true, ...over.row });
const swept = (over = {}) => ({ mark: "QZORVAK", executor: "perplexity", ok: true, ...over });

test("research Perplexity completed is evidence; a replay, a failure, a skip and a fixture are not", () => {
  const root = workspace();
  const cases = [
    [{ readingLog: [asked()] }, true, "a question Perplexity answered"],
    [{ readingLog: [asked({ args: { grid: true } })] }, true, "a grid Perplexity ran"],
    [{ sweep: [swept()] }, true, "a Knockout sweep Perplexity completed"],
    [{ readingLog: [asked({ args: { replay: true } })] }, false, "a replay answered from the run's own saved research"],
    [{ readingLog: [asked({ row: { ok: false, error: "refused" } })] }, false, "a question that did not complete"],
    [{ readingLog: [{ tool: "register_search", args: { task: "x" }, ok: true }] }, false, "another tool's call"],
    [{ sweep: [swept({ ok: false, cause: "grid: timeout" })] }, false, "a sweep that failed"],
    [{ sweep: [swept({ executor: "injected" })] }, false, "an injected sweep"],
    [{ sweep: [swept({ executor: "fixtures:/x" })] }, false, "a fixture sweep"],
    [{}, false, "an order refused before it ran, which searched nothing"],
  ];
  for (const [files, perplexity, what] of cases)
    assert.equal(researchOnRecord(aRun(root, files)), perplexity ? "perplexity" : null, what);
  assert.equal(researchOnRecord(aRun(root, { choices: { research: "own" } })), "other", "a run recorded on its own AI program's search");
  assert.equal(researchOnRecord(aRun(root, { choices: { research: null } })), "other", "a run recorded with no service chosen");
  assert.equal(researchOnRecord(aRun(root, { ownRecords: true, readingLog: [asked()] })), "other", "a run holding its own search's records");
  const asksOwn = aRun(root, { sweep: [swept()] });
  mkdirSync(dirname(questionRecordsPath(asksOwn)), { recursive: true });
  writeFileSync(questionRecordsPath(asksOwn), JSON.stringify({ kind: "question", service: "own:claude" }) + "\n");
  assert.equal(researchOnRecord(asksOwn), "other", "a run whose questions its own AI program answered");
  assert.equal(researchOnRecord(aRun(root, { choices: { research: "perplexity" }, readingLog: [asked()] })), "perplexity");
});

test("an installation whose runs show Perplexity research, and nothing else, is given the setting once", () => {
  const root = workspace();
  aRun(root, { readingLog: [asked()] });
  aRun(root, { archived: true, sweep: [swept()] });
  aRun(root, {});   // a refused order: no research, and no other service either
  const dirs = installationRunDirs(root);
  assert.equal(dirs.length, 3, "live and archived runs are both read");
  assert.deepEqual(webResearchToAdd({ PERPLEXITY_API_KEY: "k" }, dirs), { add: { CLEAROTRON_WEB_RESEARCH: "perplexity" }, runs: 2 });
  assert.equal(UPGRADE_NOTE, "Perplexity was used on this installation before upgrade. To change it, run npx clearotron install.");
});

test("a choice already named stands, valid or not, and a record that cannot settle it writes nothing", () => {
  const root = workspace();
  aRun(root, { readingLog: [asked()] });
  const dirs = installationRunDirs(root);
  for (const v of ["own", "perplexity", "google"])
    assert.deepEqual(webResearchToAdd({ CLEAROTRON_WEB_RESEARCH: v }, dirs), { add: null, why: "chosen" }, `${v}: the operator's line wins`);
  aRun(root, { archived: true, choices: { research: "own" } });
  assert.deepEqual(webResearchToAdd({}, installationRunDirs(root)), { add: null, why: "mixed" }, "one run on another service: setup asks");
  assert.deepEqual(webResearchToAdd({ PERPLEXITY_API_KEY: "k" }, []), { add: null, why: "none" }, "a key with no research on record is not a history");
  const knockoutOnly = workspace();
  aRun(knockoutOnly, { sweep: [swept({ ok: false, cause: "open-web research did not run — no research credential on this deployment" })] });
  assert.deepEqual(webResearchToAdd({}, installationRunDirs(knockoutOnly)), { add: null, why: "none" }, "a Knockout whose web search never ran");
  assert.deepEqual(installationRunDirs(join(knockoutOnly, "absent")), [], "no workspace, no runs");
});

test("the setting is carried to the services' file beside the research key", () => {
  const names = runRequiredNames({ CLEAROTRON_WEB_RESEARCH: "perplexity" });
  assert.ok(names.includes("CLEAROTRON_WEB_RESEARCH"));
  assert.ok(names.includes("PERPLEXITY_API_KEY"));
});
