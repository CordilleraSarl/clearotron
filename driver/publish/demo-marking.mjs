// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// demo-marking.mjs — is this run demo data, asked once for every product.
//
// put the question in the clearance publisher. found the answer:
// the KNOCKOUT publisher never asked it. `render-knockout.mjs` and `knockout.mjs` carried no demo
// handling of any kind, so a demo knockout shipped an invented mark with a real-looking assessment, a
// real register basis and a published URL, and nothing saying the matter was fiction. Measured on
// a delivered demo knockout of 2026-09-02: no demo marking in report.html,
// report.md or report-data.json.
//
// `demo-run-agreement.mjs` refuses the OTHER direction at the door — a demo banner over a real
// account's report — calling it "the same lie pointing the other way, and it is worse, because the
// reader has every reason to trust it". This direction had no door at all, and it is the one that
// travels: demo artifacts exist to be shown, and a screenshot carries whatever the page said.
//
// So the resolution lives here, once, and every publisher imports it. A second product added later
// gets the answer by importing rather than by remembering.
//
// ── WHY THE ROSTER IS RE-READ, AND WHY EITHER SOURCE MARKS ───────────────────────────────────────
//
// Moved verbatim in reasoning from the clearance publisher, because it is the part that looks like an
// oversight if the argument is left behind:
//
// RE-RESOLVED FROM THE ROSTER, which departs from the frozen-sidecar rule used for facts that
// genuinely CHANGE — a project renamed or archived afterwards must not retitle history, because the
// sidecar is what actually rated the run. Demo-ness is not that kind of fact. An invented company was
// always fiction; only the MARKER is new. Re-resolving recovers what was true at publish time rather
// than rewriting it, and it is what makes "re-publishing an existing demo run picks the marking up"
// true for every report already sitting in a pool, none of which carry the marker in their frozen
// sidecar because it did not exist when they were written.
//
// The frozen sidecar still marks when it carries the flag: an account un-marked later must not
// silently un-declare the reports it already produced. EITHER SOURCE MARKS; NEITHER UN-MARKS.
//
// Both reads are wrapped: an unreadable sidecar or roster leaves the other source's answer standing,
// and absent stays absent. It returns a boolean and never throws, because a publisher that cannot
// decide must still publish — and the failure direction is stated where it is chosen, not inferred:
// unreadable evidence yields `false`, so a marking is never invented for a report nobody proved is a
// demo. The refusal at the agreement door is what protects the other direction.

import { readFileSync } from "node:fs";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { loadProfiles } from "../profiles.mjs";

/**
 * BOTH SOURCES ARE INJECTABLE, and that is not test scaffolding for its own sake. This function's whole
 * content is a rule about how two sources combine — either marks, neither un-marks, and an unreadable
 * one is not an answer. A version that could only reach the real roster could be asserted at but never
 * DRIVEN against one, and the rule would be untested exactly where it is load-bearing. Defaults are the
 * production reads, so every caller is unchanged.
 *
 * @param {{runDir?: string|null, customerKey?: string|null,
 *          readFile?: (p: string) => string, loadRoster?: () => Map<string, {demoData?: boolean}>}} opts
 * @returns {boolean} true when this run's report must carry the demonstration marking
 */
export function resolveDemoData({
  runDir = null, customerKey = null,
  readFile = (p) => readFileSync(p, "utf8"),
  loadRoster = loadProfiles,
} = {}) {
  let demoData = false;
  try {
    const fp = runDir ? JSON.parse(readFile(driverDir(runDir, "profile.json"))) : null;
    demoData = fp?.demoData === true;
  } catch { /* no frozen profile — pre-WS-B run, or a republish with no workspace */ }
  if (!demoData && customerKey) {
    try { demoData = loadRoster().get(String(customerKey))?.demoData === true; }
    catch { /* roster unreadable — the sidecar's answer stands, and absent stays absent */ }
  }
  return demoData;
}

/**
 * The demonstration note for a MARKDOWN surface.
 *
 * 's acceptance 3 asks for the banner on "the grouped knockout page … the one a
 * reader opens first". THAT PAGE DOES NOT EXIST: `knockout.mjs` states in its own header that a
 * multi-mark run "writes no `report.html` AT ALL — the documents are `report-<slug>.html`, one per
 * mark", and that `report.md` "is the ONLY file that names every mark together". It is also written
 * into the served pool directory and reachable by URL.
 *
 * So the criterion's intent — the cross-mark surface a reader meets first is marked — is met on the
 * file that actually holds that role, and the criterion's letter cannot be met because its subject is
 * not built. Said here rather than quietly doing less.
 *
 * Same two halves as the HTML banner, and for the same reason: "invented mark" alone reads as a toy
 * and throws away the report's value as a specimen of real work; "real data" alone reads as advice
 * about a real dispute.
 */
export function demoBannerMd(isDemo) {
  if (!isDemo) return "";
  return "> **Demonstration report.** The mark is invented and this matter is not a real engagement. "
    + "The register records, the searches behind them and the risk assessment are real.\n";
}
