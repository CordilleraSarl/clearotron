// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// outbox-backoff.mjs — C5: wake-failure detection + paced retry for the instant-delivery outbox.
//
// deliver-trigger.sh used to clear every *.pending marker UNCONDITIONALLY after the wake, even when the
// courier's agent turn itself failed (the CLI exits 0 on stopReason:"error"), silently degrading each failed
// wake to the ≤55m HEARTBEAT backstop — which doesn't run at all 22:00–05:00 (activeHours). This module
// owns the three decisions the shell can't unit-test:
//
//   check  — is this agent's wake DUE, or still inside a backoff window from an earlier failure?
//   settle — did this wake SUCCEED (clear markers + sidecar) or FAIL (retain markers, write/update the
//            backoff sidecar: exponential delay, capped, retry-count bounded → "giveup" hands the lane
//            back to the rescan timer instead of holding markers forever)?
//   rescan — deterministic belt-and-braces: re-drop a <runId>.pending marker for every run still
//            sendPending with no .sent, so a lost/given-up marker (or an overnight finish) is retried
//            on the prelim-outbox.timer cadence independent of heartbeat activeHours.
//
// TIGHT-LOOP INVARIANT (load-bearing): prelim-outbox.path is PathExistsGlob=…/prelim-outbox/*.pending —
// level-triggered, so a RETAINED marker re-triggers the service the moment it deactivates. The backoff
// sidecars therefore live in <outbox>/backoff/ — a subdirectory the glob can never match (`*` does not
// cross `/`, and "backoff" has no .pending suffix; inotify on the outbox dir doesn't recurse either) —
// and deliver-trigger.sh SLEEPS the shortest not-due wait inside the activation, so the re-trigger
// cadence equals the backoff, never a hot loop. check/settle only decide; the shell does the rm/sleep.
//
// Fail-safe: every CLI verb catches its own errors and answers the delivery-preserving default
// ("due" / "retry 300") — a broken helper must degrade to retried wakes, never to lost deliveries.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./driver.config.mjs";
import { atomicWrite } from "./progress.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings

// Tunables (env-overridable for tests; production uses the defaults). Delay for the Nth consecutive
// failure = min(base·2^(N−1), cap); past maxRetries the verdict is "giveup": the shell clears the
// markers (ending the .path retrigger cycle) and the sidecar keeps a long cooldown so the rescan
// timer's re-dropped marker doesn't hot-retry a persistently broken wake either.
const tunables = () => ({
  baseSec: Math.max(1, Number(process.env.CLEAROTRON_OUTBOX_BACKOFF_BASE_SEC || 60)),
  capSec: Math.max(1, Number(process.env.CLEAROTRON_OUTBOX_BACKOFF_CAP_SEC || 900)),
  maxRetries: Math.max(1, Number(process.env.CLEAROTRON_OUTBOX_BACKOFF_MAX_RETRIES || 5)),
  giveupCooldownSec: Math.max(1, Number(process.env.CLEAROTRON_OUTBOX_GIVEUP_COOLDOWN_SEC || 3600)),
});

// No-progress circuit-breaker: after this many CONSECUTIVE ok-but-unconsumed wakes for the SAME marker,
// the marker is set aside (quarantined) and a human alert is queued. This closes the gap the runaway
// spend fell through — the wakes that burned $380 all returned status ok (mark_sent → alreadySent:true
// reads as "consuming"), so classifyWake never faulted and the level-triggered .path re-fired forever.
// Progress, not just success, is the signal.
// 5 (matching maxRetries) × the exponential pace ≈ a ~15min grace before a marker is set aside — enough
// for a slow fix (e.g. an admin adding a BLOCKED recipient to the allowlist) to let a normal wake deliver
// it first. Each wake is now cheap (fresh session + Haiku), so the extra grace costs ~nothing.
const noProgressMax = () => Math.max(1, Number(process.env.CLEAROTRON_OUTBOX_NOPROGRESS_MAX || 5));

const backoffDir = () => join(config.outboxDir, "backoff");
const sidecarPath = (agent) => join(backoffDir(), `${agent}.json`);
const quarantineDir = () => join(config.outboxDir, "quarantine");

function readSidecar(agent) {
  try { return JSON.parse(readFileSync(sidecarPath(agent), "utf8")); }
  catch { return null; }   // absent or torn — reads as "no backoff in force" (fail toward retrying)
}

// Mirrors gateway.mjs parseJsonStdout (not imported: that module pulls the whole engine chain, and this
// helper runs on every outbox fire): under --json stdout is clean JSON, but be defensive about stray
// prefix lines anyway.
export function parseJsonStdout(stdout) {
  const s = (stdout ?? "").trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch { /* fall through */ }
  const nl = s.lastIndexOf("\n{");
  if (nl >= 0) { try { return JSON.parse(s.slice(nl + 1)); } catch { /* fall through */ } }
  const br = s.indexOf("{");
  if (br >= 0) { try { return JSON.parse(s.slice(br)); } catch { /* fall through */ } }
  return null;
}

// Did the wake WORK? Same envelope reading as gateway.mjs stage classification, plus the class that
// caused the 2026-07 silent degradations: the CLI exits 0 with status "ok" while the agent TURN itself
// errored (result.stopReason === "error") — the delivery never ran, so it must count as a failure.
export function classifyWake({ code, stdout }) {
  if (Number(code) !== 0) return { ok: false, reason: `nonzero_exit_${code}` };   // 124/137 = timeout(1) TERM/KILL
  const json = parseJsonStdout(stdout);
  if (!json) return { ok: false, reason: "unparseable_json" };
  if (json.status !== "ok") return { ok: false, reason: `status_${json.status}` };
  if (json.result?.stopReason === "error") return { ok: false, reason: "stop_reason_error" };
  return { ok: true, reason: null };
}

// Is a wake for this agent due, or still inside an earlier failure's backoff window?
export function checkDue(agent, now = Date.now()) {
  const sc = readSidecar(agent);
  if (!sc?.nextDueAt) return { due: true, retries: sc?.retries ?? 0, waitSec: 0 };
  const waitMs = Date.parse(sc.nextDueAt) - now;
  if (!Number.isFinite(waitMs) || waitMs <= 0) return { due: true, retries: sc.retries ?? 0, waitSec: 0 };
  return { due: false, retries: sc.retries ?? 0, waitSec: Math.ceil(waitMs / 1000) };
}

export function recordSuccess(agent) {
  try { rmSync(sidecarPath(agent), { force: true }); } catch { /* best-effort — a stale sidecar only delays */ }
}

export function recordFailure(agent, reason, now = Date.now()) {
  const t = tunables();
  const retries = (readSidecar(agent)?.retries ?? 0) + 1;
  const giveup = retries >= t.maxRetries;
  const delaySec = giveup ? t.giveupCooldownSec : Math.min(t.baseSec * 2 ** (retries - 1), t.capSec);
  const sidecar = {
    agent, retries, lastReason: String(reason ?? "unknown"),
    nextDueAt: new Date(now + delaySec * 1000).toISOString(), updatedAt: new Date(now).toISOString(),
  };
  try {
    mkdirSync(backoffDir(), { recursive: true });
    atomicWrite(sidecarPath(agent), JSON.stringify(sidecar, null, 2) + "\n");
  } catch { /* best-effort — with no sidecar the next fire just retries immediately-but-bounded */ }
  return { outcome: giveup ? "giveup" : "retry", waitSec: delaySec, retries };
}

// One call the shell makes after each wake: classify the outcome and update the sidecar accordingly.
// A FAILED wake goes to the failure backoff (unchanged). A SUCCESSFUL turn is not the end of the story:
// it only counts if it actually CONSUMED the markers — an ok wake that leaves the same markers behind is
// a no-progress wake and feeds the circuit-breaker below.
export function settleWake(agent, { code, stdout }, now = Date.now()) {
  const c = classifyWake({ code, stdout });
  if (!c.ok) return { ...recordFailure(agent, c.reason, now), reason: c.reason };
  return settleProgress(agent, now);
}

// Which *.pending markers currently route to <agent>? Mirrors deliver-trigger.sh's grouping exactly: a
// JSON packet carries an "agent" field; a legacy delivered marker's first-line body IS the agent id.
export function markersForAgent(agent) {
  let names = [];
  try { names = readdirSync(config.outboxDir).filter((f) => f.endsWith(".pending")); } catch { return []; }
  const out = [];
  for (const file of names.sort()) {
    let raw;
    try { raw = readFileSync(join(config.outboxDir, file), "utf8"); } catch { continue; } // raced an ack — skip
    let who = null, kind = "delivered";
    if (raw.trimStart().startsWith("{")) {
      try { const j = JSON.parse(raw); who = j.agent != null ? String(j.agent) : null; kind = j.kind != null ? String(j.kind) : "delivered"; }
      catch { who = null; }
    } else {
      who = raw.split("\n")[0].trim();
    }
    if (who === agent) out.push({ file, path: join(config.outboxDir, file), kind });
  }
  return out;
}

// Set a stuck marker aside so the level-triggered .path unit can never re-fire on it again, keep the
// payload (moved, never deleted), and record it in an audit log. INTEGRATOR-AGNOSTIC by design: the
// engine does NOT push a "please notify an admin" packet into the delivery outbox — "who the operator is"
// is integrator config the engine can't know, and the delivery outbox is the REQUESTER's channel, not an
// ops channel. Operators surface stuck deliveries from this audit record / the MCP read surface however
// their own agent chooses. Recovery is manual and recorded here so it's discoverable.
function quarantineStuckMarker(agent, marker, strikes, now) {
  try {
    mkdirSync(quarantineDir(), { recursive: true });
    try { renameSync(marker.path, join(quarantineDir(), marker.file)); }
    catch { return false; }   // raced away between listing and move — nothing to quarantine
    const rec = {
      ts: new Date(now).toISOString(), agent, marker: marker.file, kind: marker.kind, strikes,
      note: "no-progress: an OK wake failed to consume this marker N times running — set aside to stop the .path re-fire loop",
      recover: `once the underlying issue is fixed, retry by moving quarantine/${marker.file} back to the outbox root`,
    };
    try { writeFileSync(join(quarantineDir(), "STUCK-ALERTS.jsonl"), JSON.stringify(rec) + "\n", { flag: "a" }); }
    catch { /* best-effort — the moved marker is the primary record; the journal line also names it */ }
    return true;
  } catch { return false; }
}

function writeStrikeSidecar(agent, strikes, waitSec, now) {
  if (Object.keys(strikes).length === 0) { recordSuccess(agent); return; }   // nothing left to track
  const sc = readSidecar(agent) || {};
  const sidecar = {
    agent, retries: sc.retries ?? 0, markerStrikes: strikes, lastReason: "no_progress",
    nextDueAt: new Date(now + waitSec * 1000).toISOString(), updatedAt: new Date(now).toISOString(),
  };
  try { mkdirSync(backoffDir(), { recursive: true }); atomicWrite(sidecarPath(agent), JSON.stringify(sidecar, null, 2) + "\n"); }
  catch { /* best-effort — with no sidecar the next fire just re-observes and re-counts */ }
}

// Every run dir under every agent studio (live slugs + archive) — the enumeration the .sent resolver
// walks. A handoff run can be archived before its send happens (the packet is self-contained for exactly
// that reason), so both halves are walked. (rescanOwedRuns keeps its own inline walk unchanged.)
function* eachRunDir() {
  let workspaces = [];
  try { workspaces = readdirSync(config.workspaceRoot).filter((n) => n.startsWith("workspace-")); } catch { return; }
  for (const ws of workspaces) {
    const studio = join(config.workspaceRoot, ws, "studio", "prelim-search");
    let slugs = [];
    try { slugs = readdirSync(studio); } catch { continue; }
    for (const slug of slugs) {
      if (slug === "queue" || slug === "archive") continue;
      try { for (const leaf of readdirSync(join(studio, slug))) yield join(studio, slug, leaf); } catch { /* file, not a slug dir */ }
    }
    let months = [];
    try { months = readdirSync(join(studio, "archive")); } catch { /* no archive yet */ }
    for (const month of months) {
      let archSlugs = [];
      try { archSlugs = readdirSync(join(studio, "archive", month)); } catch { continue; }
      for (const slug of archSlugs) {
        try { for (const leaf of readdirSync(join(studio, "archive", month, slug))) yield join(studio, "archive", month, slug, leaf); } catch { /* not a dir */ }
      }
    }
  }
}

// Is the run behind this <runId>.pending marker already .sent (a successful delivery)? Resolves the run
// dir by status.json.runId — the id mark_sent names the marker with. Unknown run ⇒ false (never silently
// drop a marker we can't positively tie to a completed send).
// BOTH runId forms are matched (charter P1 §3 defence): the canonical dated `<slug>-<date>-<codename>`
// (status.runId — the ONE form every minting site writes now) AND the legacy dateless
// `<slug>-<codename>` that pre-fix delivery packets minted markers with. Without the legacy arm a
// historical dateless orphan could never be tied to its .sent run, so it would strike and quarantine a
// delivery that in fact succeeded.
function runIsSent(runId) {
  for (const runDir of eachRunDir()) {
    let status = null;
    try { status = JSON.parse(readFileSync(join(runDir, "status.json"), "utf8")); } catch { continue; }
    const dated = String(status?.runId ?? basename(runDir));
    const legacy = status?.slug && status?.codename ? `${status.slug}-${status.codename}` : null;
    if (runId === dated || (legacy && runId === legacy)) return existsSync(join(runDir, ".sent"));
  }
  return false;
}

// The circuit-breaker itself: reconcile this agent's still-present markers against the per-marker strike
// counts from the last wake. A marker that survives another ok wake earns a strike; at the threshold it
// is quarantined. Fully consumed ⇒ clean success (sidecar cleared). Partial/none ⇒ paced re-fire.
export function settleProgress(agent, now = Date.now()) {
  const present = markersForAgent(agent);
  if (present.length === 0) { recordSuccess(agent); return { outcome: "ok", waitSec: 0, retries: 0, reason: null }; }
  const t = tunables();
  const max = noProgressMax();
  const prev = readSidecar(agent)?.markerStrikes || {};
  const strikes = {};
  const quarantined = [];
  let silentCleared = 0;
  for (const m of present) {
    // A delivered-kind marker whose run is already .sent is an orphan of a SUCCESSFUL delivery (a
    // mark_sent race, or a first call killed before its cleanup — the exact AXIS case). The delivery
    // DID happen, so clear it SILENTLY exactly as mark_sent's idempotent path does — never strike,
    // never quarantine, never raise a "could not be sent" alarm about a send that succeeded.
    if (m.kind === "delivered" && runIsSent(m.file.replace(/\.pending$/, ""))) {
      try { rmSync(m.path, { force: true }); silentCleared++; continue; } catch { /* fall through to strike */ }
    }
    const n = (prev[m.file] || 0) + 1;
    if (n >= max && quarantineStuckMarker(agent, m, n, now)) { quarantined.push(m.file); continue; }
    strikes[m.file] = n;
  }
  // Only silent-cleared orphans and/or nothing left ⇒ this wake made progress: clean success.
  if (Object.keys(strikes).length === 0 && quarantined.length === 0) {
    recordSuccess(agent);
    return { outcome: "ok", waitSec: 0, retries: 0, reason: null, silentCleared };
  }
  const worst = Object.values(strikes).reduce((a, b) => Math.max(a, b), 0);
  const waitSec = worst > 0 ? Math.min(t.baseSec * 2 ** (worst - 1), t.capSec) : t.baseSec;
  writeStrikeSidecar(agent, strikes, waitSec, now);
  if (quarantined.length) return { outcome: "quarantine", waitSec, quarantined, retries: 0, reason: "no_progress" };
  return { outcome: "stuck", waitSec, quarantined: [], retries: 0, reason: "no_progress" };
}

// ── WHAT A RUN OWES, AND THE TWO RULINGS THAT SETTLED IT ─────────────────────────────────────────
//
// `sendPending` was RIGHT here by accident until 2026-08-22: it is written on the delivery paths, so
// failed runs were skipped because nobody set their flag rather than because this sweep had a rule about
// them. Measured: 25 of 25 delivered runs carried it, 0 of 29 failed, parked or cancelled. A
// predicate that is correct by accident is one careless write away from being wrong.
//
// **Owner ruling, 2026-08-22, verbatim: "clean up the failed runs. they owe the client nothing."** That
// produced a `state === "delivered"` filter here, and the failure packets already in the outbox were
// disposed of on the box.
//
// **Owner ruling, 2026-08-24, SUPERSEDING THIS SWEEP'S HALF OF IT: failed runs' notification packets get
// the same re-drop cover as delivered ones.** (Relayed by role-overwatch.)
//
// BOTH ARE KEPT BECAUSE BOTH ARE STILL TRUE, and reading them as a reversal is the mistake to avoid. A
// failed run owes the CLIENT no report — that is 2026-08-22, and `scripts/e2e.mjs`'s delivery assertion
// stays scoped by terminal state accordingly. It owes the REQUESTER the news that it failed, and that
// packet is written by the product on purpose (`driver/runner.mjs` sets `sendPending` on the pre-run and
// self-resume failure paths). Nothing is owed to the client; the news is owed to whoever asked. The two
// rulings are about different recipients and only ever looked like one question.
//
// THE STATES ARE NAMED, NOT INFERRED FROM THE FLAG. Reverting to "anything carrying sendPending" would
// put the sweep back where 2026-08-22 found it. A NON-terminal state is excluded, which neither earlier
// version did: a run still `running` has not finished owing anything, and a marker for it is premature.
//
// A status with NO state is still swept: absence is not evidence a run failed, and this sweep exists to
// catch markers that were LOST. Only a state that positively says otherwise excludes a run.
export const OWED_TERMINAL_STATES = new Set(["delivered", "failed", "parked", "cancelled"]);

/** Is this run still owed a notification the sweep should re-drop a marker for? */
export function owedANotification(status) {
  if (status?.sendPending !== true) return false;
  const terminal = String(status?.state ?? "").trim().toLowerCase();
  return terminal === "" || OWED_TERMINAL_STATES.has(terminal);
}

// ── Deterministic rescan (prelim-outbox.timer) ──────────────────────────────────────────────────────
// Re-drop a <runId>.pending marker for every run still owed a notification — `owedANotification`
// above states which those are — and that has no .sent marker. Walks each agent studio's
// LIVE slugs and the archive (a handoff run can be archived before its send happens; the packet is
// self-contained for exactly that reason). Marker content is only the agent to wake — sendPending/.sent
// (and now the per-channel receipts) stay the source of truth, so a re-dropped marker can never
// double-send; the backoff sidecars keep a persistently failing wake paced.
export function rescanOwedRuns() {
  const dropped = [];
  const runDirs = [];
  let workspaces = [];
  try { workspaces = readdirSync(config.workspaceRoot).filter((n) => n.startsWith("workspace-")); } catch { return dropped; }
  for (const ws of workspaces) {
    const studio = join(config.workspaceRoot, ws, "studio", "prelim-search");
    let slugs = [];
    try { slugs = readdirSync(studio); } catch { continue; }
    for (const slug of slugs) {
      if (slug === "queue" || slug === "archive") continue;
      try { for (const leaf of readdirSync(join(studio, slug))) runDirs.push(join(studio, slug, leaf)); } catch { /* file, not a slug dir */ }
    }
    let months = [];
    try { months = readdirSync(join(studio, "archive")); } catch { /* no archive yet */ }
    for (const month of months) {
      let archSlugs = [];
      try { archSlugs = readdirSync(join(studio, "archive", month)); } catch { continue; }
      for (const slug of archSlugs) {
        try { for (const leaf of readdirSync(join(studio, "archive", month, slug))) runDirs.push(join(studio, "archive", month, slug, leaf)); } catch { /* not a dir */ }
      }
    }
  }
  for (const runDir of runDirs) {
    if (existsSync(join(runDir, ".sent"))) continue;   // settled — cheap short-circuit before the JSON read
    let status = null;
    try { status = JSON.parse(readFileSync(join(runDir, "status.json"), "utf8")); } catch { continue; }
    if (!owedANotification(status)) continue;
    const agent = String(status.agent ?? "");
    if (!/^[A-Za-z0-9_-]+$/.test(agent)) continue;     // marker's first line feeds the agent CLI — same shape gate as the shell
    const sanitize = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, "_");
    const runId = sanitize(status.runId ?? `${basename(runDir)}`);
    // ONE canonical runId form is MINTED (the dated status.runId), but the dedupe check honours BOTH
    // forms (charter P1 §3): a still-live marker under the legacy dateless `<slug>-<codename>` name
    // (minted by a pre-fix delivery, or in flight across the deploy) already wakes this agent — dropping
    // the dated sibling would recreate the exact two-markers-for-one-delivery split this fix ends.
    const legacy = status.slug && status.codename ? sanitize(`${status.slug}-${status.codename}`) : null;
    const forms = legacy && legacy !== runId ? [runId, legacy] : [runId];
    const marker = join(config.outboxDir, `${runId}.pending`);
    if (forms.some((id) => existsSync(join(config.outboxDir, `${id}.pending`)))) continue;   // already queued (either form) — don't churn the inotify watch
    if (forms.some((id) => existsSync(join(quarantineDir(), `${id}.pending`)))) continue;    // circuit-breaker set it aside — never resurrect a quarantined delivery
    try {
      mkdirSync(config.outboxDir, { recursive: true });
      writeFileSync(marker, `${agent}\n`);
      dropped.push({ runId, agent, runDir });
    } catch { /* best-effort — the next timer fire retries */ }
  }
  return dropped;
}

// ── CLI (deliver-trigger.sh) ────────────────────────────────────────────────────────────────────────
//   check <agent>          → "due" | "wait <sec>"
//   settle <agent> <rc>    (wake stdout on stdin) → "ok" | "retry <sec>" | "giveup"
//   rescan                 → "rescan: <n> marker(s) re-dropped" (silent when 0)
async function cli() {
  const [verb, agent, rcArg] = process.argv.slice(2);
  try {
    if (verb === "check") {
      const r = checkDue(String(agent));
      process.stdout.write(r.due ? "due\n" : `wait ${r.waitSec}\n`);
    } else if (verb === "settle") {
      const chunks = [];
      for await (const c of process.stdin) chunks.push(c);
      const r = settleWake(String(agent), { code: Number(rcArg), stdout: Buffer.concat(chunks).toString("utf8") });
      const line =
        r.outcome === "ok" ? "ok" :
        r.outcome === "giveup" ? "giveup" :
        r.outcome === "quarantine" ? `quarantine ${r.waitSec}` :
        r.outcome === "stuck" ? `stuck ${r.waitSec}` :
        `retry ${r.waitSec}`;
      process.stdout.write(line + "\n");
      if (r.outcome === "quarantine")
        process.stderr.write(`outbox-backoff: 🚨 quarantined ${r.quarantined.join(", ")} for ${agent} (no delivery progress) — set aside; recorded in quarantine/STUCK-ALERTS.jsonl\n`);
      else if (r.reason && (r.outcome === "retry" || r.outcome === "giveup"))
        process.stderr.write(`outbox-backoff: wake for ${agent} failed (${r.reason}) — attempt ${r.retries}, ${r.outcome}\n`);
    } else if (verb === "rescan") {
      const dropped = rescanOwedRuns();
      if (dropped.length) process.stdout.write(`rescan: ${dropped.length} marker(s) re-dropped (${dropped.map((d) => d.runId).join(", ")})\n`);
    } else {
      process.stderr.write("usage: outbox-backoff.mjs check <agent> | settle <agent> <rc> (stdin=wake stdout) | rescan\n");
      process.exitCode = 2;
    }
  } catch (e) {
    // Delivery-preserving defaults: a broken helper must never eat a marker or wedge the lane.
    process.stderr.write(`outbox-backoff: ${verb} failed (${e?.message ?? e}) — answering the fail-safe default\n`);
    if (verb === "check") process.stdout.write("due\n");
    else if (verb === "settle") process.stdout.write("retry 300\n");
  }
}

if (isEntrypoint(import.meta.url)) await cli();
