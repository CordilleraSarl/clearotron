// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHAT THIS IS FOR. `dedupeFollowUps` drops a driver-composed "Follow-up / …" coverage row when another
// row already says the same thing about the same search. It decides that by word containment, and over a
// short directive containment matches rows that merely mention the word — so an open slice the run had
// deliberately disclosed never reached the page, while staying correct in findings.json.
//
// Measured on a delivered report: 33 coverage entries, 31 rendered cells. The two missing were open park
// rows with a one-word and a two-word directive. Every row containing either directive was axis-labelled
// `register`. The verdict was still clamped to CONDITIONAL and still correct; what the client lost was
// the row saying WHICH ground was left open — the disclosure that doctrine rests on.
//
// THESE ARMS RENDER. The defect is in what reaches the page, not in what the composer writes: a test over
// the composer's output passes throughout. Each arm counts cells in real HTML.
import { test } from "node:test";
process.env.CLEAROTRON_MCP_URL ||= "https://mcp.test/mcp";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseReport } from "../publish/parse.mjs";
import { renderHtml } from "../publish/render.mjs";

const REPORT = "# Clearance read\n\n## Overall\n\nMEDIUM\n\n## What we found\n\nNothing notable.\n";

function parsed() {
  const dir = mkdtempSync(join(tmpdir(), "clearotron-shortslice-"));
  const path = join(dir, "f.report.md");
  writeFileSync(path, REPORT);
  try { return parseReport(path); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

const cells = (coverage) =>
  (renderHtml(parsed(), [], coverage, { runId: "shortslice" }).match(/class="covcell/g) || []).length;

// WHAT THE PAGE DRAWS CHANGED UNDER THIS ARM, AND THE PROPERTY DID NOT. The report used to carry a grid
// of every coverage row, clean and open alike; the redesign (tracker issue 644) shows completed work as
// counts and draws only what was LEFT OPEN, because a client reading a list of searches that succeeded
// is reading the engine's account of itself. So the expected cell count is the OPEN population, not the
// whole ledger. The thing these arms exist for is untouched: a disclosed open slice must still reach the
// page, and a row that merely mentions its word must not erase it.
const CLEAN = new Set(["confirmed-clean", "searched-clean", "clean"]);
const openOnly = (coverage) => coverage.filter((c) => !CLEAN.has(c.state));

// Invented ground throughout. No client content reaches a fixture.
const park = (directive) => ({
  area: `Follow-up / ${directive}`,
  state: "open",
  note: `${directive} — not completed this run — the earlier search session could not be resumed to finish it, so the slice was left open rather than reported as clean`,
});

test("an axis-labelled row does not erase the open slice it merely mentions", () => {
  // Shape A as measured: a one-word directive, and an OPEN register unit containing that word.
  const coverage = [
    park("eu"),
    { area: "register / eu filings for the house mark", state: "open", note: "the eu register sweep is still open" },
    { area: "register / us", state: "confirmed-clean", note: "clean" },
  ];
  assert.equal(cells(coverage), openOnly(coverage).length,
    "a disclosed open slice is in the record and not on the page — the client cannot see which ground was left open");
});

test("a not-searched axis row does not erase it either", () => {
  // Shape B as measured, and the reason it is the SAME defect rather than a second one: the suppressor
  // only exempts `confirmed-clean`, and `not-searched` is class `todo`, so it suppresses like any other.
  // Both erased rows therefore have one cause, and one fix closes both.
  const coverage = [
    park("toy packaging"),
    { area: "register / toy packaging classes", state: "not-searched", note: "not run this run" },
    { area: "register / toy packaging adjacents", state: "not-searched", note: "not run this run" },
  ];
  assert.equal(cells(coverage), openOnly(coverage).length, "a not-searched unit stood in for a slice that was never searched at all");
});

test("every entry reaches the page across a spread of short directives", () => {
  const coverage = [
    park("eu"), park("toys"), park("uk"),
    { area: "register / eu and uk toys filings", state: "open", note: "still open" },
    { area: "register / us", state: "confirmed-clean", note: "clean" },
  ];
  assert.ok(coverage.length >= 5, "the fixture is too small for the count below to mean anything");
  assert.equal(cells(coverage), openOnly(coverage).length, `${openOnly(coverage).length} open entries in, ${cells(coverage)} cells out`);
});

test("the model's own restatement still suppresses the driver's row", () => {
  // THE HALF THE MEASURED RUN CANNOT EVIDENCE, so it is pinned here deliberately. That run has no open
  // row WITHOUT an axis label, so nothing in it exercises this direction; the only witness is the dolphin
  // incident. If this arm ever goes green by drawing both rows, the discriminator has been widened into a
  // deletion of the feature and the duplicate that incident was filed for is back.
  const coverage = [
    park("dolphin"),
    { area: "the English word DOLPHIN as a dedicated exact search", state: "open", note: "planned and not reached" },
    { area: "register / us", state: "confirmed-clean", note: "clean" },
  ];
  assert.equal(cells(coverage), openOnly(coverage).length - 1,
    "the model's free-text row and the driver's composed row name the same search and both drew — the "
    + "discriminator no longer suppresses anything");
});

test("a completed search still never stands in for an uncompleted one", () => {
  const coverage = [
    park("dolphin"),
    { area: "the English word DOLPHIN as a dedicated exact search", state: "confirmed-clean", note: "ran and was clean" },
  ];
  assert.equal(cells(coverage), openOnly(coverage).length,
    "a searched-and-clean row suppressed an open slice that never ran — those report opposite things");
});
