// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — a deployment that cannot say how stale it is, is stale in the way nothing reports.
//
// A test box sat on a day-old commit for a full day while main advanced more than a dozen merges. Four
// rounds ran in that window and every one was honest about its build; what did not exist was any
// surface saying "this deployment is N commits behind", and any mechanism that would have moved it.
//
// AN ABSENT MECHANISM IS INVISIBLE IN EXACTLY THE WAY A BROKEN ONE IS NOT. A unit that is wrong leaves
// a journal; a unit that was never placed leaves nothing to read. So these arms check what the install
// PRODUCES and what the documents PROMISE, and refuse to let the two drift apart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { deploymentCurrency, programsOnAnOlderTree, readOwnProcesses } from "../../bin/onboard.mjs";
import { processTable } from "../../shared/process-table.mjs";   // — /proc is not the only box
import { pinEnv } from "../../shared/env-aliases.mjs";   // every spelling of both names, from the table

const ROOT = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), "");
const UNIT = join(ROOT, "driver/systemd/clearotron-deploy.service");
const TIMER = join(ROOT, "driver/systemd/clearotron-deploy.timer");

test("#1883 the three currency answers are three answers, and none of them is silence", () => {
  // "Up to date", "N behind" and "I could not look" are different FACTS. A check that prints the first
  // for the third is the failure this whole issue is one instance of, so each is driven separately.
  const git = (map) => (args) => map(args);
  const inside = (a) => a[0] === "rev-parse" && a[1] === "--is-inside-work-tree";
  const upstream = (a) => a[1] === "--abbrev-ref";

  const current = deploymentCurrency({ run: git((a) => inside(a) ? { status: 0 }
    : upstream(a) ? { status: 0, stdout: "origin/main\n" } : { status: 0, stdout: "0\n" }) });
  assert.equal(current.state, "current");
  assert.equal(current.behind, 0);

  const behind = deploymentCurrency({ run: git((a) => inside(a) ? { status: 0 }
    : upstream(a) ? { status: 0, stdout: "origin/main\n" } : { status: 0, stdout: "13\n" }) });
  assert.equal(behind.state, "behind");
  assert.equal(behind.behind, 13, "the NUMBER is the report — 'behind' without it is not actionable");

  // Each of the three could-not-answer cases says which one it is, rather than reporting zero.
  assert.equal(deploymentCurrency({ run: git(() => ({ status: 128, stderr: "not a git repository" })) }).state,
    "not-a-checkout");
  assert.equal(deploymentCurrency({ run: git((a) => inside(a) ? { status: 0 } : { status: 128 }) }).state,
    "no-upstream");
  assert.equal(deploymentCurrency({ run: git((a) => inside(a) ? { status: 0 }
    : upstream(a) ? { status: 0, stdout: "origin/main\n" } : { status: 1, stderr: "bad revision\n" }) }).state,
    "unknown", "a git that failed to count is UNKNOWN, never zero");
});

test("#1883 update REFUSES over a queued run — driven through the real entry, not the function", () => {
  // The property is load-bearing: `npm ci` rebuilds node_modules under whatever is running, and a
  // clearance assembled from halves of two builds does not fail, it answers wrongly and says nothing.
  // Driven as a subprocess with a real queued job on disk, because the refusal has to hold for the
  // TIMER — which calls the binary, not this function.
  const dir = mkdtempSync(join(tmpdir(), "deploy-guard-"));
  writeFileSync(join(dir, "job-1883.json"), JSON.stringify({ ref: "GUARD" }));
  // `pinEnv` with the name QUOTED, not `pinEnvAll` with an object literal: 's guard exempts a
  // file that routes a name through the table, and it looks for the name as a STRING beside the
  // helper. An unquoted object key satisfies the helper and not the guard, so the call would be
  // correct and reported anyway.
  const env = { ...process.env };
  pinEnv(env, "CLEAROTRON_NO_ENV_FILE", "1");
  pinEnv(env, "CLEAROTRON_QUEUE_DIR", dir);

  let code = 0, out = "";
  try {
    out = execFileSync(process.execPath, [join(ROOT, "bin/update.mjs")], { env, encoding: "utf8", timeout: 120000 });
  } catch (e) { code = e.status; out = `${e.stdout ?? ""}${e.stderr ?? ""}`; }

  assert.equal(code, 4, `update should refuse with 4 over a queued run, got ${code}:\n${out.slice(0, 600)}`);
  assert.match(out, /REFUSED/, "and it must SAY it refused");
  assert.match(out, /job-1883/, "naming what holds it — an unnamed refusal is not actionable");
  assert.doesNotMatch(out, /git pull/, "nothing may be pulled before the refusal");
});

test("#1883 the shipped deploy unit runs the guarded command and treats its two exits differently", () => {
  assert.ok(existsSync(UNIT) && existsSync(TIMER), "the unit and timer this install documents must exist");
  const unit = readFileSync(UNIT, "utf8");

  assert.match(unit, /ExecStart=.*bin\/clearotron\.mjs update/,
    "the unit runs the verb that carries the refusals, rather than reimplementing a pull");
  assert.match(unit, /^SuccessExitStatus=4$/m,
    "exit 4 is 'a run is live' — transient, expected, and not a fault to page on");
  assert.doesNotMatch(unit, /^SuccessExitStatus=.*\b3\b/m,
    "exit 3 is the store INSIDE the checkout: permanent, needs a human, and swallowing it would leave a "
    + "deployment that never updates and never says so — the defect this unit exists to end");

  // It must not decide which drainer this box runs, which is an open question elsewhere. DIRECTIVES,
  // not text: a comment naming the drain unit to explain a shared convention is fine and is not an
  // ordering. Reading the whole file for the word failed on this unit's own explanatory comment.
  const directives = unit.split("\n").filter((l) => !/^\s*[#;]/.test(l) && l.includes("="));
  const ordering = directives.filter((l) => /^\s*(After|Before|Requires|Wants|BindsTo|PartOf|Conflicts)\s*=/.test(l));
  assert.deepEqual(ordering, [],
    "the deploy unit holds no ordering against a drainer and neither starts nor stops one — which "
    + "drainer this box runs is an open question this change must not decide");

  const timer = readFileSync(TIMER, "utf8");
  assert.match(timer, /OnUnitActiveSec=/, "a cadence, so staleness is bounded by it rather than by memory");
  assert.match(timer, /Persistent=true/, "a box asleep through several firings does ONE catch-up, not a queue");
});

test("#1883 the install document promises exactly what the tree ships", () => {
  // The failure that produced this issue was a document asserting a mechanism nobody had placed. So the
  // document's own commands are read back against the files they name.
  const doc = readFileSync(join(ROOT, "INSTALL.md"), "utf8");
  assert.match(doc, /does not keep this install up to date/i,
    "silence is the one thing the acceptance forbids: say it does not, and what to run");
  assert.match(doc, /clearotron update/, "and name the command");
  assert.match(doc, /clearotron doctor/, "and the surface that reports how far behind");

  for (const named of [...doc.matchAll(/driver\/systemd\/([a-z-]+)\.\{service,timer\}/g)]) {
    for (const ext of ["service", "timer"]) {
      const f = join(ROOT, "driver/systemd", `${named[1]}.${ext}`);
      assert.ok(existsSync(f), `INSTALL.md tells a reader to copy ${named[1]}.${ext} and it is not in the tree`);
    }
  }
});

test("#1883 a current checkout is not a current deployment — the older-tree state is its own answer", () => {
  // `git pull` moves the FILES. A long-lived service keeps executing the tree it started with, so a box
  // can be honestly up to date and still answer from code that no longer exists on disk. That is this
  // issue's invisibility in a third form, and it needs its own word rather than being folded into
  // "current" — which is what it looked like before this arm existed.
  const moved = 1_000_000;
  const older = programsOnAnOlderTree({ pulledAt: moved,
    readProcs: () => [{ pid: 4242, startedAt: moved - 60_000, cmd: "node /repo/driver/portal-service.mjs" }] });
  assert.equal(older.state, "older-tree");
  assert.equal(older.programs[0].pid, 4242, "the PID is the report — 'something is stale' is not actionable");

  const after = programsOnAnOlderTree({ pulledAt: moved,
    readProcs: () => [{ pid: 4243, startedAt: moved + 60_000, cmd: "node /repo/driver/portal-service.mjs" }] });
  assert.equal(after.state, "current", "a process started AFTER the branch moved is on the new tree");

  // COULD NOT LOOK IS ITS OWN ANSWER, not "current". The whole family of defects behind this issue is a
  // check that reports absence when it could not observe.
  // The reader is injected as a FUNCTION so "could not look" and "nothing to report" cannot collapse
  // into each other — they did, and this arm is why the signature changed.
  assert.equal(programsOnAnOlderTree({ pulledAt: moved, readProcs: () => null }).state, "unknown",
    "a scan that could not read the process table is UNKNOWN, never current");
  assert.equal(programsOnAnOlderTree({ pulledAt: moved, readProcs: () => [] }).state, "current",
    "an empty process table is a real answer and must not read as unknown");
});

test("#1883 the detector can SEE a real process from this checkout — a zero here is a broken instrument", async () => {
  // The arm above proves the predicate. This proves the SCAN: a silent report is worthless if the reason
  // for the silence is that nothing can be observed. Driven with a real child, reaped in a finally.
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { cwd: ROOT, stdio: "ignore" });
  try {
    await new Promise((r) => setTimeout(r, 300));
    // Its command line does not mention the checkout, so the scan must NOT claim it; what is proven here
    // is that the scan reads /proc at all and returns a list rather than null.
    const seen = programsOnAnOlderTree({ pulledAt: Date.now() + 60_000 });
    assert.notEqual(seen.state, "unknown", `the process table could not be read: ${seen.detail ?? ""}`);
    assert.ok(Array.isArray(seen.programs), "the scan returns a list, so an empty one means empty");
  } finally {
    child.kill("SIGKILL");
    await new Promise((r) => child.on("exit", r));
  }
});

test("2099 the deployment scan sees a program on this checkout where there is no /proc", async () => {
  // 's scan read `/proc` directly, so on macOS it returned null and doctor told every reader on
  // that platform "the process table could not be read" — permanently. The listing now comes from
  // shared/process-table.mjs, and this arm drives the branch macOS takes, on a box that has /proc.
  //
  // The child's command line NAMES the checkout, because that is what the scan filters on.
  const child = spawn(process.execPath, ["-e", `setTimeout(() => {}, 60000); // ${ROOT}`], { stdio: "ignore" });
  try {
    await new Promise((r) => setTimeout(r, 300));
    const seen = readOwnProcesses(ROOT, { table: processTable({ platform: "darwin" }) });
    assert.notEqual(seen, null, "the ps reader could not look on a box where it can");
    const mine = seen.find((p) => p.pid === child.pid);
    assert.ok(mine, `the scan did not find the child it was given: ${seen.length} program(s) named ${ROOT}`);
    assert.ok(Number.isFinite(mine.startedAt), `no start time, so the older-tree comparison cannot run: ${mine.startedAt}`);
  } finally {
    child.kill("SIGKILL");
    await new Promise((r) => child.on("exit", r));
  }
});

test("2099 a process table that could not be read is still null, not an empty box", () => {
  // The one line this whole reader exists to keep true, and it was unfalsifiable while the function was
  // private: `programsOnAnOlderTree`'s injection replaces the reader wholesale and never enters it.
  assert.equal(readOwnProcesses(ROOT, { table: null }), null,
    "a reader that could not look returned a listing, so doctor would report a clean box from an "
    + "instrument that never ran");
  assert.deepEqual(readOwnProcesses(ROOT, { table: [] }), [],
    "an empty box read as could-not-look — the two answers must stay apart in both directions");

  // AND THE DOCTOR IS NOT AN OLDER TREE. Asserted against a listing that CONTAINS this process under a
  // command line naming the checkout, because the real one does not: node's test runner is invoked with
  // a relative path, so `!seen.some(p => p.pid === process.pid)` over the live table is true whatever
  // the filter does — a passing assertion that had never once excluded anything.
  assert.deepEqual(readOwnProcesses(ROOT, { table: [{ pid: process.pid, cmd: `node ${ROOT}/bin/onboard.mjs doctor`, startedAt: 1 }] }), [],
    "doctor reported ITSELF as a program running on an older tree");
});
