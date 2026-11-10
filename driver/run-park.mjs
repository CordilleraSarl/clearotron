// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// run-park.mjs — the one writer of `.postponed`, the marker that says a run is parked and how it resumes.
//
// A run parks for a rate limit, for a recovery, for a part not yet completed, or for a choice this machine cannot
// serve, and either product can park. The runner resumes a parked run the queue does not own from this marker
// alone, and it skips a marker without `job`, `agent` and `codename` (runner.mjs, the run-folder watcher). So every
// park is written here, and every marker carries the three: a park that did not name them gets them from the run.
import { join } from "node:path";
import { atomicWrite } from "./run-record.mjs";

/**
 * Write a run's `.postponed` marker. `park` holds the kind and its own fields, in the order they are written.
 * `identity` is what a self-resume needs; each of the three the park did not already name is added after the
 * park's own fields. A truncated marker is never visible: the write is atomic, as every sentinel's is.
 */
export function writePark(runDir, park, { job = null, agent = null, codename = null } = {}) {
  const marker = { ...park };
  for (const [key, value] of [["codename", codename], ["job", job], ["agent", agent]]) if (!(key in marker)) marker[key] = value ?? null;
  atomicWrite(join(runDir, ".postponed"), JSON.stringify({ ts: new Date().toISOString(), ...marker }, null, 2) + "\n");
  return marker;
}
