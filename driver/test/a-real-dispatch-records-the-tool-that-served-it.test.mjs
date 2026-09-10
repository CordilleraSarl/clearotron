// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-real-dispatch-records-the-tool-that-served-it.test.mjs — the CLI version on the record, written by the
// real dispatch.
//
// a-run-records-the-tool-that-served-it.test.mjs holds the version probe by injecting its `run` function,
// which is what makes those arms fast and what makes them blind to one failure: the dispatch site being
// wired wrong. Its last arm reads the gateway's source for the two row fields. This one drives runStage
// once per engine, through the stand-in binary each engine's own tests use, and reads the version back
// out of the run directory — the stage's attempt row and the run log's attempt event — which is where a
// reader of the record looks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
process.env.CLEAROTRON_RUN_LOCK_DIR = mkdtempSync(join(tmpdir(), "cliver-locks-"));
const { runStage } = await import("../gateway.mjs");
const { forgetCliVersions } = await import("../engine/cli-version.mjs");

function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; pinEnv(process.env, k, env[k]); }
  return (async () => { try { return await fn(); } finally { for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else pinEnv(process.env, k, saved[k]); } } })();
}

// The version token is the one each stand-in prints for --version, read off the stand-in itself.
const ENGINES = {
  "anthropic-agent": { version: "2.1.241", env: (dir, out) => ({ CLEAROTRON_AI: "anthropic-agent",
    CLEAROTRON_CLAUDE_PATH: join(HERE, "mock-claude.mjs"), MOCK_CLAUDE_FILE: "a stub the validator accepts\n",
    MOCK_OUT_FILE: out, MOCK_CLAUDE_CALL_LOG: join(dir, "calls.jsonl"), MOCK_COUNT_FILE: join(dir, "count") }) },
  "openai-agent": { version: "0.5.0", env: () => ({ CLEAROTRON_AI: "openai-agent",
    CLEAROTRON_CODEX_PATH: join(HERE, "mock-codex.mjs"), CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-dummy",
    MOCK_CODEX_FILE: "# ctx\n" }) },
};

for (const [engine, { version, env }] of Object.entries(ENGINES)) {
  test(`${engine}: a real dispatch writes the version it probed, and the probe state, on both attempt records`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "cliver-"));
    try {
      mkdirSync(driverDir(dir), { recursive: true });
      forgetCliVersions();
      const out = join(dir, "out.md");
      const res = await withEnv({ ...env(dir, out), CLEAROTRON_RETRY_BACKOFF_MS: "0" },
        () => runStage("matter-frame", { message: `write it. OUTPUT_FILE: ${out}`, model: "opus", sessionKey: `cliver-${engine}`,
          runDir: dir, expectFile: out, maxRetries: 0, timeoutSec: 30 }));
      assert.equal(res?.ok, true, `the stand-in turn did not complete, so there is no attempt record to read: ${JSON.stringify(res).slice(0, 300)}`);
      const read = (p) => readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
      const runLog = [driverDir(dir, "run.jsonl"), join(dir, "run.jsonl")].find(existsSync);
      assert.ok(runLog, "no run log was written, so its attempt event cannot be read");
      for (const [where, rows] of [["the stage's attempt row", read(driverDir(dir, "matter-frame.jsonl"))],
        ["the run log's attempt event", read(runLog).filter((e) => e.event === "attempt")]]) {
        assert.ok(rows.length >= 1, `${where}: none was written`);
        const last = rows[rows.length - 1];
        assert.equal(last.cliVersion, version, `${where} does not carry the version the binary answered: ${JSON.stringify(last).slice(0, 240)}`);
        assert.equal(last.cliVersionProbe, "ok", `${where} does not say the probe answered`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
