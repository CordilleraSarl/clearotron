// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// no-client-surface-speaks-the-delivery-gates-word.test.mjs — the band and the run's own sentence reach a
// client; the delivery gate's word stays in the run record.
//
// Measured on a delivered run (2026-09-20): the sidecar held verdict BLOCKING with tier Medium, and
// status.json held the verdict and no band at all. The assistant read the run and told the client it was
// delivered BLOCKING, beside a report rating of Medium; the delivery email's banner said the same. Both
// reached for the gate's word because it was the only outcome word recorded where they look.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { composeEmailHtml } from "../publish/index.mjs";
import { riskStatement } from "../findings-model.mjs";
const require_mcp = await import("../../mcp-server/lib/runs.mjs");

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const GATE = "BLOCKING";
const STATEMENT = riskStatement({ tier: "Medium", verdict: GATE });

const REPORT = ["---", "type: clearance-clearance", "matter: tmp9-demo", "title: INVENTED MARK",
  "overall_label: MEDIUM", "overall_badge: l3", "overall_caption: medium overall.",
  "classes: 9", "jurisdiction: United States only", "run: 2026-09-20", "---", "",
  "# Findings", "## Invented Owner", "- one: An invented conflict.", "### The read", "An invented read."].join("\n");

// RULED 2026-09-22: the report is the master. The short surfaces quote the rating and the report's own
// conclusion; the composed statement no longer heads them, and nothing says "on hold".
test("the rating and the report's own conclusion, not the gate's word or a second summary, head the delivery email", () => {
  const dir = mkdtempSync(join(tmpdir(), "gate-word-"));
  const md = join(dir, "report.md");
  writeFileSync(md, REPORT);
  const html = composeEmailHtml(md, "https://portal.example/report/r1", "audit.xlsx", ["Invented Owner"],
    { email: "table", privileged: true }, { verdict: GATE, tier: "Medium", statement: STATEMENT, conditions: [] });
  assert.ok(html.includes("<b>Overall risk: Medium.</b> medium overall."), "the banner does not lead with the rating, then the report's conclusion");
  assert.ok(!html.includes(GATE), "the delivery gate's word is on a client-facing email");
  assert.doesNotMatch(html, /on hold/i, "the email says the matter is on hold, and nothing holds it");
  // A run recorded before statements were persisted reads the same way: its gate word is not a banner.
  const legacy = composeEmailHtml(md, "https://portal.example/report/r1", "audit.xlsx", ["Invented Owner"],
    { email: "table", privileged: true }, { verdict: GATE, tier: "Medium", conditions: [] });
  assert.ok(legacy.includes("<b>Overall risk: Medium.</b> medium overall."));
  assert.ok(!legacy.includes(GATE), "a legacy run's email still prints the gate's word");
});

test("the assistant's row and briefing carry the band and the sentence, and no gate word", async () => {
  // The row is built inside the enumerator and has no export to drive, so it is read where it is written.
  const rows = readFileSync(join(ROOT, "mcp-server", "lib", "runs.mjs"), "utf8");
  assert.match(rows, /tier: s\.tier \?\? bandWord\(s\.verdict\) \?\? tierFromRecord\(runDir\), caption: s\.caption \?\? null/,
    "the run row does not carry the band and the report's conclusion");
  assert.doesNotMatch(rows, /statement: s\.statement/, "the run row still carries a second summary");
  // A run recorded before the band was written has one in its verdict record, and the row reads it there
  // rather than leaving an assistant with the gate's word and nothing beside it.
  assert.match(rows, /function tierFromRecord\(runDir\)/, "an older run's band is not recovered");
  assert.doesNotMatch(rows, /state: s\.state \?\? null, verdict: s\.verdict/, "the run row still carries the gate's word");
  const server = readFileSync(join(ROOT, "mcp-server", "server.mjs"), "utf8");
  assert.doesNotMatch(server, /verdict: run\.verdict/, "a raw row still hands an assistant the gate's word");
  assert.match(server, /state: run\.state, location: run\.location, tier: run\.tier, caption: run\.caption/,
    "the single-run row does not carry the band and the report's conclusion");
  // The knockout lane records its BAND in the same field, and every archived run has only that field.
  assert.match(rows, /const GATE_WORDS = new Set\(\["CLEAR", "CONDITIONAL", "BLOCKING"\]\)/);
  assert.match(rows, /return w && !GATE_WORDS\.has\(w\.toUpperCase\(\)\) \? w : null;/,
    "a gate word would be read as a rating band");
  const src = readFileSync(join(ROOT, "mcp-server", "lib", "brief.mjs"), "utf8");
  assert.doesNotMatch(src, /reviewer verdict: \$\{run\.verdict\}/, "the briefing still prints the gate's word");
  assert.doesNotMatch(src, /\?\? run\.verdict \?\? null/, "the overall-risk line still falls through to the gate's word");
  assert.doesNotMatch(src, /lines\.push\(String\(run\.statement\)\)/, "the briefing still carries a second summary");
  assert.match(src, /const caption = clearance \? \(clearance\.caption \?\? ""\) : plainClause\(fm\.overall_caption \?\? ""\);/,
    "the briefing does not quote the report's conclusion");
});

test("a run recorded before the band was written still shows one, read from its verdict record", () => {
  const { tierFromRecord, bandWord } = require_mcp;
  const dir = mkdtempSync(join(tmpdir(), "older-run-"));
  mkdirSync(join(dir, "_driver"), { recursive: true });
  writeFileSync(join(dir, "_driver", "verdict.json"), JSON.stringify({ verdict: GATE, tier: "Medium" }));
  assert.equal(bandWord(GATE), null, "precondition: a gate word is never read as a band");
  assert.equal(tierFromRecord(dir), "Medium", "an older run is left with the gate's word and no band");
  assert.equal(tierFromRecord(mkdtempSync(join(tmpdir(), "no-record-"))), null, "a missing record is an absence, not a guess");
});

test("the driver records the band and the sentence on the run's status", () => {
  const src = readFileSync(join(ROOT, "driver", "pipeline.mjs"), "utf8");
  assert.match(src, /writeRunStatus\(ctx, \{ tier: derived\.tier \?\? null, statement: statement \?\? null \}\)/,
    "status.json carries no band, so every summary must reach for the gate's word again");
});
