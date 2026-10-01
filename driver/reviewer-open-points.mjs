// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// reviewer-open-points.mjs — where the reviewer's open points are kept, and how the audit workbook reads them.
//
// Owner ruling, 2026-09-24: reviewer notes never reach the client page. Owner ruling, 2026-10-01: they do
// not reach the email either, on any run. The pipeline still builds the section from the review and the
// corrective observation (buildReviewerOpenPointsSection) and writes it to the run record under `_driver/`,
// beside the report, for the reviewing lawyer who opens the run. Nothing sends it anywhere.
//
// WHAT THE SECOND RULING REMOVED, and why it is not a narrowing of the first. The first took the section off
// the report page and left it on the email, gated on whether the run's forwarder was the client. The email
// then carried the sentence naming the independent reviewer — which reads as a human declining to sign a
// report — and carried the points in the engine's own vocabulary. Measured over the thirty days to
// 2026-10-01: the report page carries neither since the first ruling, and the email carried both. So the
// gate was holding a door open that is now shut: nothing reads this file onto a surface that is sent.
//
// One module owns the file's name, so the pipeline that writes it and the workbook reader that skips it
// cannot disagree about where it is, and a reader does not import the pipeline to learn a file name.

import { readFileSync, existsSync } from "node:fs";
import { driverDir } from "../shared/driver-dir.mjs";

/** The run-record file the reviewer's open points are written to, under the run's `_driver/`. */
export const REVIEWER_OPEN_QUESTIONS_FILE = "reviewer-open-questions.md";

// THE EMAIL READER IS GONE (owner ruling, 2026-10-01). It returned this file's text for a run whose
// forwarder was not the client, and the pipeline handed that to the email cover. Both halves are removed:
// the reader here, and the hand-off there. A gate on the recipient is not what the ruling asked for — the
// points leave every surface that is sent, so there is no recipient to test.
//
// NOT LEFT IN PLACE UNUSED. An exported reader with no caller is the shape somebody wires back up, and the
// thing that made this reachable in the first place was a function that existed and looked safe to call.
