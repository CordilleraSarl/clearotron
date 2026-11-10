// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// one-build-per-run.mjs — a run is finished on the build it started on, or not at all.
//
// The owner's ruling of 2026-11-09: a search is not upgraded part-way, and a run is not resumed after an upgrade. Code
// that carries a run from one build into the next is not kept. Each segment of a run already writes the build it loaded
// as an `engine-build` row in `run.jsonl`; this reads the first of them and compares it with the build now running.
//
// WHERE IT IS ASKED. The runner's resumes ask it before re-entering the pipeline: a postponed claim and a crash reclaim
// in `runPrepared`, and a run folder's own resume in `resumeRunDirOrphans`. `pipeline()` itself does not, because the
// bench resumes saved runs on new code to measure what a change does, and that comparison reads a copy and delivers
// nothing. Only the doors a client's run comes back through refuse.
//
// AN ABSENT RECORD REFUSES. A run with no `engine-build` row started before the row existed, which is an earlier
// version, and a build that cannot name itself cannot show that a run started on it.
import { readFileSync } from "node:fs";

import { engineProvenance } from "./engine-build.mjs";
import { paths } from "./run-record.mjs";

/** The commit a run's first segment loaded, from its first `engine-build` row, or null when it recorded none. */
export function startedOnBuild(runDir) {
  let text;
  try { text = readFileSync(paths(runDir).run, "utf8"); } catch { return null; }
  for (const line of text.split("\n")) {
    if (!line.includes('"engine-build"')) continue;
    try {
      const row = JSON.parse(line);
      if (row?.event === "engine-build") return typeof row.engineHead === "string" && row.engineHead ? row.engineHead : null;
    } catch { /* a torn line is not the row */ }
  }
  return null;
}

/**
 * Why this run may not be resumed on the running build, as one sentence, or null when it may.
 * `current` is injected for tests; callers leave it to the running build.
 */
export function crossBuildResumeRefusal(runDir, { current = engineProvenance().engineHead } = {}) {
  const why = !current
    ? "this install cannot name its own build, so it cannot show the run started on it"
    : (() => {
      const started = startedOnBuild(runDir);
      if (!started) return "the run recorded no build when it started, so it started on an earlier version";
      return started === current ? null : `the run started on build ${started.slice(0, 12)} and this is ${current.slice(0, 12)}`;
    })();
  return why && `resume refused: ${why}. A run is finished on the build it started on and is not resumed after an update; start a new run.`;
}
