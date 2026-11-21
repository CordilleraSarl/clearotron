// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// run-resume.mjs — two questions a resume asks before it opens a run: on which date the named run started, and whether
// it was stopped.
//
// Moved out of pipeline.mjs unchanged, so that the step that opens a run imports them instead of having them handed in.
import { isCancelled } from "./cancel.mjs";
import { config } from "./driver.config.mjs";
import { deriveSlug } from "./phase0.mjs";
import { terminalRunState } from "./progress.mjs";
import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * — WHY THIS RESUME MUST NOT HAPPEN, OR null.
 *
 * Exported and pure so an arm can drive the DECISION without standing up a run slot, an engine
 * preflight and a whole studio tree to reach it — the same reasoning retireCancelledPark states for
 * returning what it wrote. A predicate nobody can call cheaply is a predicate nobody tests.
 *
 * Two surfaces, because a stop is spelled two ways depending on what the run was doing when it was
 * asked. `.cancel` is the REQUEST, and stop_run writes only that for a run still executing; a terminal
 * `status.json` is the SETTLEMENT, which is what a park retired by the runner (or by an operator at a
 * shell) leaves behind. Reading one and not the other is how the measured run resumed past a cancel
 * that was, by then, written on both of them.
 *
 * The DELIVERED terminal is deliberately NOT folded in here: its caller needs to name which of three
 * delivery markers it found, and it refuses for a different reason (a duplicate report, not a
 * countermanded decision). Two refusals, two messages a reader can act on.
 */
export function resumeStopRefusal(runDir) {   // @internal
  if (!runDir) return null;
  if (isCancelled(runDir)) return "an operator asked it to stop (.cancel present)";
  // ── CANCELLED ONLY, AND THE FIRST CUT OF THIS WAS WRONG ────────────────────────────────────────
  //
  // This read `TERMINAL_STATES.has(state)` — delivered, failed, cancelled — and CI refused sixty-odd
  // resume arms for it. Rightly: `failed` is a terminal the RUNNER writes about itself, and resuming a
  // failed run is not an edge case, it is the documented purpose of the door this guard sits in. The
  // three rmSync calls below exist to clear exactly that sentinel so "a clean resume doesn't read as
  // failed". A guard refusing what its own function was built to do is a worse defect than the one it
  // was fixing, and it would have stranded every crash-recovered run on the box.
  //
  // `cancelled` is the only state a PERSON sets, which is the issue's own criterion — "a terminal
  // status.json state set by an OPERATOR is honoured". The runner's REPARK_MAX circuit breaker and the
  // reclaim-exhausted path both write `failed` with a reason, so "terminal + has a reason" cannot
  // separate them either; the state word can.
  //
  // `delivered` is deliberately absent: the branch above already refuses it, earlier, and names which
  // of three delivery markers it found. Repeating it here would be unreachable code carrying a worse
  // message than the one that fires.
  const t = terminalRunState(runDir);
  return t === "cancelled" ? "it was cancelled (status.json)" : null;
}
// The calendar date of an existing LIVE run-dir for this job+codename (the leaf is "<date>-<codename>"), read
// off disk so a resume/re-run targets the ORIGINAL run regardless of today's date. null if no live run-dir.
export function findRunDate(job, codename, studioRoot) {
  const slugDir = join(studioRoot ?? config.studioRoot, deriveSlug(job));
  let entries = [];
  try { entries = readdirSync(slugDir); } catch { /* none */ }
  const hit = entries.find((n) => /^\d{4}-\d\d-\d\d-/.test(n) && n.endsWith(`-${codename}`));
  return hit ? hit.match(/^(\d{4}-\d\d-\d\d)-/)[1] : null;
}
