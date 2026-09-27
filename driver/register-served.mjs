// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// register-served.mjs — which register actually served this run, as a field in the run's own record.
//
// THE KNOCKOUT LANE ALREADY RECORDS THIS and the clearance lane recorded nothing equivalent, so the same
// question about a clearance run had no answer to look up. What stood in for the field was searching for a
// register's NAME as a substring inside three artifacts that happen to mention it — and measured on the
// archived runs that instrument could not attribute more than half of two scenarios' runs to any register
// at all. Those are runs whose register is unknown to the record, not runs that used none, and nothing in
// the record said which.
//
// WHAT SERVED, NOT WHAT WAS CONFIGURED. The value is taken from the same resolver the dispatch itself goes
// through, at the moment a register is used, rather than from the frozen settings the run started on. The
// per-run settings sidecar is deliberately NOT the home for it: that file exists to freeze what the run
// was sold, so a resume runs on what it started on, and a register recorded there would be the launch
// value presented with a frozen file's authority. A run whose provider changed under it would read wrong
// and confident, which is the failure this field exists to end rather than to relocate.
//
// A LIST, BECAUSE ONE IS A LIST OF ONE. A run that used two registers says two rather than naming the
// first, and a reader never has to know whether the field is a value or a set.
//
// BEST-EFFORT AND SILENT, like every other telemetry write in this lane: a field that cannot be recorded
// must never fail a register call. An absence is then the honest answer — this run's register is unknown
// to the record — which is exactly the state the archive is full of and the reason nothing here guesses.
import { readRunStatus, writeRunStatus } from "./progress.mjs";

/** The status key. One name, so the writer and every reader cannot drift. */
export const REGISTERS_SERVED = "registersServed";

// Per-process memo so the common case — every call of a run resolving the same register — costs one read
// and one write for the whole run rather than one of each per call. Keyed by run directory because a
// process can carry more than one (a resume, a batch).
const seen = new Map();

/**
 * Note that `id` served this run, and return the run's full list. Writes only when the set changes.
 * `id` is the resolver's own answer, never a raw environment read. PURE apart from the run's record.
 */
export function noteRegisterServed(runDir, id) {
  const register = String(id ?? "").trim().toLowerCase();
  if (!runDir || !register) return null;
  let set = seen.get(runDir);
  if (!set) {
    // A RESUME READS WHAT THE EARLIER PROCESS RECORDED, so a run that changed register across a resume
    // says both rather than only the half this process saw.
    set = new Set(registersServedFrom(readRunStatus(runDir)));
    seen.set(runDir, set);
  }
  if (set.has(register)) return [...set];
  set.add(register);
  const registers = [...set];
  try { writeRunStatus(null, { [REGISTERS_SERVED]: registers }, runDir); }
  catch { /* telemetry must never break a register call */ }
  return registers;
}

/** The registers a run's status records, or [] when it records none. PURE. */
export function registersServedFrom(status) {
  const v = status?.[REGISTERS_SERVED];
  return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()) : [];
}

/**
 * One line for a reader, three-valued rather than two: the register, the registers, or the absence NAMED
 * as an absence. "not recorded" is not "none served" and a reader must never have to guess which.
 * PURE.
 */
export function registerServedLine(status) {
  const r = registersServedFrom(status);
  if (!r.length) return "NOT RECORDED — this run's record carries no register, which is not the same fact as using none";
  return r.length === 1 ? r[0] : `${r.length} registers served this run: ${r.join(", ")}`;
}

/** Test seam: forget the per-process memo, so an arm can drive a second run in the same process. */
export function forgetRegistersServed() { seen.clear(); }
