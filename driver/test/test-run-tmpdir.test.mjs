// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The fixture leak, pinned.
//
// On 2026-07-31 /tmp held ~300,000 fixture directories and the root filesystem hit 100%. The cause was
// volume, not any one test: 582 mkdtempSync call sites across 166 files, roughly four in five with no
// cleanup. scripts/test-run.mjs gives each run its own TMPDIR so every fixture lands in a directory the
// runner created and can therefore delete outright.
//
// These tests drive the real wrapper as a subprocess, because the whole mechanism IS the subprocess
// boundary — TMPDIR reaching the child, and cleanup surviving the child's exit. A unit test of an
// exported helper would prove neither.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readdirSync, existsSync, rmSync, mkdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const RUNNER = fileURLToPath(new URL("../../scripts/test-run.mjs", import.meta.url));

// Every case gets its own base, passed via CT_TEST_TMP_BASE, so these tests never read or write the real
// /tmp — which is the exact mistake that would make this file dangerous on a shared box.
function withBase(fn) {
  const base = mkdtempSync(join(tmpdir(), "testrun-spec-"));
  try { return fn(base); } finally { rmSync(base, { recursive: true, force: true }); }
}

const runnerEnv = (base) => ({ ...process.env, CT_TEST_TMP_BASE: base });

test("a fixture made by the child lands inside the run root, not in the ambient tmpdir", () => {
  withBase((base) => {
    const script = join(base, "child.mjs");
    writeFileSync(script, `
      import { mkdtempSync } from "node:fs";
      import { join } from "node:path";
      import { tmpdir } from "node:os";
      console.log(mkdtempSync(join(tmpdir(), "probe-")));
    `);
    const out = execFileSync("node", [RUNNER, "node", script], { encoding: "utf8", env: runnerEnv(base) }).trim();
    assert.ok(out.startsWith(join(base, "ct-testrun-")), `fixture went to ${out}, not inside a run root under ${base}`);
  });
});

test("the run root is gone when the run ends — the leak itself", () => {
  withBase((base) => {
    const script = join(base, "child.mjs");
    writeFileSync(script, `
      import { mkdtempSync } from "node:fs";
      import { join } from "node:path";
      import { tmpdir } from "node:os";
      mkdtempSync(join(tmpdir(), "probe-a-"));
      mkdtempSync(join(tmpdir(), "probe-b-"));
    `);
    execFileSync("node", [RUNNER, "node", script], { env: runnerEnv(base) });
    assert.deepEqual(readdirSync(base).filter((f) => f.startsWith("ct-testrun-")), [],
      "the run root must not survive its own run");
  });
});

test("a FAILING run still cleans up, and still reports the failure — cleanup must never mask a red suite", () => {
  withBase((base) => {
    const script = join(base, "child.mjs");
    writeFileSync(script, `
      import { mkdtempSync } from "node:fs";
      import { join } from "node:path";
      import { tmpdir } from "node:os";
      mkdtempSync(join(tmpdir(), "probe-"));
      process.exit(7);
    `);
    const r = spawnSync("node", [RUNNER, "node", script], { env: runnerEnv(base) });
    assert.equal(r.status, 7, "the child's exit code IS the result — CI reads it");
    assert.deepEqual(readdirSync(base).filter((f) => f.startsWith("ct-testrun-")), []);
  });
});

test("an abandoned root from a killed run is swept on the next run, once it is old enough", () => {
  withBase((base) => {
    const stale = join(base, "ct-testrun-STALE");
    mkdirSync(stale);
    writeFileSync(join(stale, "leftover"), "x");
    const old = new Date(Date.now() - 7 * 60 * 60 * 1000);
    utimesSync(stale, old, old);

    const fresh = join(base, "ct-testrun-FRESH");   // a CONCURRENT run's root, mtime now
    mkdirSync(fresh);

    execFileSync("node", [RUNNER, "node", "-e", "0"], { env: runnerEnv(base) });

    assert.equal(existsSync(stale), false, "a root older than the age floor is abandoned and should go");
    assert.equal(existsSync(fresh), true, "a RECENT root may belong to a run in flight — never touch it");
  });
});

// ── — WHAT SURVIVES A CANCEL ───────────────────────────────────────────────────────────────────
//
// `cancel-in-progress` fires on every superseded PR push. The runner signals the job, waits a grace, then
// SIGKILLs whatever is still alive. The wrapper's SIGINT/SIGTERM/SIGHUP handlers were written for this
// and had NO arm: they were verified by reading them. Two of the three cases below now hold them.
//
// The third is the honest bound. A SIGKILLed process runs no handler, so its root DOES survive — and the
// sweep is the only thing that collects it. Stating that as an arm is the difference between a known
// limit and a surprise.
const runRoots = (base) => readdirSync(base).filter((n) => n.startsWith("ct-testrun-"));

const spawnLongRun = (base, extraEnv = {}) => {
  const script = join(base, "long.mjs");
  writeFileSync(script, "setTimeout(() => {}, 60000);");
  const child = spawn("node", [RUNNER, "node", script], {
    stdio: "ignore", env: { ...runnerEnv(base), ...extraEnv },
  });
  return child;
};

// Wait for a condition without pinning a wall time — a loaded box must not decide the verdict.
const until = async (pred, ms = 15000, every = 50) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, every));
  }
  return false;
};

for (const sig of ["SIGTERM", "SIGINT"]) {
  test(`#1763 a run cancelled with ${sig} removes its root — the cancel-in-progress path`, async () => {
    const base = mkdtempSync(join(tmpdir(), "testrun-spec-"));
    try {
      const child = spawnLongRun(base);
      assert.ok(await until(() => runRoots(base).length === 1),
        "the run never created its root — this probe cannot tell cleanup from never having started");
      child.kill(sig);
      await new Promise((r) => child.once("exit", r));
      assert.ok(await until(() => runRoots(base).length === 0),
        `${sig} left ${runRoots(base).join(", ")} behind; the handler in test-run.mjs did not reach cleanup`);
    } finally { rmSync(base, { recursive: true, force: true }); }
  });
}

test("#1763 a cancel that lands during SETUP still removes the root — ownership precedes the mkdtemp", async () => {
  // THE ARMS ABOVE POLL AT 50ms AND LAND AFTER THE WINDOW. This one signals at the first instant the
  // root exists, which is what a runner's `cancel-in-progress` does on a superseded push: it does not
  // wait for the wrapper to finish wiring itself up.
  //
  // Measured on origin/main before the ownership block moved: 15 of 15 such cancels left the root
  // behind, wrapper dead by default action (`exit=null/SIGINT`) with no `exit` handler installed yet —
  // the registration sat ~190 lines below the mkdtemp, behind the env wiring, the symlink farm and the
  // dependency check. Registering it after the mkdtemp instead of before left ~7% still leaking; before
  // it, 0 of 15 on both signals. That is why the handlers are registered against a null root rather
  // than beside the directory they remove.
  //
  // THREE ATTEMPTS, because one that never manages to signal inside setup proves nothing — the count of
  // attempts that actually landed is asserted, not assumed.
  //
  // WHAT THIS ARM DOES NOT CATCH, stated rather than discovered later: the few-statement window between
  // an mkdtemp and a registration on the very next line. Planted, and these three attempts went green
  // through it — at ~7% per cancel it needs tens of attempts to show, which is a minute of suite time
  // for a case the ordering below makes unreachable anyway. This arm holds the gross defect: ownership
  // that lives near the SPAWN rather than near the directory.
  let signalled = 0;
  const leaked = [];
  for (let i = 0; i < 3; i++) {
    const base = mkdtempSync(join(tmpdir(), "testrun-spec-"));
    try {
      const child = spawnLongRun(base);
      // 1ms polling: the earliest observable moment, not a comfortable one
      const appeared = await until(() => runRoots(base).length === 1, 15000, 1);
      assert.ok(appeared, "the run never created its root — this probe cannot tell cleanup from never having started");
      child.kill("SIGINT");
      signalled += 1;
      await new Promise((r) => child.once("exit", r));
      if (!await until(() => runRoots(base).length === 0, 5000, 25)) leaked.push(runRoots(base).join(", "));
    } finally { rmSync(base, { recursive: true, force: true }); }
  }
  assert.equal(signalled, 3, "no attempt reached the point of signalling — the arm measured nothing");
  assert.deepEqual(leaked, [],
    "a cancel arriving during setup left its root behind: the wrapper is being killed by default action "
    + "before it owns the directory it just created");
});

test("#1763 SIGKILL leaves its root — and the NEXT run's sweep is what collects it", async () => {
  const base = mkdtempSync(join(tmpdir(), "testrun-spec-"));
  try {
    const child = spawnLongRun(base);
    assert.ok(await until(() => runRoots(base).length === 1), "the run never created its root");
    child.kill("SIGKILL");
    await new Promise((r) => child.once("exit", r));

    // The bound, asserted rather than assumed: no handler runs, so the root is still there.
    const orphan = runRoots(base);
    assert.equal(orphan.length, 1,
      "a SIGKILLed run is expected to leave its root — if this passes with 0, the collector below is no "
      + "longer the only thing that removes it and the reasoning here needs revisiting");

    // Age it past a LOW floor and run again: the sweep is the collector.
    const old = Date.now() / 1000 - 3600;
    utimesSync(join(base, orphan[0]), old, old);
    const script = join(base, "quick.mjs");
    writeFileSync(script, "");
    execFileSync("node", [RUNNER, "node", script],
      { encoding: "utf8", env: { ...runnerEnv(base), CT_TESTRUN_STALE_MS: "60000" } });
    assert.deepEqual(runRoots(base), [],
      "the next run's sweep did not collect the abandoned root");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("#1763 CT_TESTRUN_STALE_MS moves the floor, and CI is what sets it", () => {
  withBase((base) => {
    const stale = join(base, "ct-testrun-ORPHAN");
    mkdirSync(stale);
    const old = Date.now() / 1000 - 30 * 60;      // half an hour: under the 6h default, over CI's 40min
    utimesSync(stale, old, old);
    const script = join(base, "quick.mjs");
    writeFileSync(script, "");

    execFileSync("node", [RUNNER, "node", script], { encoding: "utf8", env: runnerEnv(base) });
    assert.equal(existsSync(stale), true,
      "at the DEFAULT floor a half-hour-old root must survive — a developer's long suite is not litter");

    execFileSync("node", [RUNNER, "node", script],
      { encoding: "utf8", env: { ...runnerEnv(base), CT_TESTRUN_STALE_MS: String(20 * 60 * 1000) } });
    assert.equal(existsSync(stale), false,
      "with the floor lowered the same root is swept — this is what ci.yml's CT_TESTRUN_STALE_MS buys");
  });
});

test("nothing outside the prefix is ever touched, however old", () => {
  withBase((base) => {
    const bystander = join(base, "claude-1001");     // the shape that must survive: another user's session
    mkdirSync(bystander);
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    utimesSync(bystander, old, old);

    execFileSync("node", [RUNNER, "node", "-e", "0"], { env: runnerEnv(base) });

    assert.equal(existsSync(bystander), true,
      "the sweep is scoped to roots this runner minted — a glob over the ambient tmpdir is how a tidy-up becomes an outage");
  });
});

test("every workspace routes its tests through the runner, or that workspace keeps leaking", () => {
  const read = (p) => JSON.parse(execFileSync("cat", [fileURLToPath(new URL(p, import.meta.url))], { encoding: "utf8" }));
  assert.match(read("../package.json").scripts.test, /scripts\/test-run\.mjs/);
  assert.match(read("../../mcp-server/package.json").scripts.test, /scripts\/test-run\.mjs/);
  assert.match(read("../../portal-ui/package.json").scripts.test, /scripts\/test-run\.mjs/);
  assert.match(read("../../package.json").scripts["test:providers"], /scripts\/test-run\.mjs/);
});
