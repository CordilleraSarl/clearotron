// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// status-snapshot.mjs — a single read-only snapshot of the LIVE clearance-run state, for the operations
// "Run status" surface (status.html). Pure file reads, no model, no gateway, no writes.
//
// Sources (all already exposed by the driver):
//   • run SLOTS         — live <pid>:<nonce>[:<tag>] lock files in runLockDir (slot-lock.mjs). A TURN
//                         slot count sat beside it until; the turn cap fenced an agent gateway's
//                         command lanes, and it left the product with the delivery mode that used it.
//   • QUEUE             — <id>.json (+ prose sidecars) waiting in each agent's studio/prelim-search/queue/,
//                         plus a .processing count (claimed-but-not-yet-published).
//   • IN-FLIGHT + POSTPONED + RECENT — enumerateRuns() over every workspace status.json (running /
//                         postponed [rate-limit paused, auto-resuming] / delivered / failed).
//
// Every path/dep is injectable so the snapshot unit-tests offline against a temp tree; defaults read the real
// driver layout. `now` is injected (not stamped here) so a test is deterministic and the caller controls it.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "./driver.config.mjs";
import { resolveNumericSetting } from "./numeric-setting.mjs";   // — resolve without the throw a diagnostic surface must not take
import { enumerateRuns as enumerateRunsDefault } from "../mcp-server/lib/runs.mjs";
import { readActivity as readActivityDefault } from "./run-activity.mjs";

// kill-0 liveness, matching slot-lock.mjs: EPERM proves the pid exists (another user), only ESRCH is death.
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === "EPERM"; }
}

// Count LIVE slot files in a lock dir (any "*.lock", any index/prefix) and collect their tags (the run-slot
// tag is the agent). Dead-pid locks and the nested turns/ dir (not a *.lock) are ignored. Absent dir ⇒ 0.
function countSlots(dir) {
  let inUse = 0; const tags = [];
  let names = [];
  try { names = readdirSync(dir).filter((n) => n.endsWith(".lock")); } catch { return { inUse: 0, tags }; }
  for (const n of names) {
    let raw; try { raw = readFileSync(join(dir, n), "utf8"); } catch { continue; }
    const f = String(raw).split(":");
    if (pidAlive(Number(f[0]) || 0)) { inUse++; const tag = f.slice(2).join(":"); if (tag) tags.push(tag); }
  }
  return { inUse, tags };
}

// …/<prefix><id>/studio/prelim-search/queue → "<id>"; "?" if the path isn't an agent queue dir.
function agentOfQueue(qdir) {
  return config.agentIdFromQueueDir(qdir) ?? "?";
}

// One queued job's display fields. markName is a prose SIDECAR (<base>.markName.md) since 2026-06-16 — read it
// raw, fall back to a legacy inline manifest value. A malformed manifest never throws (the job still lists).
function readJob(qdir, file) {
  const base = file.slice(0, -".json".length);
  let j = {}; try { j = JSON.parse(readFileSync(join(qdir, file), "utf8")); } catch { /* list it anyway */ }
  let markName = j.markName || null;
  try { const mp = join(qdir, `${base}.markName.md`); if (existsSync(mp)) markName = readFileSync(mp, "utf8").trim() || markName; } catch { /* sidecar optional */ }
  let enqueuedAt = null; try { enqueuedAt = statSync(join(qdir, file)).mtime.toISOString(); } catch { /* race */ }
  return {
    id: base, markName,
    classes: Array.isArray(j.classes) ? j.classes : (j.classes ?? null),
    ref: j.ref ?? null, profileKey: j.profileKey ?? null, forwarder: j.forwarder ?? null,
    enqueuedAt,
  };
}

function readQueues(queueDirs) {
  const queues = [];
  for (const qdir of queueDirs) {
    let names = []; try { names = readdirSync(qdir); } catch { continue; }
    const jobs = names.filter((n) => n.endsWith(".json")).map((n) => readJob(qdir, n))
      .sort((a, b) => String(a.enqueuedAt ?? "").localeCompare(String(b.enqueuedAt ?? "")));   // FIFO: oldest first
    const processing = names.filter((n) => n.endsWith(".processing")).length;
    queues.push({ agent: agentOfQueue(qdir), queued: jobs.length, processing, jobs });
  }
  return queues.sort((a, b) => a.agent.localeCompare(b.agent));
}

const slimRun = (r) => ({
  runId: r.runId, slug: r.slug, codename: r.codename, agent: r.agent,
  markName: r.markName, ref: r.ref, classes: r.classes,
  state: r.state, stepN: r.stepN, stepTotal: r.stepTotal, stepLabel: r.stepLabel,
  lastStage: r.lastStage,   // spec 64 C — the RAW stage key ("register-unit:primary-sweep"): what the run is actually doing
  verdict: r.verdict, statement: r.statement,   // spec 64 — THE one risk statement (absent on legacy runs)
  url: r.url, failedStage: r.failedStage, reason: r.reason,
  resetsAt: r.resetsAt,   // rate-limit POSTPONE ONLY: when the cap window clears + the run auto-resumes (ISO)
  recoveryResumesAt: r.recoveryResumesAt ?? null,   // recovery park's backoff clock (A4 split — never conflated with a provider cap)
  parkedKind: r.parkedKind ?? null,                 // parked-for-human discriminator (grace-exit)
  terminalKind: r.terminalKind ?? null,             // failed-with-artifacts: WHY the run ended (invalid-artifact-loop | reclaim-exhausted | …)
  startedAt: r.startedAt, updatedAt: r.updatedAt, deliveredAt: r.deliveredAt,
});

// Merge activity rows into ONE time-sorted list. Pure (data in → rows out) so it unit-tests offline; each
// source maps to a common {kind, when, label, outcome, url?}. It takes REPORTS ONLY: the finished-check,
// auto-fix and overnight mappers linked into the Quality hub, which retired, and a row pointing at a
// deleted page is worse than no row.
export function buildRecentActivity({ reports = [], limit = 12 } = {}) {
  const out = [];
  for (const r of reports) {
    const ok = r.state === "delivered";
    // spec 64 — a delivered run's outcome is THE one risk statement when the run carries it (band +
    // stance in one sentence), never a bare disposition word beside a severity word on another page.
    out.push({ kind: "report", ok, when: r.deliveredAt || r.updatedAt || r.startedAt || "", label: r.markName || r.slug || r.runId,
      outcome: ok ? (r.statement || r.verdict || "delivered") : `failed${r.failedStage ? " · " + r.failedStage : ""}`,
      url: r.url || (ok && r.runId ? `${r.runId}/report.html` : "") });
  }
  // ONE explicit time key per row: a report's `when` can come from any of three stamps, and they all sort on
  // whenMs, computed once. An unparseable stamp gets whenMs 0 (sinks to the bottom rather than faking
  // recency) + `whenUnknown` so the page renders "—" instead of a garbled slice.
  for (const row of out) {
    const ms = Date.parse(row.when);
    if (Number.isFinite(ms)) row.whenMs = ms; else { row.whenMs = 0; row.whenUnknown = true; }
  }
  return out.sort((a, b) => b.whenMs - a.whenMs).slice(0, limit);
}

/**
 * Assemble the live status/queue snapshot. All inputs default to the real driver layout; override for tests.
 * @returns {{schema, generatedAt, slots, queues, queuedTotal, inFlight, postponed, recent, recentActivity}}
 */
export function statusSnapshot({
  now = new Date().toISOString(),
  queueDirs = config.queueDirs,
  runLockDir = config.runLockDir,
  // — the NON-THROWING read, deliberately. The engine refuses a non-numeric cap by
  // name; this snapshot is the surface an operator opens to find out why nothing is draining, so it must
  // survive the misconfiguration it has to report. A cap that cannot be resolved is reported as absent
  // with its reason, never as a number nobody chose — the same rule this file already applies one field
  // over, where a cap nothing can reach is omitted rather than printed.
  runCap = resolveNumericSetting("CLEAROTRON_MAX_CONCURRENT_RUNS"),
  // The injected form stays a plain NUMBER, which is what every caller and test passes; the default is
  // the resolver's own answer. Normalised here so one field downstream reads the same either way.
  enumerate = enumerateRunsDefault,
  recentLimit = 8,
  // — no literal fallback. This is a READ-ONLY surface (it looks for the activity ledger beside a
  // pool), so an unconfigured machine gets null — "no pool here" — instead of being pointed at a
  // deployment's client archive. CLEAROTRON_STAFF_POOL_ROOT still wins where it is set: the CLIs that regenerate the
  // status/profiles pages are run by hand against a named pool.
  pool = process.env.CLEAROTRON_STAFF_POOL_ROOT || config.poolRootOrNull,
  ledgerPath = null,
  readActivity = readActivityDefault,
  // The activity window (reports). The Run-status page shows the newest ~12 live (auto-refreshing) and folds
  // the rest into a static, date-grouped "Earlier activity" section so you can page back in time (deeper
  // report history lives on the Clearance reports tab). Deep enough to be useful; still a small payload.
  activityLimit = 50,
} = {}) {
  const capRead = typeof runCap === "number" || runCap === null
    ? { ok: runCap !== null, value: runCap, reason: null }
    : runCap;
  let runs = [];
  try { runs = enumerate() || []; } catch { runs = []; }   // a torn workspace never breaks the snapshot
  // Presentation retire (2026-07-06, Jordan): a run whose status.json carries `retired: true` is hidden
  // from every status surface — the same reversible-flag pattern as the page retire. The
  // forensic record (.failed sentinel, run.jsonl, failure.json, the run dir) is untouched; flipping the
  // key back resurfaces the row. Set it with a one-key status.json merge, never by editing state.
  runs = runs.filter((r) => r?.status?.retired !== true);
  const inFlight = runs.filter((r) => r.state === "running").map(slimRun);
  // rate-limit POSTPONE: paused-but-alive runs awaiting the cap reset. Their own bucket (NOT recent/done) so
  // the UI shows them as in-progress-paused with a resume time, instead of dropping them (they match neither
  // running nor delivered/failed). Newest-first like the rest.
  // RECOVERING belongs here too (2026-07-29 hardening): an auto-recovery park is paused-but-alive exactly
  // like a rate-limit park — it writes state "recovering" with its own backoff clock, and matching NO bucket
  // made every recovering run invisible on status.html for as long as it backed off.
  // parked-for-human (A5 grace-exit) is the same shape — a run cut by a deploy restart must stay on the
  // ops surface (the zombie face), not vanish.
  const postponed = runs.filter((r) => r.state === "postponed" || r.state === "recovering" || r.state === "parked-for-human").map(slimRun);
  const done = runs.filter((r) => r.state === "delivered" || r.state === "failed");
  const recent = done.slice(0, recentLimit).map(slimRun);
  // The activity feed gets its OWN report window (activityLimit, like every other source) — it used to reuse
  // `recent` (recentLimit=8), so only the 8 newest reports were ever eligible for a 50-row feed and a burst of
  // checks could crowd reports out of "Earlier activity" entirely. `recent` (the slim legacy bucket) keeps its
  // own cap for its own consumers.
  const reportRows = done.slice(0, activityLimit).map(slimRun);

  const run = countSlots(runLockDir);
  const queues = readQueues(queueDirs);

  // The activity feed is REPORTS-ONLY. It was split that way so a finished quality check reported its
  // health on the Quality hub rather than here; retired the hub, and with it the finished-check,
  // auto-fix and overnight rows that pointed at it. Checks still ALIVE (waiting/running — they hold a run
  // slot) are operational, so they keep their own bucket, rendered inside "In flight".
  const lp = ledgerPath || (pool ? join(pool, "run-activity.jsonl") : null);
  let checks = []; try { checks = lp ? readActivity(lp, { limit: activityLimit, now }) : []; } catch { checks = []; }
  const checksInProgress = checks
    .filter((a) => !a.stale && (a.state === "waiting" || a.state === "running"))
    .map((a) => ({ id: a.id, label: a.label || a.case || "quality check", case: a.case || null, state: a.state, ts: a.ts || "" }));
  const recentActivity = buildRecentActivity({ reports: reportRows, limit: activityLimit });

  return {
    schema: 1,
    generatedAt: now,
    // — `turn` IS GONE FROM THIS OBJECT rather than pinned to zero. Nothing acquires a turn slot
    // any more, so the pair would have read `{inUse: 0, cap: 3}` on every box forever: a configured
    // limit and a usage count, both true, describing a mechanism that no longer exists. An operations
    // surface that shows a cap nothing can reach is worse than one that shows nothing.
    slots: {
      run: {
        inUse: run.inUse,
        // A number when the setting resolves, null when it does not — and `capProblem` then carries the
        // sentence naming the variable and what it holds, so the page states the misconfiguration
        // instead of leaving a reader to infer it from a missing number.
        cap: capRead.ok ? Math.max(1, capRead.value) : null,
        ...(capRead.ok ? {} : { capProblem: capRead.reason }),
        agents: run.tags,
      },
    },
    queues,
    queuedTotal: queues.reduce((n, q) => n + q.queued, 0),
    inFlight,
    postponed,
    recent,
    recentActivity,
    checksInProgress,
  };
}
