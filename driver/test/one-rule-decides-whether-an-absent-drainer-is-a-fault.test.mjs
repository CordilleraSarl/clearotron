// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// tracker issue 206 — TWO ARMS OF ONE REPORT DISAGREEING ABOUT ONE BOX.
//
// Measured on `c6e183d` while closing tracker issue 109: `live-surface-check` printed, in the same run,
// that `clearotron-worker.service` is enabled and drains continuously so the .path/timer posture is
// retired here — and that an absent drainer is a fault under the timer-era rule. One arm had read the
// units; the other had not looked at all and applied the rule anyway.
//
// The ruling (overwatch, 2026-09-06) is one rule, printed: the check reads the box's posture, calls an
// absent drainer a fault where draining is continuous, calls it normal where the timer posture is live,
// and says which posture it read either way.
//
// WHY THE PURE ARMS AND THE DRIVEN ONE ARE BOTH HERE. The two branches that matter cannot be produced by
// a probe on a healthy box — a box either drains continuously or it does not — so the decision is
// exercised pure. But a verdict nobody feeds is the defect this repository keeps finding, so the last
// arm drives the real script and reads the line it prints.
import test from "node:test";
import assert from "node:assert/strict";
import { drainerVerdict, writeDrainerStamp, STAMP_BASENAME } from "../drainer-identity.mjs";
import { drainPosture, absentDrainerIsNormal, CONTINUOUS, SCHEDULED, NONE, UNKNOWN } from "../drain-posture.mjs";
import { queueWatchVerdict } from "../queue-watch-verdict.mjs";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const DRIVER = dirname(dirname(fileURLToPath(import.meta.url)));
const src = (f) => readFileSync(join(DRIVER, f), "utf8");

// DERIVED, NEVER A LITERAL HOME. The arm named `no executable line names a specific account's home directory`
// refuses a `/home/<user>/` written into code, and it is right to: a fixture path that names one
// operator's account is wrong under every other service account and in every public clone. These are
// only ever compared as strings, so where they live is immaterial — but the shape must be the sanctioned
// one, or the next person copies the literal into somewhere it matters.
const UNITS = join(tmpdir(), "ct206-fixture", ".config", "systemd", "user");
const WORKER = join(UNITS, "clearotron-worker.service");
const TIMER = join(UNITS, "prelim-driver.timer");

const on = (unit) => ({ unit, present: true, enabled: true, error: null });
const off = (unit) => ({ unit, present: true, enabled: false, error: null });
const absent = (unit) => ({ unit, present: false, enabled: false, error: null });
const unreadable = (unit, error = "EACCES") => ({ unit, present: null, enabled: null, error });

/** A stamped drainer whose process is gone — the exact shape tracker issue 206 was measured on. */
const goneDrainer = (posture, { processes = [] } = {}) => drainerVerdict({
  stamp: { pid: 4242, engineCommit: "abcdef1234567890", pidStarttime: "9999" },
  headCommit: "abcdef1234567890",
  isAlive: () => false,
  processes,
  posture,
});

// ── THE POSTURE RULE ITSELF ─────────────────────────────────────────────────────────────────────────

test("an enabled worker is a CONTINUOUS posture, and the timer cannot change that answer", () => {
  for (const timer of [on(TIMER), off(TIMER), absent(TIMER), unreadable(TIMER), null]) {
    const p = drainPosture({ worker: on(WORKER), timer });
    assert.equal(p.kind, CONTINUOUS);
    assert.match(p.how, /clearotron-worker\.service is enabled and drains continuously/);
  }
});

test("no worker but an enabled timer is a SCHEDULED posture, and names both units", () => {
  const p = drainPosture({ worker: absent(WORKER), timer: on(TIMER) });
  assert.equal(p.kind, SCHEDULED);
  assert.match(p.how, /prelim-driver\.timer is enabled and drains on its schedule/);
  assert.match(p.how, /clearotron-worker\.service does not exist/);
});

test("both off is NONE — asked twice, and nothing drains this box at all", () => {
  const p = drainPosture({ worker: off(WORKER), timer: absent(TIMER) });
  assert.equal(p.kind, NONE);
  assert.match(p.how, /nothing drains this box at all/);
});

test("a posture that could not be read is UNKNOWN, names the read that failed, and is never normal", () => {
  const cases = [
    [{ worker: unreadable(WORKER), timer: on(TIMER) }, /clearotron-worker\.service could not be read: EACCES/],
    [{ worker: off(WORKER), timer: unreadable(TIMER) }, /prelim-driver\.timer could not be read: EACCES/],
    [{ worker: off(WORKER), timer: null }, /no timer state was supplied/],
    [{}, /no worker state was supplied/],
  ];
  for (const [posture, says] of cases) {
    const p = drainPosture(posture);
    assert.equal(p.kind, UNKNOWN, `${JSON.stringify(posture)} resolved to ${p.kind}, and an unknown posture may not resolve to either answer`);
    assert.match(p.how, says);
    assert.equal(absentDrainerIsNormal(p.kind), false);
  }
});

test("only a SCHEDULED box calls an absent drainer normal — an unknown one never does", () => {
  assert.equal(absentDrainerIsNormal(SCHEDULED), true);
  for (const kind of [CONTINUOUS, NONE, UNKNOWN]) assert.equal(absentDrainerIsNormal(kind), false);
});

// ── WHAT THE DRAINER ARM DOES WITH IT ───────────────────────────────────────────────────────────────

test("tracker issue 206 — a gone drainer on a CONTINUOUS box is the fault it is today, and says so", () => {
  const v = goneDrainer({ worker: on(WORKER), timer: null });
  assert.equal(v.state, "fail");
  assert.match(v.message, /IS GONE: nothing is executing runs on this box/);
  assert.match(v.message, /Drain posture continuous: .*clearotron-worker\.service is enabled/);
});

test("tracker issue 206 — a gone drainer on a SCHEDULED box is the resting state, not a fault", () => {
  const v = goneDrainer({ worker: absent(WORKER), timer: on(TIMER) });
  assert.equal(v.state, "pass", `a box that drains on ${TIMER} has no drainer between ticks: ${v.message}`);
  assert.match(v.message, /the resting state, not a fault/);
  assert.match(v.message, /next tick starts a fresh process off the checkout/);
  assert.match(v.message, /Drain posture scheduled: .*prelim-driver\.timer is enabled/);
  assert.doesNotMatch(v.message, /IS GONE/);
});

test("tracker issue 206 — a gone drainer where NOTHING drains is a fault, and names that", () => {
  const v = goneDrainer({ worker: off(WORKER), timer: off(TIMER) });
  assert.equal(v.state, "fail");
  assert.match(v.message, /Drain posture none: .*nothing drains this box at all/);
});

test("tracker issue 206 — an UNPROBED posture keeps the failure, and says the posture was not probed", () => {
  for (const posture of [null, {}, { worker: unreadable(WORKER) }]) {
    const v = goneDrainer(posture);
    assert.equal(v.state, "fail", `an unreadable posture must not be talked into a pass: ${v.message}`);
    assert.match(v.message, /IS GONE/);
    assert.match(v.message, /Drain posture unknown: it was NOT probed/);
  }
});

test("a stray drainer is still reported on a SCHEDULED box — the posture excuses the absence and nothing else", () => {
  const v = goneDrainer({ worker: absent(WORKER), timer: on(TIMER) },
    { processes: [{ pid: 77, cmd: "node /home/x/driver/runner.mjs --watch" }] });
  assert.equal(v.state, "warn", `an unstamped second drainer holds a build nothing can name: ${v.message}`);
  assert.match(v.message, /ALSO RUNNING AND UNACCOUNTED FOR/);
  assert.match(v.message, /pid 77/);
});

test("an absent STAMP is a failure under EVERY posture — no box's resting state is having never stamped", () => {
  const postures = [
    ["continuous", { worker: on(WORKER) }],
    ["scheduled", { worker: absent(WORKER), timer: on(TIMER) }],
    ["none", { worker: off(WORKER), timer: off(TIMER) }],
    ["unknown", null],
  ];
  for (const [kind, posture] of postures) {
    const v = drainerVerdict({ stamp: null, headCommit: "abc", isAlive: () => true, processes: [], posture });
    assert.equal(v.state, "fail", `no stamp read as ${v.state} under a ${kind} posture — a scheduled box that has drained once has a stamp from that tick`);
    assert.match(v.message, /This is a failure to look, never a pass\./);
    assert.match(v.message, new RegExp(`Drain posture ${kind}:`), `the ${kind} branch did not say which posture it read`);
  }
});

test("the posture cannot rescue any OTHER finding — a live drainer on the wrong commit still fails", () => {
  for (const posture of [{ worker: on(WORKER) }, { worker: absent(WORKER), timer: on(TIMER) }, null]) {
    const v = drainerVerdict({
      stamp: { pid: 9, engineCommit: "1111111111", pidStarttime: "1" },
      headCommit: "2222222222", isAlive: () => true, processes: [], posture,
    });
    assert.equal(v.state, "fail", "a drainer holding a stale build is a finding under any drain path");
    assert.match(v.message, /THE EXECUTING PROCESS IS NOT ON THE DEPLOYED COMMIT/);
  }
});

// ── ONE RULE, NOT TWO ───────────────────────────────────────────────────────────────────────────────

test("tracker issue 206 — the queue arm and the drainer arm read ONE rule about the same box", () => {
  // The same worker answer, handed to both. This is the arm the issue is actually about: before it, the
  // queue arm called this box's timer posture retired in the same report that called an absent drainer a
  // timer-era fault. If a later edit re-spells either predicate, they part company here.
  const worker = on(WORKER);
  const queue = queueWatchVerdict({ queueDirs: ["/q"], watched: [], unitPath: "/u/prelim-driver.path", worker, timer: null });
  assert.equal(queue.state, "pass");
  assert.match(queue.message, /drains continuously/);

  const drainer = goneDrainer({ worker, timer: null });
  assert.equal(drainer.state, "fail");
  assert.match(drainer.message, /Drain posture continuous/);

  // And the other direction: where the queue arm does NOT read a continuous worker, the drainer arm
  // must not be reading one either.
  const off1 = { unit: WORKER, present: false, enabled: false, error: null };
  assert.notEqual(queueWatchVerdict({ queueDirs: ["/q"], watched: [], unitPath: "/u/p", worker: off1, timer: on(TIMER) }).state, "pass");
  assert.equal(drainPosture({ worker: off1, timer: on(TIMER) }).kind, SCHEDULED);
});

test("tracker issue 206 — the rule exists in ONE copy, and neither consumer keeps a private one", () => {
  // The arm above proves the two agree TODAY on the input it hands them. It cannot prove there is only
  // one predicate, and "one rule, printed, not two arms disagreeing about the same box" is a property of
  // the source, not of a pair of return values — so it is read from the source, which is where a second
  // copy would reappear.
  for (const f of ["queue-watch-verdict.mjs", "drainer-identity.mjs"]) {
    const text = src(f);
    assert.match(text, /from "\.\/drain-posture\.mjs"/, `${f} decides the drain posture without consulting the shared rule`);
    const own = text.match(/worker[?.\]]*\.?\s*(?:\.|\[["']?)?enabled["'\]]?\s*===\s*true/g) ?? [];
    assert.deepEqual(own, [], `${f} spells the posture test itself (${own.join(", ")}) — that is the second copy tracker issue 206 is about`);
  }
  // And the rule's own module is the only place the predicate is written.
  assert.match(src("drain-posture.mjs"), /worker\?\.enabled === true/);
});

/**
 * Drive the REAL deploy check against a fixture box, and hand back the drainer line it printed.
 *
 * NOT A HELPER STANDING IN FOR THE SCRIPT. The finding in tracker issue 206 is that the check did not
 * read the units — an arm against the pure verdict would hold a rule nobody feeds, which is the shape
 * this repository keeps finding and repairing. `probeWorker`/`probeTimer` resolve their unit paths from
 * HOME, and `enable` is recorded as a symlink into `*.target.wants/`, so a fixture HOME is a real
 * posture as far as every read in the path is concerned.
 */
function drainerLineFor({ workerEnabled = false, timerEnabled = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ct206-"));
  try {
    const units = join(dir, "home", ".config", "systemd", "user");
    mkdirSync(join(dir, "pool"), { recursive: true });
    mkdirSync(join(dir, "ws"), { recursive: true });
    mkdirSync(join(units, "default.target.wants"), { recursive: true });
    mkdirSync(join(units, "timers.target.wants"), { recursive: true });
    const enable = (unit, wants) => {
      writeFileSync(join(units, unit), "# fixture\n");
      symlinkSync(join(units, unit), join(units, wants, unit));
    };
    if (workerEnabled) enable("clearotron-worker.service", "default.target.wants");
    if (timerEnabled) enable("prelim-driver.timer", "timers.target.wants");
    // A stamped drainer whose pid is long gone — the shape the issue was measured on.
    writeFileSync(join(dir, "ws", STAMP_BASENAME),
      JSON.stringify({ schema: 1, pid: 999_999, engineCommit: "deadbeefdeadbeef", pidStarttime: "1" }) + "\n");

    let out = "";
    try {
      out = execFileSync(process.execPath, [join(DRIVER, "..", "scripts", "live-surface-check.mjs")], {
        encoding: "utf8", timeout: 300_000,
        env: { ...process.env, HOME: join(dir, "home"), CLEAROTRON_REPORTS_DIR: join(dir, "pool"), CLEAROTRON_WORK_DIR: join(dir, "ws") },
      });
    } catch (e) { out = `${e.stdout ?? ""}${e.stderr ?? ""}`; }
    // COULD THE ARM EVEN LOOK? The check has a preflight refusal and can die on a throw, and in both
    // cases it prints no surface lines — silence that the assertions below would otherwise read as the
    // posture being missing, which is the finding this file exists to make about something else.
    assert.ok(/== live surface check —/.test(out),
      `the deploy check never reached its report, so this arm could not look at the drainer line:\n${out.slice(0, 800)}`);
    const at = out.indexOf("the process that executes runs is on the deployed commit");
    assert.notEqual(at, -1, `the deploy check ran to its report and named no drainer surface at all:\n${out.slice(0, 800)}`);
    // The line plus its message, and nothing from the surface after it.
    const line = out.slice(out.lastIndexOf("\n", at) + 1).split(/\n(?=\[)/)[0];
    return { line, out };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("tracker issue 206 — DRIVEN: the real deploy check reads the posture and prints which one it read", () => {
  const continuous = drainerLineFor({ workerEnabled: true });
  assert.match(continuous.line, /FAIL/, `a box whose worker drains continuously has no drainer, and that is the outage:\n${continuous.line}`);
  assert.match(continuous.line, /IS GONE: nothing is executing runs on this box/);
  assert.match(continuous.line, /Drain posture continuous: .*clearotron-worker\.service is enabled/);

  const scheduled = drainerLineFor({ timerEnabled: true });
  assert.doesNotMatch(scheduled.line, /FAIL/, `a box that drains on a timer has no drainer between ticks:\n${scheduled.line}`);
  assert.match(scheduled.line, /the resting state, not a fault/);
  assert.match(scheduled.line, /Drain posture scheduled: .*prelim-driver\.timer is enabled/);

  // AND THE TWO ARMS AGREE ABOUT THE SAME BOX, which is the whole issue. On the continuous run the
  // queue arm calls the timer posture retired; before this change the drainer arm applied it anyway.
  assert.match(continuous.out, /the \.path\/timer posture this arm was written for is retired on this box/);
});

test("writeDrainerStamp still names the file the verdict refuses on", () => {
  assert.equal(STAMP_BASENAME, "_drainer-identity.json");
  assert.equal(typeof writeDrainerStamp, "function");
});
