// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN OLDER REPORT'S STATEMENT COUNTS ONLY WHAT THE CLIENT READS.
//
// A run recorded before the engine's sentence about its frame comparison was withheld stored a statement that
// counted that sentence among its conditions: "conditional on: … (and 2 more)" over a list that now shows two
// conditions, not three. A count is a fact, and a number one too high on a client page is a defect. The page is
// published from a record shaped like those runs, and its statement's count matches the list it prints, while
// the withheld sentence appears nowhere. Every mark, owner and condition here is invented.
import { test } from "node:test";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";

const ROOT = mkdtempSync(join(tmpdir(), "older-statement-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool-default"));
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
delete process.env.CLEAROTRON_MCP_URL;
pinEnv(process.env, "CLEAROTRON_DATABASE", "corsearch");
const { publishReport } = await import("../publish/index.mjs");

const FRAME = "the blind frame-diff flagged a dominant-element omission the reopen pass did not close";
const FIRST = "No consent from the owner of the earlier QZORVAK filing appears on the record searched";
const SECOND = "The earlier QZORVAK filing's use in the client's market is not shown on the record searched";

const REPORT_MD = `---
type: clearance-clearance
matter: TMP1166
title: QZORVAK
client: House default
classes: 9
run: 2026-10-01 · register + common-law
overall_label: Medium
overall_badge: l3
overall_caption: An invented fixture for the statement's count.
---

# Summary
An invented fixture.
`;

const FINDINGS = JSON.stringify({
  schema_version: 1,
  findings: [{
    ordinal: 1, mark: "QZORVAKO", owner: { name: "Invented Owner Ltd", country: "CH", registrations: [] },
    composite: 3, level: "B", dispute_type: "register-only",
    meters: {
      mark_similarity: { token: "high", basis: "inferred-from-signal" }, goods_proximity: { token: "medium", basis: "inferred-from-signal" },
      use: { token: "confirmed", basis: "inferred-from-signal" }, enforcer: { token: "low", basis: "inferred-from-signal" },
    },
    quadrant: { x: 0.5, y: 0.5 }, source: { source_type: "register-vendor", resolved_link: null },
  }],
  coverage: [{ area: "register / EU", state: "confirmed-clean", note: "" }],
});

test("an older record's statement names only the further conditions its page lists, and the withheld sentence appears nowhere", async (t) => {
  t.after(() => rmSync(ROOT, { recursive: true, force: true }));
  const runDir = join(ROOT, "run");
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(join(runDir, "status.json"), JSON.stringify({ runId: "fixture-older-statement", markName: "QZORVAK" }));
  writeFileSync(join(runDir, "report.md"), REPORT_MD);
  writeFileSync(join(runDir, "findings.json"), FINDINGS);
  // Shaped like the six saved records: the sentence stored as a client clause, and counted by the statement.
  writeFileSync(driverDir(runDir, "verdict.json"), JSON.stringify({
    verdict: "CONDITIONAL", reasons: [FIRST, SECOND, FRAME], clauses: [FIRST, SECOND, FRAME], kinds: { frame: true },
    tier: "Medium", statement: `Medium — conditional on: ${FIRST} (and 2 more).`, stance: "conditional",
  }));
  const poolRoot = join(ROOT, "pool");
  mkdirSync(poolRoot, { recursive: true });
  await publishReport({ runId: "tmp1166-2026-10-01-older", codename: "older", reportMd: join(runDir, "report.md"),
    findingsJson: join(runDir, "findings.json"), poolRoot, poolUrl: "https://trademark.test", customerKey: "generic", runDir, skipRegen: true });
  const html = readFileSync(join(poolRoot, "tmp1166-2026-10-01-older", "report.html"), "utf8");
  assert.ok(html.includes("(and 1 more)"), "the statement's count is not the page's");
  assert.ok(!html.includes("(and 2 more)"), "the statement counts a condition the client never reads");
  assert.doesNotMatch(html, /frame[- ]diff|reopen pass/i, "the withheld sentence reached the page");
  assert.ok(html.includes("earlier QZORVAK filing&#39;s use") || html.includes("earlier QZORVAK filing's use"), "guard: the page lists its other conditions");
  // The stored record is the run's, and publishing it changes nothing in it.
  assert.match(readFileSync(driverDir(runDir, "verdict.json"), "utf8"), /\(and 2 more\)/);
});
