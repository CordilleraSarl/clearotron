#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// drain-preflight.mjs — CAN THIS BOX DRAIN ITS QUEUE, AND DELIVER WHAT IT FINISHES?
//
// The question came from the codex round (18 Aug): an engine override is carried by the DRIVER
// ACTIVATION's environment, and an activation that never happens carries no environment. On the box this
// was first asked about, no runner process was running for any user and no prelim unit existed at system
// level — so every job enqueued would have sat there, and the round would have been fiction.
//
// Nothing here builds a drainer. ONE ALREADY SHIPS: `driver/systemd/prelim-driver.path` (inotify),
// `prelim-driver.timer` (90s fallback) and `prelim-driver.service` (the oneshot that runs runner.mjs).
// What was missing is any way to notice they are not installed, and that absence is silent by
// construction — no unit fails, no log line appears, jobs simply queue forever.
//
// ── THE FAILURE THIS EXISTS FOR IS THE QUIET ONE ─────────────────────────────────────────────────────
//
// `prelim-driver.path` CANNOT read an environment variable — the unit's own header says so: "there is no
// `%E`, no EnvironmentFile, no expansion: the prefix below is a literal, and it is the one thing in the
// queue lane that CLEAROTRON_WORK_DIR cannot reach." So the watcher's globs and the runner's
// `config.queueDirs` are two spellings of one fact with nothing at runtime comparing them. When they
// disagree the watcher arms an inotify on a path nothing writes to, the queue drains on the 90s timer
// alone, and if the timer is also down it stops completely — with every unit reporting healthy.
//
// This compares them, and it treats "I could not tell" as a finding rather than a pass.
//
//   node scripts/drain-preflight.mjs            human-readable; exit 1 when the queue cannot drain
//   node scripts/drain-preflight.mjs --json     the same as JSON

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { homedir, userInfo } from "node:os";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── HOW DEEP THE OUTBOX IS, AND HOW OLD ITS OLDEST PACKET IS ────────────────────────────────
//
// "Is the watcher armed" and "is anything actually being delivered" are different questions, and this
// script only answered the first. Measured on the test box 2026-08-23: 128 packets, span eleven days,
// NOTHING removed since 2026-08-12, growing about ten a day — and no surface anywhere reports it. The
// accumulation is silent, which is the failure mode was filed about.
//
// AGE IS THE SIGNAL, NOT DEPTH. A deep outbox during a busy hour is a lane keeping up; one packet that
// has sat for a day is a lane that is not. The threshold is derived from the retry windows rather than
// picked: the backoff caps at 900s, the give-up cooldown is 3600s, and the heartbeat backstop runs at
// most every 55 minutes AND NOT AT ALL between 22:00 and 05:00. A full day is the first bound that is
// past every one of those, including the overnight gap, so a packet older than it has outlived every
// path that could have delivered it.
const STUCK_AFTER_SEC = 24 * 60 * 60;

/**
 * How many packets are waiting, and how old the oldest is. `null` when the directory could not be read.
 *
 * NULL IS NOT ZERO, and keeping them apart is the whole point. An unreadable outbox — wrong account,
 * wrong path, not yet created — must not report "0 waiting", which is the answer a healthy lane gives.
 * That is this shop's privilege-limited-count-reads-as-empty mistake, and it has been paid for twice.
 *
 * PURE given `io`.
 */
export function outboxBacklog(dir, now = Date.now(), io = { readdirSync, statSync }) {
  if (!dir) return null;
  let names;
  try { names = io.readdirSync(dir).filter((f) => f.endsWith(".pending")); } catch { return null; }
  let oldestMs = null, oldestFile = null;
  for (const f of names) {
    let st;
    try { st = io.statSync(join(dir, f)); } catch { continue; }
    const ms = st.mtimeMs ?? st.mtime?.getTime?.() ?? null;
    if (ms == null) continue;
    if (oldestMs == null || ms < oldestMs) { oldestMs = ms; oldestFile = f; }
  }
  return {
    pending: names.length,
    oldestAgeSec: oldestMs == null ? null : Math.max(0, Math.round((now - oldestMs) / 1000)),
    oldestFile,
  };
}

/** Human-readable age. PURE. */
export function ageLabel(sec) {
  if (sec == null) return "unknown";
  if (sec < 90) return `${sec}s`;
  if (sec < 5400) return `${Math.round(sec / 60)}m`;
  if (sec < 172800) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}

/** The finding a backlog earns, or null. PURE — takes the reading, never the filesystem. */
export function backlogFinding(backlog, dir, stuckAfterSec = STUCK_AFTER_SEC) {
  if (backlog === null) return (
    `the outbox \`${dir ?? "(none configured)"}\` could not be read, so its depth is UNKNOWN. That is a `
    + "SKIP, not a pass — an unreadable outbox and an empty one are the same number of packets to a check "
    + "that does not tell them apart. Run this as the account the runner runs as.");
  if (backlog.pending === 0 || backlog.oldestAgeSec == null) return null;
  if (backlog.oldestAgeSec < stuckAfterSec) return null;
  return (
    `${backlog.pending} packet(s) are waiting in the outbox and the oldest has been there `
    + `${ageLabel(backlog.oldestAgeSec)} (\`${backlog.oldestFile}\`). Every delivery path has had its `
    + "chance in that time — the instant watcher, the paced retry, the give-up cooldown and the heartbeat "
    + "backstop including its overnight gap — so these are not late, they are unsent. Nothing else reports "
    + "this: the packets accumulate silently and no unit fails.");
}

/**
 * The queue directories a `.path` unit actually watches, with `%h` resolved.
 *
 * COMMENTED LINES ARE NOT WATCHES, and that matters here more than usual: the headless glob
 * (`%h/prelim-queue/*.json`) ships commented out, so a standalone deployment that never uncommented it
 * has event-driven pickup dead on the one queue it uses. Reading the file without honouring `#` would
 * report that box as watched.
 *
 * PURE.
 * @returns {string[]} directories, not globs — the trailing `/*.json` is stripped
 */
export function watchedQueueDirs(unitText, home) {
  const out = [];
  for (const raw of String(unitText ?? "").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^PathExistsGlob\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    // — AN EMPTY ASSIGNMENT RESETS THE LIST, and until now this parser could not see one. The
    // regex demanded at least one character after `=`, so a bare `PathExistsGlob=` matched nothing and
    // was skipped as noise — while to systemd it is the instruction that CLEARS everything accumulated
    // so far. That is not a corner: it is the documented way a drop-in replaces an inherited list
    // rather than appending to it, and it is what the test box's own `prelim-driver.path.d/queue.conf`
    // does, in its own words: "The empty assignment RESETS the inherited list; without it these are
    // appended to the watcher globs."
    //
    // Reading the list without the reset is wrong in BOTH directions — it keeps globs the deployment
    // has disowned, and (because the caller then compares against a superset) it can report a directory
    // as watched that nothing watches. The second is 's original harm, produced by the guard built
    // to prevent it.
    if (!m[1].trim()) { out.length = 0; continue; }
    // EXTENSION-AGNOSTIC. The queue watcher globs `*.json` and the outbox watcher globs `*.pending`;
    // a `/\*\.json$/` strip left the outbox path ending in its own glob, so the comparison compared a
    // directory against a pattern and reported a disagreement that was the reader's, not the box's.
    // Caught by pointing it at the second unit — which is the argument for the second input pair.
    const p = m[1].trim().replace(/%h/g, home).replace(/\/\*\.[A-Za-z0-9]+$/, "");
    if (p) out.push(p);
  }
  return out;
}

/**
 * Which queues the runner drains but nothing watches, and which watches point at no queue.
 *
 * BOTH DIRECTIONS, because they are different faults with different costs. An unwatched queue is a
 * latency bug that becomes an outage the moment the timer stops. A watch on a path that does not exist
 * is dead config — harmless today, and the tell that this file and the deployment have drifted apart,
 * which is the state the unit's own header warns is invisible at runtime.
 *
 * PURE.
 */
export function compareWatches(queueDirs, watched) {
  const norm = (p) => String(p ?? "").replace(/\/+$/, "");
  const q = (queueDirs ?? []).map(norm);
  const w = (watched ?? []).map(norm);
  return {
    unwatched: q.filter((d) => !w.includes(d)),
    watchesNothing: w.filter((d) => !q.includes(d) && !existsSync(d)),
  };
}

const systemctl = (args) => {
  const r = spawnSync("systemctl", args, { encoding: "utf8" });
  return { ok: r.status === 0, out: String(r.stdout ?? "").trim(), err: String(r.stderr ?? "").trim(), status: r.status };
};

/**
 * Is a unit installed, enabled and (for a .path/.timer) active — for THIS user or the system?
 *
 * `unknown` IS A DISTINCT ANSWER and is never folded into `no`. A user-level unit belonging to another
 * account is unreadable from here, and reporting that as "not installed" would be the same
 * privilege-limited-count-reads-as-empty mistake this shop has paid for before. The scope that answered
 * is always named.
 */
// A systemctl invocation that never reached a manager. `--user` needs a session bus, and a non-login
// shell has no XDG_RUNTIME_DIR — which is the ordinary way this tool gets run, because its own banner
// says to run it as the account the runner runs as, and `sudo -u <user> bash -c ...` has no bus.
const BUS_UNREACHABLE = /Failed to connect to bus|Failed to get D-Bus connection|refusing to operate/i;

// `run` is injectable ONLY so a test can drive the bus-unreachable branch: it cannot be reached by
// running this file, because a box that HAS a session bus cannot be made not to have one from inside
// the process. Without the seam this branch could only ever be exercised by hand, which is how it
// came to be wrong in the first place.
export function unitState(name, run = systemctl) {
  let userScopeUnreadable = false, why = "";
  for (const [scope, args] of [["user", ["--user"]], ["system", []]]) {
    const enabled = run([...args, "is-enabled", name]);
    const active = run([...args, "is-active", name]);
    // COULD NOT LOOK IS NOT NOT-FOUND, and this is the whole. Without a bus, `--user` answers
    // nothing at all -- no stdout, an error on stderr -- and folding that into "not-found" reported
    // NOTHING DRAINS THE QUEUE over a timer that had fired 26ms earlier. The same code cannot tell a
    // false red from a false green, so the fix is to refuse to answer rather than to answer wrongly.
    if (BUS_UNREACHABLE.test(enabled.err + active.err)) {
      userScopeUnreadable ||= scope === "user";
      why ||= enabled.err.split("\n")[0] || active.err.split("\n")[0];
      continue;
    }
    const known = enabled.out && !/^Failed to|^Unit .* could not be found/.test(enabled.out + enabled.err);
    if (known && enabled.out !== "not-found") return { scope, enabled: enabled.out, active: active.out };
  }
  // A USER-SCOPE READ THAT FAILED POISONS THE ANSWER even when the system scope answered cleanly. These
  // are user units: the system manager saying "not-found" about one is true and irrelevant, and pairing
  // it with an unreadable user manager is exactly how "could not look" got printed as "not armed".
  if (userScopeUnreadable) {
    return { scope: null, enabled: "unknown", active: "unknown", unreadable: true, why };
  }
  return { scope: null, enabled: "not-found", active: "not-found" };
}

/** Is a runner actually draining right now, for any user? `ps` reads across accounts; systemd does not. */
export function runnerRunning() {
  const r = spawnSync("ps", ["-eo", "user,pid,etimes,cmd", "--no-headers"], { encoding: "utf8" });
  if (r.status !== 0) return { known: false, procs: [] };
  const procs = String(r.stdout ?? "").split("\n")
    .filter((l) => /driver\/runner\.mjs/.test(l) && !/drain-preflight/.test(l))
    .map((l) => l.trim());
  return { known: true, procs };
}

// ── THE OUTBOX IS THE SAME HAZARD, ONE LANE OVER ('s tail) ───────────────────────────────────────
//
// `prelim-outbox.path` carries the identical literal glob and says so in its own header: "this literal
// and the driver's `config.outboxDir` are two spellings of one fact with nothing checking them against
// each other. Disagree, and finished runs drop their `.pending` markers where this watcher is not
// looking: no delivery wake, no failure, no log."
//
// I SAID THIS NEEDED ITS OWN READER AND MEASURING SAYS OTHERWISE. `compareWatches` was already generic
// — a set of directories against a set of watches — so what the outbox needed was a second INPUT PAIR,
// not a second reader. Building the reader I had promised would have been a second implementation of a
// comparison that already existed, which is the defect this codebase spent the week removing.
//
// WHAT DIFFERS IS THE CONSEQUENCE, and the report says so rather than folding the two lanes into one
// verdict: an unwatched QUEUE means jobs never run; an unwatched OUTBOX means delivery silently falls
// back to the 55-minute heartbeat completion-watch. Both are silent, only one is an outage, and a
// reader deciding what to fix first needs them apart.

export async function preflight({ home = homedir(), root = ROOT } = {}) {
  const unitPath = join(root, "driver", "systemd", "prelim-driver.path");
  const unitText = existsSync(unitPath) ? readFileSync(unitPath, "utf8") : null;

  const { config } = await import(join(root, "driver", "driver.config.mjs"));
  const queueDirs = config.queueDirs ?? [];
  const watched = unitText == null ? null : watchedQueueDirs(unitText, home);

  const units = {
    path: unitState("prelim-driver.path"),
    timer: unitState("prelim-driver.timer"),
    service: unitState("prelim-driver.service"),
  };
  const runner = runnerRunning();
  const cmp = watched == null ? null : compareWatches(queueDirs, watched);

  // The delivery lane, same comparison, its own inputs and its own verdict.
  const obUnitPath = join(root, "driver", "systemd", "prelim-outbox.path");
  const obText = existsSync(obUnitPath) ? readFileSync(obUnitPath, "utf8") : null;
  const outboxDirs = config.outboxDir ? [config.outboxDir] : [];
  const obWatched = obText == null ? null : watchedQueueDirs(obText, home);
  const obUnits = { path: unitState("prelim-outbox.path"), service: unitState("prelim-outbox.service") };
  const obCmp = obWatched == null ? null : compareWatches(outboxDirs, obWatched);
  // — armed and keeping up are different questions. This is the second one.
  const backlog = outboxBacklog(config.outboxDir);

  // THE VERDICT IS ABOUT WHETHER A JOB WOULD EVER RUN, and it is deliberately generous about HOW.
  // Either drain path suffices: an armed watcher, or the 90s timer. Both dead is the outage.
  const watcherArmed = units.path.active === "active";
  const timerArmed = units.timer.active === "active";
  const canDrain = watcherArmed || timerArmed;
  // UNREADABLE IS NOT UNARMED. If the user manager could not be reached, this tool does not know
  // whether anything drains -- and the same silence that would produce a false "NOTHING DRAINS" would
  // produce a false green somewhere else. Said in the voice the outbox arm already uses below.
  const unreadable = [units.path, units.timer, units.service].some((u) => u.unreadable);

  const findings = [];
  if (unreadable) findings.push(
    "UNIT STATE UNKNOWN (not the same as not-armed). `systemctl --user` could not reach a session bus, "
    + "so whether anything drains this queue was NOT determined — these units are user units, and a user "
    + "manager this tool cannot reach hides them completely. "
    + (units.timer.why ? `systemctl said: ${units.timer.why}. ` : "")
    + "A non-login shell has no XDG_RUNTIME_DIR, which is how the banner's own advice — run it as the "
    + "account the runner runs as — leads here. Re-run with XDG_RUNTIME_DIR=/run/user/$(id -u <account>) "
    + "set, as that account.");
  if (!canDrain && !unreadable) findings.push(
    "NOTHING DRAINS THE QUEUE. Neither prelim-driver.path nor prelim-driver.timer is active, so an "
    + "enqueued job is never claimed — and no unit fails, so nothing else will say so. Install and enable "
    + "both from driver/systemd/ for the account the runner should run as.");
  if (canDrain && !unreadable && !watcherArmed) findings.push(
    "The inotify watcher is not armed; the 90s timer is the ONLY drain path. Jobs are late rather than "
    + "lost, and the lane becomes an outage the moment the timer stops.");
  if (canDrain && !unreadable && !timerArmed) findings.push(
    "The 90s fallback timer is not armed. The watcher's globs are literals that no environment variable "
    + "can reach, so the backstop for a queue it does not cover is missing.");
  for (const d of cmp?.unwatched ?? []) findings.push(
    `queue \`${d}\` is drained by the runner and watched by NOTHING — event-driven pickup is dead for it `
    + `(prelim-driver.path's globs cannot expand CLEAROTRON_WORK_DIR; this is the disagreement its own `
    + `header calls invisible at runtime).`);
  for (const d of cmp?.watchesNothing ?? []) findings.push(
    `prelim-driver.path watches \`${d}\`, which is neither a queue the runner drains nor a directory that `
    + `exists — dead config, and the tell that the unit and this deployment have drifted apart.`);
  if (unitText == null) findings.push(
    "driver/systemd/prelim-driver.path is not in this checkout, so the watcher's globs could not be read. "
    + "This is a SKIP, not a pass — the comparison did not run.");

  // ── the delivery lane's findings, named as ITS OWN failure rather than the queue's ────────────────
  const outboxArmed = obUnits.path.active === "active";
  if (!outboxArmed) findings.push(
    "prelim-outbox.path is not armed. A finished run's `.pending` marker wakes nobody, so delivery falls "
    + "back to the 55-minute heartbeat completion-watch — late rather than lost, and silent either way.");
  for (const d of obCmp?.unwatched ?? []) findings.push(
    `the outbox \`${d}\` is where finished runs drop their markers and NOTHING watches it — the same `
    + `literal-vs-variable disagreement as the queue lane, one lane over, with the heartbeat as the only `
    + `remaining delivery path.`);
  for (const d of obCmp?.watchesNothing ?? []) findings.push(
    `prelim-outbox.path watches \`${d}\`, which is neither this deployment's outbox nor a directory that `
    + `exists — dead config, and the tell that the unit and this deployment have drifted apart.`);
  if (obText == null) findings.push(
    "driver/systemd/prelim-outbox.path is not in this checkout, so the delivery comparison did not run. "
    + "A SKIP, not a pass.");
  const backlogSays = backlogFinding(backlog, config.outboxDir);
  if (backlogSays) findings.push(backlogSays);

  return {
    canDrain, units, runner, queueDirs, watched, ...cmp,
    delivery: { armed: outboxArmed, units: obUnits, outboxDirs, watched: obWatched, backlog, ...(obCmp ?? {}) },
    findings,
  };
}

function main() {
  preflight().then((r) => {
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.canDrain ? 0 : 1);
    }
    // NAME THE ACCOUNT. Every answer here is about ONE account: `%h` resolves to this user's home, the
    // user-scope systemctl reads this user's units, and another account's user units are simply
    // unreadable. A run under one account saying "NO DRAIN PATH" is true about THAT account and says
    // nothing about the account the deployment actually runs as. Reading it as a verdict on the box is
    // the privilege-limited-count-reads-as-empty mistake wearing a different hat.
    console.log(`drain preflight for ${userInfo().username} (home ${homedir()}) — ${r.canDrain ? "a drain path is armed" : "NO DRAIN PATH"}`);
    console.log(`  this answers for THIS ACCOUNT ONLY; run it as the account the runner runs as.`);
    for (const [k, u] of Object.entries(r.units))
      console.log(`  prelim-driver.${k.padEnd(8)} enabled=${u.enabled} active=${u.active} scope=${u.scope ?? (u.unreadable ? "(UNREADABLE — no session bus; state unknown)" : "(not found in user or system scope)")}`);
    console.log(`  runner processes: ${r.runner.known ? (r.runner.procs.length || "none") : "unknown (ps unavailable)"}`);
    console.log(`  queues the runner drains: ${r.queueDirs.length ? r.queueDirs.join(", ") : "none"}`);
    console.log(`  queues the watcher covers: ${r.watched == null ? "unread" : (r.watched.join(", ") || "none")}`);
    console.log(`  delivery: prelim-outbox.path enabled=${r.delivery.units.path.enabled} active=${r.delivery.units.path.active}`);
    console.log(`  outbox this deployment writes: ${r.delivery.outboxDirs.join(", ") || "none"}`);
    console.log(`  outbox the watcher covers:     ${r.delivery.watched == null ? "unread" : (r.delivery.watched.join(", ") || "none")}`);
    // Printed whether or not it earns a finding: a lane keeping up should be able to SHOW that it is,
    // and "0 waiting" read once is worth more than a threshold nobody sees cross.
    console.log(`  outbox backlog:               ${r.delivery.backlog === null
      ? "UNREADABLE (not the same as empty)"
      : `${r.delivery.backlog.pending} waiting, oldest ${ageLabel(r.delivery.backlog.oldestAgeSec)}`}`);
    for (const f of r.findings) console.log(`\n  ! ${f}`);
    process.exit(r.canDrain ? 0 : 1);
  });
}

if (isEntrypoint(import.meta.url)) main();
