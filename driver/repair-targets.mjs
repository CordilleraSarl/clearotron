// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// repair-targets.mjs — which part of the delivered report holds a delivery-check fault, so its repair can edit it.
//
// The report is assembled from parts that different writers own: the overview, which the report-overview step
// writes; each full card, which its own card step writes; and lines that code composes from the findings record —
// each card's finding sentence, every short entry and every grouped line. The pre-delivery check reads the assembled
// report, and most of its prose checks name no finding. A fault that names none went to the overview's repair, which
// cannot edit a card, so a fault inside a card shipped after a repair that could not reach it, and the overview was
// rewritten for nothing.
//
// So each such fault is located. Its own check runs again on each part's own text, and a part where it fails is a
// part that holds it: a card's fault goes to that card's repair, carrying the detail the check gives on that card
// alone, and the overview's goes to the overview's. A fault that only the lines code composes from the record hold is
// one neither repair can edit, so it costs neither a repair. A fault no single part holds (two cards counting one
// owner's registrations differently), or one whose check cannot be run on a part, keeps the overview's repair it
// always had.
import { readFileSync } from "node:fs";
import { prescriptionProseChecks, scopeNumberProseChecks, wipoLanguageChecks, countingChecks, countsFromFindings } from "./predelivery-lint.mjs";
import { netOf, memberLine } from "./write-up-render.mjs";

// The checks that judge a text by itself, run as the delivery check runs them, on one part at a time.
const ON_A_PART = {
  "prescription-prose": (text) => prescriptionProseChecks({ reportMd: text }).find((c) => c.surface === "report"),
  "scope-numbers-in-prose": (text) => scopeNumberProseChecks({ reportMd: text }).find((c) => c.surface === "report"),
  "wipo-designation-language": (text) => wipoLanguageChecks({ reportMd: text }).find((c) => c.surface === "report"),
  "counting-consistency": (text) => countingChecks({ report: text })[0],
  "counting-vs-findings": (text, findings) => countsFromFindings(findings, { report: text })[0],
};
export const LOCATED_CHECKS = Object.freeze(Object.keys(ON_A_PART));

/**
 * Give each report fault the part that holds it. PURE. A fault whose check named its finding goes to that finding's
 * card, as it always did; one that names none is located.
 *
 * `parts` are the texts as their writers wrote them: `cards`, each full card's own file ({ordinal, text}); `overview`,
 * the overview's own file; and `stamped`, the lines code composes from the record ({ordinal, text}). `findings` is
 * the record the delivery check judged, for the check that compares a count with it.
 *
 * Returns `{cards, overview, stamped, unlocated}`: `cards` maps a card's ordinal to the faults it holds, each with
 * that card's ordinal and the detail its check gives on that card alone; `overview` holds the faults the overview's
 * repair is given, those it holds (with its own detail) and those no part holds alone; `stamped` the faults only
 * lines composed from the record hold; `unlocated` the faults no part holds alone, already counted in `overview`.
 */
export function locateReportFaults(failures, { cards = [], overview = null, stamped = [], findings = [] } = {}) {
  const out = { cards: new Map(), overview: [], stamped: [], unlocated: [] };
  const fails = (rerun, text) => {
    if (!String(text ?? "").trim()) return null;
    const c = rerun(text, findings);
    return c && c.pass === false ? c : null;
  };
  const toCard = (ordinal, fault) => out.cards.set(ordinal, [...(out.cards.get(ordinal) ?? []), fault]);
  for (const f of failures ?? []) {
    if (f?.ordinal != null) { toCard(f.ordinal, f); continue; }   // the check named its finding: that card, as it always was
    const rerun = ON_A_PART[f?.id];
    if (!rerun) { out.overview.push(f); out.unlocated.push(f); continue; }
    let held = false;
    for (const c of cards) {
      const hit = fails(rerun, c.text);
      if (!hit) continue;
      held = true;
      toCard(c.ordinal, { ...f, ordinal: c.ordinal, detail: hit.detail });
    }
    const shell = fails(rerun, overview);
    if (shell) { held = true; out.overview.push({ ...f, detail: shell.detail }); }
    if (held) continue;
    if (stamped.some((s) => fails(rerun, s.text))) { out.stamped.push(f); continue; }
    out.overview.push(f);
    out.unlocated.push(f);
  }
  return out;
}

/**
 * The report's parts as their writers wrote them, read from the run. Never throws: a part that cannot be read is left
 * out, so no fault is placed in it. `plan` is the write-up plan the report was assembled from (pipeline.mjs
 * planWriteUps): its full cards are the cards' own files, and its short entries and grouped lines, like each card's
 * finding sentence, are composed from the record.
 */
export function reportPartsOf(P, findings, plan) {
  const read = (at) => { try { return readFileSync(at, "utf8"); } catch { return null; } };
  const byOrdinal = new Map((findings ?? []).filter((f) => f?.ordinal != null).map((f) => [f.ordinal, f]));
  const cards = (plan?.cardOrdinals ?? []).map((o) => ({ ordinal: o, text: read(P.reportCard(String(o))) })).filter((c) => c.text != null);
  const stamped = [
    ...(plan?.cardOrdinals ?? []).map((o) => ({ ordinal: o, text: netOf(byOrdinal.get(o)) })),
    ...(plan?.entrySingles ?? []).map((f) => ({ ordinal: f.ordinal, text: read(P.reportCard(String(f.ordinal))) ?? netOf(f) })),
    ...(plan?.groupedMembers ?? []).map((f) => ({ ordinal: f.ordinal, text: memberLine(f) })),
  ];
  return { cards, overview: read(P.reportOverview), stamped, findings };
}
