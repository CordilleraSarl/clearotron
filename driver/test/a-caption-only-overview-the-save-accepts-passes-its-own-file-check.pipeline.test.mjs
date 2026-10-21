// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CAPTION-ONLY OVERVIEW THE SAVE ACCEPTS PASSES ITS OWN FILE CHECK. The record_report_overview transport accepts a
// caption with an empty actions list and no methodology, and renders it with no section heading. The stage's file check
// (validators.reportOverview) required a section heading, so it refused the driver's own render twice and a live run
// went into recovery. A file that is, byte for byte, the driver's render of the run's last accepted call now passes on
// the acceptance's terms; a shell written by hand, or one changed after the render, still meets the structural check.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv, pinEnvAll, envFrom } from "../../shared/env-aliases.mjs";
import { recordReportOverview, IDENTITY_FILE, PROSE_FILE } from "../report-overview-record.mjs";
import { validators } from "../verify.mjs";

const TEMP_DIRS = [];
const tempDir = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); TEMP_DIRS.push(d); return d; };
after(() => { for (const d of TEMP_DIRS) rmSync(d, { recursive: true, force: true }); });

const IDENTITY = {
  schema_version: 1,
  matter: "TMP8439", title: "PROJECT NOVAPULSE", client: "ACME Interactive", use: "codename",
  classes: "9, 41", run: "2026-01-01 · corsearch + common-law",
  overall_label: "MEDIUM", overall_badge: "l3",
};
const BARE = { overall_caption: "One owner holds a near-identical mark for the same goods and is likely to object; nothing else in the field blocks it.", actions: [] };
const runDirWith = () => {
  const dir = tempDir("rov-bare-");
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(join(dir, IDENTITY_FILE), JSON.stringify(IDENTITY, null, 2) + "\n");
  return dir;
};

test("the driver's render of an accepted caption-only call passes the file check, though it carries no section", () => {
  const dir = runDirWith();
  const r = recordReportOverview(dir, BARE);
  assert.ok(r.written, `premise: the save accepts the call: ${JSON.stringify(r)}`);
  const at = join(dir, PROSE_FILE);
  const content = readFileSync(at, "utf8");
  assert.ok(!/^#\s*(Actions|Coverage|Methodology)/im.test(content), "premise: the render carries no section heading");
  assert.equal(validators.reportOverview(at, content).ok, true, "the file check refused the driver's own render of an accepted call");
});

test("a shell written by hand, or the render changed after the save, still meets the structural check", () => {
  // No accepted call: an archived or replayed shell, written by hand under the old dictation.
  const bare = runDirWith();
  const handWritten = `---\ntype: clearance-clearance\noverall_caption: ${BARE.overall_caption}\n---\n\n${"A note with no section heading at all. ".repeat(4)}\n`;
  const v1 = validators.reportOverview(join(bare, PROSE_FILE), handWritten);
  assert.equal(v1.ok, false, "a hand-written shell with no section passed");
  assert.match(String(v1.reason), /front-matter\+shell/);
  // An accepted call whose render was then changed: the file is no longer the driver's, so the structure is judged.
  const dir = runDirWith();
  recordReportOverview(dir, BARE);
  const at = join(dir, PROSE_FILE);
  const changed = `${readFileSync(at, "utf8")}\nA line added after the save.\n`;
  assert.equal(validators.reportOverview(at, changed).ok, false, "a render changed after the save passed as the driver's own");
  // And a hand-written shell WITH a section still passes, as it always did.
  assert.equal(validators.reportOverview(join(bare, PROSE_FILE), `${handWritten}\n# Methodology\n\nRegister and web.\n`).ok, true);
});

// ── THE WHOLE RUN, ON BOTH ENGINES ───────────────────────────────────────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
const CODEX = join(HERE, "mock-codex.mjs");
chmodSync(CLAUDE, 0o755);
chmodSync(CODEX, 0o755);
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
const JOB = { id: "test-job", msgId: "<test@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8439", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch" };
const AS_STARTED = Object.fromEntries(["CLEAROTRON_AI_BILLING", "CODEX_API_KEY", "CLEAROTRON_CODEX_PATH"].map((k) => [k, process.env[k]]));
const ENGINES = {
  claude: { ...AS_STARTED, CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE },
  codex: { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" },
};
async function runPipeline(env, engine) {
  const root = tempDir("clearotron-bare-overview-");
  delete process.env.MOCK_OVERVIEW_BARE;
  pinEnvAll(process.env, { ...ENGINES[engine], CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_SKEPTIC: "no flags surfaced", MOCK_VERDICT: "CLEAR", ...env });
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB });
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events };
}

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: a run whose overview call is a caption alone delivers, with the overview stage passing on its first attempt`, async () => {
    const { res, events } = await runPipeline({ MOCK_OVERVIEW_BARE: "1" }, engine);
    const shell = readFileSync(join(res.runDir, PROSE_FILE), "utf8");
    assert.ok(!/^#\s*(Actions|Coverage|Methodology)/im.test(shell), "premise: the overview the driver rendered carries no section heading");
    const overview = events.filter((e) => e.event === "stage" && e.stage === "report-overview");
    assert.ok(overview.length >= 1 && overview[0].ok === true && overview[0].attempts === 1,
      `the overview stage did not pass on its first attempt: ${JSON.stringify(overview.map((e) => [e.trigger, e.ok, e.attempts, e.fail]))}`);
    assert.ok(!events.some((e) => /front-matter\+shell/.test(JSON.stringify(e))), "the file check refused the driver's own render");
    assert.ok(!events.some((e) => e.event === "auto-recovery-parked"), "the run went into recovery");
    assert.ok(readFileSync(join(res.runDir, "report.md"), "utf8").includes("The identical registration in class 9 is the one finding"), "the delivered report does not carry the caption the mock sent");
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 300));
  });
}
