// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engine/common.mjs — shared, engine-AGNOSTIC runtime substrate for the CLI-wrapping engine adapters
// (anthropic-agent = `claude -p`; openai-agent = `codex exec`). Both wrap a long-running child process
// that streams NDJSON and must be governed identically: a detached process-GROUP spawn, a stall
// watchdog (0-liveness kill), a hard-wall kill, a maxBuffer overflow kill, and settle-exactly-once.
//
// This is NEW code, written as a faithful generalization of anthropic-agent.mjs's proven internals
// (the C2 detached-group-kill, the A3 overflow cap, the B1 final-line flush — all battle-tested in
// production). On THIS branch anthropic-agent.mjs is deliberately left byte-untouched and keeps its
// own copy (so this engine work stays merge-clean against the parallel branches editing that file);
// rewiring anthropic-agent onto this module is an optional, separable follow-up. openai-agent.mjs is
// the first consumer.
//
// The substrate is intentionally provider-blind: it knows nothing about claude/codex event shapes. The
// caller passes an `onStdoutLine(line)` sink that parses ONE NDJSON line (accumulating whatever it needs
// via closure), and gets back the low-level process outcome. The caller maps that outcome → the driver's
// normalized runTurn() tuple (engine/CONTRACT.md §1). Kept dependency-free (node built-ins only), like
// the engines it serves.

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { recordEngineChild, clearEngineChild } from "./child-record.mjs";   //

// ── Shared env-tunable knobs (same names + defaults the anthropic engine already documents) ──────────
// 120s of ZERO streamed output = the silent-provider-stall abort. A healthy turn streams continuously,
// so this never clips a slow-but-working turn. Per-stage stallSec overrides at the call site.
export const stallMs = () => Number(process.env.CLEAROTRON_STALL_MS || 120000);
// Grace between the watchdog's group SIGTERM and the group SIGKILL that follows it. ~5s.
export const killEscalateMs = () => Math.max(50, Number(process.env.CLEAROTRON_KILL_ESCALATE_MS || 5000));

// — STARTUP IS NOT SILENCE. The stall clock measures the gap BETWEEN outputs, but it started at
// spawn, so a child's entire process creation was charged to it. Under concurrent spawning (not CPU load
// — an ambient-load control stayed green) startup p90 measured 376ms against a 300ms deadline, and every
// kill carried ZERO bytes emitted at wall ≈ deadline.
//
// A FLOOR, NOT A RE-BASING, and deliberately so. Re-basing the clock to first output would mean a child
// that emits nothing at all — a startup wedge, precisely this case — never stall-kills and runs to the
// hard wall instead: on a stage with stallSec 1100 / timeoutSec 2250 that doubles the burn on a real
// wedge. The floor keeps the wedge kill and only stops charging startup to the wrong clock.
//
// AND IT CANNOT MOVE PRODUCTION. The smallest stall window that ships is 30s (PROBE_STALL_SEC; the rest
// are 300–1100s, default 120s), so `Math.max(STALL, grace)` returns STALL on every shipping path and the
// default below is unreachable there. This is a latent trap being closed, not a live fault being fixed —
// which is the only reason a change to a kill path is worth making at all.
export const spawnGraceMs = () => Math.max(0, Number(process.env.CLEAROTRON_SPAWN_GRACE_MS || 2000));
// Cap the engine's stdout/stderr: a model that emits one
// endless newline-free line otherwise grows the buffer to the V8 string limit → uncaught RangeError →
// runner crash. Default 64MB (gateway parity); CLEAROTRON_ENGINE_MAX_BUFFER shrinks it for tests.
export const engineMaxBufferChars = () => Math.max(1024, Number(process.env.CLEAROTRON_ENGINE_MAX_BUFFER || 64 * 1024 * 1024));

// ── Output discipline (shared verbatim across engines) ───────────────────────────────────────────────
// The shared stage prompts say "write your output to <path>", which a workspace agent executes via its
// file tool — but a headless coding CLI (`claude -p`, `codex exec`) tends to COMPOSE the output as text
// and report "done" without ever calling the Write tool (the matter-frame missing_file failures,
// 2026-06-16). This system-prompt directive forces the Write-tool behaviour so every stage's file lands.
// The REPAIR EXCEPTION (2026-08-01) is part of the same directive because it corrects the same directive:
// "write every required file via the Write tool (overwrite if it exists)" is right for producing a stage's
// output and wrong for fixing one named defect in a 160 KB document that already passed its other checks.
// Without this sentence a corrective turn retypes the whole file — measured at 3-4x the wall and tokens of
// the patching attempt that actually passed (see repair-contract.mjs for the numbers). Kept byte-identical
// with the anthropic-agent copy; engine.common.test.mjs pins that.
export const WRITE_DISCIPLINE =
  "OUTPUT DISCIPLINE — read carefully: when the task instructs you to write output to an absolute file path, " +
  "you MUST create that file by CALLING THE WRITE TOOL with that exact path and the full content. Output you " +
  "place only in your text reply is DISCARDED and the task is scored as FAILED. Do the actual work, write every " +
  "required file via the Write tool (overwrite if it exists), and only THEN reply — with just the path(s) you " +
  "wrote and a 2-3 line summary. Never claim a file is written unless you invoked the Write tool to write it. " +
  "EXCEPTION — REPAIRS: when the task instructs you to FIX or CORRECT an EXISTING file, use the Edit tool and " +
  "change only what the correction names — a file corrected with the Edit tool counts as written. Rewriting a " +
  "whole file to fix a few lines risks degrading content that already passed. If the file does not exist, the " +
  "rule above stands: create it in full with the Write tool.";

// ── Skill-ref absolutization (shared verbatim across engines) ────────────────────────────────────────
// The shared stage prompts reference skills by the convention `skills/foo/SKILL.md` — a workspace agent
// resolves these against its workspace cwd, but a headless CLI (cwd = a neutral tmpdir, to avoid loading
// the repo CLAUDE.md) resolves them against /tmp → missing_file. Rewrite every `skills/…md` token to an
// ABSOLUTE path under the configured compute-skills tree. The refs keep their `skills/` prefix, so we
// join onto the PARENT of skillsDir. Engine-localized: the caller's original message is NEVER mutated.
// The negative lookbehind on [\w/.] makes the rewrite IDEMPOTENT — an already-absolute path that
// contains `skills/` is preceded by `/` and so is never double-prefixed. `resolve` (optional) maps a ref
// to a layered overlay-over-base path (driver.config.resolveSkillPath); without it the legacy single-dir
// behaviour stands.
const SKILL_REF = /(?<![\w/.])skills\/[A-Za-z0-9._/-]+\.md/g;
export function absolutizeSkillRefs(message, skillsDir, resolve = null) {
  if (!message || (!skillsDir && !resolve)) return message;
  const base = skillsDir ? dirname(skillsDir) : null;   // skillsDir ends in /skills; refs carry their own `skills/` prefix
  return message.replace(SKILL_REF, (m) => (resolve ? resolve(m) : join(base, m)));
}

// ── Envelope synthesis (shared) ──────────────────────────────────────────────────────────────────────
// Build the envelope gateway.mjs's classifiers expect (payloadText, json.status,
// isEmbeddedFallback, isTimeout, isLaneWedge all read this shape), from ALREADY-NORMALIZED primitives so
// it is engine-blind: each engine extracts ok/text/usage/… from its own result event and calls this.
export function buildEnvelope({ text = "", ok, killed, usage = null, summary, runId, stopReason } = {}) {
  return {
    status: ok ? "ok" : (killed ? "timeout" : "error"),
    result: { meta: { agentMeta: { usage } }, payloads: [{ text }] },
    summary, runId, stopReason,
  };
}

// ── The governed streaming child (the heart of the substrate) ────────────────────────────────────────
// Spawn `bin args`, feed `input` on stdin then EOF, stream stdout line-by-line to onStdoutLine, run the
// stall/hard-wall/overflow watchdogs, and resolve the LOW-LEVEL process outcome. Never rejects — a spawn
// failure resolves with { spawnError }. The caller maps the outcome → the normalized runTurn() tuple.
//
// Options:
//   bin, args, input        — spawn target + stdin payload (prompt rides stdin, never argv: MAX_ARG_STRLEN)
//   cwd, env                — spawn cwd / env (caller supplies the auth-scrubbed env)
//   stallSec, timeoutSec    — per-stage overrides (seconds); fall back to stallMs() / a +60s hard wall
//   onStdoutLine(line)      — parse ONE NDJSON stdout line; accumulate via closure. Called for the final
//                             un-terminated line at settle too (unless overflow), so a result event on the
//                             last newline-less line is never dropped (B1).
//   stderrIsLiveness        — true (default): a stderr byte ALSO resets the stall clock. codex streams its
//                             progress on stderr, so its liveness lives there. (claude parity would pass
//                             false — stdout-only liveness — if this substrate is ever adopted there.)
// ── — THE SPAWN CWD IS A GRANTED WRITE ROOT, SO IT IS THE RUN DIR ──────────────────────────────
// Every engine here confines the model's file tools to cwd plus the `--add-dir` roots. So whatever cwd
// is, the model may WRITE there — and it was `tmpdir()`: ONE directory shared by every stage of every run
// on the box, which nothing in the tree ever reads back and no teardown or archive knows exists.
//
// A clearance run wrote four deliverable-shaped documents into it — a 39-platform x 12-variant results
// grid, a supplementary search matrix, a methodology note and an executive summary — simply by inventing
// relative filenames. On production that shape is client matter: a named mark and a full channel matrix
// accumulating unswept in a service account's home, outside the matter archive and outside every
// retention control that applies to a run directory.
//
// `runDir` is ALREADY a granted writable `--add-dir` root on every dispatch that has one, so resolving
// cwd to it grants nothing new — it REMOVES the tmpdir grant. A relative write now lands inside the run,
// where the archive keeps it, teardown removes it, and the stray-artifact detector can see it at all.
// Strictly a tightening.
//
// `tmpdir()` survives for a dispatch with NO run — a probe, a test. That case has no run directory to
// write into, so there is nothing to confine it to, and the neutral-cwd reasoning still applies: cwd is a
// CLAUDE.md-discovery and trust surface, and the driver's own checkout has one.
//
// CLEAROTRON_ENGINE_CWD IS DELETED, not defaulted. An env var whose only job is to relocate a model's write
// root is the mechanism this issue is about, and a flag that can re-open it is not a fix. ONE definition,
// shared by all three engines, because two copies of "where may the model write" is how they drift.
export function resolveSpawnCwd({ cwd, runDir } = {}) {
  return cwd || runDir || tmpdir();
}

export function runStreamingChild({
  bin, args, input,
  cwd, env,
  runDir,            // — the fallback write root when no explicit cwd is given; see resolveSpawnCwd
  stallSec, timeoutSec,
  onStdoutLine,
  stderrIsLiveness = true,
} = {}) {
  const t0 = Date.now();
  const STALL = (Number(stallSec) > 0 ? Number(stallSec) * 1000 : stallMs());
  // — PINNABLE, on the same terms as the anthropic engine's `CLEAROTRON_HARD_MS`. +60s past the stage
  // timeout; NaN/≤0 clamps to 660s so the wall never silently disables. A non-positive or unparseable
  // PIN falls through to that derivation for the same reason — a pin is an instrument, never an off
  // switch. Without it the floor here is 61 SECONDS at the shortest, which is why this clock had no arm
  // and why 's grace never reached the line below: no test could drive it without sitting for a
  // minute.
  const pinnedHard = Number(process.env.CLEAROTRON_HARD_MS);
  const hardMs = pinnedHard > 0 ? pinnedHard : (Number(timeoutSec) > 0 ? Number(timeoutSec) + 60 : 660) * 1000;
  const pollMs = Math.max(50, Math.min(1000, Math.floor(STALL / 2)));               // tight for fast tests, ≤1s in prod
  const maxBuffer = engineMaxBufferChars();
  const spawnCwd = resolveSpawnCwd({ cwd, runDir });

  return new Promise((resolve) => {
    let child;
    // detached:true (C2): a coding CLI spawns its MCP servers as CHILDREN; killing only the direct pid
    // orphans them (a bridge orphan ran 3.5 days, still billing). Detached → the child leads its own
    // process group, so the watchdog's group kills reach the whole tree. stdin is a PIPE (not "ignore"):
    // the prompt rides stdin, never a `-p`/argv element, so it is never subject to MAX_ARG_STRLEN (E2BIG).
    try { child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"], cwd: spawnCwd, env: env || process.env, detached: true }); }
    catch (e) { return resolve({ spawnError: e, wall: (Date.now() - t0) / 1000 }); }
    // — WRITE THE CHILD DOWN, so a stop can target this run's turn rather than hunt
    // for it. Best effort and never fatal: a dispatch that cannot write this must still run, because
    // failing here costs a stop that falls back to the boundary, and throwing here costs the run.
    recordEngineChild(runDir, child.pid);

    child.stdin.on("error", () => {});   // ignore EPIPE if the child already died (close/error settles)
    try { child.stdin.write(input ?? ""); child.stdin.end(); } catch { /* child gone — handled by close/error */ }

    let buf = "", stdoutAll = "", stderr = "";
    let killed = false, stallKill = false, overflow = false, settled = false;
    let lastMove = Date.now();
    // — false until the child's FIRST byte on EITHER stream. Not "first liveness byte": a
    // stderr-only child under stdout-only liveness has spoken, so its startup is over and its stall
    // clock must run normally from here.
    let sawOutput = false;
    // — WHEN THE TURN STARTED, as opposed to when the process did. The hard wall below measures
    // from here; see its comment for why spawn was the wrong t0 and what still bounds a child that
    // never speaks.
    let firstOutputAt = 0;
    const GRACE = spawnGraceMs();

    // Group kill (C2): SIGTERM the whole process group, then group SIGKILL after the escalation grace.
    // ESRCH/EPERM (group already gone / not ours) falls back to the direct child.kill. The escalation
    // timer is unref'd and NOT cleared on settle — the direct child exiting on SIGTERM must not save a
    // SIGTERM-immune MCP straggler from the group SIGKILL.
    let escalation = null;
    const groupKill = (sig) => { try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch { /* already gone */ } } };
    const killTree = () => {
      if (escalation) return;   // the watchdog polls — arm the escalation exactly once
      groupKill("SIGTERM");
      escalation = setTimeout(() => groupKill("SIGKILL"), killEscalateMs());
      escalation.unref?.();
    };

    const watchdog = setInterval(() => {
      const idle = Date.now() - lastMove, wall = Date.now() - t0;
      // Before the first byte the deadline is the LARGER of the stall window and the spawn grace, so a
      // slow process creation cannot be read as a stall. After it, the stall window governs unchanged.
      const deadline = sawOutput ? STALL : Math.max(STALL, GRACE);
      if (idle >= deadline) { stallKill = true; killed = true; killTree(); }
      // — FROM THE FIRST BYTE, never from spawn, which is what fixed in the anthropic
      // watchdog and fixed for the stall clock immediately above. Process startup is not the
      // turn: against a tight pin it was the whole budget, and against the shipping 660s ceiling it
      // charged ~0.15% to every turn for no reason anyone chose. Both clocks in this file now agree on
      // when a turn begins.
      //
      // A CHILD THAT NEVER SPEAKS IS STILL BOUNDED, so this is not a ceiling removal: the stall branch
      // above fires at max(STALL, GRACE) whether or not a byte ever arrives, and it is checked first.
      else if (sawOutput && Date.now() - firstOutputAt >= hardMs) { killed = true; killTree(); }
    }, pollMs);

    // Overflow (A3): TRUNCATE at the cap, pull the tree-kill FORWARD (an endless newline-free stream
    // never trips the stall/hard wall — every byte resets the clock), and settle nonzero so the truncated
    // tail is never parsed as a valid result. The group SIGKILL escalation still reaps a spewing tree.
    const overflowKill = () => { if (overflow) return; overflow = true; killTree(); settle(1); };

    child.stdout.on("data", (d) => {
      if (settled || overflow) return;
      sawOutput = true; firstOutputAt ||= Date.now();        // — the child has spoken; startup is over
      lastMove = Date.now();   // ANY streamed byte = liveness → resets the stall clock
      const s = d.toString();
      buf += s; stdoutAll += s;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) { emitLine(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
      if (buf.length > maxBuffer || stdoutAll.length > maxBuffer) { buf = buf.slice(0, maxBuffer); overflowKill(); }
    });
    child.stderr.on("data", (d) => {
      if (settled || overflow) return;
      sawOutput = true; firstOutputAt ||= Date.now();        // — spoken is spoken, whether or not this stream counts as liveness
      if (stderrIsLiveness) lastMove = Date.now();   // codex progress lives on stderr → it is liveness too
      stderr += d.toString();
      if (stderr.length > maxBuffer) { stderr = stderr.slice(0, maxBuffer); overflowKill(); }
    });

    function emitLine(line) {
      const t = line.trim(); if (!t) return;
      try { onStdoutLine?.(t); } catch { /* a bad sink must never crash the reader */ }
    }

    // error + close can BOTH fire for one failure (Node) → settle EXACTLY once.
    child.on("error", (e) => { if (settled) return; settled = true; clearInterval(watchdog); resolve({ spawnError: e, wall: (Date.now() - t0) / 1000 }); });
    child.on("close", (code) => settle(code));

    function settle(code) {
      if (settled) return; settled = true;
      clearInterval(watchdog);
      // — the turn is over, so the record must not outlive it. Cleared only if it
      // still names THIS child: a slow-exiting child must not erase the record of the one that replaced
      // it, or a later stop targets a process that finished ten minutes ago.
      clearEngineChild(runDir, child?.pid);
      // Reap the pipes: an overflow settle fires while a SIGTERM-immune spewer still holds stdout, so
      // settlement must never wait on a pipe some straggler keeps open (the group SIGKILL reaps the tree).
      try { child.stdout.destroy(); } catch { /* stream gone */ }
      try { child.stderr.destroy(); } catch { /* stream gone */ }
      if (!overflow) emitLine(buf);   // B1: flush the final, un-terminated line — but NEVER the truncated overflow tail
      buf = "";
      resolve({
        rawCode: typeof code === "number" ? code : null,
        killed, stallKill,
        hardWall: (killed && !stallKill) || false,   // watchdog killed at the hard wall, NOT a 0-liveness stall
        overflow,
        wall: (Date.now() - t0) / 1000,
        stdout: stdoutAll,
        stderr,
        maxBuffer,   // echoed so the caller's overflow stderr signature can name the exact cap
      });
    }
  });
}
