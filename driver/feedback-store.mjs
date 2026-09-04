// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// feedback-store.mjs — where a lawyer's flag on a delivered finding lands.
//
// One JSON file per flag, named by uuid, in a flat directory. No index, no database, no state machine:
// a flag is a captured observation, and the only thing that ever has to be true of it is that it can be
// read back later without asking anyone what it means. turns each one into a GitHub issue; nothing
// in this module knows about that.
//
// WHAT A FLAG HAS TO SURVIVE, and why the locator is a composite rather than an id.
//
// A finding has no stable identity. `ordinal` is assigned by a contiguous renumber on EVERY publish
// (findings-model.mjs — `out.forEach((f, i) => { f.ordinal = i + 1 })`), so a republish that adds,
// withdraws or reorders a finding silently re-points every stored ordinal at a different finding. The
// predecessor system stored a bare ordinal and carries that defect in all 75 of its records.
//
// So a flag stores the ordinal AND the facts that identify the finding independently of it — mark, band,
// disposition — read SERVER-SIDE from the run's own artifacts, never taken from the request. Mark and band
// come from report-data.json; the disposition comes from findings.json beside it in the same run dir,
// because report-data.json is the CLIENT cut and stopped serving the engine's placement key. A
// reader who finds the ordinal now points at `KURENA / Manageable / rebuttable` when the flag says
// `PETCARY / Medium / conceded` knows the run was republished, which is exactly the thing a bare id
// would have hidden.

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** good/bad, as the issue rules it: "Good flags matter as much as bad." */
export const VERDICTS = new Set(["good", "bad"]);

/** A why longer than this is a document, not a note; the report is where documents live. */
export const MAX_WHY = 4000;

/**
 * Where flags go. `CLEAROTRON_FEEDBACK_DIR` when set, else a `_feedback` directory beside the pool.
 *
 * Beside the pool rather than inside a run: a flag is evidence ABOUT a run, and run directories are
 * written read-only at publish and purged on their own schedule. A flag outliving the run it describes
 * is the point.
 */
export function feedbackDir(poolRoot) {
  return process.env.CLEAROTRON_FEEDBACK_DIR || join(poolRoot, "_feedback");
}

/**
 * Write one flag. Returns `{ id, path }`.
 *
 * Every field is supplied by the CALLER, which is the portal route, which reads the identifying ones
 * from the run's own artifacts. This module validates shape and refuses rather than coercing: a flag
 * with a missing locator is worse than no flag, because it looks like evidence.
 */
export function appendFlag(dir, flag) {
  const verdict = String(flag?.verdict ?? "");
  if (!VERDICTS.has(verdict)) throw new Error(`verdict must be good or bad, got ${JSON.stringify(flag?.verdict)}`);
  const runId = String(flag?.runId ?? "").trim();
  if (!runId) throw new Error("runId is required");
  const why = String(flag?.why ?? "").trim();
  if (!why) throw new Error("why is required — a flag with no reason is a vote, and votes are not evidence");
  if (why.length > MAX_WHY) throw new Error(`why is ${why.length} chars, over the ${MAX_WHY} limit`);

  const id = randomUUID();
  const rec = {
    id,
    schema: "report-feedback/1",
    verdict,
    why,
    capturedBy: flag.capturedBy ?? null,
    capturedAt: flag.capturedAt ?? new Date().toISOString(),
    // WHERE IN THE REPORT. `ordinal` locates it today; the other three locate it after a republish.
    locator: {
      ordinal: flag.locator?.ordinal ?? null,
      // — the knockout lane's two extra identifying facts, and they are the same idea as `mark`
      // and `band` above: read server-side, stored so the flag survives a republish that renumbers.
      // `ref` is the drill-through key both the report page and the workbook print (`<MARK> #<ordinal>`,
      //); `searchedMark` is which of a BATCH's marks was being read, which nothing else here says —
      // `mark` is the CONFLICTING name on both lanes. Null on clearance, which has neither.
      ref: flag.locator?.ref ?? null,
      searchedMark: flag.locator?.searchedMark ?? null,
      mark: flag.locator?.mark ?? null,
      band: flag.locator?.band ?? null,
      disposition: flag.locator?.disposition ?? null,
      section: flag.locator?.section ?? null,
    },
    // The flagged sentence(s), as the reader saw them — puts this in the issue body so triage does
    // not require opening the VM to read one sentence.
    excerpt: flag.excerpt ?? null,
    // WHICH RUN, and which build of the engine produced it.
    run: {
      runId,
      account: flag.run?.account ?? null,
      matter: flag.run?.matter ?? null,
      markName: flag.run?.markName ?? null,
      searchLevel: flag.run?.searchLevel ?? null,
      issuedAt: flag.run?.issuedAt ?? null,
      engineCommit: flag.run?.engineCommit ?? null,
      runDir: flag.run?.runDir ?? null,
    },
  };

  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${id}.json`);
  writeFileSync(path, JSON.stringify(rec, null, 2) + "\n", { mode: 0o640 });
  return { id, path };
}

/** Every flag on disk, newest first. Unreadable or non-JSON files are SKIPPED, never thrown on. */
export function listFlags(dir) {
  let names;
  try { names = readdirSync(dir).filter((n) => n.endsWith(".json")); }
  catch { return []; }
  const out = [];
  for (const n of names) {
    try { out.push(JSON.parse(readFileSync(join(dir, n), "utf8"))); }
    catch { /* a half-written or hand-edited file is not a reason to lose the other 74 */ }
  }
  return out.sort((a, b) => String(b.capturedAt ?? "").localeCompare(String(a.capturedAt ?? "")));
}
