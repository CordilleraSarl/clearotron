#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Mock `claude` for offline anthropic-agent engine tests. Parses the `-p <message>` print call, emits a
// valid stream-json sequence (system:init → stream_event → result), and writes a minimal file to the
// ABSOLUTE output path named in the message (same regexes the retired gateway mock used, so it is pipeline-compatible).
// Env knobs:
//   MOCK_CLAUDE_BOOT_MS=<ms> — block for <ms> before ANY output: a STARVED SPAWN, the load condition the
//     watchdog arms used to need a busy box to reproduce
//     (+ MOCK_CLAUDE_STDERR_FIRST=1 to put one stderr line BEFORE that block — a child that has made a
//      noise without having spoken its protocol, which is)
//   MOCK_CLAUDE_STALL=1   — emit init then go SILENT forever (no result) → the engine stall-watchdog must kill it
//   MOCK_CLAUDE_USAGE_THEN_STALL=1 — one assistant turn WITH usage, then silence → the kill must carry streamed usage
//   MOCK_CLAUDE_JUNK_STREAM=<ms>   — byte-alive non-progress chatter forever → the NO-PROGRESS watchdog must kill it
//     (+ MOCK_CLAUDE_JUNK_COUNT=<n> to finish cleanly instead; + MOCK_CLAUDE_JUNK_WRITE_FILE/_MS = artifact-advance progress)
//     (+ MOCK_CLAUDE_TOOL_HANG=1 to open an UNRETURNED tool ask first — the  case)
//     (+ MOCK_CLAUDE_ASK_DELAY_MS=<ms> to hold that ask <ms> after init, pipe warm throughout: the gap
//      between the FIRST BYTE and the first PROGRESS event — a timer, not a block, see the call site)
//   MOCK_CLAUDE_TOKEN_STREAM=<ms> (+ _COUNT) — usage-bearing partials then a clean result (token movement = progress)
//   MOCK_CLAUDE_FAIL=1    — emit a result with is_error/subtype:error (a failed turn)
//   MOCK_CLAUDE_OVERLOADED=1 — the Anthropic 529 overload shape (failed result carrying overloaded_error, exit 1)
//   MOCK_CLAUDE_MAXTOK=1  — the A6 output-ceiling shape: a "successful" result (exit 0) whose
//                           stop_reason is max_tokens, with NO file written (zero usable output)
//   MOCK_CLAUDE_NOFILE=1  — do not write the output file (drives the missing_file ladder)
//   MOCK_CLAUDE_RESULT=<text>     — the result text (default "mock claude ok")
//   MOCK_CLAUDE_FILE=<content>    — the output file content (default a tiny valid stub)
//   MOCK_CLAUDE_COST=<usd>        — total_cost_usd (default 0.0123)
//   MOCK_CLAUDE_SESSION=<id>      — session_id (default derived); a --resume value echoes back as the session
//   MOCK_CLAUDE_CALL_LOG=<file>   — append each invocation's argv as a JSON line (assert flags/resume)
//   MOCK_CLAUDE_WIRE_MODEL=<id>   — report <id> as the served model on system:init AND every assistant
//                               message, whatever --model asked for: the SILENT SUBSTITUTION fixture
//                               ( corruption 3). Unset, the mock echoes the model it was asked for.
//   MOCK_CLAUDE_READS=<json array of paths> — emit an assistant message whose content carries one Read
//                               tool_use block per path (the AD-4 reads-gauge substrate)
//   MOCK_CLAUDE_BAD_CONTENT=1 — assistant events whose message.content is TRUTHY but not iterable, emitted
//                               on BOTH parseLine paths (streamed + the final un-terminated line settle()
//                               flushes); a stream parser that iterates it blind throws out of settle()
// Ported from the retired gateway mocks so the driver mock corpus runs engine-parametric on the
// standalone anthropic-agent engine (Phase-2 gateway-bin removal):
//   MOCK_FAIL_STAGE=<substr>  — turns whose -p message contains <substr> emit init then stderr+exit(1); the
//                               engine's close handler (anthropic-agent.mjs) classifies !resultEvent→code 1 →
//                               runStage `nonzero_exit_1`, IDENTICAL to the retired gateway mock's non-zero-exit branch.
//   MOCK_BARRIER_FILE=<path>  — hold the matter-frame turn (writes matter-context.md) until <path> exists
//                               (continuous-admission test); Atomics.wait 100ms ticks, 15s deadline.
//   MOCK_WARM_MODE=flake|draft|soft_fail|stubborn|form|form_noop — the warm-patch / in-dispatch
//                               form-repair substrate (call-count in
//                               MOCK_COUNT_FILE, argv to MOCK_CALL_LOG, file to MOCK_OUT_FILE); warm resume is
//                               detected via the engine-agnostic patch message ("RESUMING your own session").
import { writeFileSync, mkdirSync, appendFileSync, existsSync, readFileSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { applyStageWrites } from "./mock-stage-fixtures.mjs";

const argv = process.argv.slice(2);
// The engine now pipes the prompt on STDIN (no `-p` positional) — read it to EOF. Fallback to a positional
// after `-p` for any direct-CLI caller / TTY (a token starting with `-` is the NEXT flag, not the prompt).
const pIdx = argv.indexOf("-p");
const positional = (pIdx >= 0 && argv[pIdx + 1] && !argv[pIdx + 1].startsWith("-")) ? argv[pIdx + 1] : "";
async function readStdin() {
  if (process.stdin.isTTY) return "";
  process.stdin.setEncoding("utf8");
  let d = "";
  for await (const chunk of process.stdin) d += chunk;
  return d;
}
const msg = (await readStdin()) || positional;
// Call-log = the REAL argv (flags) + the stdin prompt, so tests can assert both faithfully (the prompt is
// no longer an argv element). Written after the stdin read so `prompt` is populated.
if (process.env.MOCK_CLAUDE_CALL_LOG) {
  try { appendFileSync(process.env.MOCK_CLAUDE_CALL_LOG, JSON.stringify({ argv, prompt: msg }) + "\n"); } catch { /* best-effort */ }
}
const resumeIdx = argv.indexOf("--resume");
const resumed = resumeIdx >= 0 ? (argv[resumeIdx + 1] ?? "") : "";
const session = process.env.MOCK_CLAUDE_SESSION || resumed || ("mock-sess-" + Buffer.from(msg).length.toString(36));

const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");

// ── the WIRE MODEL ( corruption 3) ───────────────────────────────────────────────────────────────
// This used to be the hardcoded literal "claude-haiku-4-5" on the init event regardless of --model,
// which was fine while nothing read it and is not fine now: the engine's model gauge reads exactly this
// field, so a mock that ignores --model would report a mismatch on every honest turn.
//
// The real CLI echoes the model it resolved, in ITS OWN naming — a dated id for haiku
// ("claude-haiku-4-5-20251001", the form driver.config's normaliser exists for), the pinned catalog
// names for opus/sonnet. The table is keyed on what `claudeModel()` actually passes on the wire.
//   MOCK_CLAUDE_WIRE_MODEL=<id> — report <id> INSTEAD, whatever was asked for. That is the substitution
//     fixture: the shape `--model gemini` had when it logged gemini and ran sonnet.
const mIdx = argv.indexOf("--model");
const askedModel = mIdx >= 0 ? (argv[mIdx + 1] ?? "") : "";
const WIRE_MODEL = {
  opus: "claude-opus-5", "claude-opus-5": "claude-opus-5",
  sonnet: "claude-sonnet-5", "claude-sonnet-5": "claude-sonnet-5",
  haiku: "claude-haiku-4-5-20251001",
  fable: "fable",
};
const wireModel = process.env.MOCK_CLAUDE_WIRE_MODEL || WIRE_MODEL[askedModel] || "claude-haiku-4-5";

// system:init — mirrors the real shape (apiKeySource etc.)
// MOCK_CLAUDE_BOOT_MS=<ms> — block for <ms> before ANY output: the shape a STARVED SPAWN has from the
// parent's side, where the child exists, has produced nothing, and is NOT idle. Blocking rather than a
// timer on purpose — a starved process does not service its event loop either. This is the deterministic
// stand-in for full-suite load, so an arm that turns on startup latency reproduces without loading the box.
// MOCK_CLAUDE_STDERR_FIRST=1 — put ONE line on stderr before that boot block, so the child is a
// process that has made a noise without having said anything in its protocol. A node warning or a CLI
// deprecation notice is exactly this, and it arrives before the real startup rather than after it.
//
// writeSync(2, …), not process.stderr.write: the boot block below stops the event loop, and a buffered
// write would still be sitting in it when the block starts. The whole point of this fixture is that the
// PARENT sees the stderr byte EARLY, so the write has to have happened before the block, not merely
// have been requested.
if (process.env.MOCK_CLAUDE_STDERR_FIRST) writeSync(2, "mock-claude: an early notice on stderr\n");

const bootMs = Number(process.env.MOCK_CLAUDE_BOOT_MS || 0);
if (bootMs > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, bootMs);

send({ type: "system", subtype: "init", cwd: process.cwd(), session_id: session, model: wireModel, permissionMode: "acceptEdits", apiKeySource: "none", tools: ["Read", "Write", "Edit"], mcp_servers: [] });

// — MOCK_CLAUDE_STRAY_RELATIVE=<name>: write <name> RELATIVE to process.cwd. This is the model
// inventing a filename instead of using the absolute path it was given, which is exactly how four
// deliverable-shaped documents ended up in a shared tmpdir outside every run. Where the byte lands is the
// only observable that can tell a granted write root apart from a neutral one, so the test that proves
// the spawn cwd needs this and cannot be written without it.
if (process.env.MOCK_CLAUDE_STRAY_RELATIVE) {
  try { writeFileSync(process.env.MOCK_CLAUDE_STRAY_RELATIVE, "invented by the model, addressed to nowhere\n"); }
  catch { /* an unwritable cwd is itself a result the test can assert on */ }
}

// Continuous-admission barrier (ported from the retired gateway mock): hold the first stage (matter-frame writes
// matter-context.md) until the sentinel appears, so a job dropped mid-flight can be proven claimed while this
// run is still in flight. init already streamed above (stall clock reset). Atomics.wait, not a busy spin.
if (process.env.MOCK_BARRIER_FILE && /matter-context\.md/.test(msg)) {
  const sab = new Int32Array(new SharedArrayBuffer(4));
  const start = Date.now();
  while (!existsSync(process.env.MOCK_BARRIER_FILE) && Date.now() - start < 15000) Atomics.wait(sab, 0, 0, 100);
}

// Forced stage failure (ported from the retired gateway mock). init streamed above; stderr + exit(1) with NO result
// event → the engine's close handler sets failed (!resultEvent) → code=(childCode||1)=1 → `nonzero_exit_1`,
// the SAME runStage taxonomy branch the retired gateway mock hit. Used by pipeline.mock / operability failedStage tests.
// MOCK_FAIL_STAGE: "&&"-separated substrings must ALL appear in the message (a single substring is the
// degenerate case) — lets a test fail ONLY the reopen followup ("SOURCE CHANNELS&&half-b") without also
// failing half-b's original gather turn. Mirrors the retired gateway mock exactly.
if (process.env.MOCK_FAIL_STAGE && process.env.MOCK_FAIL_STAGE.split("&&").every((part) => msg.includes(part))) {
  process.stderr.write("mock forced failure\n");
  process.exit(1);
}

// Warm-patch ladder substrate (ported from the retired gateway warm mock). Each MOCK_WARM_MODE case fully handles the turn
// (emits the claude result envelope) and exits, so control never reaches the stall/normal paths below. Warm
// resume is detected via the patch message (warmPatchMessage is engine-agnostic and carries the marker),
// exactly as the retired gateway warm mock did — the runStage warm/fresh KEY logic itself is engine-agnostic.
if (process.env.MOCK_WARM_MODE) {
  const cFile = process.env.MOCK_COUNT_FILE;
  const n = (existsSync(cFile) ? Number(readFileSync(cFile, "utf8")) : 0) + 1;
  writeFileSync(cFile, String(n));
  if (process.env.MOCK_CALL_LOG) { try { appendFileSync(process.env.MOCK_CALL_LOG, JSON.stringify(argv) + "\n"); } catch { /* best-effort */ } }
  const out = process.env.MOCK_OUT_FILE;
  const warmResume = /RESUMING your own session/.test(msg);
  const okTurn = () => {
    send({ type: "result", subtype: "success", is_error: false, duration_ms: 5, num_turns: 1, result: "done",
      stop_reason: "end_turn", session_id: session, total_cost_usd: 0.001,
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
    process.exit(0);
  };
  switch (process.env.MOCK_WARM_MODE) {
    case "flake":  // ok every turn; file only from call 2 (the skeptic ok-but-no-file shape on call 1)
      if (n > 1) writeFileSync(out, "no flags surfaced\n"); okTurn(); break;
    case "draft":  // ok + file every turn; content patched on a warm resume, else fresh (a validator asserts it)
      writeFileSync(out, n === 1 ? "draft\n" : warmResume ? "draft PATCHED\n" : "draft FRESH\n"); okTurn(); break;
    case "soft_fail":  // call 1 = a hard turn failure (nonzero_exit → NOT warm-eligible → fresh retry); then recovers
      if (n === 1) { process.stderr.write("mock forced failure\n"); process.exit(1); }
      writeFileSync(out, "recovered\n"); okTurn(); break;
    case "stubborn":  // ok every turn, never writes the file (warm attempt also empty → stage ultimately fails)
      okTurn(); break;
    // write-time form rejection. `form` advances the file content by CALL NUMBER so a test can map
    // each step to a distinct validator reason (a form defect, then the NEXT form defect a fail-fast
    // parser only reveals once the first is gone, then clean) and can prove from the marker that the
    // repair turn RESUMED the session rather than starting cold.
    // write-time form rejection.
    //   MOCK_FORM_STEPS   — a JSON array of file CONTENTS, one per call (the last entry repeats). The
    //                       test puts REAL artifacts there (the malformed frame-diff.json / coverage
    //                       ledger the 08-02 round produced) so the REAL parser judges them.
    //   MOCK_FORM_SIBLING — production's shape for every sibling-routed token: the stage's own output
    //                       (a .md) is written ONCE by the fresh dispatch, the repair turn is told NOT
    //                       to touch it, and the defect and its fix live in the SIBLING at this path.
    //                       Unset ⇒ the steps go to MOCK_OUT_FILE (the prose-cell tokens' shape).
    case "form": {
      const steps = process.env.MOCK_FORM_STEPS ? JSON.parse(process.env.MOCK_FORM_STEPS) : null;
      const body = steps ? steps[Math.min(n, steps.length) - 1] : `form-${n} ${warmResume ? "WARM" : "FRESH"}\n`;
      const sib = process.env.MOCK_FORM_SIBLING;
      if (sib) { if (!warmResume) writeFileSync(out, "# prose reasoning\nno repair turn touches this\n"); writeFileSync(sib, body); }
      else writeFileSync(out, body);
      okTurn(); break;
    }
    // The repair turn is KILLED after writing. The bytes on disk would now VALIDATE, and they must
    // still not be accepted: a killed turn's write may be torn and a shape validator cannot prove it
    // whole (gateway's exit-1 rescue doctrine). exit 137 with no result event is the shape.
    case "form_kill": {
      const steps = process.env.MOCK_FORM_STEPS ? JSON.parse(process.env.MOCK_FORM_STEPS) : null;
      const body = steps ? steps[Math.min(n, steps.length) - 1] : `form-${n}\n`;
      const sib = process.env.MOCK_FORM_SIBLING;
      if (sib) { if (!warmResume) writeFileSync(out, "# prose reasoning\nno repair turn touches this\n"); writeFileSync(sib, body); }
      else writeFileSync(out, body);
      if (warmResume) { process.stderr.write("mock kill after write\n"); process.exit(137); }
      okTurn(); break;
    }
    // The repair turn that WRITES NOTHING — issue 's shape, reproduced here on purpose and where it
    // is visible, because it is the one case an in-dispatch repair could read as a fix: the turn ends
    // clean, the bytes on disk are the SAME malformed bytes, and re-judging them must NOT be allowed to
    // say "repaired". Call 1 writes the malformed file; every resume returns ok and writes nothing.
    case "form_noop": {
      const steps = process.env.MOCK_FORM_STEPS ? JSON.parse(process.env.MOCK_FORM_STEPS) : null;
      const sib = process.env.MOCK_FORM_SIBLING;
      if (!warmResume) {
        if (sib) { writeFileSync(out, "# prose reasoning\nno repair turn touches this\n"); writeFileSync(sib, steps ? steps[0] : `form-${n} FRESH\n`); }
        else writeFileSync(out, steps ? steps[0] : `form-${n} FRESH\n`);
      }
      okTurn(); break;
    }
    default:
      process.stderr.write("MOCK_WARM_MODE unknown\n"); process.exit(1);
  }
}

if (process.env.MOCK_CLAUDE_RATELIMIT
    && (!process.env.MOCK_CLAUDE_RATELIMIT_MATCH || msg.includes(process.env.MOCK_CLAUDE_RATELIMIT_MATCH))) {
  // MOCK_CLAUDE_RATELIMIT=<epochSeconds> — the session-cap rejection shape (2026-06-17 incident): a rejected
  // rate_limit_event (resetsAt = epoch SECONDS) + a 429 result. The engine must surface signals.rateLimited +
  // resetsAt (ISO) so the driver POSTPONES rather than failing. Exit 1 (the real claude -p 429 exit code).
  // MOCK_CLAUDE_RATELIMIT_MATCH=<substr> — rate-limit ONLY the turns whose -p message contains <substr>
  // (e.g. a register-sweep skill ref), so earlier stages succeed first → a mid-run 429, mirroring the
  // 2026-06-22 incident. Unset = rate-limit every turn (the original all-or-nothing behavior).
  const resetsAt = Number(process.env.MOCK_CLAUDE_RATELIMIT);
  send({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt, rateLimitType: "five_hour", overageStatus: "rejected" } });
  send({ type: "result", subtype: "success", is_error: true, api_error_status: 429, result: "You've hit your session limit", stop_reason: "stop_sequence", session_id: session, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
  process.exit(1);
}

if (process.env.MOCK_CLAUDE_MAXTOK) {
  // A6 (addendum 2026-07-30): the output-ceiling shape — the turn "succeeds" (subtype success, exit 0)
  // but stopped at stop_reason max_tokens and never wrote its artifact. runStage must NAME the fault
  // (max_tokens_no_output:…) instead of riding the generic missing_file ladder silently.
  send({ type: "result", subtype: "success", is_error: false, duration_ms: 5, num_turns: 1,
    result: "…truncat", stop_reason: "max_tokens", session_id: session, total_cost_usd: 0.01,
    usage: { input_tokens: 10, output_tokens: 4096, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
  process.exit(0);
}

if (process.env.MOCK_CLAUDE_OVERLOADED) {
  // MOCK_CLAUDE_OVERLOADED=1 — the Anthropic 529 overload shape (D3): the API refuses the turn with
  // overloaded_error; claude -p surfaces a FAILED result whose text carries the error envelope, exit 1.
  // runStage must reclassify the resulting nonzero_exit_1 to status_overloaded and stop its ladder.
  send({ type: "result", subtype: "error_during_execution", is_error: true, api_error_status: 529,
    result: 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
    stop_reason: "error", session_id: session, total_cost_usd: 0,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
  process.exit(1);
}

if (process.env.MOCK_CLAUDE_USAGE_THEN_STALL) {
  // Streamed-usage-on-kill substrate (charter P1 §1 honesty): ONE completed assistant turn whose usage
  // proves real token movement (the R-round shape: millions of cacheRead), then silence forever. The
  // byte-stall kills it; the engine must report the STREAMED usage (never null) so the kill can never be
  // journalled as a 0-token lane wedge / transient-provider fault.
  const u = process.env.MOCK_CLAUDE_USAGE ? JSON.parse(process.env.MOCK_CLAUDE_USAGE)
    : { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 2950000, cache_creation_input_tokens: 0 };
  send({ type: "assistant", message: { role: "assistant", model: wireModel, content: [{ type: "text", text: "working…" }], usage: u }, session_id: session });
  setInterval(() => {}, 1 << 30);
} else if (process.env.MOCK_CLAUDE_JUNK_STREAM) {
  // No-progress substrate (charter P1 §1): keep the PIPE warm forever with non-progress chatter (system
  // events — parseable, byte-alive, but no token movement, no agent-loop step, no artifact write). The
  // byte-stall never fires; the NO-PROGRESS watchdog must kill it well below the wall.
  // MOCK_CLAUDE_JUNK_WRITE_FILE=<path>+MOCK_CLAUDE_JUNK_WRITE_MS=<ms>: also touch <path> every <ms> —
  // artifact advance IS honest progress, so with the write loop on the engine must NOT kill the turn;
  // MOCK_CLAUDE_JUNK_COUNT bounds the junk stream so that variant can finish with a clean result.
  // MOCK_CLAUDE_TOOL_HANG=1: ask for a tool FIRST and never send its `user` result, then chatter as
  // usual. moved the hard ceiling onto ACTIVE time, and the claim that makes that safe is that a
  // tool which never returns is still bounded — by this watchdog, because only a COMPLETED result
  // resets the progress clock. Before this fixture nothing in the suite could produce that state.
  if (process.env.MOCK_CLAUDE_TOOL_HANG) {
    // MOCK_CLAUDE_ASK_DELAY_MS=<ms> — hold the ask <ms> after init while the junk stream below keeps the
    // pipe warm. This is the gap between the child's FIRST BYTE and its first PROGRESS event, which is a
    // different fixture from MOCK_CLAUDE_BOOT_MS: the child is alive and talking, it just has not done
    // anything the progress clock counts yet.
    //
    // It MUST be a timer, not the Atomics.wait block BOOT_MS uses. `send` is a bare pipe write, so a
    // blocked event loop never flushes init and the fixture silently collapses into a plain slow boot —
    // the very thing this knob has to be distinguishable from.
    const askDelay = Number(process.env.MOCK_CLAUDE_ASK_DELAY_MS || 0);
    const ask = () => send({ type: "assistant", message: { role: "assistant", model: wireModel,
      content: [{ type: "tool_use", id: "toolu_hang_0", name: "RegisterLookup", input: {} }],
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
    if (askDelay > 0) setTimeout(ask, askDelay); else ask();
  }
  const gap = Number(process.env.MOCK_CLAUDE_JUNK_STREAM);
  const bound = Number(process.env.MOCK_CLAUDE_JUNK_COUNT || 0);
  const wf = process.env.MOCK_CLAUDE_JUNK_WRITE_FILE;
  const wms = Number(process.env.MOCK_CLAUDE_JUNK_WRITE_MS || 0);
  let wrote = 0;
  if (wf && wms > 0) setInterval(() => { try { writeFileSync(wf, `progress ${++wrote} ${Date.now()}\n`); } catch { /* best-effort */ } }, wms);
  let i = 0;
  const iv = setInterval(() => {
    if (bound > 0 && i++ >= bound) {
      clearInterval(iv);
      send({ type: "result", subtype: "success", is_error: false, duration_ms: 5, num_turns: 1, result: "mock claude ok",
        stop_reason: "end_turn", session_id: session, total_cost_usd: 0.001,
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
      process.exit(0);
    }
    send({ type: "system", subtype: "ping", t: Date.now() });   // bytes, parseable — but NOT progress
  }, gap);
} else if (process.env.MOCK_CLAUDE_TOKEN_STREAM) {
  // Token-movement substrate: usage-bearing message_delta partials every <ms> (honest progress), then a
  // clean result. With a tight CLEAROTRON_NO_PROGRESS_MS the engine must NOT kill this turn — token movement
  // resets the progress clock even when nothing is written yet.
  const gap = Number(process.env.MOCK_CLAUDE_TOKEN_STREAM);
  const total = Number(process.env.MOCK_CLAUDE_TOKEN_COUNT || 8);
  let i = 0;
  const iv = setInterval(() => {
    if (i++ >= total) {
      clearInterval(iv);
      send({ type: "result", subtype: "success", is_error: false, duration_ms: 5, num_turns: 1, result: "mock claude ok",
        stop_reason: "end_turn", session_id: session, total_cost_usd: 0.001,
        usage: { input_tokens: 10, output_tokens: total, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
      process.exit(0);
    }
    send({ type: "stream_event", event: { type: "message_delta", usage: { output_tokens: i } } });
  }, gap);
} else if (process.env.MOCK_CLAUDE_STALL) {
  // Init streamed (resets the engine's stall clock), then NOTHING — the silent-provider-stall shape the
  // 120s watchdog exists to abort. Hold the process open; the engine SIGKILLs it.
  setInterval(() => {}, 1 << 30);
} else {
  function doStageWrites() {
    if (process.env.MOCK_CLAUDE_NOFILE) return;
    // The bound card index the driver put into this turn's recording-server env. Read from argv rather
    // than re-derived, so a broken binding shows up here as an absent trace instead of a plausible one.
    const boundRecordAxis = (argv) => {
      try {
        const i = argv.indexOf("--mcp-config");
        const cfg = i >= 0 && argv[i + 1] ? JSON.parse(argv[i + 1]) : null;
        return cfg?.mcpServers?.["recording-report-card"]?.env?.CLEAROTRON_RECORD_AXIS ?? null;
      } catch { return null; }
    };
    // A2 (parallel report-cards): MOCK_STAGE_TRACE=<file> appends {card, phase, t} lines around a
    // report-card turn's write so a test can measure real in-flight overlap from the intervals;
    // MOCK_STAGE_DELAY_MS widens the window (Atomics.wait ticks, not a busy spin). Report-card only —
    // its message names the /report-cards/<ord>.md output path. (Ported from the retired gateway mock for the
    // anthropic-agent engine — the card turns run through THIS mock now.)
    // conversion 5 — FROM THE BOUND INDEX, not from a path. This matched `/report-cards/(\d+).md`
    // out of the dispatch, and the converted dispatch names no path at all, so the trace silently wrote
    // NOTHING and its test failed on a missing file rather than on a wrong measurement. The card index
    // now comes from the same place the tool's binding does: `CLEAROTRON_RECORD_AXIS`, in the resolved
    // --mcp-config the driver built for this turn.
    const traceCard = process.env.MOCK_STAGE_TRACE
      ? (msg.match(/\/report-cards\/(\d+)\.md/)?.[1] ?? boundRecordAxis(process.argv))
      : null;
    if (traceCard) {
      appendFileSync(process.env.MOCK_STAGE_TRACE, JSON.stringify({ card: traceCard, phase: "start", t: Date.now() }) + "\n");
      const delay = Number(process.env.MOCK_STAGE_DELAY_MS || 0);
      if (delay > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
    }
    const traceEnd = () => { if (traceCard) appendFileSync(process.env.MOCK_STAGE_TRACE, JSON.stringify({ card: traceCard, phase: "end", t: Date.now() }) + "\n"); };
    // Engine-test mode: a simple message + explicit MOCK_CLAUDE_FILE content → write it to the named path.
    if (process.env.MOCK_CLAUDE_FILE != null) {
      const m = msg.match(/ABSOLUTE path[^:]*:\s*(\/\S+)/)
        || msg.match(/write (?:the COMPLETE corrected file|it) at\s+(\/\S+)/)
        || msg.match(/OUTPUT_FILE:\s*(\/\S+)/);
      if (m) { try { mkdirSync(dirname(m[1]), { recursive: true }); writeFileSync(m[1], process.env.MOCK_CLAUDE_FILE); } catch { /* best-effort */ } }
      traceEnd();
      return;
    }
    // Pipeline mode: write the REAL stage fixtures (shared via mock-stage-fixtures.mjs)
    // so the $0 mock pipeline runs end-to-end on CLEAROTRON_AI=anthropic-agent.
    applyStageWrites(msg, argv);
    traceEnd();
  }
  function emitResult() {
    const usage = process.env.MOCK_CLAUDE_USAGE
      ? JSON.parse(process.env.MOCK_CLAUDE_USAGE)
      : { input_tokens: 10, output_tokens: 46, cache_read_input_tokens: 21462, cache_creation_input_tokens: 5065 };
    const fail = Boolean(process.env.MOCK_CLAUDE_FAIL);
    const obj = {
      type: "result", subtype: fail ? "error_during_execution" : "success", is_error: fail,
      duration_ms: 12, num_turns: 1, result: process.env.MOCK_CLAUDE_RESULT || "mock claude ok",
      stop_reason: fail ? "error" : "end_turn", session_id: session,
      total_cost_usd: process.env.MOCK_CLAUDE_COST != null ? Number(process.env.MOCK_CLAUDE_COST) : 0.0123,
      usage,
    };
    // MOCK_CLAUDE_NO_NEWLINE=1 — emit the FINAL result event with NO trailing newline (NDJSON last record);
    // the engine MUST flush its buffer on close or the result is dropped (the B1 regression).
    if (process.env.MOCK_CLAUDE_NO_NEWLINE) process.stdout.write(JSON.stringify(obj));
    else send(obj);
    process.exit(0);
  }

  if (process.env.MOCK_CLAUDE_SLOW_STREAM) {
    // Healthy-but-SLOW turn: stream a delta every <ms> (each resets the engine's stall clock) for
    // MOCK_CLAUDE_SLOW_COUNT iterations, then finish. With a gap < STALL the watchdog must NOT clip it.
    const gap = Number(process.env.MOCK_CLAUDE_SLOW_STREAM);
    const total = Number(process.env.MOCK_CLAUDE_SLOW_COUNT || 6);
    let i = 0;
    const iv = setInterval(() => {
      if (i++ >= total) { clearInterval(iv); doStageWrites(); emitResult(); return; }
      send({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "…" } } });
    }, gap);
  } else {
    // THINKING GAUGE fixture (MOCK_CLAUDE_THINK=1). Mirrors the REAL production shape probed against
    // claude 2.1.193 at --effort high: the thinking block's text is EMPTY (thinking.display defaults to
    // "omitted" on Opus 5) and the signature is what proves it engaged. This is deliberately hostile to a
    // naive implementation — anything that judges thinking by the block's text passes a friendlier fixture
    // and fails this one, which is the regression this guards.
    if (process.env.MOCK_CLAUDE_THINK === "1") {
      send({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "mock-sig" } } });
      send({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "" } } });
      send({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "mock-sig" } } });
      send({ type: "stream_event", event: { type: "content_block_stop", index: 0 } });
      send({ type: "assistant", message: { content: [{ type: "thinking", thinking: "", signature: "mock-sig" }] } });
    }
    // READS GAUGE fixture (MOCK_CLAUDE_READS=<json array of paths>): one completed assistant message
    // carrying a Read tool_use block per path — the shape the AD-4 gauge parses (completed messages only;
    // partials stream input via input_json_delta and are deliberately not the substrate).
    if (process.env.MOCK_CLAUDE_READS) {
      const paths = JSON.parse(process.env.MOCK_CLAUDE_READS);
      send({ type: "assistant", message: { role: "assistant", model: wireModel,
        content: paths.map((p, i) => ({ type: "tool_use", id: `toolu_mock_${i}`, name: "Read", input: { file_path: p } })),
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
    }
    // TOOL-WAIT fixture (MOCK_CLAUDE_TOOL_WAIT=<json array of {name, ms}>): an assistant message asking
    // for the named tool(s), a real pause, then the `user` event that closes the ask. 's gauge times
    // exactly that gap, and until this existed the suite could only prove the field was PRESENT AT ZERO —
    // which is the same instrument-cannot-show-nonzero hole the gauge itself was built to close.
    //
    // One entry = one assistant/user round trip. An entry may name SEVERAL tools (`name` an array), which
    // is the shape that decides attribution: the model asks for two tools in one message and waits once.
    if (process.env.MOCK_CLAUDE_TOOL_WAIT) {
      for (const [i, step] of JSON.parse(process.env.MOCK_CLAUDE_TOOL_WAIT).entries()) {
        const names = Array.isArray(step.name) ? step.name : [step.name];
        send({ type: "assistant", message: { role: "assistant", model: wireModel,
          content: names.map((n, j) => ({ type: "tool_use", id: `toolu_wait_${i}_${j}`, name: n, input: {} })),
          usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
        const until = Date.now() + Number(step.ms || 0);
        while (Date.now() < until) { /* a real gap: the gauge times wall-clock, not a declared duration */ }
        send({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: `toolu_wait_${i}_0` }] } });
      }
    }
    // OVERLAPPING-ASK fixture (MOCK_CLAUDE_TOOL_OVERLAP=<json array of {name, ms}>): EVERY ask is
    // emitted before ANY result, which is the shape a single-slot ask clock cannot hold. The tool-wait
    // fixture above strictly alternates ask/result, so nothing in the suite ever put two asks in flight
    // at once — which is exactly why 's keying defect stayed latent and invisible.
    //
    // `tool_use_id` is carried on both halves here because it is carried on both halves on the wire.
    // The engine ignored it until the keying fix; with it, each result closes the ask it belongs to.
    if (process.env.MOCK_CLAUDE_TOOL_OVERLAP) {
      const steps = JSON.parse(process.env.MOCK_CLAUDE_TOOL_OVERLAP);
      // MOCK_CLAUDE_TOOL_OVERLAP_ONE_CHUNK=1 — EVERY ASK IN A SINGLE WRITE, so the reader receives them
      // in ONE stdout chunk however it is scheduled. This is the shape a LATE READER produces on its own
      // (two asks 120ms apart on the wire, one chunk at the parser) and it is what took main red on
      // 2026-08-25 while the same fixture passed 12 of 12 locally. Driving it here makes it deterministic:
      // an arm that waits for load to reproduce a race is an arm that reports a pass on a quiet box.
      // `preMs` is deliberately IGNORED in this mode — the whole point is that the gap the sender waited
      // never reaches the reader, so honouring it would defeat the fixture.
      if (process.env.MOCK_CLAUDE_TOOL_OVERLAP_ONE_CHUNK) {
        // DRAIN FIRST. A single write is atomic on a pipe, but the READER's chunk boundary can still
        // fall between the two lines when earlier bytes (init, system chatter) are still in flight —
        // measured flapping about one run in three without this. A short real gap lets the reader
        // consume everything already sent, so the combined write below is the only thing pending and
        // arrives whole. Writes issued BEFORE a busy-wait do reach the reader during it (probed
        // separately, 5 of 5 separated by the full gap), which is what makes this work.
        { const u = Date.now() + 40; while (Date.now() < u) { /* let the reader catch up */ } }
        process.stdout.write(steps.map((step, i) => JSON.stringify({ type: "assistant",
          message: { role: "assistant", model: wireModel,
            content: [{ type: "tool_use", id: `toolu_ov_${i}`, name: step.name, input: {} }],
            usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
        }) + "\n").join(""));
      } else
      for (const [i, step] of steps.entries()) {
        // `preMs` is a real gap BEFORE this ask is emitted, so the earlier ask is outstanding ALONE for
        // a measurable stretch. Without it every ask lands in the same millisecond and the period where
        // only the first was waiting is too small to assert on — which let a defect that drops that
        // period entirely pass unnoticed.
        if (step.preMs) { const u = Date.now() + Number(step.preMs); while (Date.now() < u) { /* gap */ } }
        send({ type: "assistant", message: { role: "assistant", model: wireModel,
          content: [{ type: "tool_use", id: `toolu_ov_${i}`, name: step.name, input: {} }],
          usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
      }
      // MOCK_CLAUDE_TOOL_OVERLAP_REVERSE=1 returns the results in the OPPOSITE order to the asks, which
      // is the only shape that tells id-keying apart from "close whichever ask is oldest". With results
      // in ask order the two are indistinguishable, and an arm built on that fixture proves neither.
      const order = process.env.MOCK_CLAUDE_TOOL_OVERLAP_REVERSE
        ? [...steps.keys()].reverse() : [...steps.keys()];
      for (const i of order) {
        const until = Date.now() + Number(steps[i].ms || 0);
        while (Date.now() < until) { /* a real gap, as above */ }
        send({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: `toolu_ov_${i}` }] } });
      }
    }
    // MALFORMED-CONTENT fixture (MOCK_CLAUDE_BAD_CONTENT=1) — an `assistant` event whose message.content is
    // TRUTHY but NOT iterable (the shape a display-mode or CLI-version change could produce). The gauge
    // loops must survive it on BOTH parseLine call sites, so it is emitted twice: once newline-terminated
    // (the stdout 'data' listener) and once as the FINAL un-terminated line (settle()'s flush — where a
    // throw would land after `settled = true` + clearInterval(watchdog) and before resolve(), killing the
    // driver mid-stage with no fail classification, or hanging the turn with its watchdog already gone).
    // The result event is emitted BETWEEN them, so a surviving engine still returns a clean successful turn.
    if (process.env.MOCK_CLAUDE_BAD_CONTENT) {
      send({ type: "assistant", message: { role: "assistant", content: { type: "text", text: "not an array" } } });
      doStageWrites();
      const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
      send({ type: "result", subtype: "success", is_error: false, duration_ms: 5, num_turns: 1,
        result: process.env.MOCK_CLAUDE_RESULT || "mock claude ok", stop_reason: "end_turn",
        session_id: session, total_cost_usd: 0, usage });
      process.stdout.write(JSON.stringify({ type: "assistant", message: { role: "assistant", content: "a bare string" } }));
      process.exit(0);
    }
    // a streamed partial (the watchdog heartbeat) then the final result
    send({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "…" } } });
    doStageWrites();
    emitResult();
  }
}
