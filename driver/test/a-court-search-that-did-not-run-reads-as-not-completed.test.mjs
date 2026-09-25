// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the real publisher over a copy of the committed full country demo, and reads what it wrote
//
// A court-decisions search that failed, or whose source was down, reads "could not be completed" on the
// report: in the Court decisions section, on the row, and on the gauge. It never reads "found" or "none
// found". The state comes from the pass's own record (its last attempt, its retrieval record, and the calls
// its source answered), so this drives the whole path rather than the state function alone: a run
// directory with each kind of record, published by the publisher, and the page it wrote.
//
// The demo is the fixture because it is a real full country run with a case-law file. Each variant copies
// it and changes only the case-law pass's files, so any difference on the page is the court state's.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
// SAFETY: driver.config reads env at module load and its pool-root default is the real archive. Pin first.
const ROOT = mkdtempSync(join(tmpdir(), "court-state-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool-default"));
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
pinEnv(process.env, "CLEAROTRON_DATABASE", "corsearch");
delete process.env.CLEAROTRON_MCP_URL;
import { test } from "node:test";
import assert from "node:assert/strict";
import { driverDir } from "../../shared/driver-dir.mjs";
const { publishReport } = await import("../publish/index.mjs");
const { CASELAW_BRIDGES } = await import("../engine/mcp/gather-config.mjs");

const DEMO = join(import.meta.dirname, "..", "..", "demo", "full-country-search", "run");

// The case-law file's words, in the shapes the pass writes. Neither carries an outage phrase, so without a
// record the first reads found and the second none found.
const CITES = "## Case-law grounding\n\n### Grounded profile — the proposed mark vs the first finding (Japan)\n- ord: 1\n**On-point authorities:**\n- District Court, 2019: two coined marks sharing a prefix held confusable.\n";
const NONE = "## Case-law grounding\n\n### Grounded profile — the proposed mark vs the first finding (Japan)\n- ord: 1\n**No on-point precedent found.**\n\n### Grounded profile — the proposed mark vs the second finding (Japan)\n- ord: 2\n**No on-point precedent found.**\n";
const MIXED = `${CITES}\n### Grounded profile — the proposed mark vs the second finding (Japan)\n- ord: 2\n**No on-point precedent found.**\n`;

const ledger = ({ results = [], citations = 0 } = {}) => JSON.stringify({
  schema_version: 1,
  queries: results.map((n, i) => ({ query: `query ${i + 1}`, jurisdiction: "JP", results: n })),
  citations: Array.from({ length: citations }, (_, i) => ({ proceeding: `Case ${i + 1}`, forum: "District Court", jurisdiction: "JP",
    decided: "2019", url: `https://courts.example/${i + 1}`, read: "read", ord: i + 1, bearing: "grounds the finding" })),
});
const jsonl = (...rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
const attempts = (...oks) => jsonl(...oks.map((ok, i) => ({ attempt: i + 1, ok })));

let seq = 0;
async function publish({ words = null, attemptsJsonl = null, ledgerRaw = null, readingLog = null } = {}) {
  const tag = `v${++seq}`;
  const runDir = join(ROOT, `run-${tag}`);
  cpSync(DEMO, runDir, { recursive: true });
  mkdirSync(driverDir(runDir), { recursive: true });
  if (words != null) writeFileSync(join(runDir, "case-law-findings.md"), words);
  if (attemptsJsonl != null) writeFileSync(driverDir(runDir, "case-law.jsonl"), attemptsJsonl);
  if (ledgerRaw != null) writeFileSync(join(runDir, "case-law-citations.json"), ledgerRaw);
  if (readingLog != null) writeFileSync(driverDir(runDir, "reading-log.jsonl"), readingLog);
  const poolRoot = join(ROOT, `pool-${tag}`);
  mkdirSync(poolRoot, { recursive: true });
  const runId = `tmp0945-2026-09-25-${tag}`;
  await publishReport({ runId, codename: tag, runDir, poolRoot, poolUrl: "https://trademark.test", customerKey: "harbour",
    skipRegen: true, reportMd: join(runDir, "report.md"), findingsJson: join(runDir, "findings.json") });
  const out = join(poolRoot, runId);
  return { html: readFileSync(join(out, "report.html"), "utf8"), state: JSON.parse(readFileSync(join(out, "search-depth.json"), "utf8")).counts.courtDecisions };
}

// The page, in the three places the state shows: the section, the row and the gauge.
const PAGE = {
  "not-checked": ["Case-law research could not be completed for Japan.", '<span class="wstate">Not searched</span><span class="wnote">Case-law research could not be completed for Japan.</span>', "court decisions could not be checked"],
  "none-found": ["Court decisions: none found for Japan.", '<span class="wstate">None found</span>', "court decisions checked, none touch the name"],
  "found": ["Court decisions were searched for Japan and are cited against the findings above.", '<span class="wstate">Found</span>', "court decisions checked"],
};
function assertPage({ html, state }, want, label) {
  assert.equal(state, want, `${label}: the recorded state`);
  for (const s of PAGE[want]) assert.ok(html.includes(s), `${label}: the page says "${s}"`);
  for (const [other, lines] of Object.entries(PAGE)) {
    if (other === want) continue;
    assert.ok(!html.includes(lines[0]), `${label}: the page must not also say "${lines[0]}"`);
  }
}

test("a pass that failed its check but left its file reads could not be completed", async () => {
  assertPage(await publish({ words: CITES, attemptsJsonl: attempts(false, false), ledgerRaw: ledger({ results: [2], citations: 1 }) }), "not-checked", "failed");
  // THE CONTROL: the same file with no record reads found, which is what the failed pass used to print.
  assertPage(await publish({ words: CITES }), "found", "the same words, no record");
});

test("a pass whose every query came back at 0 reads could not be completed, until its source is seen answering", async () => {
  const zeros = { words: NONE, attemptsJsonl: attempts(true), ledgerRaw: ledger({ results: [0, 0, 0, 0] }) };
  assertPage(await publish(zeros), "not-checked", "zeros");
  const answered = await publish({ ...zeros, readingLog: jsonl({ tool: `${CASELAW_BRIDGES[0]}__search`, ok: true }) });
  assertPage(answered, "none-found", "zeros, and the source answered");
  assert.ok(!answered.html.includes('class="clstrand"'), "none found puts no strand on a card, as before");
});

test("a pass that cited a decision reads found and keeps its strand, even where one profile found nothing", async () => {
  const cited = await publish({ words: MIXED, attemptsJsonl: attempts(true), ledgerRaw: ledger({ results: [2, 0], citations: 1 }) });
  assertPage(cited, "found", "cited");
  assert.ok(cited.html.includes('class="clstrand"'), "the card the authority grounds carries its strand");
  // THE CONTROL: read by its words, the second profile's none found took the whole pass and every strand.
  const words = await publish({ words: MIXED });
  assertPage(words, "none-found", "the same words, no record");
  assert.ok(!words.html.includes('class="clstrand"'));
});

test("the committed demo, which kept no record and says its source was unavailable, reads could not be completed", async () => {
  assertPage(await publish(), "not-checked", "the demo as committed");
});
