// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the stage ladder resumes a kept session on its first attempt, on both engines, with fake turns
//
// A CORRECTION RESUMES THE SESSION THAT WROTE THE RECORD (owner, 2026-10-02).
//
// A followup used to be a new first attempt with no resume reference, so the corrective pass and every
// repair of synthesis started cold while their message said "You are RESUMING your own synthesis session".
// A stage that keeps its session hands back { ref, home }; a later ladder given it resumes it on its first
// attempt and, on codex, borrows the home the session lives in. A resumed first attempt that fails is
// never resumed again: the next attempt is today's cold dispatch, and the run says so once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
const ROOT = mkdtempSync(join(tmpdir(), "resume-kept-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
pinEnv(process.env, "XDG_CACHE_HOME", join(ROOT, "cache"));
process.env.CLEAROTRON_RETRY_BACKOFF_MS = "0";
const GW = await import("../gateway.mjs");

const withEnv = async (vars, fn) => {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) { prev[k] = process.env[k]; pinEnv(process.env, k, String(v)); }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(prev)) pinEnv(process.env, k, v); }
};

const OK = (ref) => ({ code: 0, killed: false, wall: 1, stdout: "", stderr: "", laneWaitMs: 0,
  json: { status: "ok", runId: `run-${ref}` }, usage: { input_tokens: 10, output_tokens: 10 }, sessionRef: ref });
const GONE = { code: 1, killed: false, wall: 0.2, stdout: "", stderr: "the session could not be resumed", laneWaitMs: 0,
  json: null, usage: null, sessionRef: null };

/** One ladder over a fake engine; `turns` answers each call in order. Returns the calls and the result. */
async function ladder(engineName, tag, turns, opts = {}) {
  const runDir = mkdtempSync(join(ROOT, `${tag}-`));
  mkdirSync(driverDir(runDir), { recursive: true });
  const out = join(runDir, "out.md");
  const calls = [];
  GW.registerEngine({ name: engineName, async runTurn(args) {
    calls.push({ resumeRef: args.resumeRef, codexHome: args.codexHome, homeExists: args.codexHome ? existsSync(args.codexHome) : null });
    const t = turns[calls.length - 1] ?? turns[turns.length - 1];
    if (t.code === 0) writeFileSync(out, "the record\n");
    return t;
  } });
  const r = await withEnv({ CLEAROTRON_AI: engineName, CLEAROTRON_MAX_RETRIES: "2", CLEAROTRON_RECOVERY_MAX: "0" }, () =>
    GW.runStage("synthesis", { agent: "mailagent", message: "go", model: "haiku", sessionKey: `clearance-${tag}`,
      timeoutSec: 30, runDir, expectFile: [out], ...opts }));
  const run = (() => { try { return readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } })();
  return { r, calls, run };
}

for (const engine of ["anthropic-agent", "openai-agent"]) {
  test(`${engine}: the stage that wrote the record keeps its session, and a correction resumes it on its first attempt`, async () => {
    const first = await ladder(engine, `keep-${engine}`, [OK("sess-1")], { keepSession: true });
    assert.equal(first.r.ok, true);
    assert.equal(first.r.session?.ref, "sess-1", "the kept handle names the session that wrote the record");
    if (engine === "openai-agent") assert.ok(first.r.session.home && existsSync(first.r.session.home), "codex keeps the home the session lives in");
    else assert.equal(first.r.session.home, null, "claude resumes from its own store; there is no home to keep");

    const fix = await ladder(engine, `fix-${engine}`, [OK("sess-2")], { resume: first.r.session });
    assert.equal(fix.calls[0].resumeRef, "sess-1", "the first attempt resumed the kept session");
    if (engine === "openai-agent") {
      assert.equal(fix.calls[0].codexHome, first.r.session.home, "and ran in the home that session lives in");
      assert.ok(existsSync(first.r.session.home), "a borrowed home outlives the ladder that borrowed it");
    }
    assert.equal(fix.r.sessionRef, "sess-2", "the correction hands back its own session for the next one to resume");

    GW.releaseStageSession(first.r.session);
    if (first.r.session.home) assert.equal(existsSync(first.r.session.home), false, "its owner releases the kept home");
  });

  test(`${engine}: a resumed first attempt that fails is not resumed again — the next is cold, and the run says so`, async () => {
    const kept = { ref: "sess-gone", home: null };
    const { r, calls, run } = await ladder(engine, `gone-${engine}`, [GONE, OK("sess-3")], { resume: kept });
    assert.equal(r.ok, true, String(r.fail));
    assert.equal(calls[0].resumeRef, "sess-gone");
    assert.equal(calls[1].resumeRef, undefined, "the second attempt resumed the session that just failed to resume");
    const row = run.find((e) => e.event === "resume-fell-back-cold");
    assert.ok(row, "no run-log row says the resume fell back");
    assert.equal(row.stage, "synthesis");
  });
}

test("a ladder that keeps nothing removes its own home, and a failed ladder keeps nothing", async () => {
  const plain = await ladder("openai-agent", "plain", [OK("sess-4")]);
  assert.equal(plain.r.session, undefined);
  assert.equal(existsSync(plain.calls[0].codexHome), false, "a ladder that keeps nothing leaves no home behind");
  const failed = await ladder("openai-agent", "failed", [GONE], { keepSession: true, maxRetries: 0 });
  assert.equal(failed.r.ok, false);
  assert.equal(failed.r.session, undefined, "a failed ladder hands back no session to resume");
  assert.equal(existsSync(failed.calls[0].codexHome), false);
});

// THE HANDLE IS ALWAYS THE SESSION THAT WROTE THE CURRENT RECORD. A cold rewrite (the stale-input repair,
// the schema migration) replaces it, so a later correction never resumes a session holding an older record
// while its patch merges onto the new one.
test("a cold rewrite of the record replaces the handle and releases the old home; a failed one changes nothing", async () => {
  const { carrySynthSession } = await import("../pipeline.mjs");
  const oldHome = mkdtempSync(join(ROOT, "old-home-"));
  const newHome = mkdtempSync(join(ROOT, "new-home-"));
  const ctx = { synthSession: { ref: "sess-old", home: oldHome } };
  carrySynthSession(ctx, { ok: false, fail: "boom" });
  assert.deepEqual(ctx.synthSession, { ref: "sess-old", home: oldHome }, "a failed rewrite left the record as it was, and the handle with it");
  carrySynthSession(ctx, { ok: true, session: { ref: "sess-cold", home: newHome } });
  assert.equal(ctx.synthSession.ref, "sess-cold", "the next correction would resume the session holding the older record");
  assert.equal(existsSync(oldHome), false, "the replaced session's home was left behind");
  carrySynthSession(ctx, { ok: true, session: { ref: "sess-next", home: newHome } });
  assert.equal(existsSync(newHome), true, "a correction that resumed in the same home must not lose it");
});

test("both cold rewrites of the synthesis record keep their session and hand it to the handle", () => {
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  assert.match(src, /const keep = name === "synthesis";[^\n]*\n[^\n]*\.\.\.\(keep \? \{ keepSession: true \} : \{\}\)[^\n]*\n\s*return keep \? carrySynthSession\(ctx, r\) : r;/,
    "the stale-input repair of synthesis keeps no session");
  assert.match(src, /carrySynthSession\(ctx, await stage\("synthesis", ctx, \{[^\n]*\n[^\n]*\n\s*trigger: "schema-downlevel", keepSession: true/,
    "the schema migration keeps no session");
});

test.after(() => rmSync(ROOT, { recursive: true, force: true }));
