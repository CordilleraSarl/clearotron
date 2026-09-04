// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the real runner's crash-reclaim lane end to end
// A5 (2026-07-28 postmortem) — the queue crash-reclaim lane is BOUNDED. It used to clear the dead claimer and
// re-drive the same codename with no counter, so a run whose every resume died the same death (an
// invalid artifact, a wedge outliving its claimer) was resumed at every activation forever — the loop
// behind "running 7/9". The identity meta now carries a `reclaims` counter (persisted at dispatch,
// preserved by runPrepared); past the cap the claim goes TERMINAL with artifacts kept and the failure
// notice on the guaranteed packet lane. Cross-process, like the other reclaim tests — the dead-claimer
// window IS the feature.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, chmodSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { todayISO } from "../phase0.mjs";
import { deadClaimToken } from "./claim-fixtures.mjs";   // — pid+starttime, never a bare pid
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, "..", "runner.mjs");
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);

const studioFor = (root) => join(root, "workspace-clawdi", "studio", "prelim-search");
const queueFor = (root) => join(studioFor(root), "queue");

function envFor(root, extra = {}) {
  return {
    ...process.env,
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_OUTBOX_DIR: join(root, "outbox"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    CLEAROTRON_QUEUE_SCAN_MS: "100", CORSEARCH_SESSION_KEY: "test-offline",
    ...extra,
  };
}
const spawnRunner = (env) => {
  const c = spawn(process.execPath, [RUNNER], { env, stdio: ["ignore", "pipe", "pipe"] });
  c.log = "";
  c.stdout.on("data", (d) => { c.log += d; });
  c.stderr.on("data", (d) => { c.log += d; });
  c.exited = new Promise((r) => c.on("exit", (code) => r(code)));
  return c;
};

// A dead claimer's .processing with identity meta at `reclaims` prior crash-reclaims, plus the live
// run dir the codename owns (mid-flight shape: status running, no terminal sentinel).
async function seedOrphan(root, { reclaims }) {
  const Q = queueFor(root);
  mkdirSync(Q, { recursive: true });
  const J = { id: "reclaim-TMP9201", msgId: "<reclaim-TMP9201@x>", forwarder: "requesting-lawyer", forwarderDomain: "example.com",
    ref: "TMP9201", markName: "RECLAIM PROBE", classes: [9], provider: "corsearch" };
  const slug = "tmp9201-reclaim-probe";
  const codename = "onyx-hollow";
  const dateISO = todayISO();
  const runDir = join(studioFor(root), slug, `${dateISO}-${codename}`);
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(join(runDir, "status.json"), JSON.stringify({
    runId: `${slug}-${dateISO}-${codename}`, slug, codename, date: dateISO, agent: "clawdi",
    state: "running", stepN: 7, stepTotal: 9, stepLabel: "Drafting the report", updatedAt: new Date().toISOString(),
  }, null, 2) + "\n");
  writeFileSync(join(Q, "job-a.processing"), JSON.stringify(J));
  writeFileSync(join(Q, "job-a.processing.pid"), await deadClaimToken());
  writeFileSync(join(Q, "job-a.processing.meta"), JSON.stringify({ codename, dateISO, agentId: "clawdi", ...(reclaims ? { reclaims } : {}) }, null, 2) + "\n");
  return { Q, runDir, codename, slug, job: J };
}

test("reclaim bound: at the cap the claim goes TERMINAL — artifacts kept, terminalKind stamped, failure packet on the guaranteed lane", async () => {
  const root = mkdtempSync(join(tmpdir(), "reclaim-cap-"));
  const { Q, runDir } = await seedOrphan(root, { reclaims: 3 });
  const c = spawnRunner(envFor(root));
  assert.equal(await c.exited, 0, c.log);
  assert.match(c.log, /queue reclaim exhausted/, "the terminal is loud");

  // queue side: terminal marker + result, never a resume
  assert.ok(existsSync(join(Q, "job-a.failed")), "claim ended as .failed");
  assert.ok(!existsSync(join(Q, "job-a.processing")), "no live-looking claim left behind");
  const result = JSON.parse(readFileSync(join(Q, "job-a.failed.result"), "utf8"));
  assert.equal(result.terminalKind, "reclaim-exhausted");
  assert.equal(result.failedStage, "queue-reclaim");

  // run side: failed WITH artifacts (the dir survives), status carries the WHY
  assert.ok(existsSync(runDir), "artifacts kept for diagnosis");
  assert.ok(existsSync(join(runDir, ".failed")), "run-dir terminal sentinel (blocks every self-resume lane)");
  const status = JSON.parse(readFileSync(join(runDir, "status.json"), "utf8"));
  assert.equal(status.state, "failed");
  assert.equal(status.terminalKind, "reclaim-exhausted");
  assert.equal(status.sendPending, true, "the notice is owed");

  // the guaranteed notice lane: packet + outbox marker ( T5 shape)
  const packet = JSON.parse(readFileSync(driverDir(runDir, "failure.json"), "utf8"));
  assert.equal(packet.terminalKind, "reclaim-exhausted");
  const outbox = readdirSync(join(root, "outbox"));
  assert.ok(outbox.some((f) => f.endsWith(".pending")), `outbox wake marker present (got ${outbox.join(", ")})`);
});

test("reclaim bound: UNDER the cap the reclaim still resumes (counter incremented and persisted through dispatch)", async () => {
  const root = mkdtempSync(join(tmpdir(), "reclaim-under-"));
  const { Q, codename } = await seedOrphan(root, { reclaims: 1 });
  const c = spawnRunner(envFor(root));
  assert.equal(await c.exited, 0, c.log);
  assert.match(c.log, /reclaim 2\/3/, "the counter is visible in the journal");
  assert.ok(existsSync(join(Q, "job-a.done")), `the resume ran to delivery\n${c.log}`);
  const res = JSON.parse(readFileSync(join(Q, "job-a.done.result"), "utf8"));
  assert.ok(String(res.runDir).endsWith(`-${codename}`), "resumed the SAME codename, no fresh mint");
});
