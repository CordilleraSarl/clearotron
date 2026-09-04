// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives real runner processes through SIGKILL and re-drain
// B1 — crash-safe run identity, across REAL processes (the slot-lock-xproc pattern): a runner child is
// SIGKILLed mid-run and the re-drain must RESUME the dispatch-persisted codename (completed billable
// stages skip) instead of minting a fresh one and re-spending; a dead claimer whose run already DELIVERED
// is consumed as .done and never re-run (the post-delivery-pre-.done crash window that once
// double-delivered a full report); a meta-less claim keeps the legacy fresh re-claim. In-process tests
// cannot cover any of this — the crash window IS the feature.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, chmodSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { todayISO } from "../phase0.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";
import { deadClaimToken } from "./claim-fixtures.mjs";   // — pid+starttime, never a bare pid
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

const job = (ref, mark) => ({
  id: `crash-${ref}`, msgId: `<crash-${ref}@x>`, forwarder: "requesting-lawyer", forwarderDomain: "example.com",
  ref, markName: mark, classes: [9], provider: "corsearch",
});
const studioFor = (root) => join(root, "workspace-clawdi", "studio", "prelim-search");
const queueFor = (root) => join(studioFor(root), "queue");

// Child env: explicit, so a knob a sibling test exported can never leak into the spawned runner.
function envFor(root, extra = {}) {
  const env = {
    ...process.env,
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_OUTBOX_DIR: join(root, "outbox"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    CLEAROTRON_QUEUE_SCAN_MS: "100", CORSEARCH_SESSION_KEY: "test-offline",
    ...extra,
  };
  for (const k of ["MOCK_BARRIER_FILE", "MOCK_BARRIER2_FILE", "MOCK_FAIL_STAGE"]) if (!(k in extra)) delete env[k];
  return env;
}

const spawnRunner = (env) => {
  const c = spawn(process.execPath, [RUNNER], { env, stdio: ["ignore", "pipe", "pipe"] });
  c.log = "";
  c.stdout.on("data", (d) => { c.log += d; });
  c.stderr.on("data", (d) => { c.log += d; });
  // capture at SPAWN time — an "exit" listener registered after the child already exited never fires
  c.exited = new Promise((r) => c.on("exit", (code) => r(code)));
  return c;
};
const exited = (c) => c.exited;
const waitFor = async (pred, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
};
// A really-dead pid: a child that has already exited (the slot-lock-xproc precedent).
// The one-marker invariant: a base owns AT MOST one queue marker at any instant (claims are renames —
// two concurrent claims of one base would show up as marker duplication or a .json↔.processing overlap).
function assertOneMarker(qdir, base) {
  const markers = readdirSync(qdir).filter((f) => new RegExp(`^${base}\\.(json|processing|done|failed|postponed|duplicate)$`).test(f));
  assert.ok(markers.length <= 1, `base ${base} owns ${markers.length} queue markers at once: ${markers.join(", ")}`);
}
const runsFor = (root, slug) => {
  const isRun = (n) => /^\d{4}-\d\d-\d\d-/.test(n);   // run leaves only — not slug-level machinery like _plans
  const out = [];
  try { out.push(...readdirSync(join(studioFor(root), slug)).filter(isRun).map((n) => `live:${n}`)); } catch { /* none */ }
  const arch = join(studioFor(root), "archive");
  try {
    for (const m of nonEmpty(readdirSync(arch), "readdirSync(arch)")) {
      try { out.push(...readdirSync(join(arch, m, slug)).filter(isRun).map((n) => `archived:${n}`)); } catch { /* other slug */ }
    }
  } catch { /* no archive */ }
  return out;
};

test("SIGKILLed claimer with identity meta → re-drain RESUMES the same codename; completed stages skip; exactly one run", async () => {
  const root = mkdtempSync(join(tmpdir(), "crashid-resume-"));
  const Q = queueFor(root);
  mkdirSync(Q, { recursive: true });
  const J = job("TMP9101", "CRASH PROBE");
  const slug = "tmp9101-crash-probe";
  writeFileSync(join(Q, "job-a.json"), JSON.stringify(J));

  // Barrier2 holds the prelim-variants turn, so matter-frame COMPLETES and the run is provably mid-flight.
  const barrier2 = join(root, "release-variants");
  const env = envFor(root, { MOCK_BARRIER2_FILE: barrier2 });
  const claimer = spawnRunner(env);
  const metaPath = join(Q, "job-a.processing.meta");
  assert.ok(await waitFor(() => existsSync(metaPath)), `dispatch wrote the identity meta\n${claimer.log}`);
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  assert.ok(meta.codename && meta.dateISO && meta.agentId === "clawdi", `meta carries the identity: ${JSON.stringify(meta)}`);
  const runDir = join(studioFor(root), slug, `${meta.dateISO}-${meta.codename}`);
  assert.ok(await waitFor(() => existsSync(join(runDir, "matter-context.md"))), `matter-frame completed before the kill\n${claimer.log}`);

  claimer.kill("SIGKILL");
  await exited(claimer);
  assert.ok(existsSync(join(Q, "job-a.processing")), "the claim survived the crash as .processing");

  // Release the barrier FIRST so the orphaned mock turn (execFile grandchild, still parked on the barrier)
  // finishes and exits before the re-drain starts — no write race on the fixture files.
  writeFileSync(barrier2, "go");
  await new Promise((r) => setTimeout(r, 700));

  const redrain = spawnRunner(env);
  // Never-two-claims invariant, sampled live while the re-drain runs: the takeover keeps the job
  // .processing end-to-end (no .json window a sibling could race) until the atomic terminal rename.
  let sawJson = false;
  while (redrain.exitCode === null) {
    assertOneMarker(Q, "job-a");
    if (existsSync(join(Q, "job-a.json"))) sawJson = true;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.equal(await exited(redrain), 0, `re-drain exited clean\n${redrain.log}`);
  assert.ok(!sawJson, "a meta-carrying reclaim never re-opens a .json claim window");

  assert.ok(existsSync(join(Q, "job-a.done")), `re-drain finished the job\n${redrain.log}`);
  const res = JSON.parse(readFileSync(join(Q, "job-a.done.result"), "utf8"));
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(basename(res.runDir).endsWith(`-${meta.codename}`), `SAME codename resumed (no fresh mint): ${res.runDir} vs ${meta.codename}`);

  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const starts = events.filter((e) => e.event === "start");
  assert.equal(starts.length, 2, "one cold start + one crash-resume");
  assert.equal(starts[1].resume, true, "the re-dispatch went through the RESUME path");
  assert.equal(starts[1].job.codename, meta.codename, "the resume rebuilt the dispatch-minted identity");
  assert.ok(events.some((e) => e.event === "skip" && /^matter-frame/.test(e.stage)),
    "the completed matter-frame stage was SKIPPED, not re-bought");

  const runs = runsFor(root, slug);
  assert.equal(runs.length, 1, `exactly one run exists across live+archive (no re-spend): ${runs.join(", ")}`);
  assert.ok(!existsSync(metaPath) && !existsSync(join(Q, "job-a.processing.pid")), "claim sidecars swept on terminal");
});

test("dead claimer whose run already DELIVERED (live dir, .delivered) → queue entry marked .done, NOT re-run", async () => {
  const root = mkdtempSync(join(tmpdir(), "crashid-delivered-"));
  const Q = queueFor(root);
  mkdirSync(Q, { recursive: true });
  const J = job("TMP9102", "DELIVERED PROBE");
  const slug = "tmp9102-delivered-probe";
  const date = todayISO();
  const runDir = join(studioFor(root), slug, `${date}-copper-anvil`);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, ".delivered"), JSON.stringify({ verdict: "CLEAR" }));
  writeFileSync(join(Q, "job-d.processing"), JSON.stringify(J));
  writeFileSync(join(Q, "job-d.processing.pid"), await deadClaimToken());
  writeFileSync(join(Q, "job-d.processing.meta"), JSON.stringify({ codename: "copper-anvil", dateISO: date, agentId: "clawdi" }));

  const c = spawnRunner(envFor(root));
  assert.equal(await exited(c), 0, c.log);
  assert.ok(existsSync(join(Q, "job-d.done")), `consumed as .done\n${c.log}`);
  const res = JSON.parse(readFileSync(join(Q, "job-d.done.result"), "utf8"));
  assert.equal(res.recovered, "already-delivered");
  assert.equal(res.codename, "copper-anvil");
  assert.ok(!existsSync(driverDir(runDir, "run.jsonl")), "the pipeline was NEVER re-dispatched");
  assert.equal(runsFor(root, slug).length, 1, "still exactly one run");
});

test("dead claimer whose run was ARCHIVED (post-delivery crash left no live dir) → .done, NOT re-run", async () => {
  const root = mkdtempSync(join(tmpdir(), "crashid-archived-"));
  const Q = queueFor(root);
  mkdirSync(Q, { recursive: true });
  const J = job("TMP9103", "ARCHIVED PROBE");
  const slug = "tmp9103-archived-probe";
  const date = todayISO();
  const archDir = join(studioFor(root), "archive", date.slice(0, 7), slug, `${date}-marble-vault`);
  mkdirSync(archDir, { recursive: true });
  writeFileSync(join(Q, "job-e.processing"), JSON.stringify(J));
  writeFileSync(join(Q, "job-e.processing.pid"), await deadClaimToken());
  writeFileSync(join(Q, "job-e.processing.meta"), JSON.stringify({ codename: "marble-vault", dateISO: date, agentId: "clawdi" }));

  const c = spawnRunner(envFor(root));
  assert.equal(await exited(c), 0, c.log);
  assert.ok(existsSync(join(Q, "job-e.done")), `consumed as .done\n${c.log}`);
  const res = JSON.parse(readFileSync(join(Q, "job-e.done.result"), "utf8"));
  assert.equal(res.recovered, "already-delivered");
  assert.equal(res.runDir, archDir);
});

test("A2 — stale EARLIER-date run dir shares today's codename → a fresh job is NOT consumed as its .done; the client search runs", async () => {
  // The A2 silent-loss: a dead claimer's meta.dateISO is TODAY, but a lingering same-slug run dir from an
  // EARLIER date happens to share the (random) codename AND is delivered. The date-agnostic endsWith lookup
  // used to match that stale LIVE dir and mark the BRAND-NEW job .done "already-delivered" — the client
  // search never happened. The exact `${dateISO}-${codename}` lookup no longer matches the earlier-date dir.
  // NOTE: the stale dir is LIVE (a studio run dir), not archived — a different-MONTH archived dir is already
  // excluded by findRunDirFor's month scoping (`months = [dateISO.slice(0,7)]`), which the fix did NOT touch,
  // so an archived fixture would pass even with the exact-leaf fix reverted (it never exercises the fix). The
  // LIVE dir is scanned month-agnostically off studioRoot/slug, so ONLY the exact-leaf change gates it.
  const root = mkdtempSync(join(tmpdir(), "crashid-a2loss-"));
  const Q = queueFor(root);
  mkdirSync(Q, { recursive: true });
  const J = job("TMP9105", "COLLISION PROBE");
  const slug = "tmp9105-collision-probe";
  const today = todayISO();
  // A DELIVERED LIVE run of the SAME codename from an EARLIER date, still sitting in the studio (never
  // archived). It carries every marker the reclaim's delivered-check (runDirDelivered) inspects.
  const staleDate = "2026-06-15";
  const staleLive = join(studioFor(root), slug, `${staleDate}-copper-anvil`);
  mkdirSync(driverDir(staleLive), { recursive: true });
  writeFileSync(join(staleLive, ".delivered"), JSON.stringify({ verdict: "CLEAR" }));
  writeFileSync(join(staleLive, "status.json"), JSON.stringify({ state: "delivered", verdict: "CLEAR" }));
  // A crashed dead claimer for a BRAND-NEW job — meta carries TODAY's date + the colliding codename.
  writeFileSync(join(Q, "job-c.processing"), JSON.stringify(J));
  writeFileSync(join(Q, "job-c.processing.pid"), await deadClaimToken());
  writeFileSync(join(Q, "job-c.processing.meta"), JSON.stringify({ codename: "copper-anvil", dateISO: today, agentId: "clawdi" }));

  const c = spawnRunner(envFor(root));
  assert.equal(await exited(c), 0, c.log);
  assert.ok(existsSync(join(Q, "job-c.done")), `finished the job\n${c.log}`);
  const res = JSON.parse(readFileSync(join(Q, "job-c.done.result"), "utf8"));
  assert.notEqual(res.recovered, "already-delivered", "the stale earlier-date LIVE dir must NOT be mistaken for this run");
  assert.equal(res.ok, true, `the job actually RAN (not falsely consumed as already-delivered): ${JSON.stringify(res)}`);
  // A real TODAY run dir was produced for this slug (the client search happened), distinct from the stale one.
  const runs = runsFor(root, slug);
  assert.ok(runs.some((r) => /:2026-\d\d-\d\d-/.test(r) && r.includes(today)), `a TODAY run exists: ${runs.join(", ")}`);
  assert.ok(!existsSync(driverDir(staleLive, "run.jsonl")), "the stale earlier-date dir was never touched");
  assert.ok(existsSync(join(staleLive, ".delivered")), "the stale earlier-date dir was left intact (never resumed/cleared)");
});

test("A2 — crash-reclaim RESUMES today's dir even when an earlier-date dir shares the codename (not the stale dir)", async () => {
  const root = mkdtempSync(join(tmpdir(), "crashid-a2resume-"));
  const Q = queueFor(root);
  mkdirSync(Q, { recursive: true });
  const J = job("TMP9106", "RESUME COLLISION");
  const slug = "tmp9106-resume-collision";
  writeFileSync(join(Q, "job-r.json"), JSON.stringify(J));

  const barrier2 = join(root, "release-variants");
  const env = envFor(root, { MOCK_BARRIER2_FILE: barrier2 });
  const claimer = spawnRunner(env);
  const metaPath = join(Q, "job-r.processing.meta");
  assert.ok(await waitFor(() => existsSync(metaPath)), `dispatch wrote the identity meta\n${claimer.log}`);
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  const todayRun = join(studioFor(root), slug, `${meta.dateISO}-${meta.codename}`);
  assert.ok(await waitFor(() => existsSync(join(todayRun, "matter-context.md"))), `matter-frame completed before the kill\n${claimer.log}`);
  // Plant a lingering EARLIER-date run dir sharing the just-minted codename — the collision trap.
  const staleRun = join(studioFor(root), slug, `2026-06-15-${meta.codename}`);
  mkdirSync(staleRun, { recursive: true });

  claimer.kill("SIGKILL");
  await exited(claimer);
  writeFileSync(barrier2, "go");
  await new Promise((r) => setTimeout(r, 700));

  const redrain = spawnRunner(env);
  assert.equal(await exited(redrain), 0, `re-drain exited clean\n${redrain.log}`);
  assert.ok(existsSync(join(Q, "job-r.done")), `re-drain finished the job\n${redrain.log}`);
  const res = JSON.parse(readFileSync(join(Q, "job-r.done.result"), "utf8"));
  assert.equal(res.ok, true, JSON.stringify(res));
  // The resume must target TODAY's dir (its leaf keeps its original date), NEVER the stale earlier-date dir.
  assert.equal(basename(res.runDir), `${meta.dateISO}-${meta.codename}`, `resumed TODAY's dir: ${res.runDir}`);
  assert.ok(!existsSync(driverDir(staleRun, "run.jsonl")), "the stale earlier-date dir was never resumed into");
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(events.filter((e) => e.event === "start").some((e) => e.resume === true), "the re-dispatch went through RESUME");
});

test("A4 — run dir with delivery.json but NO .delivered sentinel → marked .done, NOT re-handed-off (no double-send)", async () => {
  const root = mkdtempSync(join(tmpdir(), "crashid-a4deliv-"));
  const Q = queueFor(root);
  mkdirSync(Q, { recursive: true });
  const J = job("TMP9107", "TAIL CRASH PROBE");
  const slug = "tmp9107-tail-crash-probe";
  const date = todayISO();
  // The delivery tail committed delivery.json (+ .sent from the send) but CRASHED before the .delivered
  // sentinel — a live dir the reclaim must treat as delivered, or a resume re-sends the report.
  const runDir = join(studioFor(root), slug, `${date}-marble-lattice`);
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(driverDir(runDir, "delivery.json"), JSON.stringify({ runId: `${slug}-marble-lattice`, url: "https://x/report" }));
  writeFileSync(join(runDir, ".sent"), "sent");
  writeFileSync(join(Q, "job-t.processing"), JSON.stringify(J));
  writeFileSync(join(Q, "job-t.processing.pid"), await deadClaimToken());
  writeFileSync(join(Q, "job-t.processing.meta"), JSON.stringify({ codename: "marble-lattice", dateISO: date, agentId: "clawdi" }));

  const c = spawnRunner(envFor(root));
  assert.equal(await exited(c), 0, c.log);
  assert.ok(existsSync(join(Q, "job-t.done")), `consumed as .done\n${c.log}`);
  const res = JSON.parse(readFileSync(join(Q, "job-t.done.result"), "utf8"));
  assert.equal(res.recovered, "already-delivered", "the delivery.json tail is treated as delivered");
  assert.equal(res.codename, "marble-lattice");
  assert.ok(!existsSync(driverDir(runDir, "run.jsonl")), "the pipeline was NEVER re-dispatched");
  assert.ok(existsSync(join(runDir, ".sent")), "the .sent guard was NOT cleared (no re-handoff → no double-send)");
  assert.ok(existsSync(driverDir(runDir, "delivery.json")), "the delivery packet survived intact");
});

test("A4 — run dir with status.state 'delivered' but NO .delivered sentinel → marked .done, NOT re-run", async () => {
  const root = mkdtempSync(join(tmpdir(), "crashid-a4status-"));
  const Q = queueFor(root);
  mkdirSync(Q, { recursive: true });
  const J = job("TMP9108", "STATUS DELIVERED PROBE");
  const slug = "tmp9108-status-delivered-probe";
  const date = todayISO();
  const runDir = join(studioFor(root), slug, `${date}-quartz-lattice`);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "status.json"), JSON.stringify({ state: "delivered", verdict: "CLEAR" }));
  writeFileSync(join(Q, "job-s.processing"), JSON.stringify(J));
  writeFileSync(join(Q, "job-s.processing.pid"), await deadClaimToken());
  writeFileSync(join(Q, "job-s.processing.meta"), JSON.stringify({ codename: "quartz-lattice", dateISO: date, agentId: "clawdi" }));

  const c = spawnRunner(envFor(root));
  assert.equal(await exited(c), 0, c.log);
  assert.ok(existsSync(join(Q, "job-s.done")), `consumed as .done\n${c.log}`);
  const res = JSON.parse(readFileSync(join(Q, "job-s.done.result"), "utf8"));
  assert.equal(res.recovered, "already-delivered");
  assert.ok(!existsSync(driverDir(runDir, "run.jsonl")), "the pipeline was NEVER re-dispatched");
});

test("dead claimer WITHOUT identity meta (legacy) → fresh re-claim, fresh mint, runs to .done", async () => {
  const root = mkdtempSync(join(tmpdir(), "crashid-legacy-"));
  const Q = queueFor(root);
  mkdirSync(Q, { recursive: true });
  const J = job("TMP9104", "LEGACY PROBE");
  const slug = "tmp9104-legacy-probe";
  writeFileSync(join(Q, "job-l.processing"), JSON.stringify(J));
  writeFileSync(join(Q, "job-l.processing.pid"), await deadClaimToken());

  const c = spawnRunner(envFor(root));
  assert.equal(await exited(c), 0, c.log);
  assert.ok(existsSync(join(Q, "job-l.done")), `legacy re-claim ran the job\n${c.log}`);
  const res = JSON.parse(readFileSync(join(Q, "job-l.done.result"), "utf8"));
  assert.equal(res.ok, true, JSON.stringify(res));
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(events.filter((e) => e.event === "start").length, 1, "one cold start — the fresh-mint path");
  assert.equal(events.find((e) => e.event === "start").resume, false);
  assert.equal(runsFor(root, slug).length, 1);
});
