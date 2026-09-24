// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// reviewer-open-points.mjs — where the reviewer's open points are kept, and how the audit workbook reads them.
//
// Owner ruling, 2026-09-24: reviewer notes never reach the client page. The pipeline still builds the
// section from the review and the corrective observation (buildReviewerOpenPointsSection) and writes it to
// the run record under `_driver/`, for the reviewing lawyer. Nothing a client can open carries it: not the
// report, and not the audit workbook, whose link rides the cover note a client principal receives.
//
// One module owns the file's name and its reading, so the pipeline that writes it and the email that reads
// it cannot disagree about where it is, and the reader does not import the pipeline to learn a file name.

import { readFileSync, existsSync } from "node:fs";
import { driverDir } from "../shared/driver-dir.mjs";

/** The run-record file the reviewer's open points are written to, under the run's `_driver/`. */
export const REVIEWER_OPEN_QUESTIONS_FILE = "reviewer-open-questions.md";

/**
 * The recorded open points for the email the run sends, or null where that email could reach a client.
 *
 * The run's email goes to the job's forwarder, and on a client-started run (`clientPrincipal`) that address
 * is the client itself. There the open points stay in the run record alone. Everywhere else the recipient
 * is the reviewing lawyer, who reads them in the email's review headline, in the record's own words.
 * Null too when the run recorded none: the reviewer signed and nothing is open.
 */
export function reviewerOpenPointsForEmail(job, runDir) {
  if (job?.clientPrincipal === true || !runDir) return null;
  const file = driverDir(runDir, REVIEWER_OPEN_QUESTIONS_FILE);
  if (!existsSync(file)) return null;
  try { return readFileSync(file, "utf8").trim() || null; } catch { return null; }
}
