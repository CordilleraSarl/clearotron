// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Unit tests for engine/common.mjs — the shared, engine-agnostic streaming-child substrate. These use
// tiny REAL node children (no claude/codex, no network, $0) to exercise the governed behaviours both
// engine adapters rely on: line parsing + final-line flush, the stall watchdog, the maxBuffer overflow
// kill, the spawn-error path, and the stderr-as-liveness discriminator (the codex-specific bit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execPath } from "node:process";
import {
  runStreamingChild, absolutizeSkillRefs, buildEnvelope, WRITE_DISCIPLINE,
} from "../engine/common.mjs";

// helper: run a node child whose body is `code`, collecting every parsed stdout line.
function runNode(code, opts = {}) {
  const lines = [];
  return runStreamingChild({
    bin: execPath, args: ["-e", code], input: opts.input ?? "",
    stallSec: opts.stallSec, timeoutSec: opts.timeoutSec,
    stderrIsLiveness: opts.stderrIsLiveness,
    onStdoutLine: (l) => lines.push(l),
  }).then((r) => ({ ...r, lines }));
}

test("clean run: parses newline-separated lines AND flushes the final un-terminated line (B1)", async () => {
  // Two JSON lines; the SECOND has no trailing newline — it must still reach onStdoutLine at settle.
  const r = await runNode(`process.stdout.write('{"type":"a"}\\n{"type":"result","ok":true}')`);
  assert.equal(r.rawCode, 0);
  assert.equal(r.killed, false);
  assert.equal(r.overflow, false);
  assert.deepEqual(r.lines, ['{"type":"a"}', '{"type":"result","ok":true}']);
});

test("stdin is delivered to the child", async () => {
  const r = await runNode(
    `let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>process.stdout.write(JSON.stringify({got:d})))`,
    { input: "hello-prompt" },
  );
  assert.equal(r.rawCode, 0);
  assert.deepEqual(JSON.parse(r.lines[0]), { got: "hello-prompt" });
});

test("stall watchdog: a child that goes silent past stallSec is killed as a stall", async () => {
  // Emit one line, then hang forever with no output. stallSec=0.3s → killed within ~0.45s.
  const r = await runNode(`process.stdout.write('{"type":"start"}\\n');setInterval(()=>{},1000)`, { stallSec: 0.3 });
  assert.equal(r.killed, true);
  assert.equal(r.stallKill, true);
  assert.equal(r.hardWall, false);
  assert.equal(r.rawCode, null);           // signal-killed → no exit code
  assert.deepEqual(r.lines, ['{"type":"start"}']);
});

// ── — A DEADLINE MARGIN IS A RATIO, NOT A NUMBER THAT LOOKS SMALL ───────────────────────────────
//
// These two arms shared one hand-copied child and a 100ms heartbeat against a 0.3s stall deadline: a 3x
// margin. Under full-suite load a timer slip of 200ms is ordinary, the watchdog fires, and the arm reds on
// a diff that cannot reach a child process — measured three times in one day on three unrelated diffs,
// each time green standalone. A flake in a suite this size is indistinguishable from a regression at the
// moment you read it, and the cost lands on the next reader rather than on whoever caused it.
//
// The margin is now set from the RATIO between the two clocks the arm is about, so load has to be 40x
// worse before it can close it. Nothing about what either arm ASSERTS has changed: one says stderr counts
// as liveness, the other says it does not.
//
// THE TWO USE THE SAME CHILD BY CONSTRUCTION. They were two copies of one string, and a pair that must
// stay identical to mean anything is exactly the pair that drifts.
const HEARTBEAT_MS = 25;
const HEARTBEAT_TICKS = 40;              // ~1s of life, so the stdout-only arm still has room to stall-kill
const stderrOnlyChild = `let n=0;const i=setInterval(()=>{process.stderr.write("tick\\n");if(++n>=${HEARTBEAT_TICKS}){clearInterval(i);process.stdout.write('{"type":"done"}');process.exit(0)}},${HEARTBEAT_MS})`;

test("stderrIsLiveness=true: stderr progress keeps a stdout-silent child ALIVE (the codex path)", async () => {
  // No stdout at all; heartbeat on STDERR every 25ms for ~1s, then exit clean. With stderr counting as
  // liveness (codex streams progress there), the 1s stall watchdog must NOT fire — 40 heartbeats have to
  // be lost in a row before it could.
  const r = await runNode(stderrOnlyChild, { stallSec: 1.0, stderrIsLiveness: true });
  assert.equal(r.killed, false, "stderr liveness should prevent the stall kill");
  assert.equal(r.rawCode, 0);
  assert.deepEqual(r.lines, ['{"type":"done"}']);
});

test("stderrIsLiveness=false: the SAME stderr-only child stalls (claude-parity, stdout-only liveness)", async () => {
  // The stdout-only side keeps a SHORT deadline on purpose: it must fire well inside the child's ~1s life.
  // Load pushes this one the safe way — a slower child emits stdout no sooner, so it is if anything more
  // certain to stall-kill. Only the arm above could flake, and only that one needed widening.
  const r = await runNode(stderrOnlyChild, { stallSec: 0.3, stderrIsLiveness: false });
  assert.equal(r.killed, true, "with stdout-only liveness the stderr-only child must stall-kill");
  assert.equal(r.stallKill, true);
});

test("overflow: a newline-less spew past maxBuffer is truncate-killed as a nonzero (NOT a timeout)", async () => {
  const prev = process.env.CLEAROTRON_ENGINE_MAX_BUFFER;
  process.env.CLEAROTRON_ENGINE_MAX_BUFFER = "1024";
  try {
    const r = await runNode(`process.stdout.write("x".repeat(50000))`);
    assert.equal(r.overflow, true);
    assert.equal(r.killed, false, "overflow is a plain nonzero failure, not a watchdog kill/timeout");
    assert.equal(r.hardWall, false);
    assert.equal(r.rawCode, 1);
  } finally {
    if (prev === undefined) delete process.env.CLEAROTRON_ENGINE_MAX_BUFFER; else process.env.CLEAROTRON_ENGINE_MAX_BUFFER = prev;
  }
});

test("spawn error: a missing binary resolves with { spawnError }, never rejects", async () => {
  const r = await runStreamingChild({ bin: "/nonexistent/definitely-not-a-binary-xyz", args: [], input: "" });
  assert.ok(r.spawnError, "a spawn failure must surface as spawnError");
  assert.equal(r.rawCode, undefined);
});

// ── pure helpers ─────────────────────────────────────────────────────────────────────────────────────
test("absolutizeSkillRefs: rewrites skills/… refs under dirname(skillsDir), idempotently", () => {
  const skillsDir = "/opt/driver/skills";
  const once = absolutizeSkillRefs("read skills/prelim-register/SKILL.md now", skillsDir);
  assert.equal(once, "read /opt/driver/skills/prelim-register/SKILL.md now");
  assert.equal(absolutizeSkillRefs(once, skillsDir), once, "already-absolute path must not be double-prefixed");
  assert.equal(absolutizeSkillRefs("no refs here", skillsDir), "no refs here");
});

test("absolutizeSkillRefs: a resolve() overlay wins over the base join", () => {
  const out = absolutizeSkillRefs("see skills/x/SKILL.md", "/base/skills", (m) => `/overlay/${m}`);
  assert.equal(out, "see /overlay/skills/x/SKILL.md");
});

test("buildEnvelope: ok → status ok with the payload text; killed → timeout; else error", () => {
  const ok = buildEnvelope({ text: "hi", ok: true, usage: { total: 5 } });
  assert.equal(ok.status, "ok");
  assert.equal(ok.result.payloads[0].text, "hi");
  assert.equal(ok.result.meta.agentMeta.usage.total, 5);
  assert.equal(buildEnvelope({ ok: false, killed: true }).status, "timeout");
  assert.equal(buildEnvelope({ ok: false, killed: false }).status, "error");
});

test("WRITE_DISCIPLINE names the Write tool and the DISCARDED failure mode", () => {
  assert.match(WRITE_DISCIPLINE, /WRITE TOOL/);
  assert.match(WRITE_DISCIPLINE, /DISCARDED/);
});

test("WRITE_DISCIPLINE carries the repair exception, and the two engine copies never drift", async () => {
  // Producing a stage's output and repairing one named defect in it are different acts. Without this
  // sentence a corrective turn retypes a whole 160 KB document to fix a few lines — measured at 3-4x the
  // wall and tokens of the patching attempt that actually passed (repair-contract.mjs carries the numbers).
  assert.match(WRITE_DISCIPLINE, /EXCEPTION — REPAIRS/);
  assert.match(WRITE_DISCIPLINE, /Edit tool/);
  assert.match(WRITE_DISCIPLINE, /counts as written/, "a repaired file must not read as an unwritten one");
  // …and the exception must never swallow the base rule: an ABSENT file is still written in full.
  assert.match(WRITE_DISCIPLINE, /If the file does not exist, the rule above stands/);
  // engine/anthropic-agent.mjs deliberately imports nothing but node built-ins, so it holds its own copy.
  // Two copies of a system prompt are two chances to fix one and forget the other — pin them equal.
  const { WRITE_DISCIPLINE: fromAnthropic } = await import("../engine/anthropic-agent.mjs");
  assert.equal(fromAnthropic, WRITE_DISCIPLINE, "the anthropic-agent copy drifted from engine/common.mjs");
});

// ── — THE STALL CLOCK STARTED AT SPAWN, SO STARTUP COUNTED AS SILENCE ───────────────────────────
//
// `lastMove` was set at spawn, which makes the child's entire startup sit on a clock meant to measure
// silence BETWEEN outputs. Under concurrent process CREATION — not CPU load; an ambient-load control
// stayed green — startup p90 measured 376ms against a 300ms deadline, and the kills all carried ZERO
// bytes emitted at wall ≈ deadline. Survivors were untouched, because a first byte had already reset the
// clock.
//
// LATENT, NOT LIVE. The smallest stall window that ships is 30s (PROBE_STALL_SEC; the rest are 300–1100s
// and the default is 120s), so a 376ms startup is ~1% of the narrowest real deadline and this cannot be
// firing on a real run. The remedy therefore has to be one that CANNOT move production behaviour, which
// is why it is a grace floor rather than a re-basing of the clock.
//
// WHY NOT "START THE CLOCK AT FIRST OUTPUT": that removes the guarantee the clock exists for. A child
// that emits nothing at all — a startup wedge, exactly this case — would then never stall-kill and would
// run to the hard wall instead. On a stage with stallSec 1100 / timeoutSec 2250 that doubles the burn on
// a real wedge to save a rare test red. The second arm below is that guarantee, kept.
test("#1692 a child slow to produce its FIRST byte is not killed as a stall", async () => {
  // First output at ~700ms against a 0.3s stall window. On the pre-fix clock the deadline ran from spawn,
  // so this died at 300ms having never had the chance to speak.
  const r = await runNode(`setTimeout(()=>{process.stdout.write('{"type":"done"}');process.exit(0)},700)`, { stallSec: 0.3 });
  assert.equal(r.killed, false,
    "killed before it had emitted anything — startup is being charged to a clock that measures silence between outputs");
  assert.equal(r.stallKill, false);
  assert.deepEqual(r.lines, ['{"type":"done"}']);
});

test("#1692 a child that NEVER speaks still stall-kills — the grace bounds startup, it does not remove the kill", async () => {
  // The guarantee that makes the grace safe. No output on either stream, ever.
  const r = await runNode(`setInterval(()=>{},1000)`, { stallSec: 0.3 });
  assert.equal(r.killed, true, "a child that emitted nothing at all was allowed to run — the wedge kill is gone");
  assert.equal(r.stallKill, true, "and it must be recorded as a STALL, not as a hard-wall kill");
  assert.equal(r.hardWall, false);
});

test("#1692 the grace ends on the first byte of EITHER stream, not on liveness-counting output", async () => {
  // A stderr-only child with stdout-only liveness must still stall-kill inside its own lifetime. If the
  // grace waited for a LIVENESS byte it would not, because stderr never resets this child's clock — and
  // the claude-parity arm above would start passing for the wrong reason.
  const r = await runNode(stderrOnlyChild, { stallSec: 0.3, stderrIsLiveness: false });
  assert.equal(r.killed, true, "the grace outlived a child that was streaming stderr the whole time");
  assert.equal(r.stallKill, true);
});

// ── — THE HARD WALL MEASURES THE TURN, NOT THE PROCESS ────────────────────────────────────────
//
// The stall clock above got its spawn grace in and the anthropic watchdog got its first-byte t0
//. The hard wall in this file kept charging process startup to the ceiling, and nothing here
// could say so: `hardMs` derives from `timeoutSec` with a 61-SECOND floor, so no arm could drive the
// site without sitting for a minute. `CLEAROTRON_HARD_MS` is the instrument that makes these three arms
// possible, on the same fail-safe terms as its anthropic sibling.
//
// THE PIN IS PROCESS-WIDE — it is read from the PARENT's env inside runStreamingChild, not passed to
// the child — so each arm sets and restores it rather than leaving it set for whatever runs next.
const withHardPin = async (value, fn) => {
  const had = Object.prototype.hasOwnProperty.call(process.env, "CLEAROTRON_HARD_MS");
  const before = process.env.CLEAROTRON_HARD_MS;
  process.env.CLEAROTRON_HARD_MS = value;
  try { return await fn(); }
  finally { if (had) process.env.CLEAROTRON_HARD_MS = before; else delete process.env.CLEAROTRON_HARD_MS; }
};

// Silent for `quietMs`, then a heartbeat every 200ms until `endMs`, then a clean exit. The heartbeat is
// what keeps the STALL clock out of these arms: they are about the hard wall, and a stall kill here
// would pass for the wrong reason.
const lateSpeaker = (quietMs, endMs) =>
  `setTimeout(()=>{const i=setInterval(()=>process.stdout.write('{"t":"tick"}\\n'),200);`
  + `setTimeout(()=>{clearInterval(i);process.stdout.write('{"type":"done"}');process.exit(0)},${endMs - quietMs})},${quietMs})`;

test("#1752 a slow spawn is not charged to the hard wall", async () => {
  // Quiet until 1000ms, then alive until 2500ms. Measured from spawn, the ceiling expires at 2000ms with
  // the child mid-heartbeat and the run dies having been given 1000ms of actual turn. Measured from the
  // first byte, it survives to its own exit.
  //
  // ── ✕ THE NUMBERS ARE PINNED BY TWO BOUNDS, AND THE ARM USED TO SIT ON ONE OF THEM ──
  //
  // The wall starts at the child's first OUTPUT (driver/engine/common.mjs:224 — `Date.now() -
  // firstOutputAt >= hardMs`), so the child's life after that byte is what the ceiling is measured
  // against. Two bounds are live at once:
  //
  //     turn < hardMs                 or this arm reds on a CORRECT implementation
  //     hardMs < quietMs + turn       or this arm passes on the DEFECT it was written for
  //
  // The window is therefore `turn ∈ (hardMs - quietMs, hardMs)` and it is exactly `quietMs` wide, which
  // is why the ceiling cannot simply be widened: raising hardMs alone crosses the second bound and the
  // arm silently stops catching anything.
  //
  // It used to be pinned at 1500 with `lateSpeaker(700, 2200)` — a turn of 2200-700 = 1500ms against a
  // 1500ms ceiling. The child's own `process.exit(0)` and the watchdog's kill were scheduled for the SAME
  // INSTANT on every run, and which landed first was a race between a timer in the child and a poll in
  // the parent. It was not flaky under load; it was a coin flip that load biased. The old comment called
  // that "only just fits", describing a zero-margin budget as though it were a design.
  //
  // 1000/2500 against a 2000ms ceiling puts the turn at 1500ms, which is 500ms clear of BOTH bounds —
  // the most margin the window allows, and the window was widened to buy it (quietMs 700 → 1000).
  const r = await withHardPin("2000", () => runNode(lateSpeaker(1000, 2500), { stallSec: 1.0 }));
  assert.equal(r.killed, false,
    `killed after ${r.wall}s with a 2s ceiling — startup is being charged to a clock that is supposed `
    + "to measure the turn");
  assert.equal(r.hardWall, false);
  assert.ok(r.wall > 2.0, `the run lasted ${r.wall}s — it has to outlive the ceiling for this arm to see anything`);
  assert.deepEqual(r.lines.at(-1), '{"type":"done"}', "the child did not reach its own ending");
});

test("#1752 the hard wall still fires, and it is recorded as a hard wall rather than a stall", async () => {
  // The guarantee that keeps the arm above honest. A child speaking from the first moment and never
  // stopping must die at the ceiling — moving the t0 relocates the wall, it does not remove it.
  const r = await withHardPin("700", () => runNode(
    `const i=setInterval(()=>process.stdout.write('{"t":"tick"}\\n'),100);setTimeout(()=>clearInterval(i),30000)`,
    { stallSec: 5 }));
  assert.equal(r.killed, true, "a child that ran far past the ceiling was never killed — the wall is gone, not moved");
  assert.equal(r.stallKill, false, "killed as a STALL: it was streaming every 100ms, so this arm is not testing the ceiling");
  assert.equal(r.hardWall, true);
});

test("#1752 CLEAROTRON_HARD_MS is a pin, never a way to switch the wall off", async () => {
  // The fail-safe direction on the override itself, in both unusable shapes. A non-positive or
  // unparseable value falls through to the derivation; reading either as "a ceiling of zero" would kill
  // every turn at the first watchdog tick, and reading it as "no ceiling" would remove the last backstop
  // on a real box. THE TURN MUST OUTLIVE A TICK or the arm proves nothing: stallSec 1.0 polls at 500ms.
  for (const bad of ["0", "-1", "not-a-number", ""]) {
    const r = await withHardPin(bad, () => runNode(lateSpeaker(100, 1600), { stallSec: 1.0 }));
    assert.ok(r.wall > 1.0, `CLEAROTRON_HARD_MS=${JSON.stringify(bad)}: the turn ran ${r.wall}s, under two polls — `
      + "the watchdog barely ticked, so this says nothing about the ceiling");
    assert.equal(r.killed, false,
      `CLEAROTRON_HARD_MS=${JSON.stringify(bad)} was read as a ceiling rather than falling through to the derivation`);
  }
});
