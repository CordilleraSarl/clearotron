// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — A BLANK NUMERIC SETTING IS NOT THE NUMBER ZERO.
//
// `Number("")` and `Number("   ")` are both **0**, not NaN. So a blank value passes the truthiness test
// where there is one, survives `Number()`, and then survives the floor beneath it looking like a real
// setting. Nothing announces it. A trailing space in an EnvironmentFile — the most ordinary way to
// produce this — replaced a tuned default with the most degenerate value in range.
//
// TWO OF THESE WERE BROKEN ON THE DOCUMENTED SPELLING, not merely on whitespace, and that is the half
// worth reading:
//
//   maxClaimAgeMs    `?? default`, so "" passes straight through. CLEAROTRON_MAX_CLAIM_AGE_MS= gave **0**,
//                    which means every claim is instantly older than the maximum age — everything stale,
//                    permanently, silently.
//   cardConcurrency  `Number.isFinite(n)`, which is right for a non-numeric value and wrong here: 0 IS
//                    finite, so a blank gave 1 instead of 8.
//
// `X=` is what DOCUMENTS as "not configured". Those two therefore mishandled the spelling the
// documentation tells operators to use, and had done since before the whitespace question was asked.
// The other seven use `||`, where "" is falsy, so only the whitespace shape got through them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "../driver.config.mjs";
import { NUMERIC_SETTING_DEFAULTS } from "../numeric-setting.mjs";

const CONFIG_SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "driver.config.mjs");

/** accessor → the value it must give when its variable says nothing.
 *
 * — the numbers are READ from the one table that defines them, not copied here.
 *  A second hand-maintained copy of every default is the drift this file exists to catch, and a copy
 *  living in the test is worse than one living in the code: it goes green against itself. */
const NUMERIC_DEFAULTS = Object.fromEntries(Object.entries({
  gatherConcurrency: "CLEAROTRON_GATHER_CONCURRENCY",
  cardConcurrency: "CLEAROTRON_CARD_CONCURRENCY",
  maxClaimAgeMs: "CLEAROTRON_MAX_CLAIM_AGE_MS",
  maxConcurrentRuns: "CLEAROTRON_MAX_CONCURRENT_RUNS",
  maxRetries: "CLEAROTRON_MAX_RETRIES",
  rateLimitDefaultBackoffMs: "CLEAROTRON_RATE_LIMIT_DEFAULT_BACKOFF_MS",
  rateLimitProbeMs: "CLEAROTRON_RATE_LIMIT_PROBE_MS",
  rateLimitProbeCeilingMs: "CLEAROTRON_RATE_LIMIT_PROBE_CEILING_MS",
}).map(([accessor, name]) => [accessor, NUMERIC_SETTING_DEFAULTS[name]]));

const VARS = [
  "CLEAROTRON_GATHER_CONCURRENCY", "CLEAROTRON_CARD_CONCURRENCY", "CLEAROTRON_MAX_CLAIM_AGE_MS",
  "CLEAROTRON_MAX_CONCURRENT_RUNS", "CLEAROTRON_TURN_CAP", "CLEAROTRON_MAX_RETRIES",
  "CLEAROTRON_RATE_LIMIT_DEFAULT_BACKOFF_MS", "CLEAROTRON_RATE_LIMIT_PROBE_MS", "CLEAROTRON_RATE_LIMIT_PROBE_CEILING_MS",
];

function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  try {
    for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test("#1340 every numeric setting takes its DEFAULT for unset, empty and whitespace alike", () => {
  for (const blank of [undefined, "", "   ", "\t", "\n"]) {
    const env = Object.fromEntries(VARS.map((v) => [v, blank]));
    withEnv(env, () => {
      for (const [name, want] of Object.entries(NUMERIC_DEFAULTS)) {
        assert.equal(config[name], want,
          `${name} with every numeric variable ${JSON.stringify(blank)} — a blank is not a setting, and `
          + `Number("") is 0 rather than NaN, which is how it used to pass for one.`);
      }
    });
  }
});

test("#1340 the two that failed on the DOCUMENTED empty spelling, named so the regression is legible", () => {
  // Kept as their own case because these were not whitespace bugs. `X=` is what tells an operator to
  // write for "not configured", and these two answered it with the most degenerate value in range.
  withEnv({ CLEAROTRON_MAX_CLAIM_AGE_MS: "" }, () => {
    assert.equal(config.maxClaimAgeMs, 48 * 3600000,
      "CLEAROTRON_MAX_CLAIM_AGE_MS= resolved to 0, so every claim was instantly past the maximum age");
  });
  withEnv({ CLEAROTRON_CARD_CONCURRENCY: "" }, () => {
    assert.equal(config.cardConcurrency, 8, "CLEAROTRON_CARD_CONCURRENCY= resolved to 1, not to the default");
  });
});

test("#1340 a REAL value still works, including one that is legitimately zero-ish", () => {
  // The fix must not swallow configured values, and a floor is not the same as a default.
  withEnv({ CLEAROTRON_GATHER_CONCURRENCY: "1" }, () => assert.equal(config.gatherConcurrency, 1));
  withEnv({ CLEAROTRON_MAX_CLAIM_AGE_MS: "0" }, () => assert.equal(config.maxClaimAgeMs, 0,
    "an explicit 0 is a CHOICE and must survive — only a blank falls back"));
  withEnv({ CLEAROTRON_MAX_RETRIES: "0" }, () => assert.equal(config.maxRetries, 0));
  // A non-numeric value keeps cardConcurrency's documented fallback rather than becoming NaN. Tracker
  // issue 1875 made that fallback the ONE declared exemption from a named refusal and moved its own arm
  // to numeric-setting-refuses.test.mjs, where the exemption is stated. Kept here because this file's
  // subject is the blank/zero boundary and a non-numeric value sits just outside it.
  withEnv({ CLEAROTRON_CARD_CONCURRENCY: "banana" }, () => assert.equal(config.cardConcurrency, 8));
});

test("#1340 no numeric accessor reads process.env directly again", () => {
  // The growth property. Every one of these went through the same shape, so a new one written the old way
  // reintroduces the defect silently — there is no symptom until a tuned default is quietly replaced.
  const src = readFileSync(CONFIG_SRC, "utf8");
  const offenders = [];
  src.split("\n").forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return;                    // the docblock discusses the old shape
    if (/Number\(\s*process\.env\./.test(line)) offenders.push(`${i + 1}: ${line.trim()}`);
  });
  assert.deepEqual(offenders, [],
    "these read a number straight out of the environment, so a blank becomes 0 instead of the default:\n  "
    + offenders.join("\n  ") + "\n\nUse `this.envValue(\"NAME\")`, which answers undefined for unset, empty "
    + "and whitespace alike, so `||` and `??` both fall through to the default.");
});
