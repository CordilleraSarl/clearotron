// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the whole mock clearance pipeline twice, the second time as a resume
//
// A CLEARANCE RESUMED AFTER IT PUBLISHED DELIVERS WHAT THE FIRST PASS WOULD HAVE.
//
// A clearance records its publish in `.published`, and a resume that finds the record delivers from it rather than
// publishing again. The record kept four fields of the publish: the run id, the link, the counts and the client
// gate. The delivery after it reads three more: the workbook's file name for the covering email's download link,
// the report's caption for the run record, and the pool folder its delivered state is stamped on. So a run stopped
// between the publish and its delivered status sent its covering email without the workbook link, kept no caption,
// and left its pool copy unstamped.
//
// The stop here is a real one: the delivery packet's write fails once, after the covering email is composed and
// before the delivered status is written. That email is the first pass's own, and the resume must send the same.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
const PROFILES = mkdtempSync(join(tmpdir(), "clearotron-profiles-resumed-delivery-"));
cpSync(join(HERE, "..", "profiles"), PROFILES, { recursive: true });
pinEnv(process.env, "CLEAROTRON_CUSTOMERS_DIR", PROFILES);

const ROOT = mkdtempSync(join(tmpdir(), "clearotron-resumed-delivery-"));
const JOB = {
  id: "resumed-delivery", msgId: "<resumed-delivery@x>", forwarder: "jordan", forwarderDomain: "example.com",
  ref: "TMP-3307", markName: "NOVAPULSE", classes: [9, 41], provider: "corsearch",
};
for (const [k, v] of Object.entries({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE,
  CLEAROTRON_WORK_DIR: ROOT, CLEAROTRON_REPORTS_DIR: join(ROOT, "pool"), CLEAROTRON_MAX_RETRIES: "0",
  CLEAROTRON_RECOVERY_MAX: "1", CLEAROTRON_DEFAULT_AGENT: "intake-agent", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" })) pinEnv(process.env, k, v);

const pipelineOf = async () => (await import(`../pipeline.mjs?bust=${Math.random()}`)).pipeline;
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const codenameOf = (runDir) => runDir.split(/[\\/]/).pop().split("-").slice(3).join("-");
/** The pool folders this run published, by its codename. */
const poolCopies = (codename) => readdirSync(join(ROOT, "pool"), { recursive: true })
  .filter((p) => String(p).split(/[\\/]/).pop() === "meta.json" && String(p).includes(codename)).map((p) => dirname(join(ROOT, "pool", String(p))));

/** Run the first pass with the delivery packet's write failing once, so the run stops after it published. */
async function stopAfterPublishing() {
  const fs = createRequire(import.meta.url)("node:fs");
  const real = fs.writeFileSync;
  let faulted = 0;
  fs.writeFileSync = (p, ...rest) => {
    if (!faulted && /[\\/]_driver[\\/]delivery\.json$/.test(String(p))) { faulted++; throw Object.assign(new Error("EIO: a planted write fault"), { code: "EIO" }); }
    return real.call(fs, p, ...rest);
  };
  syncBuiltinESMExports();
  try {
    const res = await (await pipelineOf())(JOB);
    assert.equal(faulted, 1, "the planted fault must have reached the packet's write, or this arm proves nothing");
    return res;
  } finally {
    fs.writeFileSync = real;
    syncBuiltinESMExports();
  }
}

test("a clearance resumed after it published sends the first pass's covering email, keeps its caption and stamps its pool copy", async () => {
  const first = await stopAfterPublishing();
  assert.notEqual(first.ok, true, `premise: the first pass must stop before delivering: ${JSON.stringify(first)}`);
  const runDir = first.runDir;
  assert.ok(existsSync(join(runDir, ".published")), "premise: the first pass published before it stopped");
  assert.ok(!existsSync(join(runDir, ".delivered")), "premise: and did not deliver");
  const codename = codenameOf(runDir);
  const [pool] = poolCopies(codename);
  assert.ok(pool, "premise: the pool holds the published copy");
  const meta = readJson(join(pool, "meta.json"));
  assert.ok(meta.auditFile, "premise: the first pass published a workbook, so its email offers the download");
  assert.ok(meta.caption, "premise: the published report has a caption for the run record");
  const firstEmail = readFileSync(join(runDir, "email-body.md"), "utf8");
  assert.match(firstEmail, /Download audit \(Excel\)/, "premise: the first pass's email offers the workbook");

  const resumed = await (await pipelineOf())(JOB, { codename });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.deepEqual(poolCopies(codename), [pool], "the resume published nothing a second time");
  const packet = readJson(driverDir(resumed.runDir, "delivery.json"));
  assert.equal(packet.emailBodyHtml, firstEmail, "the resumed delivery sends the email the first pass composed, workbook link included");
  assert.equal(readJson(join(resumed.runDir, "status.json")).caption, meta.caption, "the run record keeps the report's caption");
  const settle = readdirSync(pool).filter((n) => !["meta.json"].includes(n) && /settle/i.test(n));
  assert.equal(settle.length, 1, `the delivered state is stamped on the pool copy: ${readdirSync(pool).join(", ")}`);
  assert.equal(readJson(join(pool, settle[0])).state, "delivered");
});
