// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// started-on-this-build.mjs — give a fixture run folder the row a run writes when it starts: the build it loaded.
//
// The runner's resumes refuse a run that started on another build (one-build-per-run.mjs), and a run with no such row
// started before the row existed. A fixture standing for a resume on the same build carries the row, as a real one does.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { engineProvenance } from "../engine-build.mjs";
import { paths } from "../run-record.mjs";

/** Append the running build's `engine-build` row to the run's log, and return the run folder. */
export function startedOnThisBuild(runDir) {
  const log = paths(runDir).run;
  mkdirSync(dirname(log), { recursive: true });
  appendFileSync(log, JSON.stringify({ event: "engine-build", engineHead: engineProvenance().engineHead }) + "\n");
  return runDir;
}
