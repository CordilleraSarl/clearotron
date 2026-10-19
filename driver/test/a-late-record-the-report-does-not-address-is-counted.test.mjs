// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A LATE RECORD THE REPORT DOES NOT ADDRESS IS COUNTED, AND ONE IT ADDRESSES IS NOT.
//
// A record the band gained after placement's last pass, which no placement pass read, is open until something in the
// report addresses it. The reading step's account addresses it when it carries the record or sets it aside under its
// negative results; the writer's findings address it when a finding names it; another clause already standing names it
// once. A late record none of these name is counted in the approved sentence for records neither addressed nor set
// aside, whether or not it is a floor or a record the recall gate weighs. Driven with a run's own files. Own file, so the
// call ledger is pinned before the driver loads. Every mark and owner is invented.
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || mkdtempSync(join(tmpdir(), "clearotron-testroot-")));
process.env.CLEAROTRON_REGISTER_CALL_LOG = join(mkdtempSync(join(tmpdir(), "late-unaddressed-calls-")), "register-calls.jsonl");
writeFileSync(process.env.CLEAROTRON_REGISTER_CALL_LOG, "");

import { test } from "node:test";
import assert from "node:assert/strict";

const rec = (n, mark) => ({ record_id: `/mark/us/9000${n}`, mark_text: mark, classes: [9], status: "Registered",
  owner_name: `Owner ${n} Ltd`, owner_country: "US", screen_verdict: "surface:in-scope-live" });
const READ = [rec(10, "QZORVAK")];
const LATE = [rec(21, "QZORVAK"), rec(22, "BRELLIX"), rec(23, "TANDORIM"), rec(24, "VOSKERAL"), rec(25, "MIRELLON")];

async function aRun(t, { readByPlacement = READ.map((r) => r.record_id), registerFindings = null, findings = null } = {}) {
  const { paths } = await import("../stages.mjs");
  const runDir = mkdtempSync(join(tmpdir(), "late-unaddressed-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(driverDir(runDir), { recursive: true });
  const P = paths(runDir);
  mkdirSync(dirname(P.registerNamedBand), { recursive: true });
  writeFileSync(P.registerNamedBand, JSON.stringify({ enumerated: [...READ, ...LATE] }, null, 2) + "\n");
  if (readByPlacement) writeFileSync(driverDir(runDir, "placement-band-ids.json"), JSON.stringify({ count: readByPlacement.length, ids: readByPlacement }) + "\n");
  if (registerFindings != null) writeFileSync(P.registerFindings, registerFindings);
  if (findings != null) writeFileSync(P.findings, JSON.stringify(findings, null, 2) + "\n");
  return P;
}

// The reading step's account: LATE[1] is carried as a finding row, LATE[2] is set aside under its negative results.
const ACCOUNT = "# Register findings\n\n## Findings\n\n### Risk-relevant (Sheet 1)\n| URI | Mark | Flag reason |\n|---|---|---|\n"
  + `| ${LATE[1].record_id} | BRELLIX | same field, live |\n\n### Negative results\n| Mark | Search Term / Variant | Result | Notes |\n|---|---|---|---|\n`
  + `| TANDORIM | default | screened out — off-field | URI ${LATE[2].record_id}; screen_verdict=surface:in-scope-live |\n`;
// The writer's findings: LATE[3] is named by a finding.
const meter = (token, basis = "verified-from-record") => ({ token, basis });
const FINDINGS = { schema_version: 1, coverage: [{ area: "register / US", state: "confirmed-clean", note: "" }], findings: [{
  ordinal: 1, mark: "VOSKERAL", owner: { name: "Owner 24 Ltd", country: "US", registrations: [{ uri: LATE[3].record_id, classes: ["9"] }] },
  composite: 4, level: "B", dispute_type: "register-only",
  meters: { mark_similarity: meter("high"), goods_proximity: meter("medium"), use: meter("confirmed"), enforcer: meter("high") },
  quadrant: { x: 0.5, y: 0.5 }, source: { source_type: "register-vendor", resolved_link: "" } }] };

test("a late record nothing in the report names is counted, and one the reading step, the writer or another clause names is not", async (t) => {
  const { lateRecordsUnaddressed, lateRecordIds } = await import("../pipeline.mjs");
  const P = await aRun(t, { registerFindings: ACCOUNT, findings: FINDINGS });
  assert.deepEqual(lateRecordIds(P), LATE.map((r) => r.record_id), "guard: every record after placement's pass is late");
  // LATE[0] and LATE[4] are named nowhere; LATE[4] is named by another clause standing
  assert.deepEqual(lateRecordsUnaddressed(P, new Set([LATE[4].record_id])), [LATE[0].record_id]);
  assert.deepEqual(lateRecordsUnaddressed(P), [LATE[0].record_id, LATE[4].record_id], "a late record no clause names was not counted");
});

test("a late record is counted when neither the reading step nor the writer has an account, and nothing is late when placement read every record", async (t) => {
  const { lateRecordsUnaddressed } = await import("../pipeline.mjs");
  const none = await aRun(t);
  assert.deepEqual(lateRecordsUnaddressed(none), LATE.map((r) => r.record_id), "an account that does not exist addressed a record");
  const unreadable = await aRun(t, { registerFindings: "", findings: null });
  writeFileSync(unreadable.findings, "{ not json");
  assert.deepEqual(lateRecordsUnaddressed(unreadable), LATE.map((r) => r.record_id), "an unreadable account addressed a record");
  const allRead = await aRun(t, { readByPlacement: [...READ, ...LATE].map((r) => r.record_id) });
  assert.deepEqual(lateRecordsUnaddressed(allRead), [], "a record placement read was counted as late");
  const noRecord = await aRun(t, { readByPlacement: null });
  assert.deepEqual(lateRecordsUnaddressed(noRecord), [], "a run with no record of what placement read counted every record as late");
});
