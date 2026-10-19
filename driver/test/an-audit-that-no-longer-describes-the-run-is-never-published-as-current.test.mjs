// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN AUDIT THAT NO LONGER DESCRIBES THE RUN IS NEVER PUBLISHED AS CURRENT.
//
// After a delivery-check repair the record-carry trace and the Audit Trail are written again. The trace is written
// first, so a rebuild can fail between the two and leave a new trace beside the audit written before the repair. A
// resumed pass can likewise fail its first build while the audit an earlier pass wrote is still on disk. In both cases
// that audit used to stay where publishing reads it, and an earlier ground could reach the client as the report's
// current audit. It is now withdrawn, kept under _history, and the report ships without an audit, as it does when a
// first build fails on a run that had none. Own file, so the call ledger is pinned before the driver loads. Every
// mark and owner is invented.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || mkdtempSync(join(tmpdir(), "clearotron-testroot-")));
process.env.CLEAROTRON_REGISTER_CALL_LOG = join(mkdtempSync(join(tmpdir(), "audit-withdrawn-calls-")), "register-calls.jsonl");
writeFileSync(process.env.CLEAROTRON_REGISTER_CALL_LOG, "");

import { test } from "node:test";
import assert from "node:assert/strict";
const { rebuildDeliveredRecord, withdrawSupersededAudit } = await import("../pipeline.mjs");
const { paths } = await import("../stages.mjs");

const EARLIER_AUDIT = "# Audit\n\n## Audit trail\n\n- query: QZORVAK — Alpha Ltd (/mark/eu/a1)\n- rationale: the registration lapsed before the client's first use\n";
const EARLIER_TRACE = { ts: "2026-10-19T00:00:00Z", trigger: "publish", schema_version: 2, computable: true, rows: [] };

function seedRun(t, { registerFindings = "# Register findings\n\nNo finding table was written.\n" } = {}) {
  const runDir = mkdtempSync(join(tmpdir(), "audit-withdrawn-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(driverDir(runDir), { recursive: true });
  const P = paths(runDir);
  writeFileSync(P.audit, EARLIER_AUDIT);
  writeFileSync(P.recordCarry, JSON.stringify(EARLIER_TRACE));
  writeFileSync(P.registerFindings, registerFindings);
  return P;
}
const events = (P) => (existsSync(driverDir(P.runDir, "run.jsonl"))
  ? readFileSync(driverDir(P.runDir, "run.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const kept = (P, suffix) => (existsSync(join(P.runDir, "_history")) ? readdirSync(join(P.runDir, "_history")) : [])
  .filter((d) => d.endsWith(suffix)).map((d) => join(P.runDir, "_history", d));

test("a rebuild that fails after the trace is written withdraws the audit written before the repair, and keeps the earlier pair", (t) => {
  const P = seedRun(t);
  const r = rebuildDeliveredRecord({ paths: P }, { commonLawText: "" }, "stale-repair");
  assert.equal(r.ok, false);
  assert.match(r.reason, /0 findings parsed from the spine tables/);
  // the trace was written again, the audit was not: the case between the two writes
  assert.equal(JSON.parse(readFileSync(P.recordCarry, "utf8")).trigger, "stale-repair", "guard: the rebuild wrote the trace before the audit failed");
  assert.ok(!existsSync(P.audit), "the audit written before the repair is still where publishing reads it");
  const [dir] = kept(P, "-delivered-record-stale-repair");
  assert.ok(dir, "the earlier pair was not kept");
  assert.equal(readFileSync(join(dir, "audit.md"), "utf8"), EARLIER_AUDIT, "the audit kept is not the one that stood");
  assert.equal(JSON.parse(readFileSync(join(dir, "record-carry.json"), "utf8")).trigger, "publish", "the trace kept is not the one that stood");
  const ev = events(P);
  assert.deepEqual(ev.filter((e) => e.event === "audit-rebuild-failed").map((e) => e.trigger), ["stale-repair"]);
  assert.deepEqual(ev.filter((e) => e.event === "audit-withdrawn").map((e) => e.reason), ["stale-repair-failed"]);
});

test("a first build that fails beside an earlier pass's audit withdraws that audit, kept under _history", (t) => {
  const P = seedRun(t);
  assert.equal(withdrawSupersededAudit(P, "audit-build-failed"), true);
  assert.ok(!existsSync(P.audit), "the earlier pass's audit is still where publishing reads it");
  const [dir] = kept(P, "-delivered-record-audit-build-failed");
  assert.ok(dir && readFileSync(join(dir, "audit.md"), "utf8") === EARLIER_AUDIT, "the earlier pass's audit was not kept as it stood");
  assert.deepEqual(events(P).filter((e) => e.event === "audit-withdrawn").map((e) => e.reason), ["audit-build-failed"]);
});

test("with no audit on disk there is nothing to withdraw, and nothing is written", (t) => {
  const P = seedRun(t);
  rmSync(P.audit);
  assert.equal(withdrawSupersededAudit(P, "audit-build-failed"), false);
  assert.deepEqual(kept(P, "-delivered-record-audit-build-failed"), []);
  assert.deepEqual(events(P).filter((e) => e.event === "audit-withdrawn"), []);
});
