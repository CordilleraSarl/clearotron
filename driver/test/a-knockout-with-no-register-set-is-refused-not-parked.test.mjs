// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT WITH NO REGISTER SET IS REFUSED, NOT PARKED.
//
// A newcomer following the quickstart ran a Knockout before choosing a register. The README promises that
// a run "refuses rather than picking a vendor for you". Instead the terminal said "RECOVERABLE failure …
// parking for AUTO-RECOVERY", and the reason, `CLEAROTRON_DATABASE is not set`, was only in status.json.
// The lane's count preflight asked `activeProvider()` for the register, which throws a plain Error when
// none is set; the recovery ladder could not read that prose, guessed "unknown", and bought it a park
// that no wait can answer. Now the throw is stamped as the refusal it is, like the count refusal beside
// it: terminal at once, recorded as a designed refusal, the reason on the run's record, and no park.
//
// Drives the real knockout terminal with every executor injected, so nothing dials a provider and no
// model turn is reachable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv, pinEnvAll } from "../../shared/env-aliases.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

// driver.config.mjs reads the environment at import: the register must be unset BEFORE the first import,
// and the work and report folders must point into this sandbox.
const ROOT = mkdtempSync(join(tmpdir(), "no-register-knockout-"));
pinEnvAll(process.env, { "CLEAROTRON_WORK_DIR": ROOT, "CLEAROTRON_REPORTS_DIR": join(ROOT, "pool") });
pinEnv(process.env, "CLEAROTRON_DATABASE", undefined);
pinEnv(process.env, "CLEAROTRON_INSTRUCTIONS_DIR", undefined);

const { knockoutInner } = await import("../pipeline-knockout.mjs");
const { REFUSAL_TERMINAL_KIND } = await import("../repairs.mjs");

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

test("a knockout with no register set ends refused at once, names the setting, and is not parked", async () => {
  const studioRoot = join(ROOT, "studio", "cli-no-register");
  const runDir = join(studioRoot, "clearance-search", "runs", "lanternfly", "2026-11-04-amber-quay");
  mkdirSync(driverDir(runDir), { recursive: true });
  const run = { runDir, studioRoot, slug: "lanternfly", date: "2026-11-04", codename: "amber-quay",
    archiveDir: join(studioRoot, "archive", "2026-11-04-amber-quay") };
  const job = { id: "cli-no-register", markName: "LANTERNFLY", marks: [{ name: "LANTERNFLY" }], classes: [9],
    jurisdictions: ["EM"], forwarder: "jordan", msgId: "<cli-no-register@x>", ref: "QS-1" };
  const ctx = {
    run, job, agent: "mailagent", paths: { runDir }, profile: {},
    searchPolicy: { level: "knockout-register", stageLabel: "Knockout + register", components: { registerProbe: true } },
  };
  const res = await knockoutInner(ctx, job, {
    sweepExecutor: async () => ({ ok: true, text: "unused", bytes: 6 }),
    countExecutor: async () => ({ ok: true, total: 0 }),
  });

  const status = readJson(join(runDir, "status.json"));
  assert.notEqual(status.state, "recovering", "parked to retry a setting no wait can supply");
  assert.equal(existsSync(join(runDir, ".postponed")), false, "a park marker was written");
  assert.equal(res.ok, false);
  assert.equal(status.state, "failed", "nothing was delivered, so the state is failed");
  assert.equal(res.failedStage, "knockout-register-count");
  assert.equal(status.terminalKind, REFUSAL_TERMINAL_KIND, "recorded as a refusal, not as the engine breaking");
  assert.match(String(status.reason), /CLEAROTRON_DATABASE is not set/, "the record names the setting to make");
});
