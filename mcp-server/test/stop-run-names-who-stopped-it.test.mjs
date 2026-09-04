// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — the UI stop path records WHO, not only HOW.
//
// Found by the owner stopping a live worldwide clearance from the portal. The marker read
// {"via":"mcp/stop_run","by":null} while the e2e lane's stop 14 seconds later carried an actor. The
// session already holds a verified identity — `scope.sub`, the same field `stampForwarder` reads — and
// the stop path was throwing it away. A stopped clearance is a client-visible outcome (the report does
// not arrive), so the run dir must be able to say who stopped it without correlating portal access logs
// on a different retention regime.
//
// Harness matches ops.test.mjs: CLEAROTRON_WORK_DIR is set BEFORE importing, since driver.config reads
// it at module load.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const ROOT = mkdtempSync(join(tmpdir(), "stop-actor-ws-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);

const { stopRun } = await import("../lib/ops.mjs");
const { UNIDENTIFIED } = await import("../../shared/scope.mjs");

let n = 0;
function makeRun(state = "running") {
  const slug = "tmpx-acme";
  const codename = `2026-06-16-stop-${++n}`;
  const runDir = join(ROOT, "workspace-clawdi", "studio", "prelim-search", slug, codename);
  mkdirSync(driverDir(runDir), { recursive: true });
  const runId = `${slug}-${codename}`;
  writeFileSync(join(runDir, "status.json"),
    JSON.stringify({ runId, slug, codename, agent: "clawdi", state, markName: "ACME" }));
  return { runDir, runId };
}
const marker = (runDir) => JSON.parse(readFileSync(join(runDir, ".cancel"), "utf8"));

test("the stop marker names the verified principal that asked for it", () => {
  const { runDir, runId } = makeRun();
  const s = stopRun({ runId }, { scope: { kind: "internal", sub: "staff@example.test", accounts: "*" } });
  assert.equal(s.action, "cancel-requested");
  assert.equal(marker(runDir).by, "staff@example.test",
    "the field the portal stop left null on a live client matter");
  assert.equal(marker(runDir).via, "mcp/stop_run", "the channel is still recorded — it is just not an actor");
});

test("a session that cannot name a person records THAT, with its kind — never null", () => {
  const { runDir, runId } = makeRun();
  stopRun({ runId }, { scope: { kind: "account", sub: null, accounts: [] } });
  const by = marker(runDir).by;
  assert.equal(by, `${UNIDENTIFIED}:account`);
  assert.notEqual(by, null, "null cannot say whether nobody was named or nothing was passed");
});

test("a stop with no session at all is still attributable, and says so", () => {
  // The existing ops.test.mjs callers pass no second argument at all. They must keep working, and what
  // they write must still be a statement rather than an absence.
  const { runDir, runId } = makeRun();
  stopRun({ runId });
  assert.equal(marker(runDir).by, UNIDENTIFIED);
});

test("NO STOP PATH WRITES A NULL ACTOR — the regression this exists to prevent", () => {
  for (const scope of [
    { kind: "ops", sub: "local", accounts: "*" },
    { kind: "user", sub: "token-sub", accounts: null },
    { kind: "account", sub: "", accounts: [] },
    { kind: "", sub: "", accounts: [] },
    undefined,
  ]) {
    const { runDir, runId } = makeRun();
    stopRun({ runId }, scope === undefined ? undefined : { scope });
    const by = marker(runDir).by;
    assert.ok(typeof by === "string" && by.trim(), `null/blank actor for scope ${JSON.stringify(scope)}`);
  }
});

test("the parked terminal breadcrumb carries the actor too", () => {
  // A parked run has no turn in flight, so ops.mjs writes the terminal itself. That record is the one a
  // reader reaches for on a run that never resumed, and it named the channel and no actor either.
  const { runDir, runId } = makeRun("parked-for-human");
  const s = stopRun({ runId }, { scope: { kind: "internal", sub: "staff@example.test", accounts: "*" } });
  assert.equal(s.action, "cancelled");
  assert.ok(existsSync(join(runDir, ".cancelled")), "terminal breadcrumb written");
  assert.equal(JSON.parse(readFileSync(join(runDir, ".cancelled"), "utf8")).by, "staff@example.test");
});

test("a second stop does not rewrite who stopped it first", () => {
  const { runDir, runId } = makeRun();
  stopRun({ runId }, { scope: { kind: "internal", sub: "first@example.test", accounts: "*" } });
  stopRun({ runId }, { scope: { kind: "internal", sub: "second@example.test", accounts: "*" } });
  assert.equal(marker(runDir).by, "first@example.test", "the marker is idempotent by design");
});
