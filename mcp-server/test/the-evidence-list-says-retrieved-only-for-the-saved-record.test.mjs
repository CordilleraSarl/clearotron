// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// SAFETY GUARD: the workspace is pinned before the connector's modules are imported, because the driver config
// freezes its roots at import and the fixture writes a run into it. Invented names.
import { mkdtempSync as __mkdtemp } from "node:fs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", __mkdtemp(__join(__tmpdir(), "evidence-retrieved-ws-")));
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { evidenceRecords } = await import("../lib/evidence.mjs");
// A FETCHED RECORD READS AS RETRIEVED THROUGH THE FINDING'S REGISTRATION, AND ONLY BY ITS WHOLE IDENTITY. `retrieved`
// asked the archive about the finding's link alone, so a register finding with no link of its own, whose record the run
// fetched and saved under its registration's URI, told a client's assistant that it rested on the write-up. And the link
// was matched as a substring, so a link to a registration whose number began with a saved one's read as retrieved.
// The controls run through the connector's own tool, on a run it lists.
const SAVED = "/mark/us/90000001";
const CONTROLS = [
  ["registration only", { registrations: [{ uri: SAVED }] }, true],
  ["registration not saved", { registrations: [{ uri: "/mark/us/90000002" }] }, false],
  ["exact link", { link: `https://records.example.test${SAVED}` }, true],
  ["longer number", { link: "https://records.example.test/mark/us/900000011" }, false],
  ["same number, another office", { link: "https://records.example.test/mark/eu/90000001" }, false],
  ["a fragment of the saved path", { link: "https://records.example.test/mark/us/9000" }, false],
];
const controlFindings = () => CONTROLS.map(([name, { registrations = [], link = null }], i) => ({
  ordinal: i + 1, mark: `CONTROL ${i + 1}`, owner: { name: `Invented Owner ${i + 1}`, registrations },
  source: { source_type: "register", ...(link ? { resolved_link: link } : {}) },
}));

test("a register finding reads as retrieved only when the run saved its own record, by registration or exact link", () => {
  const runDir = mkdtempSync(join(tmpdir(), "evidence-retrieved-"));
  try {
    mkdirSync(join(runDir, "_records"));
    writeFileSync(join(runDir, "_records", "us-90000001.json"), JSON.stringify({ uri: SAVED, owner: "Invented Owner 1" }));
    writeFileSync(join(runDir, "findings.json"), JSON.stringify({ findings: controlFindings() }));
    const { records } = evidenceRecords({ runDir, P: { audit: join(runDir, "audit.md") } });
    CONTROLS.forEach(([name, , want], i) => assert.equal(records.find((r) => r.mark === `CONTROL ${i + 1}`)?.retrieved, want, name));
    // No archive at all: the archive cannot answer, so the answer is unknown, never false.
    rmSync(join(runDir, "_records"), { recursive: true, force: true });
    const unarchived = evidenceRecords({ runDir, P: { audit: join(runDir, "audit.md") } }).records;
    assert.ok(unarchived.every((r) => r.retrieved === null), "a run with no record archive read as not retrieved");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("the connector's list_evidence carries the same controls", async () => {
  const { buildFixture, RUN_ID } = await import("./_fixture.mjs");
  const { runDir } = buildFixture();
  const { tools } = await import("../server.mjs");
  mkdirSync(join(runDir, "_records"), { recursive: true });
  writeFileSync(join(runDir, "_records", "us-90000001.json"), JSON.stringify({ uri: SAVED, owner: "Invented Owner 1" }));
  writeFileSync(join(runDir, "findings.json"), JSON.stringify({ findings: controlFindings() }));
  const { records } = await tools.list_evidence({ runId: RUN_ID, layer: "register" });
  CONTROLS.forEach(([name, , want], i) => assert.equal(records.find((r) => r.mark === `CONTROL ${i + 1}`)?.retrieved, want, `through the connector: ${name}`));
});
