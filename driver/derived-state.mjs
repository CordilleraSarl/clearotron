// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// derived-state.mjs — what a stage was handed of the register picture the driver derives, by content, so that a
// replay of the stage can tell whether it is being handed the same picture.
//
// THE DEFECT. Every `--experiment` arm runs the band-shape derivation again in its sandbox, from the run's files as
// they stand now. That is right for an arm that changes the derivation, as a seeded arm does. For an arm meant to
// reproduce a pass, the run's inputs may have grown since that pass was handed its shape, and the re-derived shape is
// then a later picture than the pass read: on a saved R2 run, the arm's set-aside block kept 2 of the pass's 5 group
// rows. Nothing said so. No run recorded which picture a stage was handed, so no replay could be checked against it.
//
// SO EACH DISPATCH RECORDS IT, on its `stage` row in run.jsonl: for every derivation in the stage's context
// (stage-context.mjs CONTEXT_DERIVATIONS), the files it wrote and the files it was derived from, each by content. A
// directory, such as the official records the band tools serve, is identified by its entries' names and sizes. An arm
// then keeps the run's own derived files where the run still holds exactly what the dispatch it reproduces was
// handed, and re-derives where it does not, or where it changes the derivation. Its receipt says which, and calls the
// replay faithful only where the picture is the dispatch's own. A run from before this record is never called
// faithful.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { CONTEXT_DERIVATIONS, derivationsFor } from "./stage-context.mjs";
import { driverDir } from "../shared/driver-dir.mjs";

/** A file's identity by content, or a directory's by its entries' names and sizes, recursively. `sha` null when absent. */
function identityOf(path, runDir) {
  const rel = relative(runDir, path) || path;
  try {
    const st = statSync(path);
    const h = createHash("sha256");
    if (st.isDirectory()) {
      const walk = (dir) => {
        for (const ent of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
          const p = join(dir, ent.name);
          if (ent.isDirectory()) { h.update(`d ${relative(path, p)}\n`); walk(p); }
          else if (ent.isFile()) h.update(`f ${relative(path, p)} ${statSync(p).size}\n`);
        }
      };
      walk(path);
    } else h.update(readFileSync(path));
    return { name: rel, sha: h.digest("hex").slice(0, 16) };
  } catch { return { name: rel, sha: null }; }
}

/**
 * For each derivation in stage `name`'s context: its id, what it wrote and what it was derived from, by content.
 * `opts` are the stage's context options (axes, axis, registerOnly). [] when the stage's context reaches no
 * derivation. Never throws: a record that cannot be taken is an empty one, and an empty one is never faithful.
 */
export function derivedStateOf(name, P, opts = {}) {
  try {
    return derivationsFor(name, P, opts).map((id) => {
      const d = CONTEXT_DERIVATIONS.find((x) => x.id === id);
      return { id, writes: d.writes(P).map((p) => identityOf(p, P.runDir)), reads: d.reads(P).map((e) => identityOf(e.path, P.runDir)) };
    });
  } catch { return []; }
}

// A file absent at the dispatch and absent now is the same state; one that has appeared since is not.
const sameFiles = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length
  && a.every((x, i) => x?.name === b[i]?.name && (x?.sha ?? null) === (b[i]?.sha ?? null));

/** The derived state recorded on the run's last dispatch of `label` with this trigger, or null when none was recorded. */
export function recordedDerivedState(runDir, label, trigger = "fresh") {
  let rows = [];
  try { rows = readFileSync(driverDir(runDir, "run.jsonl"), "utf8").split("\n"); } catch { return null; }
  let found = null;
  for (const line of rows) {
    if (!line.includes('"derivedState"')) continue;
    try {
      const r = JSON.parse(line);
      if (r?.event === "stage" && r.stage === label && (r.trigger ?? "fresh") === trigger && Array.isArray(r.derivedState)) found = r.derivedState;
    } catch { /* a torn line is no record */ }
  }
  return found;
}

/**
 * How a replay is handed one derivation's output, and whether that is the picture the dispatch it reproduces was
 * handed. `recorded` is that dispatch's record, `current` the run's files now, `changesDerivation` an arm that changes
 * the derivation (a seed). PURE.
 *   - kept, faithful: the arm changes nothing upstream and the run still holds exactly what the dispatch was handed;
 *   - re-derived, faithful: the arm changes the derivation, from the inputs the dispatch's own was derived from;
 *   - re-derived, not faithful: anything else, and why.
 * A projection the dispatch took (`projection` in CONTEXT_DERIVATIONS) is always the run's copy, as the rig has always
 * handed it; it is faithful when that copy is the one the dispatch wrote.
 */
export function replayOfDerivation(id, recorded, current, { changesDerivation = false } = {}) {
  const rec = (recorded ?? []).find((d) => d?.id === id) ?? null;
  const cur = (current ?? []).find((d) => d?.id === id) ?? null;
  if (!rec) return { id, how: "re-derived", faithful: false, why: "the run recorded no picture for the dispatch this arm reproduces" };
  const readsSame = Boolean(cur) && sameFiles(rec.reads, cur.reads);
  const writesSame = Boolean(cur) && sameFiles(rec.writes, cur.writes);
  // A projection the dispatch took is its own picture whatever it was read from since.
  if (CONTEXT_DERIVATIONS.find((d) => d.id === id)?.projection === true)
    return writesSame ? { id, how: "kept", faithful: true, why: null }
      : { id, how: "kept", faithful: false, why: "the run's copy was written after the dispatch this arm reproduces" };
  if (!changesDerivation && readsSame && writesSame) return { id, how: "kept", faithful: true, why: null };
  if (changesDerivation && readsSame) return { id, how: "re-derived", faithful: true, why: null };
  return { id, how: "re-derived", faithful: false, why: "the run's files have changed since the dispatch this arm reproduces" };
}

