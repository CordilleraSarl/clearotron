// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The harness the three review-after-a-repair test files share: the environment a hermetic mock run needs, the job,
// both engines, `runPipeline`, and the helpers and opening sentences more than one file reads. Importing it sets that
// environment, and the run folders it makes are removed when the importing file's tests end. Every run is
// billable-call-free (mock engine).
import { after } from "node:test";
import { pinEnv, pinEnvAll, envFrom } from "../../shared/env-aliases.mjs";
import { mkdtempSync, chmodSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";

const TEMP_DIRS = [];
export const tempDir = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); TEMP_DIRS.push(d); return d; };
after(() => { for (const d of TEMP_DIRS) rmSync(d, { recursive: true, force: true }); });

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

const JOB = {
  id: "test-job", msgId: "<test@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8439", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};
const KNOBS = ["MOCK_VERDICT", "MOCK_VERDICT_DEFECTS", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_ACTIONS",
  "MOCK_LINT_REPAIR_TOUCH_FINDINGS", "MOCK_LINT_REPAIR_TOUCH_FINDING", "MOCK_REVIEW_BLOCKS_AFTER_VERDICT",
  "MOCK_NARRATIVE_OVER_CAP", "MOCK_POST_REPAIR_FLAGS", "MOCK_POST_REPAIR_VERDICT", "MOCK_LINT_REPAIR_SAME_VALUES",
  "MOCK_POST_REPAIR_UNREAD", "MOCK_WHOLE_FALLBACK_FLAGS", "MOCK_WHOLE_FALLBACK_VERDICT", "MOCK_LATE_SAVE_ADDS",
  "MOCK_FAIL_AFTER_WRITES", "MOCK_POST_REPAIR_LOSES", "MOCK_CORRECTION_MARKS", "MOCK_POST_REPAIR_OWES_MORE",
  "MOCK_CLAUDE_RATELIMIT", "MOCK_CLAUDE_RATELIMIT_MATCH", "MOCK_CODEX_RATELIMIT", "MOCK_CODEX_RATELIMIT_MATCH"];

// The Codex run pins its own billing; every Claude run puts back what the suite started with.
const AS_STARTED = Object.fromEntries(["CLEAROTRON_AI_BILLING", "CODEX_API_KEY", "CLEAROTRON_CODEX_PATH"].map((k) => [k, process.env[k]]));
export const ENGINES = {
  claude: { ...AS_STARTED, CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE },
  codex: { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" },
};

export async function runPipeline(env, engine = "claude", { codename = null } = {}) {
  const root = codename ? process.env.CLEAROTRON_WORK_DIR : tempDir("clearotron-post-repair-");
  for (const k of KNOBS) delete process.env[k];
  pinEnvAll(process.env, { ...ENGINES[engine], CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_SKEPTIC: "no flags surfaced", ...env });
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB }, codename ? { codename } : {});
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events };
}
export const stageEvents = (events, stage, trigger) => events.filter((e) => e.event === "stage" && e.stage === stage && e.trigger === trigger);
/** Every message a stage was sent this run, the superseded ones included. */
export const dispatches = (runDir, stage) => readdirSync(driverDir(runDir)).filter((f) => f.startsWith(`${stage}.attempt`) && f.includes(".dispatch.txt"))
  .map((f) => readFileSync(driverDir(runDir, f), "utf8"));
export const REVIEW_OPENS = "This is a review of a repair, not a full review.";
export const CORRECTION_OPENS = "After the delivery check, that record was repaired, and an independent review then read only what the repair changed and what rests on it.";
// The same correction, after a whole review (design's wording, 2026-10-18).
export const WHOLE_CORRECTION_OPENS = "After the delivery check, that record was repaired, and the full independent review ran again.";

export const codenameOf = (runDir) => runDir.split(/[\\/]/).pop().split("-").slice(3).join("-");
