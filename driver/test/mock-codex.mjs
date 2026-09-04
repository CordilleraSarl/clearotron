#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Mock `codex` for offline openai-agent engine tests. Reads the prompt from STDIN (the engine passes the
// `-` placeholder), emits a valid codex `--json` JSONL sequence (thread.started → turn.started →
// item.completed{agent_message} → turn.completed), and writes the stage's output file to the ABSOLUTE
// path named in the prompt — the SAME mock-stage-fixtures the mock-claude corpus uses, so
// the $0 pipeline runs engine-parametric on CLEAROTRON_AI=openai-agent with zero stage changes.
//
// Env knobs mirror mock-claude (same names where shared, MOCK_CODEX_* where codex-specific):
//   MOCK_CODEX_STALL=1     — emit the opening events then go SILENT → the engine stall-watchdog must kill it
//   MOCK_CODEX_FAIL=1      — emit turn.failed + exit 1 (a failed turn → nonzero_exit_1)
//   MOCK_CODEX_NOFILE=1    — do not write the output file (drives the missing_file ladder)
//   MOCK_CODEX_RESULT=<t>  — the agent_message text (default "mock codex ok")
//   MOCK_CODEX_SESSION=<id>— thread_id (default derived); a `resume <id>` echoes <id> back as the thread
//   MOCK_CODEX_USAGE=<json>— turn.completed usage override (codex shape: input_tokens/cached_input_tokens/output_tokens)
//   MOCK_CODEX_RATELIMIT=1 — a 429/rate-limit turn.failed + exit 1 (engine regexes it → signals.rateLimited)
//   MOCK_CODEX_RATELIMIT_MSG=<t> — the turn.failed message text (default a bare 429; set one carrying a
//                            retry hint to exercise the engine's resetsAt parse)
//   MOCK_CODEX_ROLLOUT_MODEL=<id> — write a codex-shaped session rollout under $CODEX_HOME naming <id>
//                            as the served model, the way real codex does. Absent → no rollout,
//                            which is the "engine did not report" path.
//   MOCK_CODEX_NO_NEWLINE=1— emit the final turn.completed with NO trailing newline (B1 final-line flush)
//   MOCK_CODEX_SLOW_STREAM=<ms> [+ MOCK_CODEX_SLOW_COUNT] — a healthy-but-slow turn (a delta every <ms>)
//   MOCK_CODEX_CALL_LOG=<file> — append {argv, prompt, codexHome, configToml, hasAuth} per call (assert wiring)
//   MOCK_CODEX_FILE=<content>  — engine-test mode: write <content> to the path parsed from the prompt
// Shared with the corpus (identical semantics to mock-claude, so pipeline.mock runs parametric):
//   MOCK_FAIL_STAGE=<substr[&&substr]>  — fail (stderr + exit 1) the turns whose prompt contains ALL parts
//   MOCK_BARRIER_FILE=<path>            — hold the matter-frame turn until the sentinel appears
//   MOCK_WARM_MODE=flake|draft|soft_fail|stubborn — the warm-patch ladder (resume detected via the patch msg)
import { writeFileSync, mkdirSync, appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { applyStageWrites } from "./mock-stage-fixtures.mjs";

const argv = process.argv.slice(2);
async function readStdin() {
  if (process.stdin.isTTY) return "";
  process.stdin.setEncoding("utf8");
  let d = "";
  for await (const chunk of process.stdin) d += chunk;
  return d;
}
const msg = await readStdin();

// resume subcommand: `exec … resume <thread-id> -`. The id is the token after "resume" that is not a flag.
const resumeIdx = argv.indexOf("resume");
const resumed = resumeIdx >= 0 ? (argv.slice(resumeIdx + 1).find((a) => a && a !== "-" && !a.startsWith("-")) ?? "") : "";

// ──: A RESUME AGAINST A HOME THAT NEVER SAW THE THREAD MUST FAIL, THE WAY REAL CODEX FAILS ─────
//
// This mock used to echo whatever id it was handed straight back as the thread, so it could not tell a
// live session from a dead one and NO test could catch the per-turn-CODEX_HOME bug: the engine test
// "warm-resume: resumeRef threads a `resume <id>` subcommand" asserted the argv wiring, which was
// correct, and passed while every real warm resume on this engine failed.
//
// Measured on codex-cli 0.147.0 and reproduced here exactly, including the exit code:
//   Error: thread/resume: thread/resume failed: no rollout found for thread id <id> (code -32600)
//
// STRICT ONLY WHEN THIS MOCK IS ACTING AS A SESSION STORE (MOCK_CODEX_SESSION_STORE=1). Making strict
// the DEFAULT broke engine.openai.integration.test.mjs: that test drives the missing_file ladder, whose
// retry passes a resumeRef, and a mock with no rollout to find then exited 1 — so the ladder reported
// `nonzero_exit_1` instead of `missing_file` and the test failed on a class it never meant to exercise.
// Every existing test that threads a resumeRef without seeding a session is entitled to the old
// permissive behaviour; only a test that opted INTO session persistence gets a store that can say no.
const codexHomeDir = process.env.CODEX_HOME || "";
const sessionsDir = codexHomeDir ? join(codexHomeDir, "sessions") : "";
const rolloutFor = (id) => {
  if (!sessionsDir || !existsSync(sessionsDir)) return null;
  const stack = [sessionsDir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name);
      if (e.isDirectory()) stack.push(f);
      else if (e.name.startsWith("rollout-") && e.name.includes(id) && e.name.endsWith(".jsonl")) return f;
    }
  }
  return null;
};
if (resumed && process.env.MOCK_CODEX_SESSION_STORE === "1" && !rolloutFor(resumed)) {
  process.stderr.write(`Error: thread/resume: thread/resume failed: no rollout found for thread id ${resumed} (code -32600)\n`);
  process.exit(1);
}
const session = process.env.MOCK_CODEX_SESSION || resumed || ("mock-thread-" + Buffer.from(msg).length.toString(36));

// Call log: the real argv (flags) + the stdin prompt + the rendered config.toml (read from CODEX_HOME while
// it still exists — the engine deletes it after) so a test can assert the codex wiring faithfully.
if (process.env.MOCK_CODEX_CALL_LOG) {
  let configToml = "", hasAuth = false;
  try {
    const home = process.env.CODEX_HOME;
    if (home) {
      try { configToml = readFileSync(join(home, "config.toml"), "utf8"); } catch { /* none */ }
      hasAuth = existsSync(join(home, "auth.json"));
    }
  } catch { /* best-effort */ }
  try { appendFileSync(process.env.MOCK_CODEX_CALL_LOG, JSON.stringify({ argv, prompt: msg, codexHome: process.env.CODEX_HOME || null, configToml, hasAuth }) + "\n"); } catch { /* best-effort */ }
}

const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
const open = () => { send({ type: "thread.started", thread_id: session }); send({ type: "turn.started" }); };

// ── The session rollout. Real codex writes one per session under
// $CODEX_HOME/sessions/<yyyy>/<mm>/<dd>/rollout-<ts>-<uuid>.jsonl; the engine reads the served model off
// its `turn_context` record because the --json stream carries no model field (probed, codex 0.147.0).
// Shaped from a real rollout: a session_meta first, then the turn_context that names the model.
// — MOCK_CODEX_SESSION_STORE=1 makes the mock PERSIST sessions the way real codex does, without
// having to name a served model. That is what lets a test resume a real thread from its own home and
// fail to resume it from a fresh one.
if ((process.env.MOCK_CODEX_ROLLOUT_MODEL || process.env.MOCK_CODEX_SESSION_STORE === "1") && process.env.CODEX_HOME) {
  try {
    const dir = join(process.env.CODEX_HOME, "sessions", "2026", "08", "11");
    mkdirSync(dir, { recursive: true });
    const rows = [
      { type: "session_meta", payload: { session_id: session, cli_version: "0.147.0", source: "exec", model_provider: "openai" } },
      ...(process.env.MOCK_CODEX_ROLLOUT_MODEL ? [{ type: "turn_context", payload: { model: process.env.MOCK_CODEX_ROLLOUT_MODEL, model_provider: "openai" } }] : []),
    ];
    writeFileSync(join(dir, `rollout-2026-08-11T13-48-49-${session}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  } catch { /* best-effort: a missing rollout is a real state the engine must handle */ }
}

// ── Continuous-admission barrier (parity with mock-claude): hold the first stage until the sentinel. ──
open();
if (process.env.MOCK_BARRIER_FILE && /matter-context\.md/.test(msg)) {
  const sab = new Int32Array(new SharedArrayBuffer(4));
  const start = Date.now();
  while (!existsSync(process.env.MOCK_BARRIER_FILE) && Date.now() - start < 15000) Atomics.wait(sab, 0, 0, 100);
}

// ── Forced stage failure (parity with mock-claude MOCK_FAIL_STAGE): stderr + exit 1, no turn.completed. ──
if (process.env.MOCK_FAIL_STAGE && process.env.MOCK_FAIL_STAGE.split("&&").every((part) => msg.includes(part))) {
  process.stderr.write("mock forced failure\n");
  process.exit(1);
}

const usageOf = () => (process.env.MOCK_CODEX_USAGE
  ? JSON.parse(process.env.MOCK_CODEX_USAGE)
  : { input_tokens: 120, cached_input_tokens: 40, output_tokens: 46 });
const agentMessage = (text) => send({ type: "item.completed", item: { id: "item_0", type: "agent_message", text } });
function completeTurn(text, { noNewline } = {}) {
  agentMessage(text ?? process.env.MOCK_CODEX_RESULT ?? "mock codex ok");
  const tc = { type: "turn.completed", usage: usageOf() };
  if (noNewline) process.stdout.write(JSON.stringify(tc)); else send(tc);
  process.exit(0);
}

// ── Warm-patch ladder substrate (parity with mock-claude MOCK_WARM_MODE). ──
if (process.env.MOCK_WARM_MODE) {
  const cFile = process.env.MOCK_COUNT_FILE;
  const n = (existsSync(cFile) ? Number(readFileSync(cFile, "utf8")) : 0) + 1;
  writeFileSync(cFile, String(n));
  if (process.env.MOCK_CALL_LOG) { try { appendFileSync(process.env.MOCK_CALL_LOG, JSON.stringify(argv) + "\n"); } catch { /* best-effort */ } }
  const out = process.env.MOCK_OUT_FILE;
  const warmResume = /RESUMING your own session/.test(msg);
  switch (process.env.MOCK_WARM_MODE) {
    case "flake":  if (n > 1) writeFileSync(out, "no flags surfaced\n"); completeTurn("done"); break;
    case "draft":  writeFileSync(out, n === 1 ? "draft\n" : warmResume ? "draft PATCHED\n" : "draft FRESH\n"); completeTurn("done"); break;
    case "soft_fail": if (n === 1) { process.stderr.write("mock forced failure\n"); process.exit(1); } writeFileSync(out, "recovered\n"); completeTurn("done"); break;
    case "stubborn": completeTurn("done"); break;
    default: process.stderr.write("MOCK_WARM_MODE unknown\n"); process.exit(1);
  }
}

// ── Rate-limit / 429 (codex carries no structured reset → the engine regexes the message). ──
if (process.env.MOCK_CODEX_RATELIMIT
    && (!process.env.MOCK_CODEX_RATELIMIT_MATCH || msg.includes(process.env.MOCK_CODEX_RATELIMIT_MATCH))) {
  send({ type: "turn.failed", error: { message: process.env.MOCK_CODEX_RATELIMIT_MSG || "429 Too Many Requests: rate limit exceeded" } });
  process.exit(1);
}

// ── Forced turn failure (no turn.completed) ──
if (process.env.MOCK_CODEX_FAIL) {
  send({ type: "turn.failed", error: { message: "mock codex turn failure" } });
  process.exit(1);
}

// ── Stall: opening events streamed (stall clock reset), then silence → the engine SIGKILLs it. ──
if (process.env.MOCK_CODEX_STALL) {
  setInterval(() => {}, 1 << 30);
} else {
  function doStageWrites() {
    if (process.env.MOCK_CODEX_NOFILE) return;
    if (process.env.MOCK_CODEX_FILE != null) {
      const m = msg.match(/ABSOLUTE path[^:]*:\s*(\/\S+)/)
        || msg.match(/write (?:the COMPLETE corrected file|it) at\s+(\/\S+)/)
        || msg.match(/OUTPUT_FILE:\s*(\/\S+)/);
      if (m) { try { mkdirSync(dirname(m[1]), { recursive: true }); writeFileSync(m[1], process.env.MOCK_CODEX_FILE); } catch { /* best-effort */ } }
      return;
    }
    applyStageWrites(msg, argv);
  }
  if (process.env.MOCK_CODEX_SLOW_STREAM) {
    const gap = Number(process.env.MOCK_CODEX_SLOW_STREAM);
    const total = Number(process.env.MOCK_CODEX_SLOW_COUNT || 6);
    let i = 0;
    const iv = setInterval(() => {
      if (i++ >= total) { clearInterval(iv); doStageWrites(); completeTurn(); return; }
      send({ type: "item.updated", item: { id: "item_r", type: "reasoning", text: "…" } });
    }, gap);
  } else {
    send({ type: "item.updated", item: { id: "item_r", type: "reasoning", text: "…" } });   // a streamed partial (watchdog heartbeat)
    doStageWrites();
    completeTurn(undefined, { noNewline: Boolean(process.env.MOCK_CODEX_NO_NEWLINE) });
  }
}
