// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engine/health.mjs — is the engine still able to answer when nobody is asking it anything?
//
// The run door proves the engine with one real turn before a clearance starts (engine/probe.mjs), and that is
// the only time it was proven. An install with no orders goes unproven for as long as it has none, and a
// sign-in that stops renewing in that time is found by the next order, which is then refused. Measured on a
// production install, 2026-11-25: its last successful run was three weeks earlier, its engine program still
// reported itself signed in, and the first order in that time was refused at the door with nobody told.
//
// So the same real turn also runs on its own: when the worker starts, after the installed build changes, and when
// the engine has had no successful call for longer than CLEAROTRON_ENGINE_CHECK_ROUTINE. It is judged exactly as the door judges
// it (judgeEngineTurn, probeVerdictLane): a configuration fault, which no search can get past, raises one
// alert, and anything the run's own park handles better (an overload, a spent quota) is logged.
//
// THE CLOCK IS THE LAST SUCCESSFUL CALL, not a calendar. Every turn the engine completes, a stage's or a
// check's, moves it, so a busy install never runs the routine check: its work is the proof.
//
// THE PRODUCT SENDS NOTHING (docs/DELIVERY.md). The alert is a packet in the outbox, for whatever drains it,
// and the same lines in the worker's log; `doctor` and `status` show the last failure until a check passes.

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config, DEFAULT_ENGINE_ID } from "../driver.config.mjs";
import { judgeEngineTurn, probeFailureText, probeVerdictLane } from "./probe.mjs";
import { writeOutboxPacket } from "../outbox.mjs";
import { note } from "../log.mjs";

/** The routine check's setting, and its value when unset. */
export const ROUTINE_SETTING = "CLEAROTRON_ENGINE_CHECK_ROUTINE";
export const ROUTINE_DEFAULT = "7d";
/**
 * While a check is failing it runs again at most this often, not on every 90-second tick. A refused turn costs
 * nothing and ends in seconds, and this is how soon `status` stops showing a failure the operator has fixed.
 */
export const FAILING_RECHECK_MS = 15 * 60 * 1000;

const UNIT_MS = { h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };

/**
 * A check interval as the settings file spells it: a whole number of hours or days (`12h`, `7d`, `30d`), or
 * `off`. `{ ms }` for a duration, `{ ms: null }` for `off`, `null` for anything else.
 */
export function parseCheckInterval(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "off") return { ms: null };
  const m = /^([1-9]\d*)([hd])$/.exec(s);
  return m ? { ms: Number(m[1]) * UNIT_MS[m[2]] } : null;
}

/** The routine interval this environment sets: `{ ms, raw, invalid }`. An unreadable value runs at the default. */
export function routineInterval(env = process.env) {
  const raw = String(env[ROUTINE_SETTING] ?? "").trim();
  if (!raw) return { ms: parseCheckInterval(ROUTINE_DEFAULT).ms, raw: null, invalid: false };
  const parsed = parseCheckInterval(raw);
  return parsed ? { ms: parsed.ms, raw, invalid: false } : { ms: parseCheckInterval(ROUTINE_DEFAULT).ms, raw, invalid: true };
}

/** What a reader is told about a value the setting cannot take. */
export const invalidIntervalText = (raw) =>
  `${ROUTINE_SETTING}="${raw}" is not a duration; it takes a whole number of hours or days (12h, 7d, 30d) or off. The default, ${ROUTINE_DEFAULT}, is used.`;

// ── the record ────────────────────────────────────────────────────────────────────────────────────────
//
// TWO FILES PER ENGINE, BECAUSE THERE ARE TWO WRITERS. Every stage of every run writes the last-answer file; only
// a check writes the check file. One file would be read, changed and written back by both at once, and the one
// that wrote second would lose the other's field.

/** Where this install keeps its engine-check record. */
export const engineCheckDir = () => join(config.workspaceRoot, "engine-check");
const lastAnswerPath = (dir, engine) => join(dir, `${engine}.last-answer.json`);
const checkPath = (dir, engine) => join(dir, `${engine}.check.json`);
const engineOf = (id) => String(id || DEFAULT_ENGINE_ID).trim().toLowerCase();

function writeAtomic(path, value) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value) + "\n");
  renameSync(tmp, path);
}
function readJsonOrNull(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

/**
 * Record that the engine completed a turn. BEST-EFFORT: a stage that cannot write this must carry on, and the
 * cost of a missed write is a routine check that runs sooner than it needed to.
 */
export function recordEngineAnswered(engine, { now = Date.now(), dir = engineCheckDir() } = {}) {
  try {
    mkdirSync(dir, { recursive: true });
    writeAtomic(lastAnswerPath(dir, engineOf(engine)), { at: new Date(now).toISOString() });
    return true;
  } catch { return false; }
}

/** Did this turn reach the engine and come back? A clean exit the engine did not report as signed out. */
export const turnAnswered = (turn) => !!turn && turn.code === 0 && !turn.killed && !turn.signals?.signedOut;

/** When the engine last completed a turn, in epoch ms, or null. */
export function lastEngineAnswer(engine, { dir = engineCheckDir() } = {}) {
  const t = Date.parse(readJsonOrNull(lastAnswerPath(dir, engineOf(engine)))?.at ?? "");
  return Number.isFinite(t) ? t : null;
}

/** The last check's record, or null when this install has none. */
export const readEngineCheck = (engine, { dir = engineCheckDir() } = {}) => readJsonOrNull(checkPath(dir, engineOf(engine)));

// ── when the worker checks ────────────────────────────────────────────────────────────────────────────

/**
 * Why a check is due now, or null. PURE.
 *
 * - `build`: the installed build is not the one last checked, so a deploy by any route is proven within a tick.
 * - `recheck`: the last check failed, FAILING_RECHECK_MS or more ago, or the engine has completed a turn since,
 *   a stage's or the door's, which says it was fixed: the check confirms it and withdraws the alert.
 * - `routine`: the engine has had no successful call for the routine interval. `off` turns this one off alone.
 *
 * An install with no record yet starts its clock at `seen`, the first time the worker looked, and is not
 * checked on sight: setup has just proven it with a turn of its own, and a check on sight would fire on
 * every fresh install's first tick.
 */
export function engineCheckDue({ now, build, intervalMs, lastAnswer, record }) {
  if (!record) return null;
  if (record.ok === false) return now - Date.parse(record.at) >= FAILING_RECHECK_MS || (lastAnswer ?? 0) > Date.parse(record.at) ? "recheck" : null;
  if (build && record.build && build !== record.build) return "build";
  if (intervalMs == null) return null;
  const since = Math.max(lastAnswer ?? 0, Date.parse(record.at) || 0);
  return now - since >= intervalMs ? "routine" : null;
}

/** The first look at an install with no record: the clock starts, nothing is checked. */
export function startEngineCheckClock(engine, { now = Date.now(), build = null, dir = engineCheckDir() } = {}) {
  try {
    mkdirSync(dir, { recursive: true });
    writeAtomic(checkPath(dir, engineOf(engine)), { at: new Date(now).toISOString(), ok: null, build, reason: "first-seen" });
    return true;
  } catch { return false; }
}

// ── what the operator is told ─────────────────────────────────────────────────────────────────────────

/** The alert, in four lines. `verdict` is the probe's; its headline and fix are the probe's own sentences. */
export function engineCheckFailureText(verdict, at) {
  const headline = String(verdict.headline ?? "").replace(/\.$/, "");
  return [
    `The engine check failed at ${new Date(at).toISOString().replace(/\.\d{3}Z$/, "Z")}: ${headline}.`,
    "No search can run until this is fixed.",
    `To fix it: ${verdict.fix ?? "the engine's own message is in the worker's log."}`,
    "Then run `clearotron doctor` to confirm.",
  ].join("\n");
}

/**
 * What `status` prints while the last check failed for a configuration fault: the alert's own lines, rebuilt from
 * the record. Nothing once a check has passed, once the engine has completed a turn since (`lastAnswer`), or when
 * the failure was not this install's to fix.
 */
export function failedCheckLines(record, lastAnswer = null) {
  if (record?.ok !== false || record.lane !== "configuration") return [];
  if ((lastAnswer ?? 0) > Date.parse(record.at)) return [];
  return engineCheckFailureText({ headline: record.headline, fix: record.fix }, Date.parse(record.at)).split("\n");
}

/** The packet's name in the outbox: one per engine, so a second failure replaces the first rather than queueing beside it. */
export const engineCheckPacketName = (engine) => `engine-check-${engineOf(engine)}.failed`;

/**
 * Take back an alert nothing has collected yet. A fault already fixed must not be delivered later: whatever drains
 * the outbox would tell the operator of a failure that no longer stands. Best-effort; one already collected is gone.
 */
export function withdrawEngineCheckPacket(engine) {
  try { rmSync(join(config.outboxDir, `${engineCheckPacketName(engine)}.pending`), { force: true }); return true; }
  catch { return false; }
}

/**
 * Run the check once and record it. Returns `{ verdict, lane, alerted, text }`.
 *
 * ONE ALERT PER FAILURE. A failed check whose previous check had already alerted for a configuration fault
 * writes no second packet; a check that passes clears it and withdraws the packet if it is still waiting, so the
 * next failure alerts again. Weather is logged
 * and never alerted: "no search can run" is not true of an overload, and the run's park recovers from it.
 */
export async function runEngineCheck({
  env = process.env, reason = "routine", now = () => Date.now(), build = null, dir = engineCheckDir(),
  judge = judgeEngineTurn, write = writeOutboxPacket, withdraw = withdrawEngineCheckPacket, log = note, wait,
} = {}) {
  const engine = engineOf(env.CLEAROTRON_AI);
  const previous = readEngineCheck(engine, { dir });
  let verdict;
  try { verdict = await judge({ env, ...(wait ? { wait } : {}) }); }
  catch (e) { verdict = { ok: false, engine, mode: "probe-error", basis: "driver-bug", headline: "the engine check itself failed to run", fix: String(e?.message ?? e), detail: null }; }
  const at = now();
  const lane = probeVerdictLane(verdict);
  let alerted = false, text = null;
  if (verdict.ok) {
    recordEngineAnswered(engine, { now: at, dir });
    withdraw(engine);
    log(`[engine-check] ${engine} answered (${reason})`);
  } else if (lane === "configuration") {
    text = engineCheckFailureText(verdict, at);
    const already = previous?.ok === false && previous.lane === "configuration" && !!previous.alertedAt;
    if (!already) {
      alerted = !!write(engineCheckPacketName(engine), {
        kind: "engine-check-failed", audience: "operator", engine, reason,
        mode: verdict.mode, basis: verdict.basis, checkedAt: new Date(at).toISOString(),
        headline: verdict.headline, fix: verdict.fix ?? null, text,
      });
    }
    log(`[engine-check] ${engine} FAILED (${reason}, ${verdict.mode}/${verdict.basis})${already ? " — already alerted" : alerted ? " — alert written to the outbox" : " — the alert could not be written"}\n${text}${verdict.detail ? `\n  engine said: ${verdict.detail}` : ""}`);
  } else {
    log(`[engine-check] ${engine} did not complete its turn (${reason}, ${verdict.mode}/${verdict.basis}), and this is not a fault this install can fix: logged, not alerted. ${probeFailureText(verdict)}`);
  }
  try {
    mkdirSync(dir, { recursive: true });
    writeAtomic(checkPath(dir, engine), {
      at: new Date(at).toISOString(), ok: verdict.ok === true, lane, reason, build: build ?? previous?.build ?? null,
      mode: verdict.mode ?? null, basis: verdict.basis ?? null, headline: verdict.headline ?? null, fix: verdict.fix ?? null,
      alertedAt: verdict.ok ? null : alerted ? new Date(at).toISOString() : (lane === "configuration" ? previous?.alertedAt ?? null : null),
    });
  } catch { /* the check's verdict stands; the next tick checks again */ }
  return { verdict, lane, alerted, text };
}

/**
 * The worker's question on a tick with nothing to run: is a check due, and if so run it. Nothing on an install
 * with no engine chosen. Returns the check's result, or `{ due: null }`.
 *
 * `starting`: the worker has just started, after a deploy, an upgrade or a restart, and checks whatever its
 * record says, a failure an hour old included: a restart is what an operator does after fixing the engine.
 */
export async function maybeCheckEngine({ env = process.env, now = () => Date.now(), build = null, starting = false, dir = engineCheckDir(), run = runEngineCheck, log = note } = {}) {
  if (!String(env.CLEAROTRON_AI ?? "").trim()) return { due: null };
  const engine = engineOf(env.CLEAROTRON_AI);
  const record = readEngineCheck(engine, { dir });
  if (!record) { startEngineCheckClock(engine, { now: now(), build, dir }); return { due: null }; }
  const interval = routineInterval(env);
  if (interval.invalid) log(`[engine-check] ${invalidIntervalText(interval.raw)}`);
  const due = starting ? "start" : engineCheckDue({ now: now(), build, intervalMs: interval.ms, lastAnswer: lastEngineAnswer(engine, { dir }), record });
  if (!due) return { due: null };
  return { due, ...await run({ env, reason: due, now, build, dir }) };
}
