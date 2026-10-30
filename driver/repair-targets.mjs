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
// one neither of those repairs can edit: it goes to the writer, whose record those lines are composed from. A fault no
// single part holds (two cards counting one owner's registrations differently), or one whose check cannot be run on a
// part, keeps the overview's repair it always had.
//
// Two faults are placed by what they cite. A citation held in a register of the record (the four answers' findings) is
// the writer's, since no card or overview repair can change the record. A citation of a withdrawn or absent finding in
// the overview's own prose is the overview's: a check of its own reads the overview as its writer wrote it.
import { readFileSync } from "node:fs";
import { prescriptionProseChecks, scopeNumberProseChecks, wipoLanguageChecks, countingChecks, countsFromFindings, OVERVIEW_CITATION_ID } from "./predelivery-lint.mjs";
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
 * Returns `{cards, overview, stamped, record, unlocated}`: `cards` maps a card's ordinal to the faults it holds, each
 * with that card's ordinal and the detail its check gives on that card alone; `overview` holds the faults the
 * overview's repair is given, those it holds (with its own detail) and those no part holds alone; `stamped` the faults
 * only lines composed from the record hold, each with `parts`, the finding of each line that holds it and the detail
 * its check gives on that line; `record` the faults a register of the record holds, each naming it as `register`;
 * `unlocated` the faults no part holds alone, already counted in `overview`.
 */
export function locateReportFaults(failures, { cards = [], overview = null, stamped = [], findings = [] } = {}) {
  const out = { cards: new Map(), overview: [], stamped: [], record: [], unlocated: [] };
  const fails = (rerun, text) => {
    if (!String(text ?? "").trim()) return null;
    const c = rerun(text, findings);
    return c && c.pass === false ? c : null;
  };
  const toCard = (ordinal, fault) => out.cards.set(ordinal, [...(out.cards.get(ordinal) ?? []), fault]);
  for (const f of failures ?? []) {
    if (f?.ordinal != null) { toCard(f.ordinal, f); continue; }   // the check named its finding: that card, as it always was
    if (f?.register) { out.record.push(f); continue; }            // a register of the record holds it: the writer's
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
    const lines = stamped.map((s) => ({ ordinal: s.ordinal, hit: fails(rerun, s.text) })).filter((x) => x.hit);
    if (lines.length) { out.stamped.push({ ...f, parts: lines.map((x) => ({ ordinal: x.ordinal, detail: x.hit.detail ?? f.detail })) }); continue; }
    out.overview.push(f);
    out.unlocated.push(f);
  }
  return out;
}

// The writer's repair line for one withdrawn finding its record cites, in the owner's words (ruled 2026-10-28). The
// finding's number is the only part that varies.
const withdrawnCitationLine = (ordinal) => `Your text cites finding ${ordinal}, which the review withdrew. Remove that citation. `
  + `Check the affected statement against the surviving assessment, and correct or remove it if unsupported. Keep unaffected text unchanged.`;

/**
 * The faults the writer's repair is given for one a register of the record holds: one line per withdrawn finding it
 * cites, each named by the number the writer's record carries. The check judged the delivered record, which the fold
 * may have renumbered; `toModel` maps a delivered ordinal to the writer's, or to null for one the fold does not know,
 * which keeps its number as written. A citation of a finding the run does not have is not sent: the ruled line is for a
 * withdrawn one. PURE.
 */
export function writersCitationFaults(fault, toModel) {
  if (fault?.register !== "four_answers" || !Array.isArray(fault.cites)) return [fault];
  const numbers = [...new Set(fault.cites.filter((c) => c.withdrawn).map((c) => toModel(c.ordinal) ?? c.ordinal))];
  return numbers.map((ordinal) => ({ ...fault, cites: fault.cites.filter((c) => (toModel(c.ordinal) ?? c.ordinal) === ordinal),
    detail: withdrawnCitationLine(ordinal) }));
}

/**
 * The overview's repair for the citations of a withdrawn or absent finding that its own prose holds, as the overview's
 * citation check found them (predelivery-lint.mjs overviewCitationChecks). PURE.
 *
 * A citation of a live finding is not among them: that finding is in the report, so the overview has nothing to
 * remove. The check reads the overview as its writer wrote it, so every citation it found is the overview's.
 *
 * Returns the fault the overview's repair is given, `{id, family, surface, detail, cites}`, with `cites` as
 * `{ordinal, withdrawn}`, or null when its prose holds no such citation.
 */
export function overviewCitationFault(failures) {
  const found = (failures ?? []).find((f) => f?.id === OVERVIEW_CITATION_ID && Array.isArray(f.cites) && f.cites.length);
  if (!found) return null;
  const cites = [...new Map(found.cites.map((c) => [Number(c.ordinal), { ordinal: Number(c.ordinal), withdrawn: Boolean(c.withdrawn) }])).values()];
  return { id: OVERVIEW_CITATION_ID, family: "reference", surface: "report", detail: overviewCitationDetail(cites), cites };
}

// The overview's repair instruction, as design approved it for this correction (2026-10-28), word for word. Its repair is
// handed this run's references ahead of it, each as withdrawn or absent, in design's own words.
const CITATION_CORRECTION = "The listed references point to findings that have been withdrawn or are absent. "
  + "Reassess the affected answers, actions, and conclusions against the surviving findings. "
  + "Cite a surviving finding only where its evidence supports the statement; otherwise correct the statement. "
  + "Preserve unaffected work and record the corrections through the existing correction tool.";

/** The overview's citation fault in words, for its repair. PURE. */
export function overviewCitationDetail(cites) {
  const each = cites.map((c) => `finding ${c.ordinal} (${c.withdrawn ? "withdrawn" : "absent"})`);
  return `References: ${each.join("; ")}. ${CITATION_CORRECTION}`;
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
