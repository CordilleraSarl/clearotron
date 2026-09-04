// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// preflight-free-space.test.mjs —. The run door's third refusal: there is room to write.
//
// preflightCredentials' and preflightEngineBinary's sibling, at the same door and with the same
// discipline. What it adds over "the stage will fail anyway" is WHAT THE FAILURE IS CALLED. A run that
// exhausts the disk does not report a disk error — it reports a MISSING ARTIFACT, because that is what
// the next stage observes when it reads a truncated or zero-byte file. The failure names the wrong
// thing, at a stage unrelated to the cause, after arbitrary model spend, and "artifact absent" is
// indistinguishable from a genuine engine or provider fault.
//
// ── HOW A FULL DISK IS SIMULATED, AND WHY THAT IS HONEST ─────────────────────────────────────────
//
// It is not. Filling a filesystem in a test is not available and would be a hostile thing to do on a
// shared box. The threshold is driven instead — `CLEAROTRON_MIN_FREE_DISK_MB` set above what any filesystem
// has, which exercises the identical code path from the same input the real condition produces: a
// `free < need` comparison. The pure decision (`freeSpacePlan`) is tested directly with injected byte
// counts, which is the half a real disk would not tell you anything more about.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";

import { freeSpacePlan, preflightFreeSpace } from "../driver.config.mjs";

// EVERY TEMP DIR THIS FILE MAKES IS REGISTERED AND REMOVED. Six mkdtemp sites left theirs behind on
// every run — 115 `freespace-*` directories were sitting on the dev box when this was written, which is
// the exact starting shape of the disk-fill incident: a full disk does not surface as a disk error, it
// surfaces as an artifact that is mysteriously absent. `force` and the try/catch matter because one
// test below chmods its directory to 0o000 on purpose, so the cleanup must be able to fail without
// failing the suite — and must chmod back first, or the removal is the thing that leaks.
const MADE = [];
const tmp = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); MADE.push(d); return d; };
after(() => {
  for (const d of MADE) {
    try { chmodSync(d, 0o700); } catch { /* it may never have been chmodded, or may already be gone */ }
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort: a leak is not a test failure */ }
  }
});

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, "..", "runner.mjs");
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);

// ── the decision, with no filesystem in it ─────────────────────────────────────────────────────────

test("#773 room to spare is a pass and carries no reason", () => {
  const p = freeSpacePlan({ freeBytes: 40e9, needBytes: 500e6, path: "/somewhere" });
  assert.equal(p.ok, true);
  assert.equal(p.reason, null);
});

test("#773 short of room refuses WITH BOTH NUMBERS and names the path measured", () => {
  const p = freeSpacePlan({ freeBytes: 120e6, needBytes: 500e6, path: "/mnt/tiny/studio" });
  assert.equal(p.ok, false);
  // The issue's own requirement: refuse with a number — what is free, what is needed.
  assert.match(p.reason, /0\.12 GB free/, "what is free");
  assert.match(p.reason, /requires 0\.50 GB/, "what is needed");
  assert.match(p.reason, /\/mnt\/tiny\/studio/, "WHICH filesystem — df on the wrong one is a wrong answer");
  // And the whole reason the check exists, said out loud, because the reader's next move depends on it.
  assert.match(p.reason, /MISSING ARTIFACT/, "it names the failure this replaces");
  assert.match(p.reason, /before a run directory exists/i);
  assert.match(p.reason, /CLEAROTRON_MIN_FREE_DISK_MB/, "and the escape, named");
});

test("#773 exactly at the threshold is a pass — the refusal is strictly below", () => {
  assert.equal(freeSpacePlan({ freeBytes: 500e6, needBytes: 500e6, path: "/x" }).ok, true);
  assert.equal(freeSpacePlan({ freeBytes: 500e6 - 1, needBytes: 500e6, path: "/x" }).ok, false);
});

// ── the measurement ────────────────────────────────────────────────────────────────────────────────

test("#773 the default floor passes on an ordinary filesystem — a check that refuses a roomy box is worse than no check", () => {
  const dir = tmp("freespace-ok-");
  const r = preflightFreeSpace({}, dir);
  assert.equal(r.checked, true);
  assert.equal(r.warning, null);
  assert.equal(r.needBytes, 500e6, "the measured default: 500 MB, derived in driver.config's comment");
  assert.ok(Number.isFinite(r.freeBytes) && r.freeBytes > 0, "it measured a real filesystem rather than reporting itself blind");
});

// THE ARITHMETIC IS TESTED THROUGH THE INJECTION SEAM, NOT AGAINST A SECOND SYSCALL.
//
// This assertion used to live in the test above as `assert.equal(r.freeBytes, statfsSync(dir).bavail *
// statfsSync(dir).bsize)` — the module measured the filesystem, then the test measured it AGAIN and
// demanded the two agree to the byte. They are two syscalls against a live volume, so anything that
// allocates or frees a single block between them fails it: observed 2026-08-16 at 75b8f60 with a delta
// of exactly 4,096 bytes, one block. It passed 9 runs out of 9 in isolation and went red inside the
// full suite, whose other tests are writing temp directories on the same volume the harness points
// TMPDIR at. Green on a quiet CI runner, intermittently red on a working box — the worst of both, and
// it cost a merge freeze while three sessions worked out whether it was a real regression.
//
// preflightFreeSpace already takes `statfs` as its third parameter, so the seam to test the arithmetic
// deterministically was there the whole time and nothing in the module needed changing.
test("#773 freeBytes is bavail × bsize — asserted against a known statfs, never against the world", () => {
  const dir = tmp("freespace-arith-");
  const stub = () => ({ bavail: 1_234_567, bsize: 4096 });
  const r = preflightFreeSpace({}, dir, stub);
  assert.equal(r.freeBytes, 1_234_567 * 4096, "the product of the two fields the syscall returned");
  assert.equal(r.checked, true);
  // A different block size must move the answer, or the multiplication is not being exercised at all.
  const r2 = preflightFreeSpace({}, dir, () => ({ bavail: 1_234_567, bsize: 512 }));
  assert.equal(r2.freeBytes, 1_234_567 * 512, "bsize is read, not assumed to be 4096");
});

test("#773 a run directory that does not exist yet is measured on its nearest existing ancestor", () => {
  // The first run on a fresh box has no …/workspace-<agent>/studio/prelim-search. Measuring the leaf
  // would throw ENOENT and land in the unmeasurable branch, which would silently disable this check on
  // exactly the installs it was written for.
  const root = tmp("freespace-fresh-");
  const leaf = join(root, "workspace-clawdi", "studio", "prelim-search");
  assert.equal(existsSync(leaf), false, "the fixture is only meaningful while the leaf is absent");
  const r = preflightFreeSpace({}, leaf);
  assert.equal(r.checked, true, "it measured something rather than reporting itself blind");
  assert.equal(r.path, root, "…and it measured the nearest ancestor that exists");
});

test("#773 a floor nothing can satisfy REFUSES, and the throw carries the numbers", () => {
  const dir = tmp("freespace-tight-");
  assert.throws(
    () => preflightFreeSpace({ CLEAROTRON_MIN_FREE_DISK_MB: "100000000" }, dir),   // 100 TB
    (e) => {
      assert.match(e.message, /\[preflight\] not enough free disk/);
      assert.match(e.message, /GB free/);
      assert.match(e.message, /requires 100000\.00 GB/);
      assert.match(e.message, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      return true;
    },
  );
});

test("#773 CLEAROTRON_MIN_FREE_DISK_MB=0 disables the check, and says it did rather than claiming a pass", () => {
  const r = preflightFreeSpace({ CLEAROTRON_MIN_FREE_DISK_MB: "0" }, "/nonexistent-on-purpose");
  assert.equal(r.disabled, true);
  assert.equal(r.checked, false, "a disabled check must never report itself as having checked");
});

test("#773 a typo'd threshold THROWS — it must not silently disable the guard", () => {
  // The failure mode of a guard whose own configuration fails open. `CLEAROTRON_MIN_FREE_DISK_MB=500MB` is
  // the obvious thing to type and would otherwise parse to NaN, and every comparison against NaN is
  // false, so the check would pass on a full disk.
  for (const bad of ["500MB", "lots", "-1"]) {
    assert.throws(() => preflightFreeSpace({ CLEAROTRON_MIN_FREE_DISK_MB: bad }, tmpdir()),
      /is not a number of megabytes/, `"${bad}" must be refused, not ignored`);
  }
});

test("#773 an UNMEASURABLE disk is reported and never read as room", () => {
  // bin/uspto-sync.mjs's precedent, and its words: "an unread guard reported as silence is how the rule
  // it enforces stops existing." It does not refuse — statfs failing is a fact about the checker, not
  // about the disk — but it must not return a pass either.
  //
  // Driven by INJECTING a failing statfs, which is the wizard's pattern in onboard-wizard.test.mjs
  // (`statfs: async () => { throw new Error("statfs unavailable"); }`). There is no path that makes the
  // real syscall fail reliably — statfs answers for a regular file, and a missing leaf walks up to a
  // mount that exists — so the arm would otherwise be untested, which is how a fail-open branch rots.
  const dir = tmp("freespace-blind-");
  const r = preflightFreeSpace({}, dir, () => { throw new Error("statfs unavailable"); });
  assert.equal(r.checked, false, "it must not claim to have checked");
  assert.equal(r.freeBytes, null);
  assert.ok(r.warning, "and it must produce something for the caller to say out loud");
  assert.match(r.warning, /UNCHECKED/);
  assert.match(r.warning, /missing artifact/i, "naming what a silent failure would have looked like");
});

// ── the acceptance criterion, end to end ───────────────────────────────────────────────────────────

const job = (ref, mark) => ({
  id: `fs-${ref}`, msgId: `<fs-${ref}@x>`, forwarder: "requester", forwarderDomain: "example.com",
  ref, markName: mark, classes: [9], provider: "corsearch",
});
const studioFor = (root) => join(root, "workspace-clawdi", "studio", "prelim-search");
const queueFor = (root) => join(studioFor(root), "queue");
const runToExit = (env) => {
  const c = spawn(process.execPath, [RUNNER], { env, stdio: ["ignore", "pipe", "pipe"] });
  c.log = "";
  c.stdout.on("data", (d) => { c.log += d; });
  c.stderr.on("data", (d) => { c.log += d; });
  return new Promise((r) => c.on("exit", (code) => r({ code, log: c.log })));
};

test("#773 a disk that cannot hold the run refuses BEFORE any run dir exists", async () => {
  const root = tmp("freespace-nodir-");
  const Q = queueFor(root);
  mkdirSync(Q, { recursive: true });
  writeFileSync(join(Q, "job-d.json"), JSON.stringify(job("TMP9402", "NO ROOM")));

  const { code, log } = await runToExit({
    ...process.env,
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE,
    CLEAROTRON_MIN_FREE_DISK_MB: "100000000",   // 100 TB — no filesystem on any box satisfies it
    CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_OUTBOX_DIR: join(root, "outbox"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_QUEUE_SCAN_MS: "100",
    CORSEARCH_SESSION_KEY: "test-offline", CLEAROTRON_SATPROBE_CODESIDE: "0", CLEAROTRON_BAND_TRUTH_GATE: "0",
  });

  assert.equal(code, 0, log);
  assert.ok(existsSync(join(Q, "job-d.failed")), `the job is marked failed\n${log}`);
  const res = JSON.parse(readFileSync(join(Q, "job-d.failed.result"), "utf8"));
  assert.match(String(res.reason ?? ""), /not enough free disk/, `the recorded reason is a DISK error\n${log}`);
  assert.match(String(res.reason), /GB free/, "and it carries the number");

  // THE criterion, and the reason this refusal is at the door rather than inside a stage. Checked by
  // looking for a run directory rather than by trusting the order of two statements: a run dir left by
  // a run that never started is a resumable-looking husk, and a preflight must produce none.
  const runs = [];
  const walk = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (!e.isDirectory()) continue; if (existsSync(driverDir(p)) || existsSync(join(p, "status.json"))) runs.push(p); else walk(p); } };
  walk(root);
  assert.deepEqual(runs, [], `no run directory may exist\n${log}`);
  assert.ok(!existsSync(join(root, "pool")) || readdirSync(join(root, "pool")).length === 0, "and nothing was published");
});
