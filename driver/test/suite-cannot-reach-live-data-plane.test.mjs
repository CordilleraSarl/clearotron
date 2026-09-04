// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE SUITE REFUSES TO START WHEN IT IS POINTED AT A LIVE DATA PLANE.
//
// The incident: a suite run launched with a box `.env` sourced put the LIVE data-plane paths into the
// unit tests. The enqueue-exercising tests wrote REAL jobs into the real queue, an armed driver claimed
// them, and two full fixture clearances were running — four live model stages — before anything
// objected. The containment tripwire DID fire, as one red line among 207, after the fact. This file
// covers the difference between a receipt and a guard, so the property under test is not "it noticed"
// but "the child never started".
//
// EVERY TEST HERE SPAWNS THE REAL WRAPPER. There is no unit-testable seam: the thing being asserted is
// what `scripts/test-run.mjs` does to a child's environment before spawning it, so a test that imported
// a helper and checked its return value would be testing something the suite does not run through.
//
// THE NEGATIVE TESTS CARRY A VOID CONTROL. "A contained path runs normally" passes just as happily
// against a wrapper with the guard deleted, so on its own it is worth nothing. The control is
// `refuses every one of the names it claims to watch` — delete the guard, or let the derived name list
// go empty, and that test fails while the negatives stay green.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";


const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUNNER = join(ROOT, "scripts", "test-run.mjs");
const SENTINEL = "THE-CHILD-EXECUTED";

/** The three data-plane variables under BOTH spellings, derived the way the guard derives them. */
const WATCHED = [...new Set(
  ["CLEAROTRON_QUEUE_DIR", "CLEAROTRON_REPORTS_DIR", "CLEAROTRON_WORK_DIR"].flatMap((n) => [n, n]),
)];

/**
 * Run the wrapper over a child that announces itself. `vars` are applied on top of a base environment
 * with every watched name CLEARED, so the ambient shell of whoever runs this suite cannot decide the
 * result — the incident was an ambient shell.
 */
function runWrapper(vars, { child = `console.log(${JSON.stringify(SENTINEL)})` } = {}) {
  const env = { ...process.env };
  for (const n of WATCHED) delete env[n];
  delete env.CT_ALLOW_LIVE_DATA_PLANE;
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete env[k]; else env[k] = v;
  }
  const r = spawnSync(process.execPath, [RUNNER, process.execPath, "-e", child], {
    cwd: ROOT, env, encoding: "utf8",
  });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "", all: (r.stdout ?? "") + (r.stderr ?? "") };
}

// ── the refusal ─────────────────────────────────────────────────────────────────────────────────────

test("#1243 a live data-plane path REFUSES, and the child never executes", () => {
  const r = runWrapper({ CLEAROTRON_QUEUE_DIR: "/srv/prelim/queue" });
  assert.equal(r.code, 1, "a refusal that exits 0 is not a refusal");
  assert.match(r.err, /REFUSING TO RUN/);
  // The property is pre-test, not post-hoc: a nonzero exit alone is exactly what the tripwire already
  // gave us, AFTER the jobs were enqueued. What makes this a guard is that nothing downstream ran.
  assert.ok(!r.all.includes(SENTINEL), "the child ran — this is a receipt, not a guard");
});

test("#1243 the refusal names the offending variable AND its value's root", () => {
  const r = runWrapper({ CLEAROTRON_QUEUE_DIR: "/srv/prelim/queue" });
  assert.match(r.err, /CLEAROTRON_QUEUE_DIR/, "a refusal that does not name the variable teaches nothing");
  assert.match(r.err, /\/srv\/prelim\/queue/, "the value the operator actually set");
  assert.match(r.err, /root:\s*\/srv/, "the root is what says 'this is a live estate' at a glance");
});

test("#1243 the home-directory shape the incident actually had is refused", () => {
  // DERIVED FROM homedir, not written as a literal, for two reasons that point the same way.
  // forbids a specific account's home in executable code — it is wrong under every other service
  // account and in every public clone, and that guard caught this test when it was a literal. And the
  // derived form is the truer assertion anyway: `join(homedir(), "trademark", "workspace")` IS what an
  // unset CLEAROTRON_WORK_DIR resolves to, so this exercises the exact path the incident's box had
  // rather than a stand-in that resembles it.
  const live = join(homedir(), "trademark", "workspace");
  const r = runWrapper({ CLEAROTRON_WORK_DIR: live });
  assert.equal(r.code, 1, `the box user's own working estate was not refused: ${live}`);
  assert.match(r.err, /CLEAROTRON_WORK_DIR/);
  assert.ok(!r.all.includes(SENTINEL), "the child ran against a live workspace root");
});

// ── the void control: the negatives below are worthless without this one ────────────────────────────

test("#1243 VOID CONTROL — every name the guard claims to watch actually refuses", () => {
  assert.ok(WATCHED.length >= 3,
    `the derived name list collapsed to ${WATCHED.length} — a rename left this guard watching nothing`);
  // Named one at a time rather than counted, so a name dropping out of the wrapper's list fails here
  // instead of quietly reducing what the negatives below cover. closed the compatibility window,
  // so there is one spelling per variable and this list is the whole data plane.
  for (const n of ["CLEAROTRON_QUEUE_DIR", "CLEAROTRON_REPORTS_DIR", "CLEAROTRON_WORK_DIR"])
    assert.ok(WATCHED.includes(n), `${n} is not watched`);

  for (const name of WATCHED) {
    const r = runWrapper({ [name]: "/srv/live/estate" });
    assert.equal(r.code, 1, `${name} did not refuse`);
    assert.match(r.err, new RegExp(name), `${name}'s refusal did not name it`);
    assert.ok(!r.all.includes(SENTINEL), `${name}: the child executed anyway`);
  }
});

// ── what must still run ─────────────────────────────────────────────────────────────────────────────

test("#1243 a contained path runs normally", () => {
  const r = runWrapper({ CLEAROTRON_QUEUE_DIR: "/tmp/contained-queue" });
  assert.equal(r.code, 0, r.err.slice(-800));
  assert.ok(r.all.includes(SENTINEL), "the guard refused correct work — the expensive direction");
});

test("#1243 an unset queue dir falls back INSIDE the run root, never to a live path", () => {
  const r = runWrapper({}, { child: "console.log('Q=' + process.env.CLEAROTRON_QUEUE_DIR)" });
  assert.equal(r.code, 0, r.err.slice(-800));
  const q = /Q=(\S+)/.exec(r.out)?.[1];
  assert.ok(q, `the child did not report the value: ${r.out}`);
  assert.match(q, /ct-testrun-/, "the queue dir is not inside this run's own temp root");
  assert.ok(!q.startsWith("/home/"), "unset fell back to a home path — #1243 acceptance 2");
});

test("#1243 an EMPTY queue dir is unset, not a configured live path (#1216's shape)", () => {
  // `X=` in an EnvironmentFile means "not configured". An empty string reaching a `||` default is the
  // defect is filed for; here it must land in the run root like any other unset.
  const r = runWrapper({ CLEAROTRON_QUEUE_DIR: "" }, { child: "console.log('Q=' + process.env.CLEAROTRON_QUEUE_DIR)" });
  assert.equal(r.code, 0, r.err.slice(-800));
  assert.match(/Q=(\S+)/.exec(r.out)?.[1] ?? "", /ct-testrun-/);
});

test("#1243 the wrapper sets NO workspace root — pre-setting either spelling splits the run", () => {
  // MEASURED, not preferred: setting one took the driver suite from 0 red to 7 (runner claim, takeover
  // and jx families). The runner tests build child envs from process.env and inject CLEAROTRON_WORK_DIR,
  // so a legacy value pre-set here arrives beside a disagreeing current one and the run derives the root
  // two ways. Pre-setting the current spelling instead would make the wrapper win over a test's
  // deliberate value. While the compat window is open, neither spelling is safe to pre-set — the unset
  // fallthrough is defect 1 and is fixed there, not here.
  const r = runWrapper({}, {
    child: "console.log('WS=' + (process.env.CLEAROTRON_WORK_DIR ?? '<unset>')"
         + " + ' NEW=' + (process.env.CLEAROTRON_WORK_DIR ?? '<unset>'))",
  });
  assert.equal(r.code, 0, r.err.slice(-800));
  assert.match(r.out, /WS=<unset>/, "the wrapper pre-set a legacy workspace root — this splits the runner suite");
  assert.match(r.out, /NEW=<unset>/, "the wrapper pre-set a current-spelling workspace root — it would override a test's own value");
});

test("#1243 CLEAROTRON_REPORTS_DIR is deliberately NOT given a temp default", () => {
  // It has no default by design and refuses when unset — acceptance 2's other arm, already
  // satisfied by the config. Handing it a temp value here would silently delete that coverage.
  const r = runWrapper({}, { child: "console.log('POOL=' + (process.env.CLEAROTRON_REPORTS_DIR ?? '<unset>'))" });
  assert.equal(r.code, 0, r.err.slice(-800));
  assert.match(r.out, /POOL=<unset>/, "the wrapper handed the pool a default and defeated #774's refusal");
});

// ── the way through, and why it cannot be quiet ─────────────────────────────────────────────────────

test("#1243 the override lets a live path through and SAYS SO", () => {
  const r = runWrapper({ CLEAROTRON_QUEUE_DIR: "/srv/prelim/queue", CT_ALLOW_LIVE_DATA_PLANE: "1" });
  assert.equal(r.code, 0, r.err.slice(-800));
  assert.ok(r.all.includes(SENTINEL), "the named override did not let the run through");
  assert.match(r.err, /CT_ALLOW_LIVE_DATA_PLANE IS SET/, "a bypass nobody can see is the incident again");
  assert.match(r.err, /CLEAROTRON_QUEUE_DIR=\/srv\/prelim\/queue/, "the warning must name what it let through");
});

test("#1243 the override must be set to something — an empty value is not consent", () => {
  const r = runWrapper({ CLEAROTRON_QUEUE_DIR: "/srv/prelim/queue", CT_ALLOW_LIVE_DATA_PLANE: "" });
  assert.equal(r.code, 1, "an empty override waved a live data plane through");
  assert.ok(!r.all.includes(SENTINEL));
});
