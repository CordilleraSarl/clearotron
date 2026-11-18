// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE COVER EMAIL NAMES NO RATING SCALE. The email that carries a report to the lawyer printed "Rated under:
// <the scale>", a provenance line the report a client reads is cleaned of. The email drops it (2026-11-18);
// the scale stays named on the report's gauge and in the run's record. Invented names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeEmailHtml } from "../publish/index.mjs";

const REPORT = [
  "---", "type: clearance-clearance", "matter: invented-matter", "title: QZXV",
  "overall_label: MEDIUM", "overall_caption: An invented caption.",
  "rated_under: Invented Owner (invented-owner)",
  "classes: 9", "jurisdiction: United States only", "run: 2026-06-10", "---", "",
  "# Marks", "## Invented Owner", "- one: An invented conflict.",
].join("\n");

test("the cover email carries no 'Rated under' line, though the report's record names a scale", () => {
  const dir = mkdtempSync(join(tmpdir(), "cover-email-"));
  try {
    const md = join(dir, "report.md");
    writeFileSync(md, REPORT);
    const html = composeEmailHtml(md, "https://portal.example/portal/report/r1", "audit.xlsx", ["Invented Owner"]);
    assert.match(html, /QZXV/, "premise: the email rendered the report's title");
    assert.match(html, /Overall risk: MEDIUM\./, "premise: the email rendered the rating");
    assert.doesNotMatch(html, /Rated under/i, "the email names the rating scale");
    assert.doesNotMatch(html, /invented-owner/, "the scale's key reached the email");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
