// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A SIGNAL SENT TO THE VISIBLE PID REACHES WHAT THAT PID STARTED — tracker issue 176.
//
// `bin/example.mjs` grew a SIGTERM handler because killing the demo left its three doors bound. Driving
// that fix found the same defect one level UP, in the process a reader actually sees: `bin/clearotron.mjs`
// spawns the verb with `stdio: "inherit"` and registered no signal handler at all. So killing the visible
// pid killed the shim, the verb survived and reparented to init with the whole supervisor under it, and
// the handler one level down never received a signal. Three doors stayed bound on a machine the operator
// believed they had stopped.
//
// ── WHY THIS ARM SPAWNS INSTEAD OF READING THE FILE ─────────────────────────────────────────────────
//
// A grep for `process.on("SIGTERM"` in the shim is a proxy for the contract, not the contract — it passes
// on a handler that forwards the wrong signal, forwards to the wrong process, or is registered before the
// child exists. The claim is about orphans, so the arm makes one.
//
// ── AND WHY IT DRIVES AN UNPATCHED COPY AS ITS CONTROL ──────────────────────────────────────────────
//
// An arm that only ever sees the fixed shim cannot tell "no orphan" from "this harness cannot see an
// orphan" — every poll, pid and path here is machinery that fails toward green. So the same drive runs
// against a copy of the shim with the forwarding removed, and that copy MUST orphan. The control is the
// oracle; the fix is the subject.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { VERBS } from "../../bin/clearotron.mjs";
import { pidAlive } from "./platform-caps.mjs";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SHIM = join(ROOT, "bin", "clearotron.mjs");

// The block the fix added. Removing it is how the control is built, so it is matched exactly — a regex
// that silently matched nothing would make the control a second copy of the subject.
const FORWARDING = /\n {2}for \(const sig of \["SIGTERM", "SIGINT", "SIGHUP"\]\) \{\n[\s\S]*?\n {2}\}\n/;

/**
 * A stand-in for the verb the shim dispatches to: it spawns a long-lived grandchild — the doors, in the
 * real shape — and tears it down on SIGTERM, exactly as `example.mjs` and `start.mjs` do.
 *
 * The real verbs are not used because this arm is about the SHIM. Driving `demo` here would bind real
 * ports on a shared box and make a signalling question depend on a supervisor booting.
 */
const STUB_VERB = `
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const grand = spawn(process.execPath, ["-e", "setInterval(() => {}, 1e9)"], { stdio: "ignore" });
grand.unref();
process.on("SIGTERM", () => { try { grand.kill("SIGTERM"); } catch {} process.exit(0); });
setInterval(() => {}, 1e9);
// Written LAST, so its presence means both processes exist and the handler is registered. A test that
// read half-written pids would be measuring its own race.
writeFileSync(process.env.STUB_OUT, JSON.stringify({ verb: process.pid, grand: grand.pid }));
`;

// LIVENESS THROUGH pidAlive, WHICH ANSWERS IN THREE VALUES. Reading the process table under /proc is
// Linux's alone and would make every arm here blind on the macOS tier — caught by 2178's class guard,
// which is the reason that reader is shared rather than written per file. It also settles the
// cross-user case this box's runbook warns about: EPERM means a process exists and is not ours to
// signal, and a reader that scores that as death is reading the permission, not the process.
//
// `null` is a COULD-NOT-LOOK and is never collapsed into either answer below. Folding it into "dead"
// would let the control pass on a probe that saw nothing, which is this file's own failure mode.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(predicate, ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (predicate()) return true; await sleep(50); }
  return false;
}

/** A tree the real shim runs unmodified in, with `demo` resolved to the stub above. */
function stage({ forwarding }) {
  const dir = mkdtempSync(join(tmpdir(), "shim-signal-"));
  let src = readFileSync(SHIM, "utf8");
  if (!forwarding) {
    const stripped = src.replace(FORWARDING, "\n");
    assert.notEqual(stripped, src,
      "the control could not be built: the forwarding block in bin/clearotron.mjs no longer matches the "
      + "pattern this arm strips. Update FORWARDING — an unstripped control is a second copy of the "
      + "subject and would pass for the wrong reason");
    src = stripped;
  }
  mkdirSync(join(dir, "bin"), { recursive: true });
  writeFileSync(join(dir, "bin", "clearotron.mjs"), src);
  // The shim reads its version from package.json and imports two helpers from shared/; symlinked rather
  // than copied so this arm never drifts from what those files actually do.
  symlinkSync(join(ROOT, "shared"), join(dir, "shared"));
  symlinkSync(join(ROOT, "package.json"), join(dir, "package.json"));
  const [rel] = VERBS.demo;
  mkdirSync(join(dir, dirname(rel)), { recursive: true });
  writeFileSync(join(dir, rel), STUB_VERB);
  return dir;
}

/**
 * Run the shim, kill ONLY the pid a reader can see, and report what was still running afterwards.
 * Every pid it touches is one it recorded itself.
 */
async function driveAndKillTheVisiblePid({ forwarding }) {
  const dir = stage({ forwarding });
  const out = join(dir, "pids.json");
  let shim = null, pids = null;
  try {
    shim = spawn(process.execPath, [join(dir, "bin", "clearotron.mjs"), "demo"], {
      stdio: "ignore", env: { ...process.env, STUB_OUT: out },
    });
    assert.ok(await until(() => existsSync(out)), "the staged shim never started its verb, so nothing was driven");
    pids = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(pidAlive(pids.grand), true, "the grandchild was gone before anything was signalled");

    // THE READER'S ACTION, EXACTLY: one kill, on the one pid `ps` shows them.
    process.kill(shim.pid, "SIGTERM");

    // Waits for a DEFINITE death. A probe that cannot look never satisfies this, so the wait runs out
    // and the caller is handed the `null` rather than a timeout dressed up as a verdict.
    await until(() => pidAlive(pids.verb) === false);
    await until(() => pidAlive(pids.grand) === false);
    return { verb: pidAlive(pids.verb), grand: pidAlive(pids.grand) };
  } finally {
    // By recorded pid only, and never a name. `=== true` because a could-not-look is not a licence to
    // send SIGKILL at a number this arm may no longer own.
    for (const pid of [pids?.grand, pids?.verb, shim?.pid]) {
      if (pid && pidAlive(pid) === true) { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } }
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

test("tracker issue 176 — the control: without forwarding, killing the visible pid orphans everything", async () => {
  // THE ORACLE. If this passes, the harness above cannot see an orphan and the subject arm below means
  // nothing. It is the shim as it shipped in 0.1.1, driven the way the stranger drove it.
  const { grand } = await driveAndKillTheVisiblePid({ forwarding: false });
  // `true`, not "not dead": a could-not-look must fail this arm rather than satisfy it, because the
  // whole job of the control is to prove the probe can SEE an orphan.
  assert.equal(grand, true,
    "the UNPATCHED shim's grandchild is not measurably alive, so this arm cannot detect the defect it "
    + "exists to detect — the drive is measuring something other than what it claims");
});

test("tracker issue 176 — killing the visible pid tears down the verb and what the verb started", async () => {
  const { verb, grand } = await driveAndKillTheVisiblePid({ forwarding: true });
  assert.equal(verb, false, "the verb the shim dispatched to survived the signal and reparented to init");
  assert.equal(grand, false,
    "the verb's own child is still running — on a real install these are the engine, client and portal "
    + "doors, still bound on a machine the operator believes they have stopped");
});

test("tracker issue 176 — the shim forwards the three signals a reader can actually send", () => {
  // Narrow and textual on purpose: the drive above proves the mechanism on SIGTERM, and this holds the
  // SET. SIGINT was never the gap — a terminal delivers it to the whole foreground group — but a
  // backgrounded command reached by `kill -INT` or a closing SSH session's SIGHUP is the same orphan.
  const src = readFileSync(SHIM, "utf8");
  const block = FORWARDING.exec(src);
  assert.ok(block, "bin/clearotron.mjs no longer forwards signals to the verb it spawned");
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    assert.ok(block[0].includes(sig), `${sig} is not forwarded to the child`);
  }
  assert.match(block[0], /process\.off\(sig, forward\)/,
    "the handler no longer stands down after forwarding once, so a second signal cannot reach this "
    + "process and a child that ignores the first would hang the command a reader is trying to stop");
});
