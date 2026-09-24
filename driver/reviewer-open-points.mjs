// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// reviewer-open-points.mjs — where the reviewer's open points are kept, and how the audit workbook reads them.
//
// Owner ruling, 2026-09-24: reviewer notes never reach the client page. The pipeline still builds the
// section from the review and the corrective observation (buildReviewerOpenPointsSection) and writes it to
// the run record under `_driver/`. The reviewing lawyer reads it on the audit workbook's Summary tab, so
// moving it off the report does not also take it away from the person it is for.
//
// One module owns the file's name and its reading, so the writer (pipeline) and the reader (publish) cannot
// disagree about either, and publish does not have to import the pipeline to learn a file name.

import { readFileSync, existsSync } from "node:fs";
import { driverDir } from "../shared/driver-dir.mjs";

/** The run-record file the reviewer's open points are written to, under the run's `_driver/`. */
export const REVIEWER_OPEN_QUESTIONS_FILE = "reviewer-open-questions.md";

/**
 * The record's heading, lead and points, from the markdown the builder wrote. Pure.
 *
 * The builder's output is a fixed shape: the heading, a lead paragraph in bold, then one `- ` line per
 * point. Returns null for an empty or unrecognisable record rather than an empty section, so a caller
 * never renders a heading over nothing.
 */
export function reviewerOpenPointsFromRecord(md) {
  const lines = String(md ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const headingAt = lines.findIndex((l) => /^#+\s/.test(l));
  if (headingAt < 0) return null;
  const heading = lines[headingAt].replace(/^#+\s*/, "");
  const rest = lines.slice(headingAt + 1);
  const lead = rest.find((l) => !l.startsWith("- ")) ?? "";
  const points = rest.filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim());
  if (!lead && !points.length) return null;
  return { heading, lead, points };
}

/** The run's recorded open points, or null when the run recorded none (the reviewer signed, nothing open). */
export function readReviewerOpenPoints(runDir) {
  if (!runDir) return null;
  const file = driverDir(runDir, REVIEWER_OPEN_QUESTIONS_FILE);
  if (!existsSync(file)) return null;
  try { return reviewerOpenPointsFromRecord(readFileSync(file, "utf8")); }
  catch { return null; }
}
