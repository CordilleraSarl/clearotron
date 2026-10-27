// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A BLOCKING EMAIL KEEPS THE REPORT'S CLIENT ACTIONS (ruled 2026-10-27).
//
// The email's "Only you can close these" box showed only on a CONDITIONAL result, so a delivered BLOCKING result lost
// the actions the report lists under that heading. The report is the master: a BLOCKING email now carries the same
// items, in the report's words, and none where the report lists none, with no empty box and no fallback line. A
// CONDITIONAL email is unchanged. Every mark and owner is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeEmailHtml } from "../publish/index.mjs";

const FRONT = ["---", "type: clearance-clearance", "matter: tmp9-demo", "title: INVENTED MARK", "overall_label: HIGH",
  "overall_caption: One close mark in class 9 drives the rating.", "classes: 9", "jurisdiction: United States only", "run: 2026-10-27", "---", ""];
const FINDINGS = ["# Findings", "## Invented Owner", "- one: An invented conflict.", "### The read", "An invented read.", ""];
const ACTIONS = ["# Actions", "", "### Only you can close these", "",
  "- Ask Invented Owner for consent before filing in class 9.", "- Confirm whether the class 42 services will launch in the United States.", ""];
const BOX = "<b>Only you can close these</b>";

function email(t, verdict, withActions) {
  const dir = mkdtempSync(join(tmpdir(), "blocking-email-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "report.md"), [...FRONT, ...FINDINGS, ...(withActions ? ACTIONS : [])].join("\n"));
  return composeEmailHtml(join(dir, "report.md"), "https://portal.example/report/r1", "audit.xlsx", ["Invented Owner"],
    { email: "table", privileged: true }, { verdict, tier: "High", conditions: [] });
}

test("a BLOCKING email shows the report's own client actions under the report's heading", (t) => {
  const html = email(t, "BLOCKING", true);
  assert.ok(html.includes(BOX), "a blocking result lost the report's client actions");
  assert.ok(html.includes("• Ask Invented Owner for consent before filing in class 9.<br>• Confirm whether the class 42 services will launch in the United States."),
    "the items are not the report's, in its words and its order");
});

test("a BLOCKING email whose report lists no client action carries no box and no fallback line", (t) => {
  const html = email(t, "BLOCKING", false);
  assert.ok(!html.includes(BOX), "an empty box was added");
  assert.ok(!html.includes("the open items set out in the report"), "a fallback line was added to a blocking result");
});

test("a CONDITIONAL email reads as before, with and without the report's items", (t) => {
  assert.ok(email(t, "CONDITIONAL", true).includes("• Ask Invented Owner for consent before filing in class 9."));
  assert.ok(email(t, "CONDITIONAL", false).includes(`${BOX}<br>• the open items set out in the report, before relying on a clean result`));
  assert.ok(!email(t, "CLEAR", true).includes(BOX), "a clear result shows no box");
});
