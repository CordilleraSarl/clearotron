// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// findings-backstop.test.mjs —: the rebuilt-from-spine path is the SAME document, not a thinner one.
//
// `loadFindings` reads the deterministic `audit.md` when it exists, and rebuilds from the register and
// common-law spines through `buildAuditMd` when it does not (the audit build is non-fatal in the
// pipeline, so a run can legitimately be missing it).
//
// That backstop used to call `buildAuditMd(reg, cl)` with NO findings set, and audit-from-spine.mjs is
// explicit about what that costs: the withdrawn and resolution stamps are applied only
// `if (Array.isArray(runFindings))`, and "absent a findings set (replay/legacy callers), this is a
// no-op". So the backstop produced blocks with no dispositions and no resolutions at all — a quietly
// different answer to `list_findings` depending on whether one file happened to exist.
//
// makes that matter rather than merely untidy. The client filter added in scrub.mjs drops any
// block stamped withdrawn; on this path nothing was ever stamped, so the filter would have been correct
// and would have had nothing to act on. A guard that cannot fire is the shape this issue is about.

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let loadFindings, driver, scrubCards;
before(async () => {
  ({ loadFindings } = await import("../lib/findings.mjs"));
  driver = await import("../lib/driver.mjs");
  ({ scrubCards } = await import("../lib/scrub.mjs"));
});

// The shape scrub.test.mjs uses for the same job — INVENTED mark and owner, and a spine the real
// parser accepts, so the join under test is done by real code rather than by a literal.
const SPINE = [
  "# Register findings — Mark: VOLTMAX",
  "",
  "### Watchlist annex",
  "| Mark | Owner | Status | Notes |",
  "|---|---|---|---|",
  "| VOLTMAX ENERGYCORE | NutriVolt Beverages, Inc. | live | CRITICAL FINDING: active commercial product with nationwide distribution via retail channels |",
].join("\n");

const REASON = "confabulated attribution — no source ties this registration to the named owner";
const WITHDRAWN_DOC = {
  schema_version: 4,
  findings: [{
    ordinal: 7, mark: "VOLTMAX ENERGYCORE", band: "MEDIUM",
    owner: { name: "NutriVolt Beverages, Inc.", country: "US" },
    disposition: "withdrawn", withdrawn_reason: REASON,
  }],
};

/** A run dir with a spine and NO audit.md, so loadFindings must take the backstop. */
function runDir({ findingsDoc = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ta-findings-backstop-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "register-findings.md"), SPINE);
  if (findingsDoc !== null) writeFileSync(join(dir, "findings.json"), JSON.stringify(findingsDoc));
  return dir;
}

describe("#1187 the rebuilt-from-spine backstop", () => {
  test("takes the backstop at all — the premise every assertion below rests on", () => {
    const dir = runDir();
    try {
      assert.equal(loadFindings(driver.paths(dir)).source, "rebuilt-from-spine",
        "this run has no audit.md, so a source of anything else means the test is not exercising the path");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("#1187 STAMPS THE WITHDRAWAL from the run's own findings.json", () => {
    const dir = runDir({ findingsDoc: WITHDRAWN_DOC });
    try {
      const { findings } = loadFindings(driver.paths(dir));
      assert.ok(findings.length, "the spine produced no finding blocks — the fixture, not the code");
      const stamped = findings.filter((f) => f.disposition === "withdrawn");
      assert.equal(stamped.length, 1,
        `the backstop rebuilt the audit with no findings set, so nothing is marked withdrawn: `
        + JSON.stringify(findings.map((f) => ({ t: f._title, d: f.disposition })), null, 2));
      assert.equal(stamped[0].withdrawn_reason, REASON, "and it carries the reviewer's own words, uncopied");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("#1187 and the client filter then has something to act on — end to end on this path", () => {
    // The point of the pair. On the audit.md path this was already true; this is the same claim on the
    // path that had no stamps to read.
    const dir = runDir({ findingsDoc: WITHDRAWN_DOC });
    try {
      const { findings } = loadFindings(driver.paths(dir));
      const titles = findings.filter((f) => f.disposition === "withdrawn").map((f) => f._title);
      assert.ok(titles.length, "premise: something is stamped withdrawn");
      const client = scrubCards(findings);
      for (const t of titles) {
        assert.ok(!client.some((c) => c._title === t), `${JSON.stringify(t)} reached the client view`);
      }
      assert.ok(!JSON.stringify(client).includes("confabulated"), "reviewer prose survived into the client view");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("#1187 a run with NO findings.json behaves exactly as it did before — best-effort, never a throw", () => {
    // The added read must not turn a legitimately findings-less run (replay, a legacy archive, a run
    // that failed before synthesis) into an error. It degrades to the old no-op.
    const dir = runDir();
    try {
      const { findings, source } = loadFindings(driver.paths(dir));
      assert.equal(source, "rebuilt-from-spine");
      assert.ok(findings.length, "the blocks still come back, unstamped");
      assert.ok(findings.every((f) => f.disposition === undefined), "nothing to stamp, so nothing is stamped");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("#1187 a TORN findings.json is not an error either", () => {
    const dir = runDir();
    try {
      writeFileSync(join(dir, "findings.json"), "{ this is not json");
      const { findings, source } = loadFindings(driver.paths(dir));
      assert.equal(source, "rebuilt-from-spine", "an unreadable findings.json must not collapse the whole surface");
      assert.ok(findings.length);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("#1187 the bare-array form is read too, not only the wrapper", () => {
    // findings.json ships as an object with a `findings` key; the array form exists on older runs. Both
    // are on disk, so both are accepted rather than one being silently ignored.
    const dir = runDir({ findingsDoc: WITHDRAWN_DOC.findings });
    try {
      const { findings } = loadFindings(driver.paths(dir));
      assert.equal(findings.filter((f) => f.disposition === "withdrawn").length, 1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
