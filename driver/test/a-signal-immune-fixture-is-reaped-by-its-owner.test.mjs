// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// #1847 — TWO NODE PROCESSES SAT ON THE SHARED TEST BOX FOR 2.7 DAYS.
//
// `mock-claude-spew-immune.mjs` and a `node -e process.on('SIGTERM',()=>{})…` — `mock-hang-tree.mjs`'s
// grandchild. Both orphaned to init, both immune to SIGTERM, both needing a human with SIGKILL.
//
// THE PAIR IS THE POINT, in the reporter's words: a cleanup that kills the named mock and stops leaves
// the SIGTERM-proof twin running, and the twin is the half no ordinary mechanism can clear. Anyone
// finding one and reaping it believes the box is clean.
//
// And the box is SHARED — another session was running `node --test` on it during the round that found
// this — so the next leak is not hypothetical and will not necessarily be noticed by whoever caused it.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { reapPidfile, reapNow } from "./reap-fixture.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";
import { processTable } from "../../shared/process-table.mjs";   // Refs tracker issue 2099 — /proc is not the only box

const HERE = dirname(fileURLToPath(import.meta.url));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));

// ── `alive` IS NOT `ready`, AND THE PREMISE ARM REDDENED ON THE DIFFERENCE ───────────────────────
//
// The premise arm below waited a fixed 250ms, checked `alive(pid)`, then sent SIGTERM. It went red on
// main (2026-08-26 03:19Z) reporting "SIGTERM left it running" as FALSE — and the premise is fine.
//
// `alive(pid)` answers "does this process exist". What every arm here needs is "has it installed its
// SIGTERM handler". On a slow box those come apart: node has forked so the pid is real, the `-e` script
// has not run yet, and SIGTERM therefore arrives at a process with the DEFAULT disposition — which kills
// it. The arm was measuring how busy the machine was and reporting the answer as a fact about signals.
//
// The child now ANNOUNCES readiness, and the order is the whole mechanism: the handler is installed
// BEFORE the flag is written, so the flag existing means the handler exists. A fixed settle is a load
// meter; a readiness flag is a fact.
//
// A FILE RATHER THAN stdout, because these children are spawned `stdio: "ignore"` and unref'd — they
// must not hold the run open, and adding a pipe to read readiness from would give them a handle that
// does. The flag costs one temp dir per child and they are all removed in `after`.
const READY_FLAGS = new Set();

// ── EVERY CHILD THIS FILE SPAWNS IS REGISTERED AT BIRTH, AND THAT IS THE ISSUE'S OWN LESSON ─────
//
// The premise arm reaped its fixture with a bare `process.kill(pid, "SIGKILL")` written AFTER its
// assertions. A red therefore threw past the cleanup and stranded the child — which is verbatim the
// defect this whole issue was raised about, in the docblock's own words:
//
//     "The tests that verify a SIGKILL escalation were delegating their own cleanup to the escalation
//      they are testing. On the day either one catches a real regression, it leaks the processes — the
//      failure mode is armed precisely when the guard is doing its job."
//
// The reaping arms were converted to the registry; the premise arm kept a trailing kill and was missed.
// Measured 2026-08-26 by forcing its final assertion red: one run, one stranded SIGTERM-immune process,
// zero before and one after. A real specimen was found on this box the same morning — orphaned to init,
// its own temp directory already deleted, so the owning run had exited cleanly and left it. 3h53m old.
//
// A SEPARATE SET FROM reap-fixture.mjs's registry, deliberately: the reaping arms assert on what
// `reapNow()` returns (`length === 2` is one of them), so registering every child there would change a
// count those arms are reading as a fact. This net kills; it does not report.
const SPAWNED = new Set();

/**
 * Kill what this file spawned. Sync, so the `exit` handler can use it — an exit handler cannot await.
 *
 * `only` EXISTS BECAUSE ITS ABSENCE HID THE WIRING. The arm below drives this function directly, and
 * with no argument it swept the WHOLE set — including a fixture an earlier red had stranded. Deleting
 * the `after`/`exit` wiring then changed nothing observable: that arm was quietly doing the net's job
 * mid-file, so the child-run arm found no survivor and passed. A control satisfied by a different path
 * is not a control. Scoped, the full sweep is reached only by the wiring, which is the thing under test.
 */
function reapSpawned(only = null) {
  const killed = [];
  for (const pid of (only ?? SPAWNED)) {
    try { process.kill(pid, "SIGKILL"); killed.push(pid); } catch { /* already gone */ }
    SPAWNED.delete(pid);
  }
  return killed;
}

/** A process that ignores SIGTERM exactly as both real fixtures do. Unref'd: it must not hold this run open. */
function immuneChild() {
  const dir = mkdtempSync(join(tmpdir(), "reap-ready-"));
  READY_FLAGS.add(dir);
  const flag = join(dir, "ready");
  const c = spawn(process.execPath, ["-e",
    // handler FIRST, flag SECOND — the order is the guarantee, not an implementation detail
    "process.on('SIGTERM',()=>{});require('fs').writeFileSync(process.argv[1],'1');setInterval(()=>{},1<<30);",
    flag], { stdio: "ignore" });
  c.unref();
  // BEFORE the caller can assert anything. Registration after the first assertion is registration that
  // a red skips, which is the shape being fixed.
  SPAWNED.add(c.pid);
  c.readyFlag = flag;
  return c;
}

/**
 * Wait until the child has installed its handler, or say it never did. Returns true/false — the caller
 * turns false into a SETUP failure, never into a finding about signals: an arm whose fixture could not
 * build the state it exists to test has proved nothing.
 */
// USED BY THE PREMISE ARM AND NOT BY THE REAPING ARMS, deliberately. Those reap with SIGKILL, which is
// not handler-dependent: a child that has forked but not yet run its script dies just the same, and
// their assertions are `alive === false` either way. Adding a readiness wait there would be latency
// bought to satisfy a symmetry no arm needs — the same "manufactures work it does not need" this tree
// already refuses elsewhere.
async function ready(c, boundMs = 5000) {
  const until = Date.now() + boundMs;
  while (Date.now() < until) {
    if (existsSync(c.readyFlag)) return true;
    await new Promise((r) => setTimeout(r, 5));
  }
  return false;
}
// `after` covers a failed assertion and a rejected arm; the `exit` handler covers the paths it does not
// — an uncaught throw, a --test-timeout, Ctrl-C. Both, because either alone leaves a hole.
after(() => { reapSpawned(); for (const d of READY_FLAGS) rmSync(d, { recursive: true, force: true }); });
// WRAPPED, NOT PASSED BY NAME. `exit` hands its listener the exit CODE, which giving `reapSpawned` an
// argument turned into `for (const pid of 0)` — a throw inside the exit handler, and the file reported
// `exitCode: 1` with all ten arms green. Adding a parameter to a function silently re-aimed every
// callback that passed it by name.
process.on("exit", () => reapSpawned());

// ── AND `alive` IS NOT `RUNNING` EITHER — THE MIRROR OF THE SAME DEFECT, IN THE ARMS THAT REAP ───
//
// The reaping arms sent SIGKILL, waited a FIXED 250ms and asserted `alive(pid) === false`. That is a
// load meter wearing an assertion's clothes, and it reddened inside a full-suite run on 2026-08-26 —
// the second occurrence of the shape, which the tripwire on tracker issue 1847 says to DRIVE rather than re-run.
//
// Driven at a 1ms settle under load average 27: 24 of 25 runs failed, 58 arm failures, all three
// reaping arms — against 0 of 25 at the shipped 250ms. Then measured directly, 40 trials, SIGKILL and
// poll until the pid is gone:
//
//     never gone within 5s : 0        <- a REAL reap failure would land here
//     ms until gone        : min 3, median 5, max 150
//     over 1ms             : 40 of 40
//     1ms after the kill   : 40 still "alive" — 32 of them ZOMBIE (dead, parent has not wait()ed)
//
// So the reap never failed, not once. `process.kill(pid, 0)` succeeds on a process that is dead and
// waiting to be reaped by its parent, and it succeeds again in the window before the kernel has torn a
// SIGKILLed process down. `alive(pid)` answers "does this pid exist"; the arms need "has it gone". A
// fixed settle turns the gap between those into a pass or a fail depending on how busy the box is —
// which is how a green here can mean nothing at all, the direction that matters more than the red.
//
// THE EXEMPTION ABOVE WAS RIGHT AND INCOMPLETE. It reasoned that SIGKILL is not handler-dependent, so
// these arms need no readiness wait — true, and the measurements above never contradict it. It reasoned
// about whether the child would DIE. The arms assert that its PID IS GONE, and that needs the parent's
// wait() to have run, which no property of the signal guarantees.
//
// 5s against a measured 150ms maximum: a bound, not a settle. Exceeding it is a real finding, and the
// message says how long it actually waited so a future reader gets the measurement rather than a guess.
const GONE_BOUND_MS = 5000;

/** Wait until the pid is gone, up to a bound. Returns how long it took, or null if it never went. */
async function goneWithin(pid, boundMs = GONE_BOUND_MS) {
  const t0 = Date.now();
  while (Date.now() - t0 < boundMs) {
    if (!alive(pid)) return Date.now() - t0;
    await new Promise((r) => setTimeout(r, 1));
  }
  return null;
}

/** Assert a reaped pid actually went, and say what was observed when it did not. */
async function assertGone(pid, what) {
  const ms = await goneWithin(pid);
  assert.notEqual(ms, null,
    `${what} — still present ${GONE_BOUND_MS}ms after its owner's reap. This is a bound, not a settle: `
    + "SIGKILL to pid-gone measured 3-150ms under load, so exceeding it is a reap that did not happen, "
    + "not a slow box.");
}


const scratch = async (fn) => {
  const dir = mkdtempSync(join(tmpdir(), "reap-1847-"));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test("#1847 SIGTERM does not reap these fixtures — which is why the owner must escalate", async () => {
  await scratch(async () => {
    const c = immuneChild();
    // READY, NOT MERELY ALIVE. `alive` was here and it is the wrong question: it says the pid exists,
    // and this arm needs the SIGTERM handler to exist. A fixture that has forked but not yet run its
    // script satisfies the first and fails the second, and SIGTERM then kills it on the default
    // disposition — which is how this arm reported the issue's own premise as false on a busy box.
    //
    // A miss is a SETUP failure and says so. An arm whose fixture never reached the state it exists to
    // test has proved nothing about signals, and reporting that as a premise failure sends the reader
    // to rewrite the issue instead of the fixture.
    assert.ok(await ready(c),
      "the fixture never installed its SIGTERM handler within the bound — that is a setup failure, not a "
      + "finding about SIGTERM, and nothing below it can be read as one");
    assert.ok(alive(c.pid), "the fixture must be running before this proves anything");
    try { process.kill(c.pid, "SIGTERM"); } catch { /* nothing to catch */ }
    await settle(400);
    // THE SELF-TEST HOOK, and it is here rather than anywhere else on purpose: this is the arm whose red
    // stranded a process, so this is the red the wiring arm has to reproduce. Set only by that arm, in a
    // child run. In every ordinary run the condition is absent and this reads exactly as it did.
    assert.ok(alive(c.pid) && !process.env.REAP_1847_FORCE_PREMISE_RED,
      "SIGTERM left it running — this is the premise of the whole issue, and if it ever stops being "
      + "true this file's other arms are asserting something easier than they claim");
    try { process.kill(c.pid, "SIGKILL"); } catch { /* done */ }
  });
});

test("#1847 the readiness flag is written AFTER the handler — the order IS the guarantee", () => {
  // The flag means "this child ignores SIGTERM". It means that only because the handler is installed
  // first. Reverse the two and readiness becomes a second `alive` — true before the property it claims
  // to certify is true — and the arm above goes back to reporting load as a premise failure, silently,
  // because on a quiet box the reversed order still passes every time.
  //
  // Asserted on the child's own source rather than by driving it: the failure this pins is a REORDERING,
  // and a reordered child is only wrong on a machine slow enough to catch it — which is precisely the
  // machine no arm can summon on demand.
  const src = readFileSync(join(HERE, "a-signal-immune-fixture-is-reaped-by-its-owner.test.mjs"), "utf8");
  const line = src.split("\n").find((l) => l.includes("process.on('SIGTERM'") && l.includes("writeFileSync"));
  assert.ok(line, "the child's -e source must install the handler and write the flag on ONE line, so the "
    + "order is readable in one place rather than inferred across two");
  assert.ok(line.indexOf("process.on('SIGTERM'") < line.indexOf("writeFileSync"),
    "the flag is written BEFORE the handler is installed — readiness would then certify nothing, and the "
    + "premise arm would be back to timing the box: " + line.trim().slice(0, 120));
});

test("#1847 a BARE-PID pidfile is reaped — the shape mock-claude-spew-immune writes", async () => {
  await scratch(async (dir) => {
    const c = immuneChild();
    const f = join(dir, "spew.pid");
    writeFileSync(f, String(c.pid));
    reapPidfile(f);
    await settle();
    // THE PARSE THAT LOOKED CORRECT AND REAPED NOTHING: `JSON.parse("12345")` succeeds and returns a
    // NUMBER, so a JSON-first reader takes that branch, `Object.values(12345)` gives `[]`, and the
    // function returns no pids while appearing to have read the file. Driving it against a real
    // immune child is what showed it.
    const killed = reapNow();
    nonEmpty(killed, "the bare-pid file yielded no pids — the reaper parsed nothing and said nothing");
    await assertGone(c.pid, "the bare-pid fixture survived its owner's reap");
  });
});

test("#1847 a JSON pidfile is reaped WHOLE — the tree and its grandchild, the shape mock-hang-tree writes", async () => {
  await scratch(async (dir) => {
    const parent = immuneChild(), grand = immuneChild();
    const f = join(dir, "tree.json");
    writeFileSync(f, JSON.stringify({ pid: parent.pid, grandPid: grand.pid, escapeePid: null }));
    reapPidfile(f);
    await settle();
    assert.equal(reapNow().length, 2, "both pids in the file must be reaped — the pair is the point");
    await assertGone(parent.pid, "the tree survived");
    await assertGone(grand.pid,
      "the grandchild survived — this is the twin a partial cleanup leaves behind, and the half that "
      + "makes a dirty box look clean");
  });
});

test("#1847 a pidfile the fixture never wrote is not an error — it means nothing was spawned", async () => {
  await scratch(async (dir) => {
    reapPidfile(join(dir, "never-written.pid"));
    assert.deepEqual(reapNow(), [], "an unspawned fixture must reap silently, never throw at teardown");
  });
});

test("#1847 registration happens BEFORE the fixture can start, in both owning tests", () => {
  // The defect was not a missing reap; it was a reap that opened too late. `engine-overflow-cap` reaped
  // in a `finally` whose try begins AFTER the awaited turn and AFTER the pidfile read, so a rejected
  // turn skipped it. `engine.anthropic`'s hang-tree arm reaped nothing at all.
  // ANCHORED ON THE FIXTURE BINDING, not on the call that runs the turn. The first cut anchored on
  // `await run(` in engine.anthropic — a helper that arm shares with two dozen others — so it compared
  // the registration against a call site 11,000 characters earlier in an unrelated test and failed for
  // a reason that had nothing to do with the subject. The binding that points the engine at the immune
  // fixture is the moment the fixture becomes spawnable, and it is unique in each file.
  for (const [file, spawner] of [
    ["engine-overflow-cap.test.mjs", "CLEAROTRON_CLAUDE_PATH: SPEW"],
    ["engine.anthropic.test.mjs", "mock-hang-tree.mjs"],
  ]) {
    const src = readFileSync(join(HERE, file), "utf8");
    const reg = src.indexOf("reapPidfile(");
    const spawnAt = src.indexOf(spawner);
    assert.ok(reg > 0, `${file} does not register its pidfile for reaping`);
    assert.ok(spawnAt > 0, `${file} no longer contains ${spawner} — this arm is checking a stale shape`);
    assert.equal(src.indexOf(spawner), src.lastIndexOf(spawner),
      `${spawner} is no longer unique in ${file}, so this comparison is against an arbitrary one of several`);
    assert.ok(reg < spawnAt,
      `${file} registers its pidfile AFTER the fixture can start (${reg} vs ${spawnAt}) — every path `
      + "between those two points leaks, which is the defect this issue is about");
  }
});

test("#1847 the ARM'S OWN fixtures are reaped, including on the path that leaked while writing this", async () => {
  // WRITTEN AFTER LEAKING THREE OF THEM. Driving this module by hand stranded three SIGTERM-immune
  // processes on the shared box in twenty minutes — and the `pgrep` I checked with reported CLEAN,
  // because its pattern was mis-escaped and matched nothing. A leak check that cannot match its own
  // subject is the defect one level up: not a bad reap, a search that never looked at the thing.
  //
  // So this arm reaps through the registry rather than through a hand-written command, and asserts the
  // process is gone rather than asserting a pattern found nothing.
  await scratch(async (dir) => {
    const c = immuneChild();
    const f = join(dir, "own.pid");
    writeFileSync(f, String(c.pid));
    reapPidfile(f);
    await settle();
    reapNow();
    await assertGone(c.pid,
      "this file leaked its own fixture — the check must be the process's liveness, never a grep whose "
      + "empty result is indistinguishable from a pattern that matches nothing");
  });
});

test("#1847 the net is installed at import, so a test that forgets to call reapNow is still covered", () => {
  const src = readFileSync(join(HERE, "reap-fixture.mjs"), "utf8");
  assert.match(src, /process\.on\("exit", reapNow\)/,
    "the exit handler is what covers a failed assertion, a --test-timeout and an uncaught throw");
  assert.match(src, /for \(const sig of \["SIGINT", "SIGTERM", "SIGHUP"\]\)/, "and Ctrl-C");
  // WHAT NOTHING CAN COVER, said out loud rather than implied: the runner itself being SIGKILLed runs
  // no in-process handler. That case leaks, and a design claiming otherwise would be lying.
  assert.match(src, /the runner itself being SIGKILLed/,
    "the module must state the one path it cannot own — an unstated limit reads as a covered one");
});

// THE ARM FOR THE LEAK THIS FILE HAD WHILE ASSERTING NOBODY ELSE MAY HAVE IT.
//
// The premise arm's cleanup used to be a bare SIGKILL written after its assertions, so a red threw past
// it and stranded the child — the exact defect #1847 exists for, in the file that exists to prevent it.
// Proved by forcing that arm red: zero stranded before, one after.
//
// This drives the net rather than reading the source for it. A source-shaped arm would pass over a net
// that was installed and broken.
//
// TWO ARMS, BECAUSE ONE OF THEM WAS NOT ENOUGH AND SAYING SO IS THE POINT. The first drives the net as a
// FUNCTION. Measured: it stays green when `reapSpawned` is deleted from the `after` hook and the `exit`
// handler — a net that exists and is wired to nothing passes it. That is a guard that must be remembered,
// which is not a guard. The second runs this file as a CHILD PROCESS with the premise arm forced red and
// counts what survives, which is the only arm that can see the wiring.
test("#1900 a child is registered at birth, so an arm that throws before its cleanup strands nothing", async () => {
  const c = immuneChild();
  assert.ok(await ready(c), "the fixture never became ready — a setup failure, nothing below proves anything");
  assert.ok(alive(c.pid), "the fixture must be running, or the reap below proves nothing");

  // No explicit kill anywhere: this is the path a thrown assertion takes. The net is the only thing
  // between this child and the 2.7 days in the issue title.
  // SCOPED to this arm's own child. Sweeping the whole set here is what masked the wiring — see the
  // note on `reapSpawned`.
  const killed = reapSpawned([c.pid]);
  nonEmpty(killed, "the net returned no pids — a net that kills nothing reports exactly as one that "
    + "had nothing to kill, which is the empty-result-is-not-evidence failure this file already carries");
  assert.ok(killed.includes(c.pid), `the net did not carry this child: ${killed.join(", ")}`);
  await assertGone(c.pid, "a child registered at birth was not reaped by the net");
});

test("#1900 a RED arm strands nothing — driven as a child run, because the wiring is invisible from inside", async () => {
  // The child sets this too, and must not recurse: it would spawn a run that spawns a run.
  if (process.env.REAP_1847_FORCE_PREMISE_RED) return;

  // Its own TMPDIR, so "did anything survive" is answerable EXACTLY rather than by a pattern over the
  // whole box. Counting by pattern is what reported clean while eight of these were running (#1900).
  const home = mkdtempSync(join(tmpdir(), "reap-childrun-"));
  try {
    // NODE_TEST_CONTEXT MUST NOT TRAVEL. node's runner sets it in the process it forks, and inheriting it
    // makes the grandchild believe it is already a test child: it exits 0 in ~80ms having run nothing, and
    // the arm reads that as "the red did not happen". Found by running the same command by hand, which
    // reddened properly — the difference was the environment, not the command.
    const env = { ...process.env, TMPDIR: home, REAP_1847_FORCE_PREMISE_RED: "1" };
    delete env.NODE_TEST_CONTEXT;
    const run = spawn(process.execPath, ["--test", fileURLToPath(import.meta.url)], { env, stdio: "ignore" });
    const code = await new Promise((r) => run.on("exit", r));
    assert.notEqual(code, 0,
      "the child run passed — the forced-red hook did not fire, so this arm proved nothing about a red");

    // Survivors are processes whose command line names THIS run's temp home. Read by process, never by
    // a pattern over process names.
    const survivors = [];
    // THE SET IS ASSERTED BEFORE IT IS WALKED (#1010). A reader that could not look yields no pids,
    // `survivors` stays `[]`, and the assertion below passes while having examined NOTHING — a clean
    // scan and a scan that never happened are the same bytes. This process is itself in that listing,
    // so an empty one is a broken instrument, never a quiet all-clear.
    //
    // Refs tracker issue 2099: this read `readdirSync("/proc")` and died `ENOENT` on the first macOS
    // run this repository ever had. `processTable()` keeps the distinction the assertion depends on —
    // `null` is could-not-look, never an empty box.
    for (const proc of nonEmpty(processTable(),
      "the process table could not be read — this very process is in it, so the reader has broken, and "
      + "the survivor check would have reported a clean box without looking at a single process")) {
      if (proc.cmd.includes(home)) survivors.push(proc.pid);
    }
    for (const pid of survivors) { try { process.kill(pid, "SIGKILL"); } catch { /* going anyway */ } }
    assert.deepEqual(survivors, [],
      `a red arm stranded ${survivors.length} SIGTERM-immune process(es): ${survivors.join(", ")}. That is `
      + "the defect #1847 was raised for, in the file that exists to prevent it — a cleanup written after "
      + "an assertion is a cleanup a red skips.");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
