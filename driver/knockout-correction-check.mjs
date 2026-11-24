// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// knockout-correction-check.mjs — does a corrected Knockout deliver its correction?
//
// A Knockout is reviewed once, and each defect the review raises goes back to the rating step once. The record that
// publishes is composed again from the corrected groups, and the order's summary is joined from each group's own summary,
// which the rating step is asked to update when its correction changes it. Nothing compared the two afterwards: a summary
// left in its earlier form, or a record composed from the groups as they were rated, delivered with no flag, because the
// pre-delivery check listed corrections as absent by design on this lane.
//
// So this compares what publishes with what the round accepted, from the round's own record: the names as rated
// (`knockout-correction-work.json`), the outcome of each defect (`knockout-corrections.json`) and the review's answer.
// For each defect whose correction was accepted, the delivered name must not hold the earlier form: a removed finding is
// gone, a changed finding or line is not as it was rated, and the name's block in the summary heads it with the band
// the record now gives it. A clean review, and a round that accepted nothing, are checked too, and say so.
//
// FLAGS, NEVER A REFUSAL, as every Knockout pre-delivery check: the caller hands these to the lint, which projects a
// failure on the report to the reviewing lawyer through the existing correction-consistency sentence. It reads the run
// directory here and nowhere else, so the comparison itself stays pure.
import { paths } from "./run-record.mjs";
import { knockoutReviewFile } from "./knockout-review-record.mjs";
import { readCorrectionWork, sameFinding, summaryBlock, withoutOrdinal } from "./knockout-correction-record.mjs";
import { readFileSync } from "node:fs";

const ID = "correction-consistency";
const FAMILY = "corrections";
// The outcomes in which a correction changed what a name delivers (knockout-correction-record.mjs correctionOutcomes).
const ACCEPTED = new Set(["findings-changed", "findings-removed", "line-changed"]);

const nameKey = (s) => String(s ?? "").trim().toLowerCase();
const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const row = (id, surface, pass, detail) => ({ id, family: FAMILY, surface, pass: Boolean(pass), detail });
const markOf = (doc, name) => (doc?.marks ?? []).find((m) => nameKey(m?.name) === nameKey(name)) ?? null;
const shape = (m) => (m ? JSON.stringify({ ...m, findings: (m.findings ?? []).map(withoutOrdinal) }) : null);

/** The round as the run holds it: the review's answer, the corrections record and the names as rated. Each null where absent. */
export function readCorrectionRound(runDir) {
  return { review: readJson(knockoutReviewFile(runDir)), corrections: readJson(paths(runDir).knockoutCorrections), work: readCorrectionWork(runDir) };
}

/** The band word a summary block's heading gives its name, from the framework's ladder, or null where it names none. PURE. */
export function headedBand(block, name, ladder) {
  const head = String(block ?? "").split("\n")[0] ?? "";
  const rest = head.toLowerCase().split(nameKey(name)).join(" ");
  const words = [...(ladder ?? [])].map(String).filter(Boolean).sort((a, b) => b.length - a.length);
  const esc = (w) => w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return words.find((w) => new RegExp(`(^|[^a-z])${esc(w)}([^a-z]|$)`).test(rest)) ?? null;
}

/**
 * The checks, over the delivered record and the round. `notApplicable` where the run holds no review at all: a run rated
 * before every Knockout was reviewed, republished. PURE.
 */
export function knockoutCorrectionChecks({ findings, round }) {
  const { review = null, corrections = null, work = null } = round ?? {};
  if (!review && !corrections) {
    return { checks: [], notApplicable: { id: ID, family: FAMILY, reason: "this run holds no review record, so no correction was made after rating to compare" } };
  }
  if (!corrections) {
    const raised = review?.material?.length ?? 0;
    return { checks: [raised
      ? row(`${ID}:round`, "findings", false, `the review raised ${raised} defect(s) and the run holds no corrections record, so what was delivered cannot be compared with a correction`)
      : row(ID, "report", true, "the review raised no defect, so nothing was corrected after rating")], notApplicable: null };
  }
  const accepted = (corrections.outcomes ?? []).filter((o) => ACCEPTED.has(o?.outcome));
  if (!accepted.length) {
    const why = corrections.failure ? `the correction stood down (${corrections.failure}) and the rated record shipped` : "no correction changed a name";
    return { checks: [row(ID, "report", true, `${why}; nothing delivered differs from the record as rated`)], notApplicable: null };
  }
  if (!Array.isArray(work?.rated?.marks) || !Array.isArray(work?.defects)) {
    return { checks: [row(`${ID}:round`, "findings", false, `${accepted.length} correction(s) were accepted and the run no longer holds the names as rated, so what was delivered cannot be compared with them`)], notApplicable: null };
  }

  const checks = [];
  const ladder = findings?.framework?.ladder ?? [];
  const summaryNow = findings?.batch?.executiveSummary, summaryWas = work.rated?.batch?.executiveSummary;
  const names = new Map();
  for (const o of accepted) {
    const d = work.defects.find((x) => x?.n === o.n);
    if (!d) { checks.push(row(`${ID}:record:${o.n}`, "findings", false, `correction ${o.n} was accepted and the round's work holds no defect ${o.n}`)); continue; }
    const was = markOf(work.rated, d.mark), now = markOf(findings, d.mark);
    if (!now) { checks.push(row(`${ID}:record:${o.n}`, "findings", false, `correction ${o.n} changed "${d.mark}", which the delivered record does not hold`)); continue; }
    names.set(nameKey(d.mark), { name: d.mark, was, now, removed: [...(names.get(nameKey(d.mark))?.removed ?? []), ...(o.outcome === "findings-removed" && d.names ? [d.names] : [])] });
    let stale = null;
    if (o.outcome === "findings-removed" && d.names) {
      if ((now.findings ?? []).some((f) => sameFinding(f, d.names))) stale = `the finding "${d.names.name}" the correction removed is still delivered on "${d.mark}"`;
    } else if (o.outcome === "findings-changed" && d.names) {
      const before = (was?.findings ?? []).find((f) => sameFinding(f, d.names)), current = (now.findings ?? []).find((f) => sameFinding(f, d.names));
      if (before && current && withoutOrdinal(before) === withoutOrdinal(current)) stale = `the finding "${d.names.name}" on "${d.mark}" is delivered as it was rated, before its correction`;
    } else if (o.outcome === "line-changed") {
      if (shape(was) === shape(now)) stale = `"${d.mark}" is delivered as it was rated, before its correction`;
    }
    checks.push(row(`${ID}:record:${o.n}`, "report", !stale, stale ?? `correction ${o.n} (${o.outcome}) on "${d.mark}" is the form delivered`));
  }

  // THE SUMMARY, once per corrected name: its heading gives the band the record now gives the name, a moved band is not left in
  // the block as it was rated, and a finding the correction removed is not still named there.
  let i = 0;
  for (const { name, was, now, removed } of names.values()) {
    i += 1;
    const block = summaryBlock(summaryNow, name);
    const faults = [];
    const headed = headedBand(block, name, ladder);
    if (headed && nameKey(headed) !== nameKey(now.rating)) faults.push(`the summary heads "${name}" ${headed} and the delivered record rates it ${now.rating}`);
    if (block != null && nameKey(was?.rating) !== nameKey(now.rating) && block === summaryBlock(summaryWas, name))
      faults.push(`"${name}" moved from ${was?.rating} to ${now.rating} and its summary block is as it was rated`);
    for (const r of removed) {
      const stillCarried = (now.findings ?? []).some((f) => nameKey(f?.name) === nameKey(r.name));
      if (block && !stillCarried && String(r.name ?? "").trim() && block.toLowerCase().includes(nameKey(r.name)))
        faults.push(`the summary block for "${name}" still names "${r.name}", which the correction removed`);
    }
    // A corrected name the summary gives no block cannot be compared there. That is recorded, not passed, and not put to the
    // reader as a stale correction.
    if (block == null) checks.push(row(`${ID}:summary:${i}`, "findings", false, `the summary holds no block headed "${name}", so it could not be compared with the correction`));
    else checks.push(row(`${ID}:summary:${i}`, "report", !faults.length, faults.join("; ") || `the summary block for "${name}" agrees with its corrected record`));
  }
  return { checks, notApplicable: null };
}
