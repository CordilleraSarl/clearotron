// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A SCRIPT NO SEARCH COMPLETED IN REACHES THE MARKDOWN AND THE CONNECTOR. Measured in production notes, 2026-11-19: a
// native-script search the run did not complete was stated only in the overview's Methodology note, which the page does
// not show. The page now lists such a gap under "Left open", and the report's Markdown, which the connector serves when
// a client's assistant asks for the report, lists the same rows (design, 2026-11-19).
//
// One run is assembled here: its register plan put a Han spelling to the register for two territories and the search
// did not complete, and its record carries the Chinese-script row a run writes when those equivalents were not part of
// its search. What is read is the assembled report.md and the connector's answer to a client asking for the report:
// both rows, in the words the page's own rows carry. Every name is invented.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

const ROOT = mkdtempSync(join(tmpdir(), "script-gap-left-open-"));
after(() => rmSync(ROOT, { recursive: true, force: true }));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));

const { assembleReportMd, ZH_SCOPE_COVERAGE_AREA, ZH_SCOPE_COVERAGE_NOTE } = await import("../pipeline.mjs");
const { paths: stagePaths } = await import("../stages.mjs");
const { leftOpenRows } = await import("../publish/render.mjs");
const { localScripts } = await import("../publish/search-depth.mjs");
const { parseFront, parseSections } = await import("../publish/parse.mjs");
const { config } = await import("../driver.config.mjs");

const CODENAME = "amber-lattice";
const dir = join(config.studioRootForAgent("mailagent"), "quillmere", `2026-11-19-${CODENAME}`);   // where the connector finds a run
const P = stagePaths(dir);
mkdirSync(driverDir(dir), { recursive: true });
mkdirSync(join(dir, "report-cards"), { recursive: true });
writeFileSync(join(dir, "status.json"), JSON.stringify({ schema: 1, state: "done", slug: "quillmere", codename: CODENAME, markName: "QUILLMERE" }));
writeFileSync(P.reportOverview, "---\ntitle: QUILLMERE\n---\n\n# Actions\n\n### Checks we ran — what we found\n\n- A register search of QUILLMERE in the EU found no conflicting mark.\n");
const CJK_ROW = { area: ZH_SCOPE_COVERAGE_AREA, state: "coverage-limited", note: ZH_SCOPE_COVERAGE_NOTE };
writeFileSync(P.findings, JSON.stringify({ schema_version: 2, findings: [], coverage: [CJK_ROW] }, null, 2) + "\n");
const PLAN = { entries: [{ qid: "q1", term: "QUILLMERE", regions: ["EU"] }, { qid: "q2", term: "奎尔梅尔", regions: ["CN", "TW"] }] };
const EXECUTION = { executed: [{ qid: "q1", state: "enumerated" }, { qid: "q2", state: "failed" }] };
writeFileSync(driverDir(dir, "register-plan.json"), JSON.stringify(PLAN));
writeFileSync(driverDir(dir, "plan-execution.json"), JSON.stringify(EXECUTION));
assembleReportMd(P, [], []);

// The rows the page draws for this run, which the Markdown must carry.
const PAGE_ROWS = leftOpenRows({ coverage: [CJK_ROW], localScripts: localScripts(PLAN, EXECUTION) });

test("premise: the page draws the Chinese-script row and a script-gap row for this run", () => {
  assert.ok(PAGE_ROWS.some((r) => r.note === ZH_SCOPE_COVERAGE_NOTE), "the page draws no Chinese-script row");
  assert.ok(PAGE_ROWS.length >= 2, `the page draws no script-gap row for the Han search: ${JSON.stringify(PAGE_ROWS)}`);
});

test("the assembled report.md lists every row the page draws, under Left open, before the cards", () => {
  const text = readFileSync(P.report, "utf8");
  const secs = parseSections(parseFront(text).body);
  assert.deepEqual(Object.keys(secs).slice(0, 3), ["Actions", "Left open", "Marks"]);
  for (const r of PAGE_ROWS) assert.ok(secs["Left open"].includes(String(r.note).trim()), `Left open lacks the page's row: ${r.note}`);
});

test("the connector's answer to a client asking for the report carries the same rows", async () => {
  const { tools, presentForPrincipal } = await import("../../mcp-server/server.mjs");
  const answer = presentForPrincipal({ kind: "user", runId: CODENAME }, "read_artifact", tools.read_artifact({ runId: CODENAME, name: "report" }));
  const left = parseSections(parseFront(String(answer?.text ?? "")).body)["Left open"] ?? "";
  for (const r of PAGE_ROWS) assert.ok(left.includes(String(r.note).trim()), `the client's report answer lacks the page's row: ${r.note}`);
});
