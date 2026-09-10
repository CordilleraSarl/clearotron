// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the real runner: a Generic job is filed under its organisation when it is claimed,
// and the admission wall caps that organisation's lane.
//
// The unit arms (each-organisations-generic-carries-the-daily-cap) drive the cap check with a ledger they
// wrote themselves. That proves the check obeys; it does not prove anything writes the rows it counts. A
// Generic row the runner wrote with no organisation would count towards no lane, and every one of those
// arms would stay green while the cap never fired in production. So this runs the runner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, chmodSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { fileURLToPath } from "node:url";
// Off in hermetic harnesses, as in the runner's other mock-driven tests: mock runs never dial a provider.
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, "..", "runner.mjs");
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);

const studioFor = (root) => join(root, "workspace-clawdi", "studio", "prelim-search");
const queueFor = (root) => join(studioFor(root), "queue");
const ledgerFor = (root) => join(dirname(queueFor(root)), ".matter-ledger.jsonl");   // usage-ledger.mjs matterLedgerPath
function envFor(root, extra = {}) {
  return {
    ...process.env,
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_OUTBOX_DIR: join(root, "outbox"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    CLEAROTRON_QUEUE_SCAN_MS: "100", CORSEARCH_SESSION_KEY: "test-offline",
    // End the run at its first stage: everything this file asks about happens at the claim and the freeze.
    MOCK_FAIL_STAGE: "record_matter_frame", CLEAROTRON_DELIVERY: "handoff",
    ...extra,
  };
}
const runToExit = (env) => {
  const c = spawn(process.execPath, [RUNNER], { env, stdio: ["ignore", "pipe", "pipe"] });
  c.log = "";
  c.stdout.on("data", (d) => { c.log += d; });
  c.stderr.on("data", (d) => { c.log += d; });
  return new Promise((r) => c.on("exit", (code) => r({ code, log: c.log })));
};
// A Generic job a person without access to everything ordered: the portal stamps the organisation and the cap.
const genericJob = (ref, organisation) => ({
  id: `gc-${ref}`, msgId: `<gc-${ref}@x>`, forwarder: "requester", forwarderDomain: "example.com",
  ref, markName: `GENERIC ${ref}`, classes: [9], provider: "corsearch",
  profileKey: "generic", tenant: organisation, clientPrincipal: true,
});
const rows = (root) => {
  try { return readFileSync(ledgerFor(root), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); }
  catch { return []; }
};
const roots = [];
const fresh = (prefix) => { const r = mkdtempSync(join(tmpdir(), prefix)); roots.push(r); mkdirSync(queueFor(r), { recursive: true }); return r; };
test.after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

test("a claimed Generic job is filed under its organisation: the ledger row and the frozen profile both carry it", async () => {
  const root = fresh("generic-claim-");
  writeFileSync(join(queueFor(root), "job-g.json"), JSON.stringify(genericJob("TMP9401", "southbank")));
  const { code, log } = await runToExit(envFor(root));
  assert.equal(code, 0, log);
  const mine = rows(root).filter((e) => e.id === "gc-TMP9401");
  assert.equal(mine.length, 1, `the claim recorded ${mine.length} ledger row(s) for the job\n${log}`);
  assert.equal(mine[0].profileKey, "generic");
  assert.equal(mine[0].organisation, "southbank", "the row counts in Southbank's Generic lane — without it, it counts in none");
  assert.equal(mine[0].clientPrincipal, true);
  const res = JSON.parse(readFileSync(join(queueFor(root), "job-g.failed.result"), "utf8"));
  const frozen = JSON.parse(readFileSync(driverDir(res.runDir, "profile.json"), "utf8"));
  assert.equal(frozen.organisation, "southbank", "the frozen profile names the organisation, which is how the listings place a live run");
});

test("the wall refuses an organisation's Generic once its day is used, and lets another organisation's through", async () => {
  const root = fresh("generic-wall-");
  const now = Date.now();
  for (let i = 0; i < 20; i++) {
    appendFileSync(ledgerFor(root), JSON.stringify({ sig: `prior-${i}`, msgId: `<prior-${i}@x>`, id: `prior-${i}`, ts: now - 1000,
      profileKey: "generic", organisation: "southbank", clientPrincipal: true }) + "\n");
  }
  writeFileSync(join(queueFor(root), "job-s.json"), JSON.stringify(genericJob("TMP9402", "southbank")));
  const refused = await runToExit(envFor(root));
  assert.equal(refused.code, 0, refused.log);
  assert.match(refused.log, /daily allowance: Generic for southbank has started 20 search\(es\) today/,
    `the twenty-first Southbank Generic clearance of the day was admitted\n${refused.log}`);
  assert.equal(rows(root).filter((e) => e.id === "gc-TMP9402").length, 0, "a refused job records nothing against the day");

  writeFileSync(join(queueFor(root), "job-n.json"), JSON.stringify(genericJob("TMP9403", "northwind")));
  const admitted = await runToExit(envFor(root));
  assert.equal(admitted.code, 0, admitted.log);
  assert.doesNotMatch(admitted.log, /daily allowance: Generic for northwind/, "Southbank's day closed Northwind's lane");
  assert.equal(rows(root).filter((e) => e.id === "gc-TMP9403" && e.organisation === "northwind").length, 1,
    `Northwind's Generic was claimed and recorded in its own lane\n${admitted.log}`);
});
