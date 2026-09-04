// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// archive-tags.mjs — the pool's "retired" sidecar, and nothing else.
//
// <poolRoot>/archive-tags.json is `{ archived: ["<runId>", ...] }`. A run is visible unless its id is
// listed. pool-admin writes it; the staff index and the portal listing read it.
//
// WHY THIS IS ITS OWN FILE. It used to live in publish/index.mjs, which is the RENDERER — it pulls in
// the HTML renderer, the XLSX builder, the findings model and the brand assets. The portal service
// needs six lines of sidecar reading on a request path and nothing else in that graph, and importing a
// renderer to get them is the coupling that makes a service slow to boot for reasons nobody can see.
// Kept re-exported from publish/index.mjs so existing importers are untouched.
import { readFileSync, writeFileSync, renameSync, chmodSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export const ARCHIVE_TAGS_FILE = 'archive-tags.json';

/** The retired set. A missing or unreadable sidecar means NOTHING is retired — never an error: the
 *  file is optional by design, and a pool that has never had a run archived has no reason to carry it. */
export function readArchivedSet(poolDir) {
  try {
    const j = JSON.parse(readFileSync(join(poolDir, ARCHIVE_TAGS_FILE), 'utf8'));
    return new Set(Array.isArray(j?.archived) ? j.archived.map(String) : []);
  } catch { return new Set(); }
}

/**
 * — THE ONLY WRITER, AND IT DOES ITS OWN READ.
 *
 * `pool-admin` (run by hand as the pool owner) and the portal service (a long-lived process, another
 * identity) now both retire runs. Both used to read the whole set, mutate it and write the whole file
 * back — so two curation acts a second apart lose one of themselves, and the loser is a run that
 * silently comes back onto every screen. That is the failure this signature exists to prevent:
 *
 *   * THE READ IS IN HERE, not at the call site. A caller that reads a set, thinks about it, and then
 *     hands it back is holding a snapshot; the width of that window is the width of the bug. `mutate`
 *     is handed a set read microseconds before the write.
 *   * THE WRITE IS ATOMIC — tmp file in the same directory, then rename(2). A reader can never see a
 *     half-written sidecar, and a crash mid-write leaves the previous file intact.
 *   * DELTAS, NOT REPLACEMENTS, wherever the caller can express one. `add`/`delete` on the set it is
 *     given loses nothing another writer added; a caller that clears and rebuilds (pool-admin's
 *     `archive-only`, which is defined as a whole-set operation) still narrows the window to the write
 *     itself but cannot avoid it, and that is the deliberate CLI act rather than a request path.
 *
 * NO LOCK FILE. The two writers run as different users against a set-GID pool, and a lock one identity
 * creates that the other cannot clear is a control that wedges. Never chmod the pool root to fix that
 * (it strips the set-GID bit and every report then 403s — real incident).
 *
 * 0640, best-effort: group-read comes from the set-GID pool, and a chmod failure must not fail a
 * curation act that has already written correctly.
 *
 * Returns the set as written.
 */
export function updateArchived(poolDir, mutate) {
  const next = mutate(readArchivedSet(poolDir));
  if (!(next instanceof Set)) throw new TypeError('updateArchived: the mutator must return the Set');
  const target = join(poolDir, ARCHIVE_TAGS_FILE);
  const tmp = `${target}.tmp-${process.pid}`;
  const body = JSON.stringify({ archived: [...next].map(String).sort() }, null, 2) + '\n';
  try {
    writeFileSync(tmp, body);
    try { chmodSync(tmp, 0o640); } catch { /* best-effort; group-read via set-gid pool */ }
    renameSync(tmp, target);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* the rename already consumed it, or it was never created */ }
    throw e;
  }
  return next;
}
