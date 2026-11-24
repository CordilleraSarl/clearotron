// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// publish/read-document.mjs — reading a run into its report document, whichever report it is.
//
// Both products read a run the same way: the reads every report makes, once, then the product's own reads in order. A
// product is its reading: the directory its reads take as the run's when the caller gives none, whether its issue time
// carries the zone, its list of named reads and what it returns. The clearance's reading is in index.mjs and the
// Knockout's in knockout.mjs. A third report shape is a new reading, made of its own reads and any it shares, with
// nothing here copied.
//
// THE READS SHARE ONE RECORD OF THE RUN. Each read is handed everything read before it, the caller's arguments included,
// and returns the facts it adds. A later read that returns a fact an earlier one returned replaces it, as reassigning a
// variable did when each reader was one function. The reads run in their list's order, so their log lines and writes
// keep it too.
import { join } from 'node:path';

import { paths, readJson } from '../run-record.mjs';
import { engineCommit } from '../engine-build.mjs';
import { logosForReport } from '../mark-logos.mjs';
import { servedModels } from '../tokens.mjs';
import { resolveDemoData } from './demo-marking.mjs';
import { reportDates, zurichStamp } from './report-dates.mjs';

/**
 * The reads every report makes. Each reads what it always read, from the directory it always read it from, and none
 * writes, logs or throws on a run it can read at all, so they are made ahead of every product's own reads: the
 * Knockout's receipts check still refuses before anything is written.
 *
 * `runDir` is the run's workspace, which a republish from a report directory does not have; `base` is the reading's
 * directory for the run, which it always has.
 */
function readFrame({ runId, runDir = null, poolRoot, customerKey = null }, base, { issuedZone }) {
  // WHAT THE RECORD SAYS, NOT THE CLOCK (report-dates.mjs): a republish is neither a new search nor a new issue. The
  // issue time is the first issue's, read from the record in the firm's locale (Europe/Zurich, with CET or CEST picked
  // by Intl, never a fixed offset), e.g. "2026-06-16 · 14:32 CEST". It was once bound to the render, so a page restamped
  // on every republish while meta.json kept the first issue; the render's own time is `renderedAt`, apart from both.
  const dates = reportDates({ runDir: base, poolRunDir: join(poolRoot, runId) });
  // The models that served the run, named as a client may read them. A read that throws records nothing rather than
  // failing a publish.
  let served = null;
  try { served = runDir ? servedModels(runDir) : null; } catch { served = null; }
  // The run's frozen profile, which names its company's organisation, its project and the stores it picked. Absent on a
  // run filed before the profile existed, and on a republish with no workspace.
  let profile = null;
  try { profile = runDir ? readJson(paths(runDir).profile) : null; } catch { profile = null; }
  return {
    dates,
    issued: zurichStamp(dates.issuedAt, { zone: issuedZone }),
    // IS THIS RUN DEMO DATA? One answer for every surface, from the frozen sidecar or the roster: either marks, neither
    // un-marks. The resolution and its argument live in demo-marking.mjs. It is asked here, ahead of every product's
    // reads, because the report.md write that once came first asked nothing, and a surface added later cannot be written
    // before the question is asked.
    demoData: resolveDemoData({ runDir, customerKey }),
    served,
    // Each cited or listed registration's saved logo; none on a run that fetched none.
    logos: logosForReport(runDir),
    profile,
    // WHICH BUILD produced this, read once for every surface that records it. null off a git checkout.
    engineCommit: engineCommit(),
  };
}

/**
 * Read a run into what its report document is built from: the shared reads, then `reading.reads` in order, each handed
 * every fact read so far, then `reading.result` of them all.
 *
 * @param {{ base(input): string, issuedZone: boolean, reads: Array<(r: object) => object|Promise<object>>,
 *   result(r: object): object }} reading  the product's reading
 * @param {object} input  the product reader's arguments
 */
export async function readReportDocument(reading, input) {
  const base = reading.base(input);
  const r = { ...input, base, ...readFrame(input, base, reading) };
  for (const read of reading.reads) Object.assign(r, await read(r));
  return reading.result(r);
}
