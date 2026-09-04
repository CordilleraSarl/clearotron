// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — spawns real process groups and signals them
//
// — A SERVING PROCESS GROUP OUTLIVES THE SCRIPT THAT STARTED IT.
//
// MEASURED ON THE DEV BOX, 2026-09-01: three processes from that morning's `verify-publishable` run,
// PPID 1, eighty-eight minutes old, holding 127.0.0.1:18802 and running product code out of an install
// tree that had already been deleted. A watching runner among them, so not merely idle.
//
// THE FAILURE IT PRODUCES NAMES THE WRONG CAUSE, which is why it went unfixed. The ports are fixed
// defaults, so the next run dies with EADDRINUSE — reading exactly like two jobs colliding or an
// operator with a portal open. It is neither: it is the same script's previous run, still alive. The
// issue's author reached that wrong cause from the same evidence and wrote it into a code comment.
//
// THE GAP IS THE EXIT NOBODY WROTE A BRANCH FOR. These scripts kill the group from a `finish()` helper
// called on success and on a timeout. `finish()` is not called when the SCRIPT dies — a cancelled CI
// job (SIGTERM), a Ctrl-C, or a throw elsewhere in the file — and those are exactly the exits that
// produced the orphan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, readdirSync, writeFileSync, readFileSync as rf } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pidAlive } from "./platform-caps.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

// THE HARNESS IS WRITTEN AT RUN TIME, not shipped under fixtures/. `cut-ships` refuses a test file that
// constructs a path into the withheld fixtures: on the exported tree that path does not exist, the file
// throws before a single case registers, and its tests VANISH from the count rather than fail. Writing
// the harness here keeps this arm running on the cut, which is where an orphaned process group would
// hurt most — a self-hosted runner.
const HARNESS_SRC = `
import { spawn } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
import { reapOnExit } from ${JSON.stringify(join(ROOT, "shared", "reap-on-exit.mjs"))};
const [, , mode, marker] = process.argv;
// Chrome's shape in \`sh\`: a group leader whose CHILD is what outlives a naive kill of the parent.
const child = spawn("sh", ["-c", \`sleep 120 & echo $! > \${marker}.child; wait\`], {
  stdio: ["ignore", "ignore", "ignore"], detached: true,
});
writeFileSync(\`\${marker}.group\`, String(child.pid));
reapOnExit(child);
setTimeout(() => writeFileSync(\`\${marker}.ready\`, "1"), 300);
const wait = setInterval(() => {
  if (!existsSync(\`\${marker}.go\`)) return;
  clearInterval(wait);
  if (mode === "throw") throw new Error("an unplanned throw, somewhere else in the script");
  if (mode === "exit") process.exit(0);
}, 25);
setTimeout(() => process.exit(9), 30000);
`;

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

// — THIS LINE IS WHY THE FIRST macOS NIGHTLY REDDED ALL FIVE ARMS BELOW.
//
// It read `existsSync("/proc/<pid>")`. `/proc` is a Linux filesystem, so on darwin every live pid read
// as dead, and each arm died at its own CONTROL (`:79` in that run) before a single signal was sent.
// The three arms in this file that never call this returned green in the same job — which is what
// established the fixture, not the shipped reaper, as the defect.
//
// The comment that stood here was right about the hazard and wrong about the remedy: `kill -0` answers
// EPERM for another user's pid, and a NAIVE reading of that as death is the operations runbook's
// warning. `pidAlive` reads the errno instead, so EPERM is the live answer it actually means, and it
// keeps the POSITIVE-evidence property this file needs: `null` is could-not-look and is never `false`.
const alive = (pid) => pidAlive(pid);

/**
 * Assert liveness with the could-not-look case SEPARATED OUT, at both ends of every arm.
 *
 * The trap this exists to close is specific and this file was one line from shipping it: every arm's
 * post-condition is "the grandchild is gone", and on a box that cannot answer, a `assert.ok(!alive(kid))`
 * would read `null` as gone and go GREEN while measuring nothing. On darwin that is not hypothetical —
 * it is what these five arms would have done without the control at the top of `runHarness`.
 */
function assertLiveness(pid, want, message) {
  const state = alive(pid);
  assert.notEqual(state, null,
    `${message} — but this box could not answer whether pid ${pid} is running: pidAlive() returned null, `
    + "so this arm measured nothing at all. A could-not-look is a finding, never a pass.");
  assert.strictEqual(state, want, message);
}

async function until(fn, ms = 8000) {
  const stop = Date.now() + ms;
  while (Date.now() < stop) { if (fn()) return true; await settle(50); }
  return false;
}

/** Run the harness in `mode`; return the group leader's pid and its child's. */
async function runHarness(mode, after) {
  const dir = mkdtempSync(join(tmpdir(), "reap-"));
  const marker = join(dir, "m");
  const harness = join(dir, "harness.mjs");
  writeFileSync(harness, HARNESS_SRC);
  const proc = spawn(process.execPath, [harness, mode, marker], { stdio: ["ignore", "ignore", "ignore"] });
  assert.ok(await until(() => existsSync(`${marker}.ready`) && existsSync(`${marker}.child`)),
    "the harness never came up — the arm below would be asserting about nothing");
  const group = Number(readFileSync(`${marker}.group`, "utf8").trim());
  const kid = Number(readFileSync(`${marker}.child`, "utf8").trim());
  assertLiveness(kid, true, "the CONTROL: the grandchild is running before we do anything to its parent");
  // The harness holds here until this file appears, so the control above is read while the script is
  // definitely still alive — a self-terminating mode raced it otherwise and failed for the wrong reason.
  writeFileSync(`${marker}.go`, "1");
  const code = await after(proc);
  // `=== false` strictly: a could-not-look must not end this wait as though the group had gone.
  await until(() => alive(kid) === false, 8000);
  return { group, kid, code };
}

// ── the exits nobody wrote a branch for ─────────────────────────────────────────────────────────────

test("2104 a CANCELLED script (SIGTERM) takes its detached group with it", async () => {
  // The measured case: a cancelled CI job. With no handler, SIGTERM terminates without running exit
  // handlers at all — so a reaper on `exit` alone would never fire on the one exit this issue is about.
  const { kid } = await runHarness("signal", async (proc) => {
    proc.kill("SIGTERM");
    await new Promise((r) => proc.once("exit", r));
  });
  assertLiveness(kid, false, "the grandchild outlived the cancelled script — this is the defect");
});

test("2104 a Ctrl-C (SIGINT) takes it too", async () => {
  const { kid } = await runHarness("signal", async (proc) => {
    proc.kill("SIGINT");
    await new Promise((r) => proc.once("exit", r));
  });
  assertLiveness(kid, false, "an interrupted operator leaves a server holding fixed ports");
});

test("2104 a THROW somewhere else in the script takes it", async () => {
  // Node runs `exit` handlers after an uncaught throw, so this needs no handler of its own — asserted
  // rather than assumed, because the whole design rests on it.
  const { kid } = await runHarness("throw", (proc) => new Promise((r) => proc.once("exit", r)));
  assertLiveness(kid, false, "an unrelated throw stranded the group");
});

test("2104 CONTROL: an ordinary exit still reaps, as the planned paths always did", async () => {
  const { kid } = await runHarness("exit", (proc) => new Promise((r) => proc.once("exit", r)));
  assertLiveness(kid, false, "the ordinary path must keep working, or this fix broke the normal case");
});

test("2104 the SIGTERM exit code is preserved — CI reads it to tell a cancellation from a failure", async () => {
  // A reaper that swallowed the signal and exited 0 would turn every cancelled job green, which is a
  // worse defect than the orphan: a green that means "nobody ran this".
  const { code } = await runHarness("signal", async (proc) => {
    proc.kill("SIGTERM");
    return new Promise((r) => proc.once("exit", (c, s) => r(c ?? `sig:${s}`)));
  });
  assert.equal(code, 128 + 15, `expected the shell's 128+signo convention for SIGTERM, got ${code}`);
});

test("2104 a child that exits on its own is UNWATCHED — no signalling a recycled pid", async () => {
  const { reapOnExit, watchedGroups } = await import("../../shared/reap-on-exit.mjs");
  const short = spawn("sh", ["-c", "exit 0"], { stdio: "ignore" });
  reapOnExit(short);
  assert.ok(watchedGroups().includes(short.pid), "it should be watched while it runs");
  await new Promise((r) => short.once("exit", r));
  await until(() => !watchedGroups().includes(short.pid), 3000);
  assert.ok(!watchedGroups().includes(short.pid),
    "a finished child must drop out — the OS recycles pids, and reaping a stale one signals a stranger");
  assert.doesNotThrow(() => reapOnExit(null), "a caller with no child gets a no-op, never a throw");
  assert.doesNotThrow(() => reapOnExit({}), "and so does one that hands over something odd");
});

// ── the CLASS, not the instance ─────────────────────────────────────────────────────────────────────

test("2104 EVERY detached spawn in scripts/ reaps on exit — a sixth site cannot be added silently", () => {
  // The issue asks for the shape, not the one line: "grep for other detached spawns whose kill is on a
  // success path". There were five, all with the same gap. This arm is what stops the sixth: a script
  // that detaches and does not register the reaper fails here by name, rather than being discovered
  // eighty-eight minutes into poisoning a runner.
  const dir = join(ROOT, "scripts");
  const files = readdirSync(dir).filter((n) => n.endsWith(".mjs"));
  // — a loop over a DISCOVERED set says so before walking it. An empty scripts/ would make every
  // assertion below vacuous, and this arm would go green while guarding nothing.
  assert.ok(files.length > 20, `scripts/ should hold the tree's scripts, found ${files.length}`);
  const missing = [];
  for (const f of files) {
    const src = rf(join(dir, f), "utf8");
    if (!/detached:\s*true/.test(src)) continue;
    if (!/reapOnExit\(/.test(src)) missing.push(f);
  }
  assert.deepEqual(missing, [],
    `these scripts detach a process group and never reap it when the script itself dies: ${missing.join(", ")}`);
});

test("2104 the six known sites are actually wired — the class arm must not pass on an empty set", () => {
  // The arm above is vacuously true if nothing matches `detached: true` — a refactor that renamed the
  // option would turn it green while removing every reap. This pins the population it is about.
  const dir = join(ROOT, "scripts");
  const detaching = readdirSync(dir).filter((n) => n.endsWith(".mjs"))
    .filter((n) => /detached:\s*true/.test(rf(join(dir, n), "utf8")));
  assert.ok(detaching.length >= 6,
    `expected the six known detaching scripts, found ${detaching.length}: ${detaching.join(", ")}`);
  // SIX, NOT FIVE. My own hand-grep found five; the class arm above found the sixth
  // (ai-page-render-check.mjs), which is the entire argument for writing the class arm rather than
  // listing the sites I happened to notice.
  for (const f of ["verify-publishable.mjs", "render-check.mjs", "clearances-render-check.mjs",
    "home-render-check.mjs", "composer-render-check.mjs", "ai-page-render-check.mjs"])
    assert.ok(detaching.includes(f), `${f} stopped detaching — re-check this arm rather than deleting it`);
});

// ── — THE INSTRUMENT ITSELF, DRIVEN ON BOTH BRANCHES FROM ONE BOX ───────────
//
// The arms above are only worth their green if the thing they ask is answering. The reader they now
// call has one contract and several routes into it, and the route THIS machine does not take is the
// one that redded the nightly — so every route is executed here, on whatever box is running, by
// injection. That is the discipline `shared/process-table.mjs` states for `runPs` and the reason 2099's
// fix held: a portability fix whose ported branch runs nowhere is the guess it replaced, wearing a
// passing test.

/** An error the way the kernel hands it to Node: the `code` is the whole message. */
const errnoError = (code) => Object.assign(new Error(`stub ${code}`), { code });
const killThrowing = (code) => ({ kill: () => { throw errnoError(code); } });

test("2178 pidAlive answers for a pid that IS running and one that has gone — measured, not stubbed", async () => {
  // This process is definitively alive, which makes it the one pid on the box needing no fixture.
  assert.strictEqual(pidAlive(process.pid), true,
    "the reader could not see the very process asking the question");
  const short = spawn("sh", ["-c", "exit 0"], { stdio: "ignore" });
  const gone = short.pid;
  await new Promise((r) => short.once("exit", r));
  // Polled rather than read once: between `exit` and the kernel releasing the entry there is a window
  // in which the pid is a zombie, and a zombie is CORRECTLY reported alive — it still exists.
  assert.ok(await until(() => pidAlive(gone) === false, 5000),
    `pid ${gone} exited and the reader still does not call it gone`);
});

test("2178 the ERRNO is the answer — EPERM is a LIVE process, and only ESRCH means dead", () => {
  // The distinction this whole fix turns on. `docs/architecture/06-operations-runbook.md` warns that a
  // cross-user pid "reads as dead under `kill -0`" — true of the naive form, which treats any throw as
  // death. The kernel can only REFUSE to signal a process that exists, so EPERM is positive evidence of
  // life; collapsing it into `false` is the bug the runbook is describing, not the remedy for it.
  assert.strictEqual(pidAlive(4242, killThrowing("EPERM")), true,
    "EPERM means the process exists and is not ours to signal — reading it as dead is the runbook's warning");
  assert.strictEqual(pidAlive(4242, killThrowing("ESRCH")), false,
    "ESRCH is the one answer that means no such process");
  assert.strictEqual(pidAlive(4242, { kill: () => undefined }), true,
    "a kill that returned without throwing found the process");
});

test("2178 an instrument that could not look returns null — never the `false` that reads as a pass", () => {
  // The collapse 2099 exists to stop, asserted here because THIS file is where it would do the most
  // damage: every arm above post-asserts "the group is gone", and a could-not-look scored as `false`
  // turns all five green on a box that measured nothing.
  for (const code of ["EINVAL", "ENOSYS", "EACCES", undefined])
    assert.strictEqual(pidAlive(4242, killThrowing(code)), null,
      `an unrecognised failure (${code}) must read as could-not-look, not as a dead process`);
  assert.strictEqual(pidAlive(4242, { kill: () => { throw new Error("no code at all"); } }), null,
    "an error carrying no errno is a reader that failed, and a failed reader knows nothing");
});

test("2178 a pid that cannot name a process is could-not-look, not a dead one", () => {
  // 0 and the negatives are the dangerous half: to `kill(2)` they address a process GROUP, so a probe
  // that passed them through would be asking an entirely different question of an entirely different
  // set of processes. The old `/proc` form returned `false` for all of these — an answer, about nothing.
  for (const bad of [0, -1, -process.pid, 1.5, NaN, Infinity, null, undefined, "1234"])
    assert.strictEqual(pidAlive(bad), null, `pidAlive(${String(bad)}) must refuse to answer, not answer "dead"`);
});

test("2178 the box's own init is alive — the cross-user pid the runbook warns about, on a real process", () => {
  // pid 1 exists on every box this suite runs on, and it is the runbook's case in the flesh: owned by
  // root, so an unprivileged runner gets EPERM and a privileged one gets no throw. Both are life, and
  // the arm holds either way — which is the point, since it is the naive reader that disagrees with
  // itself depending on who is running it.
  assert.strictEqual(pidAlive(1), true,
    "init is not dead; a reader that says otherwise is reading the permission, not the process");
});

test("2178 no liveness probe in driver/test/ builds a /proc path from a pid — the sixth site again", () => {
  // The class arm, in the shape this file already uses for the reaper's call sites. `/proc` is Linux's,
  // and 2099 fixed three readers that assumed otherwise; 2104 then added a fourth in a test, which is
  // how it reached a macOS nightly instead of a review. This is what stops the fifth.
  //
  // The two exemptions are NAMED WITH THEIR REASON rather than pattern-matched away, and both are
  // deliberate degradations that already say so in their own source. An exemption whose file stops
  // matching fails below rather than rotting quietly.
  // The citations for these two exemptions live HERE, in a comment, and not in the reason strings
  // below. is the birth-stamp finding; covers the discovered-set guard above. The strip
  // reaches a reference in a comment and cannot reach one inside a string literal, so a citation
  // written into the reason text ships to the public tree, where a bare #NNN linkifies to that
  // repo's unrelated issue..
  const EXEMPT = new Map([
    ["purge-runs.test.mjs",
      "writes the claim sidecar the PRODUCT reads, and the product's birth stamp is /proc on Linux "
      + "and absent elsewhere. The fixture writes the bare-pid form when it cannot read one, which is "
      + "exactly the degraded shape a macOS box produces — it is reproducing the contract, not probing."],
    ["reap-fixture.mjs",
      "checks /proc/<pid>/cmdline to avoid SIGKILLing a stranger who inherited a recycled pid. Where it "
      + "cannot look it says so and proceeds, and its header states that trade — a guard that is Linux-"
      + "only by admission, not by accident."],
  ]);
  const dir = join(ROOT, "driver", "test");
  const files = readdirSync(dir).filter((n) => n.endsWith(".mjs"));
  // — a discovered population says how big it is before anything is concluded from it.
  assert.ok(files.length > 50, `driver/test/ should hold the suite's test files, found ${files.length}`);
  const offenders = [];
  for (const f of files) {
    // The defect's shape precisely: a /proc path INTERPOLATED from a pid. Prose about /proc is how this
    // very file explains itself, and a grep that caught that would be unwriteable-around.
    if (!/`\/proc\/\$\{/.test(rf(join(dir, f), "utf8"))) continue;
    if (EXEMPT.has(f)) continue;
    offenders.push(f);
  }
  assert.deepEqual(offenders, [],
    `these test files ask /proc for a pid and are therefore blind on macOS — use pidAlive() from `
    + `platform-caps.mjs, or add a named exemption with the reason: ${offenders.join(", ")}`);
  for (const [f, why] of EXEMPT)
    assert.ok(files.includes(f) && /`\/proc\/\$\{/.test(rf(join(dir, f), "utf8")),
      `${f} no longer builds a /proc path, so its exemption is dead and should be deleted. It read: ${why}`);
});
