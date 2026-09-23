// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// answer-memory.mjs — a run remembers the register's answer to a question it has already asked.
//
// WHY. A register that bills per request charges again for every repeat, and a run repeats itself: a
// repair re-sends a whole axis, a re-attempt re-asks questions that already answered, a proposal is
// asked again later in the run. The memory sits at the provider's one HTTP chokepoint, so every caller
// is covered without each of them learning to share.
//
// WHERE IT LIVES. In the run's own `_driver/` folder, because the requests come from two kinds of
// process — the long-lived driver and the tool servers a stage spawns — and the repeats cross between
// them. Each already knows the run's record log: the driver passes it on `tctx.recordLog`, and a
// spawned server has it in CLEAROTRON_REGISTER_RECORD_LOG. The memory is the folder beside that file,
// so nothing new is handed to either.
//
// ONE ATTEMPT. The driver clears the folder when an attempt starts and removes it when the attempt
// ends, so a resume asks the register again. A folder whose attempt began more than a day ago is
// ignored, for an attempt that died without cleaning up. A process that finds no folder — a bare
// probe, a test, a register with no run — asks the register exactly as it always has.
//
// THREE MODES, fixed when the attempt starts from the register's own switch (ANSWER_MEMORY_PROVIDERS):
//   off    nothing is remembered and nothing is written.
//   watch  every request still goes to the register. Per request, the memory records whether it held
//          an answer to the identical question, and whether the fresh answer has the same total, the
//          same record ids and the same order as the one it held. This is the evidence the switch to
//          `on` waits for.
//   on     a held answer is returned and the register is not asked.
//
// WHAT IS KEPT is the provider's decision, because only the provider knows which bodies are complete
// answers (see `rememberableAnswer` in the Signa core). An answer that points at a next page is held
// only for NEXT_PAGE_FRESH_MS: the cursor it carries is the register's, and nothing says how long the
// register honours it.
//
// NEVER THROWS. Every failure here reads as "nothing held" or "not stored", which is the behaviour
// the run had before the memory existed.

import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { driverDir } from "../../shared/driver-dir.mjs";
import { RUN_RECORD_LOG_FILE } from "./ledger-path.mjs";

export const ANSWER_MEMORY_MODES = Object.freeze(["off", "watch", "on"]);

/**
 * The registers whose core consults this memory, the environment switch that sets it for each (`env`, the
 * table shape the configuration audit reads), and the mode a run takes when that switch is unset. Every other register is `off`, whatever any switch says.
 *
 * SIGNA starts `off`: it goes `on` only after a watch round shows no mismatch, by the owner's ruling.
 * CLARIVATE starts `on`, with no watch round, also by his ruling: the repeated answers of its past runs
 * were already compared and matched.
 */
export const ANSWER_MEMORY_PROVIDERS = Object.freeze({
  signa: Object.freeze({ env: "CLEAROTRON_SIGNA_ANSWER_MEMORY", defaultMode: "off" }),
  clarivate: Object.freeze({ env: "CLEAROTRON_CLARIVATE_ANSWER_MEMORY", defaultMode: "on" }),
});
export const ANSWER_MEMORY_SWITCH = ANSWER_MEMORY_PROVIDERS.signa.env;
export const ANSWER_MEMORY_DIR = "register-answers";
export const ANSWER_WATCH_LOG = "register-answer-watch.jsonl";
const ATTEMPT_FILE = "attempt.json";
export const ATTEMPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// One hour: a next-page link has been seen to work an hour after the register gave it, and nothing says it
// works for longer. A held answer older than this is simply asked again. A park ends the attempt anyway,
// and a resumed run starts with an empty memory, so no link survives a park.
export const NEXT_PAGE_FRESH_MS = 60 * 60 * 1000;

/**
 * The mode a register's switch asks for. Unset, or naming none of the three, is that register's default,
 * and a value that named none of them is returned as `unknown` so the run can say so.
 */
export function answerMemoryMode(env = process.env, provider = "signa") {
  const spec = ANSWER_MEMORY_PROVIDERS[String(provider ?? "")];
  if (!spec) return { mode: "off", unknown: null };
  const raw = String(env?.[spec.env] ?? "").trim().toLowerCase();
  if (!raw) return { mode: spec.defaultMode, unknown: null };
  return ANSWER_MEMORY_MODES.includes(raw) ? { mode: raw, unknown: null } : { mode: spec.defaultMode, unknown: raw };
}

/**
 * Begin an attempt: whatever an earlier attempt left is removed, and a folder is made only for
 * `watch` or `on`. Returns the folder, or null when the memory is off. Called by the driver alone.
 */
export function startAnswerMemory(runDir, mode, { now = Date.now } = {}) {
  const dir = driverDir(runDir, ANSWER_MEMORY_DIR);
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* nothing to clear */ }
  if (mode !== "watch" && mode !== "on") return null;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ATTEMPT_FILE), JSON.stringify({ mode, started_ms: now() }) + "\n");
    return dir;
  } catch { return null; }
}

/**
 * The driver's half of an attempt: the mode this run uses, with the folder begun for it. `applies` is
 * false for a register that does not use the memory, and then nothing is written at all, so that
 * register's run folder is exactly what it was. A folder that cannot be made reads as `off`.
 */
export function beginAnswerMemory(runDir, provider, { env = process.env, now = Date.now } = {}) {
  const spec = ANSWER_MEMORY_PROVIDERS[String(provider ?? "")];
  if (!spec) return { mode: "off", unknown: null, applies: false, switch: null };
  const { mode, unknown } = answerMemoryMode(env, provider);
  const dir = startAnswerMemory(runDir, mode, { now });
  return { mode: dir ? mode : "off", unknown, applies: true, switch: spec.env };
}

/** End an attempt. The watch log stays; the held answers go. */
export function endAnswerMemory(runDir) {
  try { rmSync(driverDir(runDir, ANSWER_MEMORY_DIR), { recursive: true, force: true }); } catch { /* already gone */ }
}

/**
 * The run's memory for this request, or null. Found from the run's record log, which is the only
 * address both kinds of process already hold. The box-global ledger's file has a different name, so a
 * process pointed at it finds no run and no memory.
 */
export function openAnswerMemory(recordLog = null, { env = process.env, now = Date.now } = {}) {
  try {
    const log = typeof recordLog === "string" && recordLog.trim()
      ? recordLog.trim() : String(env?.CLEAROTRON_REGISTER_RECORD_LOG ?? "").trim();
    if (!log || basename(log) !== RUN_RECORD_LOG_FILE) return null;
    const dir = join(dirname(log), ANSWER_MEMORY_DIR);
    const attempt = JSON.parse(readFileSync(join(dir, ATTEMPT_FILE), "utf8"));
    if (attempt?.mode !== "watch" && attempt?.mode !== "on") return null;
    if (!Number.isFinite(attempt.started_ms) || now() - attempt.started_ms > ATTEMPT_MAX_AGE_MS) return null;
    return { mode: attempt.mode, dir, watchLog: join(dirname(log), ANSWER_WATCH_LOG) };
  } catch { return null; }
}

/** The identity of a question: everything that decides the answer, and nothing that does not. */
export function answerKey(question) {
  return createHash("sha256").update(JSON.stringify(question)).digest("hex");
}

/**
 * The held answer to a question, or null. An answer that points at a next page is returned `stale`
 * once NEXT_PAGE_FRESH_MS has passed: it is not served, and a watch records that it was held, so a
 * round can show what the rule costs.
 */
export function recallAnswer(mem, key, { now = Date.now } = {}) {
  try {
    const held = JSON.parse(gunzipSync(readFileSync(join(mem.dir, `${key}.json.gz`))).toString("utf8"));
    const age = now() - held.stored_ms;
    return { ...held, age_ms: age, stale: held?.summary?.next_page === true && age > NEXT_PAGE_FRESH_MS };
  } catch { return null; }
}

/**
 * Keep an answer. Written whole and renamed into place, so a process reading at the same moment sees
 * the old state or the new one and never half of either. Never makes the folder: an attempt that has
 * ended has no memory to write into.
 */
export function rememberAnswer(mem, key, entry, { now = Date.now } = {}) {
  const dest = join(mem.dir, `${key}.json.gz`);
  const tmp = `${dest}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    writeFileSync(tmp, gzipSync(JSON.stringify({ ...entry, stored_ms: now() })));
    renameSync(tmp, dest);
    return true;
  } catch {
    try { rmSync(tmp, { force: true }); } catch { /* nothing written */ }
    return false;
  }
}

/** One line per request in the watch log. Small, so concurrent appends from two processes stay whole. */
export function noteAnswer(mem, row) {
  try { appendFileSync(mem.watchLog, JSON.stringify(row) + "\n"); } catch { /* the log is evidence, never a gate */ }
}

/**
 * Three separate answers, because they mean different things. A different total or a different set
 * of ids is a different answer, and the memory must not go live while either happens. A different
 * order of the same ids is a register that breaks ties differently from one request to the next: the
 * memory returns one of the orders the register itself gives.
 */
export function compareAnswers(held, fresh) {
  const a = Array.isArray(held?.ids) ? held.ids : [];
  const b = Array.isArray(fresh?.ids) ? fresh.ids : [];
  const sa = [...a].sort(), sb = [...b].sort();
  const same_ids = sa.length === sb.length && sa.every((v, i) => v === sb[i]);
  return {
    same_total: (held?.total ?? null) === (fresh?.total ?? null),
    same_ids,
    same_order: same_ids && a.every((v, i) => v === b[i]),
  };
}
