// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// corrections-delivered.mjs — whether each reviewer correction is still in the record the report is built from.
//
// corrections-applied.json records what the corrective pass changed, flag by flag, compared at the pass. It
// cannot say whether the change is still there when the report is assembled: later saves re-send the record
// (the delivery check's redo, the stale repair, a re-emit), the delivery seam folds it, and the report is built
// after all of them. This answers that question for the typed fields a report prints from the record — a
// finding's sentence (`net`) and its two positions, a coverage row's note, an action's text, and the mark
// assessment's distinctiveness and connotation — in two steps:
//
//   correctionTargets   at the corrective pass, where the records before and after it are in hand: what each
//                       flag changed in those fields, with the text the pass left (the basis);
//   deliveredOutcomes   after an assembly: whether the record the report was built from still carries it.
//
// Each flag's outcome:
//   delivered        every field it changed reads, in the delivered record, as the pass left it;
//   not-found        at least one does not: a later save or the fold did not carry it to the report;
//   not-applicable   it changed none of these fields — a narrative or structure correction, a reasoned
//                    no-change, a removal, a rating — so there is no typed text to look for. Narrative prose
//                    reaches the client only through the overview's own words, and this does not guess at it;
//   not-checkable    the records before and after the pass could not both be read, so nothing was compared.
//
// THE RECORD DECIDES, report.md IS A SECOND LOOK. Every client surface renders these fields from the delivered
// record — findings.json as the report was built from it, folded after the delivery seam — so the outcome is
// read there, joined in the model's numbering through the fold's map. report.md prints two of them itself, the
// finding sentence on a finding's card and an action's text, and each such change says whether report.md
// carries it (`inReportMd`, null for a field report.md does not print). It never decides the outcome: whether a
// finding has a card is the assembly's choice, not the correction's fate.
//
// PURE — no node imports. The pipeline reads and writes the files.
import { reportLines, linesOf } from "./corrections-feedforward.mjs";

/** The finding fields a correction can change that a report prints from the record. */
export const DELIVERED_FINDING_FIELDS = Object.freeze(["net", "legal_position", "practical_position"]);

const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
// The name join `buildCorrectionsApplied` uses: mark first, then owner, first one wins.
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function byName(doc) {
  const out = new Map();
  for (const f of doc?.findings ?? [])
    for (const name of [f?.mark, f?.owner?.name]) { const n = norm(name); if (n && !out.has(n)) out.set(n, f); }
  return out;
}
const byOrdinal = (doc) => new Map((doc?.findings ?? []).filter((f) => Number.isInteger(f?.ordinal)).map((f) => [f.ordinal, f]));

/**
 * The basis: for each row `buildCorrectionsApplied` returned, the printed fields the pass changed and the text it
 * left in each. PURE. `preDoc` and `postDoc` are the records before and after the pass, in the model's numbering —
 * the two the applied table was built from. A finding is the one the flag declared by ordinal, else the one it
 * named; a line is the one the flag named or quoted, as the applied table joined it.
 */
export function correctionTargets(rows, preDoc, postDoc) {
  const checkable = Boolean(preDoc && postDoc);
  const preOrd = byOrdinal(preDoc), postOrd = byOrdinal(postDoc);
  const preName = byName(preDoc), postName = byName(postDoc);
  const preLines = reportLines(preDoc);
  const postLines = new Map(reportLines(postDoc).map((l) => [l.key, l.text]));
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const out = { n: r?.n ?? null, kind: r?.kind ?? null, applied: r?.outcome ?? null, changes: [] };
    if (!checkable || r?.outcome === "not-checkable") return { ...out, why: "not-checkable" };
    const seen = new Set();
    const add = (c, key) => { if (!seen.has(key)) { seen.add(key); out.changes.push(c); } };
    if (r.outcome === "line-changed") {
      for (const l of linesOf(r.text, preLines)) {
        const now = postLines.get(l.key);
        if (now !== undefined && squash(now) !== squash(l.text)) add({ line: l.key, text: now }, l.key);
      }
    } else if (r.outcome === "findings-changed") {
      const declared = (Array.isArray(r.ordinals) ? r.ordinals : []).filter((o) => preOrd.has(o) || postOrd.has(o));
      const pairs = declared.length ? declared.map((o) => [preOrd.get(o), postOrd.get(o)])
        : (Array.isArray(r.targets) ? r.targets : []).map((t) => [preName.get(norm(t)), postName.get(norm(t))]);
      for (const [a, b] of pairs) {
        if (!b || !Number.isInteger(b.ordinal)) continue;   // gone after the pass: nothing left to deliver
        for (const field of DELIVERED_FINDING_FIELDS) {
          if (squash(a?.[field]) !== squash(b[field])) add({ ordinal: b.ordinal, field, text: String(b[field] ?? "") }, `${b.ordinal}|${field}`);
        }
      }
    }
    return out.changes.length ? out : { ...out, why: "no-printed-field-changed" };
  });
}

/**
 * Each basis row's outcome against the delivered record. PURE. `deliveredDoc` is the record the report was built
 * from; `foldMap` is the fold's `{modelToFolded}` when a fold is in force, else null; `reportMd` is report.md's
 * text, or null when it could not be read. Returns null when there is no delivered record to read: a caller
 * records that as a failure to look, never as an outcome.
 */
export function deliveredOutcomes({ basis, deliveredDoc, foldMap = null, reportMd = null } = {}) {
  if (!Array.isArray(basis) || !deliveredDoc || typeof deliveredDoc !== "object") return null;
  const findings = byOrdinal(deliveredDoc);
  const lines = new Map(reportLines(deliveredDoc).map((l) => [l.key, l.text]));
  const md = typeof reportMd === "string" ? squash(reportMd) : null;
  const folded = (o) => { const f = foldMap?.modelToFolded?.[String(o)]; return f == null ? o : Number(f); };
  return basis.map((b) => {
    const head = { n: b?.n ?? null, kind: b?.kind ?? null, applied: b?.applied ?? null };
    if (b?.why === "not-checkable") return { ...head, outcome: "not-checkable", changes: [] };
    const changes = (Array.isArray(b?.changes) ? b.changes : []).map((c) => {
      const onFinding = c?.ordinal != null;
      const where = onFinding ? { ordinal: c.ordinal, deliveredAs: folded(c.ordinal), field: c.field } : { line: c?.line };
      const inRecord = onFinding
        ? findings.has(where.deliveredAs) && squash(findings.get(where.deliveredAs)[c.field]) === squash(c.text)
        : lines.has(c?.line) && squash(lines.get(c.line)) === squash(c.text);
      const printedInReportMd = (onFinding && c.field === "net") || (!onFinding && String(c?.line).startsWith("action:"));
      const inReportMd = !printedInReportMd || md == null || !squash(c?.text) ? null : md.includes(squash(c.text));
      return { ...where, inRecord, inReportMd };
    });
    if (!changes.length) return { ...head, outcome: "not-applicable", why: b?.why ?? "no-printed-field-changed", changes };
    return { ...head, outcome: changes.every((c) => c.inRecord) ? "delivered" : "not-found", changes };
  });
}
