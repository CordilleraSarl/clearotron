// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// purge-runs.mjs — the delete path. It has no undo, so its guards are the product.
//
// This suite exists because the survivors used to be COMPILED IN: four runIds and a customer key from a
// one-off 2026-07 clear-out. That was stale by construction (each was "the latest X" on the day it was
// written, so a later re-run would spare the superseded run and delete the current one) and it froze an
// operational decision into source. The keepers are now supplied by the caller.
//
// Moving a list out of source and into arguments makes a NEW failure possible: an invocation that simply
// forgets the keepers. In SWEEP mode that is not a narrow slip, it is "delete the estate". The first test
// below is the one that matters — every other guard is only reachable if that refusal holds.
//
// The script reads CLEAROTRON_REPORTS_DIR / CLEAROTRON_WORK_DIR at module load, so it is exercised as a
// subprocess with both pinned at a temp dir. Pinning is not optional: an unpinned run reads the real
// /srv/trademark-archive.

import { test } from "node:test";
import { pinEnvAll } from "../../shared/env-aliases.mjs";   // — a spread carries EVERY spelling, so an override must clear every spelling
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "purge-runs.mjs");

// Synthetic vocabulary only: TMP9xxx is this repo's probe range, distinct from real TMP5xxx matters.
const RUNS = [
  ["tmp9001-novapulse-2026-07-01-flint-probe", "demo-brand-owner"],
  ["tmp9002-novapulse-2026-07-02-slate-probe", "zephyr"],
  ["tmp9003-acmewidget-2026-07-03-briar-probe", "zephyr"],
];

function pool(runs = RUNS) {
  const root = mkdtempSync(join(tmpdir(), "clearotron-purge-"));
  const poolRoot = join(root, "pool");
  for (const [runId, customerKey] of runs) {
    mkdirSync(join(poolRoot, runId), { recursive: true });
    writeFileSync(join(poolRoot, runId, "meta.json"), JSON.stringify({ runId, customerKey }));
  }
  return { root, poolRoot, wsRoot: join(root, "ws") };
}

// `state` is a LIVE-STORE concept: collect() only reads it from a workspace run's status.json, never
// from a pool meta.json. So the running-run guard has to be exercised against the live store — putting
// a state on a pool fixture tests nothing (and looks like it passes for the wrong reason).
function liveRun({ root, ...rest }, { matter, codename, runId, state, agent = "mailagent" }) {
  const dir = join(root, "ws", `workspace-${agent}`, "studio", "clearance-search", matter, codename);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "status.json"), JSON.stringify({ runId, state }));
  return { root, ...rest };
}

function run(env, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: pinEnvAll({ ...process.env }, { CLEAROTRON_REPORTS_DIR: env.poolRoot, CLEAROTRON_WORK_DIR: env.wsRoot }),
  });
  // `out` folds both streams so the prose arms can assert on the report wherever the tool prints it.
  // `paths` is STDOUT ALONE, because `--paths` is a machine-readable list meant to be piped, and stderr
  // carries environment notes. made that concrete: once this script translates renamed variables,
  // four deprecation lines land on stderr and a merged read counted five paths where one exists.
  return { status: r.status, out: `${r.stdout}${r.stderr}`, paths: r.stdout ?? "" };
}

const counts = (out) => {
  const m = out.match(/^-- (\d+) DELETE \/ (\d+) KEEP --$/m);
  assert.ok(m, `no verdict line in output:\n${out}`);
  return { del: Number(m[1]), keep: Number(m[2]) };
};

// ── the refusal that makes supplying keepers safe ──────────────────────────────────────────────────

test("SWEEP with no keepers REFUSES instead of deleting the estate", () => {
  const p = pool();
  const r = run(p);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /would delete EVERY run/);
  // and it must not have printed a manifest that a reader could mistake for a plan
  assert.doesNotMatch(r.out, /^-- \d+ DELETE/m);
});

test("clearing the whole estate stays possible, but only when said out loud (--keep-none)", () => {
  const p = pool();
  const r = run(p, "--keep-none");
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(counts(r.out), { del: 3, keep: 0 });
});

// ── selection ─────────────────────────────────────────────────────────────────────────────────────

test("--only narrows to matching runs; everything else is KEEP", () => {
  const p = pool();
  const r = run(p, "--only=novapulse");
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(counts(r.out), { del: 2, keep: 1 });
});

test("--keep spares exact runs", () => {
  const p = pool();
  const r = run(p, "--keep=tmp9001-novapulse-2026-07-01-flint-probe");
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(counts(r.out), { del: 2, keep: 1 });
});

test("--keep-file reads one runId per line, ignoring blanks and # comments", () => {
  const p = pool();
  const f = join(p.root, "keep.txt");
  writeFileSync(f, "# survivors\ntmp9001-novapulse-2026-07-01-flint-probe\n\ntmp9002-novapulse-2026-07-02-slate-probe  # newest\n");
  const r = run(p, `--keep-file=${f}`);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(counts(r.out), { del: 1, keep: 2 });
});

// This is why a RULE beats an id list, and the whole reason the old hardcoded list was wrong: a keeper
// expressed as a customer stays correct when that customer's SECOND run appears. An id list does not —
// it silently sends the new run to the delete set.
test("--keep-customer is a RULE: a customer's later run is protected without editing anything", () => {
  const p = pool([
    ["tmp9001-novapulse-2026-07-01-flint-probe", "demo-brand-owner"],
    ["tmp9002-novapulse-2026-07-02-slate-probe", "zephyr"],
    ["tmp9009-novapulse-2026-07-09-hazel-probe", "zephyr"], // arrived after any list would have been written
  ]);
  const r = run(p, "--keep-customer=zephyr");
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(counts(r.out), { del: 1, keep: 2 });
});

test("a keeper vetoes --only — a pattern can never overrule a protected run", () => {
  const p = pool();
  const r = run(p, "--only=novapulse", "--keep=tmp9001-novapulse-2026-07-01-flint-probe");
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(counts(r.out), { del: 1, keep: 2 });
});

test("a RUNNING live run is never a delete candidate, even under --keep-none", () => {
  // one pool run (deletable) + two live runs, one in flight. Removing a live dir mid-write loses work
  // no retry recovers, so it must be KEEP regardless of how wide the sweep is.
  let p = pool([["tmp9001-novapulse-2026-07-01-flint-probe", "demo-brand-owner"]]);
  p = liveRun(p, { matter: "tmp9004", codename: "2026-07-04-hazel-probe", runId: "tmp9004-novapulse-2026-07-04-hazel-probe", state: "running" });
  p = liveRun(p, { matter: "tmp9005", codename: "2026-07-05-umber-probe", runId: "tmp9005-novapulse-2026-07-05-umber-probe", state: "failed" });

  const r = run(p, "--keep-none");
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(counts(r.out), { del: 2, keep: 1 }); // pool run + the failed live run go; the running one stays
  assert.match(r.out, /KEEP\s+live\s+\S+\s+tmp9004-novapulse-2026-07-04-hazel-probe\s+\(state=running\)/);
});

// ── typos. A mistyped keeper is silently a DELETE, so both keeper forms assert they resolved. ──────

test("a mistyped --keep refuses rather than silently deleting the run it meant to spare", () => {
  const p = pool();
  const r = run(p, "--keep=tmp9001-novapulse-2026-07-01-flint-prob"); // one char short
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /keeper never resolved/);
});

test("a mistyped --keep-customer refuses the same way", () => {
  const p = pool();
  const r = run(p, "--keep-customer=zephry");
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /--keep-customer matched no run/);
});

test("an --only pattern matching nothing refuses — an empty delete set looks like 'already clean'", () => {
  const p = pool();
  const r = run(p, "--only=nosuchrun");
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /--only pattern matched no run/);
});

// ── the execution gate survives the refactor ──────────────────────────────────────────────────────

test("--apply still refuses without --expect, and on a count mismatch", () => {
  const p = pool();
  const bare = run(p, "--keep-none", "--apply");
  assert.equal(bare.status, 2, bare.out);
  assert.match(bare.out, /requires --expect=/);

  const wrong = run(p, "--keep-none", "--apply", "--expect=2"); // manifest is 3
  assert.equal(wrong.status, 2, wrong.out);
  assert.match(wrong.out, /COUNT MISMATCH/);
});

test("dry run is the default and removes nothing", () => {
  const p = pool();
  const r = run(p, "--keep-none");
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Dry run\. Nothing removed\./);
});

// The source of truth for the backup archive is the delete set itself, not the human table re-parsed.
test("--paths prints only the delete-set directories", () => {
  const p = pool();
  const r = run(p, "--only=acmewidget", "--paths");
  assert.equal(r.status, 0, r.out);
  const lines = r.paths.trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 1, r.out);
  assert.match(lines[0], /tmp9003-acmewidget-2026-07-03-briar-probe$/);
  // THE POINT OF READING STDOUT ALONE. `--paths` is piped into a delete, so a note on stdout would be
  // handed to whatever consumes it as though it were a directory.
  assert.doesNotMatch(r.paths, /\[env-(local|aliases)\]/, "an environment note reached the piped path list");
});

// The regression this whole change is about: no real matter number, run id or codename compiled in.
test("no real runtime identifiers are hardcoded in the script", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(SCRIPT, "utf8");
  assert.doesNotMatch(src, /\bnoref[0-9a-f]{6}/, "a real runId is compiled in");
  assert.doesNotMatch(src, /\bTMP5\d{3}\b|\btmp5\d{3}[a-z-]/i, "a real matter number is compiled in");
  assert.doesNotMatch(src, /KEEP_RUN_IDS|KEEP_CUSTOMER_KEYS/, "the hardcoded keep-list is back");
});

// ── — A LIVE CLAIM OUTRANKS THE STATE FIELD ────────────────────────────────────────────────────
//
// `state === "running"` was this tool's only defence for a live run, and it reads a string out of a file
// any writer can flip. scripts/e2e.mjs teardown flipped exactly that field to `failed` on every run it
// tore down, announcing "no process was producing this run" while checking nothing. A live round, torn
// down, arrived here looking terminal.
//
// So these fixtures give the run the state teardown would have left — `failed` — and prove the run is
// still spared, because a queue claim names a process that is alive.

// A queue claim for `codename`, in the shape the runner writes: `<base>.processing.meta` carries the
// identity, `<base>.processing.pid` carries "<pid>:<starttime>". The pid is THIS test process, which is
// definitively alive, so the liveness answer is real rather than stubbed.
function queueClaim({ root, ...rest }, { codename, pid = process.pid, agent = "mailagent" }) {
  const q = join(root, "ws", `workspace-${agent}`, "studio", "clearance-search", "queue");
  mkdirSync(q, { recursive: true });
  const stat = (() => { try { return readFileSync(`/proc/${pid}/stat`, "utf8"); } catch { return null; } })();
  const starttime = stat ? stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)[19] : null;
  writeFileSync(join(q, "job-1.processing.meta"), JSON.stringify({ codename, dateISO: "2026-08-16", agentId: agent }));
  writeFileSync(join(q, "job-1.processing.pid"), starttime ? `${pid}:${starttime}` : String(pid));
  return { root, ...rest };
}

test("a run whose status says FAILED is still spared when a live queue claim holds it", () => {
  let p = pool([]);
  p = liveRun(p, { matter: "tmp9004-novapulse", codename: "2026-08-16-quiet-harbour",
    runId: "tmp9004-novapulse-2026-08-16-quiet-harbour", state: "failed" });
  p = queueClaim(p, { codename: "quiet-harbour" });   // the claim stores the BARE codename; the dir is dated
  const r = run(p, "--keep-none");
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(counts(r.out), { del: 0, keep: 1 },
    "the state field said delete; the process said otherwise, and the process wins");
  assert.match(r.out, /claim=alive/, "and the operator can SEE why it was kept");
});

test("VOID CONTROL: the same fixture with a DEAD claimer deletes — so the KEEP came from liveness", () => {
  // Without this, the test above would pass identically if the claim lookup silently kept everything —
  // which is exactly the bug this change introduced once already, when an absent queue directory was
  // read as "could not look" and the whole estate was spared.
  let p = pool([]);
  p = liveRun(p, { matter: "tmp9005-novapulse", codename: "2026-08-16-still-water",
    runId: "tmp9005-novapulse-2026-08-16-still-water", state: "failed" });
  p = queueClaim(p, { codename: "still-water", pid: 2147480000 });   // no such process
  const r = run(p, "--keep-none");
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(counts(r.out), { del: 1, keep: 0 },
    "a claim naming a process that is gone must not protect anything");
});

test("VOID CONTROL: with no queue at all the tool still deletes — an absent queue is not a shield", () => {
  // The regression that broke every purge test in this file: `config.queueDirs` synthesises a path for
  // the default agent whether or not it exists, and counting that ENOENT as "could not look" made every
  // run read `unknown` and survive. A purge that spares everything when no queue exists is broken.
  let p = pool([]);
  p = liveRun(p, { matter: "tmp9006-novapulse", codename: "2026-08-16-dry-dock",
    runId: "tmp9006-novapulse-2026-08-16-dry-dock", state: "failed" });
  const r = run(p, "--keep-none");
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(counts(r.out), { del: 1, keep: 0 });
});

test("a RUNNING run with no claim is still spared — the original guard is untouched", () => {
  // The change is ADDITIVE. It may turn a DELETE into a KEEP and never the reverse, so every protection
  // that existed before must still hold with the claim check answering "unclaimed".
  let p = pool([]);
  p = liveRun(p, { matter: "tmp9007-novapulse", codename: "2026-08-16-north-gate",
    runId: "tmp9007-novapulse-2026-08-16-north-gate", state: "running" });
  const r = run(p, "--keep-none");
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(counts(r.out), { del: 0, keep: 1 });
});

// ── A RUN WHOSE NOTICE IS STILL OWED ────────────────────────────────────────────────────────────────
//
// Nothing in this tool was keyed to an outstanding notice, so it would delete a finished run nobody had
// sent and take the packet with it, leaving the outbox holding a marker for a run that is no longer
// there — unsettleable, and empty. Three such markers are on production from 2026-09-04.
//
// THE OUTBOX IS RESOLVED THE WAY THE DELIVERY PATH RESOLVES IT, default included, so these fixtures
// write markers where the running product would write them rather than where a test found convenient.

/** The outbox the delivery path would resolve for this fixture, with the given runs owed. */
function outbox(env, owedRunIds = []) {
  const dir = join(env.wsRoot, "clearance-outbox");
  mkdirSync(dir, { recursive: true });
  for (const id of owedRunIds) writeFileSync(join(dir, `${id}.pending`), "mailagent\n");
  return dir;
}

function runOut(env, outboxDir, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: pinEnvAll({ ...process.env }, {
      CLEAROTRON_REPORTS_DIR: env.poolRoot, CLEAROTRON_WORK_DIR: env.wsRoot,
      ...(outboxDir === null ? {} : { CLEAROTRON_OUTBOX_DIR: outboxDir }),
    }),
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

test("the dry-run table MARKS a run whose notice is still owed", () => {
  const env = pool([["alpha", "acme"], ["beta", "acme"]]);
  const ob = outbox(env, ["alpha"]);
  const r = runOut(env, ob, "--keep-none");
  assert.equal(r.status, 0, r.out);
  const alpha = r.out.split("\n").find((l) => l.includes("alpha"));
  const beta = r.out.split("\n").find((l) => l.includes("beta"));
  assert.match(alpha, /OWED!/, "the owed run is marked");
  assert.doesNotMatch(beta, /OWED!/, "and the settled one is NOT — or the mark says nothing");
});

test("--apply REFUSES an owed run, names it, and removes nothing", () => {
  const env = pool([["alpha", "acme"], ["beta", "acme"]]);
  const ob = outbox(env, ["alpha"]);
  const r = runOut(env, ob, "--keep-none", "--apply", "--expect=2", `--expect-root=${env.poolRoot}`);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /REFUSING TO DELETE/);
  assert.match(r.out, /OWED\s+pool:alpha/, "the refusal names the run, not just a count");
  assert.ok(existsSync(join(env.poolRoot, "alpha")), "nothing removed");
  assert.ok(existsSync(join(env.poolRoot, "beta")), "and the refusal is for the WHOLE apply, not a skip");
});

test("--delete-owed-notices is what removes it, and the receipt records that it was owed", () => {
  const env = pool([["alpha", "acme"], ["beta", "acme"]]);
  const ob = outbox(env, ["alpha"]);
  const r = runOut(env, ob, "--keep-none", "--apply", "--expect=2",
    `--expect-root=${env.poolRoot}`, "--delete-owed-notices");
  assert.equal(r.status, 0, r.out);
  assert.ok(!existsSync(join(env.poolRoot, "alpha")), "the override is what deletes it");
  const log = readFileSync(join(env.poolRoot, ".purge-log.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(log.length, 1);
  assert.equal(log[0].overrodeOwed, true);
  assert.deepEqual(log[0].removed.find((x) => x.runId === "alpha").owed, "owed",
    "the record says WHICH of them was owed, which is the point of keeping one");
  assert.deepEqual(log[0].removed.find((x) => x.runId === "beta").owed, "settled");
  assert.ok(log[0].at && log[0].pool === env.poolRoot, "when, and from where");
});

test("an outbox that cannot be READ refuses too — a blind check is not a passed one", {
  skip: process.platform === "win32" && "mode bits: the arm makes the outbox unreadable with chmod 000, and chmod on Windows cannot take read access from a folder",
}, () => {
  const env = pool([["alpha", "acme"]]);
  const ob = outbox(env, []);
  chmodSync(ob, 0o000);
  try {
    const r = runOut(env, ob, "--keep-none", "--apply", "--expect=1", `--expect-root=${env.poolRoot}`);
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, /UNKNOWN\s+pool:alpha/);
    assert.match(r.out, /could not be read/);
    assert.ok(existsSync(join(env.poolRoot, "alpha")), "nothing removed on a could-not-look");
  } finally { chmodSync(ob, 0o755); }
});

test("an outbox that was never created is EMPTY, not unknown — or every fresh estate refuses", () => {
  // THE OTHER SIDE OF THE ARM ABOVE, and the one that keeps it honest. If a missing directory read as
  // could-not-look, the refusal would fire on every estate that has never delivered anything, and an
  // operator would learn to pass --delete-owed-notices as a matter of course. An override typed by
  // habit protects nothing.
  const env = pool([["alpha", "acme"]]);
  const r = runOut(env, join(env.wsRoot, "no-outbox-here"), "--keep-none", "--apply", "--expect=1",
    `--expect-root=${env.poolRoot}`);
  assert.equal(r.status, 0, r.out);
  assert.ok(!existsSync(join(env.poolRoot, "alpha")), "a never-created outbox does not block a purge");
});

test("a receipt that cannot be written STOPS the delete", {
  skip: process.platform === "win32" && "mode bits: the arm makes the pool root unwritable with chmod 555, and chmod on Windows does not make a folder read-only",
}, () => {
  // Otherwise the record is decorative: the one tool that removes bytes would carry on removing them
  // with no way to reconstruct what went, which is the state this was filed about.
  const env = pool([["alpha", "acme"]]);
  const ob = outbox(env, []);
  chmodSync(env.poolRoot, 0o555);   // readable, not writable — the receipt cannot be appended
  try {
    const r = runOut(env, ob, "--keep-none", "--apply", "--expect=1", `--expect-root=${env.poolRoot}`);
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, /COULD NOT WRITE THE PURGE RECEIPT/);
    assert.ok(existsSync(join(env.poolRoot, "alpha")), "and it stopped BEFORE deleting, not after");
  } finally { chmodSync(env.poolRoot, 0o755); }
});
