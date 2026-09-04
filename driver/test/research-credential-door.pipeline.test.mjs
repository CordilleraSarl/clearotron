// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// -6 — the research-credential refusal AT THE RUN DOOR. preflight-research-credential.test.mjs
// proves the FUNCTION decides correctly; this proves the pipeline actually ASKS IT, and asks it before
// it has spent anything. A correct predicate nobody calls is the failure mode that unit file cannot see.
//
// Modelled on engine-turn-door.pipeline.test.mjs, including its headline assertion: the property
// is read off the FILESYSTEM — no run directory, no frozen profile, no status sidecar — not off the
// message. "It threw" is satisfied by any of the four doors; "it built nothing" is the claim being made.
//
// THE CONTROL IS THE OTHER HALF, and without it this file would assert almost nothing: four preflights
// run ahead of this one, so a refusal proves the door was reached only if the SAME job with the SAME
// environment plus the credential gets past it. Both directions, one variable between them.
import { test } from "node:test";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling; the default is taken only when NO spelling holds one
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE_MOCK = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE_MOCK, 0o755);

// The register door runs BEFORE this one. Without a register provider AND its credential the run refuses
// for the wrong reason, and this whole file would pass on a refusal it did not cause — which is exactly
// what happened on the first run of this file: the control below went red on
// "[register-provider] CLEAROTRON_DATABASE is not set" and named the mistake before it shipped.
pinEnv(process.env, "CLEAROTRON_DATABASE", envFrom(process.env, "CLEAROTRON_DATABASE") || "corsearch");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

// `full-country-search` carries commonLawGrid: true — one of the three the ADR names.
const JOB = {
  id: "test-job-research-door", msgId: "<test-research-door@x>", forwarder: "requester",
  forwarderDomain: "example.com", ref: "TMP8440", markName: "PROJECT NOVAPULSE", classes: [9, 41],
  provider: "corsearch", product: "full-country-search",
};

/** CLEAROTRON_REPORTS_DIR is set INSIDE the temp root on purpose: unset, the driver default is production. */
function harness(env = {}) {
  const root = mkdtempSync(join(tmpdir(), "prelim-research-door-"));
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE_MOCK,
    CLEAROTRON_DATABASE: "corsearch", CORSEARCH_SESSION_KEY: "test-offline",
    CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_AGENT: "clawdi",
    MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", ...env,
  })) pinEnv(process.env, k, v);
  return {
    root,
    run: async () => {
      const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
      return pipeline({ ...JOB });
    },
  };
}

/** Run `fn` with PERPLEXITY_API_KEY forced to a value (or forced ABSENT), then put the box back.
 *  Forced rather than assumed: a dev box that happens to hold a live key would make the refusal
 *  test pass or fail on ambient state instead of on the code. */
async function withResearchKey(value, fn) {
  const had = process.env.PERPLEXITY_API_KEY;
  if (value === null) delete process.env.PERPLEXITY_API_KEY;
  else process.env.PERPLEXITY_API_KEY = value;
  try { return await fn(); }
  finally {
    if (had === undefined) delete process.env.PERPLEXITY_API_KEY;
    else process.env.PERPLEXITY_API_KEY = had;
  }
}

test("#1149-6 a clearance with no research credential is refused at the door — nothing is built", async () => {
  await withResearchKey(null, async () => {
    const { root, run } = harness();
    await assert.rejects(run, (e) => {
      assert.match(e.message, /^\[preflight\] /, "the same prefix as its refusing siblings at the same door");
      assert.match(e.message, /PERPLEXITY_API_KEY/, "it names the variable the reader has to set");
      assert.match(e.message, /full-country-search/, "…and the product it refused");
      return true;
    });
    // The claim: the run spent nothing and left nothing. `prelim-run-locks` is taken by `pipeline()`
    // before `pipelineInner` is entered at all, so it is present whatever the door does; an agent
    // workspace beside it would mean the run got past.
    assert.deepEqual(readdirSync(root), ["prelim-run-locks"],
      "no agent workspace, no run directory, no frozen profile — refused before the register stages it used to pay for");
  });
});

// THE CONTROL. Same job, same env, one variable different — so the refusal above is attributable to this
// door and not to one of the four ahead of it.
test("#1149-6 CONTROL — the same job WITH the credential gets past this door", async () => {
  await withResearchKey("pplx-NOT-A-REAL-KEY-8b3f1d6a2c9e4407", async () => {
    const { root, run } = harness();
    const res = await run();
    // It need not SUCCEED — the mock engine decides that, and this door's business ends at "not refused".
    // What must be true is that it got far enough to build a run directory, which the refusal denied.
    assert.ok(res?.runDir && existsSync(res.runDir),
      "with the credential present the run reaches its run dir; if this fails the refusal above proves nothing");
    assert.ok(readdirSync(root).length > 1,
      "…and left an agent workspace beside the lock, which the refused run did not");
  });
});
