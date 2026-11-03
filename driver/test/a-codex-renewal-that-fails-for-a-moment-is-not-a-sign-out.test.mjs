// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CODEX RENEWAL THAT FAILS FOR A MOMENT IS NOT A SIGN-OUT.
//
// codex 0.162.0 writes "Failed to refresh token…" on stderr for every sign-in renewal that does not succeed,
// a passing one included: a 503, a dropped connection, and an outage the renewal recovered from within the
// same turn. Measured offline, 2026-11-03, with codex's renewal pointed at a local stand-in. The adapter read
// each of those lines as a sign-out, so the gateway ended the stage's retries on its first attempt, and a run
// that met the outage again after its one park failed as "codex sign-in expired". A refused renewal is still
// a sign-out: a 401, or codex's words for a token that is spent, expired or revoked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runStage } from "../gateway.mjs";
import { openaiAgentEngine } from "../engine/openai-agent.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK = join(HERE, "mock-codex.mjs");

function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; pinEnv(process.env, k, env[k]); }
  return (async () => { try { return await fn(); } finally { for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else pinEnv(process.env, k, saved[k]); } } })();
}
const CODEX = { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: MOCK, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-test" };

// Codex's lines, as 0.162.0 wrote them to stderr. In the stand-in's answers, the provider's own message
// ("upstream answered 503", and the spent token's) is the stand-in's; every other word is codex's.
const PASSING_503 = [
  "2026-11-03T13:39:14.146239Z ERROR codex_login::auth::manager: Failed to refresh token status=503 Service Unavailable detail=TokenErrorDetail { error_code: None, error_message: Some(\"upstream answered 503\"), .. }",
  "2026-11-03T13:39:14.146297Z ERROR codex_login::auth::manager: Failed to refresh token: Failed to refresh token: 503 Service Unavailable: upstream answered 503",
];
const REFUSED_401 = [
  "2026-11-03T13:39:36.110059Z ERROR codex_login::auth::manager: Failed to refresh token status=401 Unauthorized detail=TokenErrorDetail { error_code: Some(\"refresh_token_reused\"), error_message: Some(\"Your refresh token has already been used to generate a new access token. Please try signing in again.\"), .. }",
  "2026-11-03T13:39:36.110114Z ERROR codex_login::auth::manager: Failed to refresh token: Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again.",
];
// The live capture of 2026-09-11, an earlier codex: the form the sign-out pattern was first written for.
const REFUSED_2026_09_11 = 'ERROR codex_login::auth::manager: Failed to refresh token: 401 Unauthorized: {"error":{"message":"Your refresh token has already been used to generate a new access token. Please try signing in again."}}';

/** One turn through the real adapter, against the mock replaying `lines` (or the dropped-connection capture). */
async function turnWith(lines) {
  const dir = mkdtempSync(join(tmpdir(), "codex-renewal-"));
  try {
    const env = { ...CODEX, MOCK_CODEX_RENEWAL_FAILED: join(dir, "failed") };
    if (lines) { env.MOCK_CODEX_RENEWAL_LINES = join(dir, "lines.txt"); writeFileSync(env.MOCK_CODEX_RENEWAL_LINES, `${lines.join("\n")}\n`); }
    return await withEnv(env, () => openaiAgentEngine.runTurn({ message: "Reply with the word ok.", model: "haiku", thinking: "low", timeoutSec: 30, runDir: dir }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("a renewal that failed for a passing reason is not a sign-out; one the provider refused still is", async () => {
  for (const [name, lines, refused] of [
    ["a dropped connection (the capture)", null, false],
    ["a 503, the same lines whether or not a later renewal in the turn succeeded", PASSING_503, false],
    ["a 401: the token was already used (0.162.0)", REFUSED_401, true],
    ["a 401: the token was already used (the 2026-09-11 capture)", [REFUSED_2026_09_11], true],
  ]) {
    const t = await turnWith(lines);
    assert.notEqual(t.code, 0, `${name}: the turn failed`);
    assert.equal(Boolean(t.signals?.signedOut), refused, `${name}: signedOut`);
    assert.equal(Boolean(t.signals?.refreshFailed), !refused, `${name}: refreshFailed`);
    if (refused) assert.match(t.signals.signedOut, /`codex login`/, `${name}: the sign-out still names what fixes it`);
  }
});

test("a stage whose renewal failed for a moment retries, and its second attempt delivers", async () => {
  // On the code this replaces, the first attempt ended the ladder as `engine_signed_out:` and the stage failed.
  const dir = mkdtempSync(join(tmpdir(), "codex-renewal-stage-"));
  try {
    const out = join(dir, "ctx.md");
    const r = await withEnv({ ...CODEX, CLEAROTRON_RETRY_BACKOFF_MS: "0", MOCK_CODEX_FILE: "# ctx\n", MOCK_CODEX_RENEWAL_FAILED: join(dir, "failed") },
      () => runStage("matter-frame", { message: `write it. OUTPUT_FILE: ${out}`, model: "opus", sessionKey: `renewal-${process.pid}`,
        runDir: dir, expectFile: out, maxRetries: 2 }));
    assert.equal(r.ok, true, `the stage did not recover from a passing renewal failure: ${r.fail}`);
    assert.equal(r.attempts, 2, "one failed attempt, then the retry that delivered");
    assert.ok(!(r.attemptFails ?? []).some((f) => /^engine_signed_out:/.test(String(f))), `a passing failure was named a sign-out: ${JSON.stringify(r.attemptFails)}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
