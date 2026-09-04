// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the real runner's claim and stale-claim lifecycle
// B2 — fail-safe stale-claim detection. The old liveness check was kill(pid,0) alone (EPERM = alive), so
// on PID reuse an orphaned .processing rotted forever and the client search never ran (pid_max is 4194304
// and wraps). The sidecar now records "<pid>:<starttime>"; the polarity tests below pin the DELIBERATE
// fail-safe rule — only positive evidence of death re-claims; ambiguity on a live pid never double-claims —
// and the cross-process tests exercise real pids: a live foreign process with the wrong starttime is
// re-claimed, the right starttime is skipped as in-flight, and an over-age claim re-claims regardless.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, chmodSync, utimesSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { procStarttime, claimToken, parseClaimSidecar, claimerIsAlive } from "../runner.mjs";
import { HAS_BIRTH_STAMP, NO_PROC_STARTTIME_WHY } from "./platform-caps.mjs";

// ── THE DEFENCE THIS FILE PINS DOES NOT EXIST ON EVERY MACHINE ──────────────────────────────
//
// procStarttime() reads field 22 of /proc/<pid>/stat — the kernel's boot-tick birth stamp for a
// process — and that file is Linux's. macOS has no /proc at all, so the function returns null there,
// claimToken falls back to a bare pid, and the PID-reuse defence has nothing to compare. Two
// tests below drive the REAL source rather than the injected one, which is deliberate: a defence
// mocked at both ends proves only that the mock agrees with itself. That is also why they cannot pass
// where the source is absent.
//
// The degradation is fail-safe and the code says so in full at `claimerIsAlive` — an unreadable
// starttime counts the claimer ALIVE, so the failure direction is a run that waits, never a billable
// search run twice or a lawyer delivered to twice. What macOS loses is the escape hatch: a
// `.processing` held by a RECYCLED pid is not freed by liveness there and waits for the max-claim-age
// ceiling instead. That is a REAL reduction in what the engine does on that platform, so it is written
// into README.md rather than skipped past — the skip and the README sentence ship together and are
// removed together.
//
// Not gated on `process.platform`: a Linux container without /proc mounted has the same gap, and a
// probe catches it where a platform name would sail past. The three tests either side of these ones
// inject their own starttime source and are portable — they stay ungated on purpose, so the parsing
// and the polarity are still proved everywhere.
const PROC_GATE = HAS_BIRTH_STAMP ? {} : { skip: NO_PROC_STARTTIME_WHY };
// code-side saturation-probe (2026-07-14): OFF in this legacy harness — its scenarios script the AGENT
// member; the dedicated satprobe-codeside tests exercise the code-side path with an injected executor.
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
// band-truth gate (2026-07-14): OFF in hermetic harnesses — mock runs never dial the provider, so the
// production call ledger can never evidence their bands; the dedicated band-truth-gate tests turn it ON.
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, "..", "runner.mjs");
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);

// ── pure polarity units (injected kill/stat readers — the /proc conditions tests can't stage for real) ──

test("parseClaimSidecar: token and legacy shapes", () => {
  assert.deepEqual(parseClaimSidecar("1234:5678"), { pid: 1234, starttime: "5678" });
  assert.deepEqual(parseClaimSidecar("1234\n"), { pid: 1234, starttime: null });   // legacy bare pid
  assert.equal(parseClaimSidecar("garbage"), null);
  assert.equal(parseClaimSidecar(""), null);
});

test("procStarttime: field 22 survives a comm with spaces and parens", () => {
  // fields:            1     2                       3 4 5 6 7 8 9  10 11 12 13 14 15 16 17 18 19 20 21 22
  const stat = "4242 (my (we)ird proc) R 1 2 3 4 5 6  7  8  9  10 11 12 13 14 15 16 17 18 424242 21 22";
  assert.equal(procStarttime(4242, () => stat), "424242");
  assert.equal(procStarttime(4242, () => { throw new Error("ENOENT"); }), null);
});

test("claimerIsAlive polarity: only positive evidence of death re-claims", () => {
  const esrch = () => { const e = new Error("ESRCH"); e.code = "ESRCH"; throw e; };
  const eperm = () => { const e = new Error("EPERM"); e.code = "EPERM"; throw e; };
  const live = () => true;
  // pid dead ⇒ dead
  assert.equal(claimerIsAlive({ pid: 1, starttime: "9" }, { kill: esrch, starttimeOf: () => "9" }), false);
  // pid alive + starttime matches ⇒ alive
  assert.equal(claimerIsAlive({ pid: 1, starttime: "9" }, { kill: live, starttimeOf: () => "9" }), true);
  // pid alive + starttime MISMATCH ⇒ dead (PID reuse — the rot-forever bug)
  assert.equal(claimerIsAlive({ pid: 1, starttime: "9" }, { kill: live, starttimeOf: () => "8" }), false);
  // pid alive + UNREADABLE stat ⇒ ALIVE — the deliberate fail-safe polarity (never double-claim)
  assert.equal(claimerIsAlive({ pid: 1, starttime: "9" }, { kill: live, starttimeOf: () => null }), true);
  // EPERM on kill(pid,0) = exists under another uid ⇒ alive
  assert.equal(claimerIsAlive({ pid: 1, starttime: "9" }, { kill: eperm, starttimeOf: () => "9" }), true);
  // legacy bare-pid sidecar: pid-aliveness is all we have
  assert.equal(claimerIsAlive({ pid: 1, starttime: null }, { kill: live, starttimeOf: () => { throw new Error("never called"); } }), true);
  assert.equal(claimerIsAlive(null, {}), false);
});

test("claimToken names this process with its real starttime", PROC_GATE, () => {
  const tok = claimToken();
  assert.match(tok, new RegExp(`^${process.pid}:\\d+$`));
  assert.equal(tok.split(":")[1], procStarttime(process.pid));
});

// ── cross-process: real pids against a real drain (the slot-lock-xproc pattern) ─────────────────────────

const job = (ref, mark) => ({
  id: `live-${ref}`, msgId: `<live-${ref}@x>`, forwarder: "jordan", forwarderDomain: "example.com",
  ref, markName: mark, classes: [9], provider: "corsearch",
});
const queueFor = (root) => join(root, "workspace-clawdi", "studio", "prelim-search", "queue");
function envFor(root, extra = {}) {
  return {
    ...process.env,
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_OUTBOX_DIR: join(root, "outbox"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    CLEAROTRON_QUEUE_SCAN_MS: "100", CORSEARCH_SESSION_KEY: "test-offline",
    ...extra,
  };
}
const spawnRunner = (env) => {
  const c = spawn(process.execPath, [RUNNER], { env, stdio: ["ignore", "pipe", "pipe"] });
  c.log = "";
  c.stdout.on("data", (d) => { c.log += d; });
  c.stderr.on("data", (d) => { c.log += d; });
  c.exited = new Promise((r) => c.on("exit", (code) => r(code)));
  return c;
};
// A LIVE unrelated process (60s sleeper) — the "reused pid" impostor / the in-flight stand-in.
const spawnSleeper = () => spawn(process.execPath, ["-e", "setTimeout(()=>{}, 60000)"], { stdio: "ignore" });

test("PID reuse (live foreign pid, WRONG starttime) → re-claimed and run; correct starttime → skipped in-flight with a .skips tally", PROC_GATE, async () => {
  const root = mkdtempSync(join(tmpdir(), "liveness-"));
  const Q = queueFor(root);
  mkdirSync(Q, { recursive: true });
  const sleeper = spawnSleeper();
  try {
    // job R: sidecar names the LIVE sleeper pid with a WRONG starttime — a recycled pid, claimer is dead
    writeFileSync(join(Q, "job-r.processing"), JSON.stringify(job("TMP9201", "REUSED PID")));
    writeFileSync(join(Q, "job-r.processing.pid"), `${sleeper.pid}:1`);
    // job f: sidecar names the sleeper with its REAL starttime — a genuinely in-flight claim
    writeFileSync(join(Q, "job-f.processing"), JSON.stringify(job("TMP9202", "IN FLIGHT")));
    writeFileSync(join(Q, "job-f.processing.pid"), claimToken(sleeper.pid));

    const c = spawnRunner(envFor(root));
    assert.equal(await c.exited, 0, c.log);

    // R (pid reuse) was re-claimed and ran to completion
    assert.ok(existsSync(join(Q, "job-r.done")), `reused-pid claim was re-claimed and run\n${c.log}`);
    // F (really in flight) untouched: still .processing, sidecar intact, skip tallied for the ops digest
    assert.ok(existsSync(join(Q, "job-f.processing")), "in-flight claim not re-claimed");
    assert.ok(!existsSync(join(Q, "job-f.json")) && !existsSync(join(Q, "job-f.done")), "in-flight job neither re-opened nor consumed");
    assert.equal(readFileSync(join(Q, "job-f.processing.pid"), "utf8"), claimToken(sleeper.pid), "in-flight sidecar untouched");
    assert.equal(readFileSync(join(Q, "job-f.processing.skips"), "utf8").trim(), "1", "first skip tallied");
    assert.match(c.log, /job-f is IN FLIGHT .*skip #1/, "skip surfaced via note() with the tally");

    const c2 = spawnRunner(envFor(root));
    assert.equal(await c2.exited, 0, c2.log);
    assert.equal(readFileSync(join(Q, "job-f.processing.skips"), "utf8").trim(), "2", "repeated skips escalate the tally");

    // never two concurrent claims of one base, whatever happened above
    for (const base of ["job-r", "job-f"]) {
      const markers = readdirSync(Q).filter((f) => new RegExp(`^${base}\\.(json|processing|done|failed)$`).test(f));
      assert.equal(markers.length, 1, `${base} owns exactly one queue marker: ${markers.join(", ")}`);
    }
  } finally {
    sleeper.kill("SIGKILL");
  }
});

test("48h-stale CLAIM (.pid sidecar age) → re-claimed REGARDLESS of a live, starttime-correct claimer", async () => {
  const root = mkdtempSync(join(tmpdir(), "liveness-age-"));
  const Q = queueFor(root);
  mkdirSync(Q, { recursive: true });
  const sleeper = spawnSleeper();
  try {
    const proc = join(Q, "job-s.processing");
    writeFileSync(proc, JSON.stringify(job("TMP9203", "STALE CLAIM")));
    writeFileSync(`${proc}.pid`, claimToken(sleeper.pid));   // alive AND authentic — only the age ceiling can fire
    const old = (Date.now() - 49 * 3600000) / 1000;          // 49h ago, past the 48h default
    utimesSync(`${proc}.pid`, old, old);                     // the CLAIM's age lives on the sidecar, not the marker

    const c = spawnRunner(envFor(root));
    assert.equal(await c.exited, 0, c.log);
    assert.match(c.log, /claim is 49h old .* re-claiming REGARDLESS/, "the over-age re-claim is loud");
    assert.ok(existsSync(join(Q, "job-s.done")), `stale claim was re-claimed and run\n${c.log}`);
  } finally {
    sleeper.kill("SIGKILL");
  }
});

test("old ENQUEUE age with a FRESH claim → NOT re-claimed (rename preserves the marker's mtime; the ceiling clocks the claim)", async () => {
  // The regression: a job enqueued Friday that 5h-cap-postponed across the weekend keeps its Friday
  // mtime through every rename (.json→.processing→.postponed→.processing). Measuring the ceiling off the
  // MARKER would force-take-over the LIVE, healthy Monday resume — a concurrent double-run of the same
  // codename. The claim's true age is the .pid sidecar, freshly written at every claim site.
  const root = mkdtempSync(join(tmpdir(), "liveness-enqueue-age-"));
  const Q = queueFor(root);
  mkdirSync(Q, { recursive: true });
  const sleeper = spawnSleeper();
  try {
    const proc = join(Q, "job-w.processing");
    writeFileSync(proc, JSON.stringify(job("TMP9204", "WEEKEND POSTPONE")));
    writeFileSync(`${proc}.pid`, claimToken(sleeper.pid));   // live, authentic, claimed just now
    const old = (Date.now() - 62 * 3600000) / 1000;          // enqueued 62h ago (Friday → Monday)
    utimesSync(proc, old, old);                              // marker mtime = enqueue time — must NOT count

    const c = spawnRunner(envFor(root));
    assert.equal(await c.exited, 0, c.log);
    assert.doesNotMatch(c.log, /re-claiming REGARDLESS/, "enqueue age must never fire the over-age takeover");
    assert.match(c.log, /job-w is IN FLIGHT/, "the live claim is honored");
    assert.ok(existsSync(proc), "still .processing — the in-flight run was left alone");
    assert.equal(readFileSync(`${proc}.pid`, "utf8"), claimToken(sleeper.pid), "the live claimer's token untouched");
    assert.ok(!existsSync(join(Q, "job-w.done")) && !existsSync(join(Q, "job-w.json")), "neither consumed nor re-opened");
  } finally {
    sleeper.kill("SIGKILL");
  }
});
