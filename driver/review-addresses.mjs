// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// review-addresses.mjs — the parts of a report a review was handed, each with the address a flag about it carries.
//
// A review flag names the findings it is about in `on`, and nothing checked that each ordinal names a finding the
// review was handed. The report's other parts had no address at all, so a correction bound a flag to them by matching
// its prose against their text. This module builds the list a review dispatch writes beside its exclusions, and
// resolves what a flag declares against it, so a declaration that names nothing the review was handed can be refused
// in the reviewer's own turn.
//
// Findings are addressed by ordinal, taken from every record handed in together: a recheck reads the record before
// and after a correction, so it can still name a finding the correction removed. Each coverage line, action and mark
// assessment read is addressed by the key a correction already gives it (REPORT_LINE_KEY), and each narrative section
// that has content by its name. A key two rows of one record share would bind a flag to either of them, so it is not
// offered, and neither is one holding a comma or a bracket, which the review line's `[lines: …]` token cannot carry
// back. PURE, apart from `writeReviewAddresses`, which writes the list into the run.
import { REPORT_LINE_KEY, REPORT_LINE_LABEL } from "./corrections-feedforward.mjs";
import { NARRATIVE_SECTIONS } from "./synthesis-record.mjs";
import { atomicWrite, driverDir, ensureDriverDir } from "./run-record.mjs";

export const REVIEW_ADDRESSES_FILE = "review-addresses.json";

const MARK_ASSESSMENT_READS = ["distinctiveness", "connotation"];
const hasContent = (v) => (typeof v === "string" ? v.trim() !== ""
  : Array.isArray(v) ? v.length > 0
  : v && typeof v === "object" ? Object.values(v).some(hasContent) : false);

/** Every part of one record that is not a finding, as [address, label] pairs, in the record's own order. */
function partsOf(doc) {
  const out = [];
  for (const c of Array.isArray(doc?.coverage) ? doc.coverage : []) out.push([REPORT_LINE_KEY.coverage(c), REPORT_LINE_LABEL.coverage(c)]);
  for (const a of Array.isArray(doc?.actions) ? doc.actions : []) out.push([REPORT_LINE_KEY.actions(a), REPORT_LINE_LABEL.actions(a)]);
  const ma = doc?.markAssessment ?? doc?.mark_assessment;
  for (const k of MARK_ASSESSMENT_READS) if (hasContent(ma?.[k])) out.push([`mark-assessment:${k}`, `the mark assessment's ${k}`]);
  return out;
}

/** Every part of one record that is not a finding, by address, with the value a reader is given for it. */
function partValues(doc) {
  const out = new Map();
  const put = (address, label, value) => { if (address.slice(address.indexOf(":") + 1).trim()) out.set(address, { label, value: JSON.stringify(value ?? null) }); };
  for (const c of Array.isArray(doc?.coverage) ? doc.coverage : []) put(REPORT_LINE_KEY.coverage(c), REPORT_LINE_LABEL.coverage(c), c);
  for (const a of Array.isArray(doc?.actions) ? doc.actions : []) put(REPORT_LINE_KEY.actions(a), REPORT_LINE_LABEL.actions(a), a);
  const ma = doc?.markAssessment ?? doc?.mark_assessment;
  for (const k of MARK_ASSESSMENT_READS) put(`mark-assessment:${k}`, `the mark assessment's ${k}`, ma?.[k]);
  return out;
}

/**
 * The parts of the report other than findings that a correction changed and no flag named: `{ named, moved }`, each
 * `moved` entry `{ address, label }`. A part added, removed or rewritten counts as moved. Narrative sections are
 * compared only when both narratives are handed in, so a caller without the earlier one claims nothing about them.
 * Recorded, never refused: the clearance's correction policy (scopeDrift in corrections-feedforward.mjs). PURE.
 */
export function partsDrift(rows, preDoc, postDoc, { narratives = null } = {}) {
  const named = [...new Set((rows ?? []).flatMap((r) => (Array.isArray(r?.lines) ? r.lines : [])))];
  if (!preDoc || !postDoc) return { named, moved: [] };
  const pre = partValues(preDoc), post = partValues(postDoc);
  if (narratives?.before && narratives?.after) {
    for (const k of NARRATIVE_SECTIONS) {
      pre.set(`section:${k}`, { label: `the narrative's ${k} section`, value: JSON.stringify(narratives.before[k] ?? null) });
      post.set(`section:${k}`, { label: `the narrative's ${k} section`, value: JSON.stringify(narratives.after[k] ?? null) });
    }
  }
  const isNamed = new Set(named);
  const moved = [];
  for (const address of new Set([...pre.keys(), ...post.keys()])) {
    if (isNamed.has(address)) continue;
    if (pre.get(address)?.value !== post.get(address)?.value) moved.push({ address, label: (post.get(address) ?? pre.get(address)).label });
  }
  return { named, moved };
}

/**
 * The address list for one review dispatch: `{ schema, ordinals, lines: [{ address, label }] }`.
 *
 * `records` are the findings documents the review reads (one at a first review; the record before and after the
 * correction at a recheck). `narratives` are the narrative's typed sections, keyed as NARRATIVE_SECTIONS names them.
 * An address with nothing after its colon, which a row with no area or id would make, is never offered.
 */
export function reviewAddresses({ records = [], narratives = [] } = {}) {
  const ordinals = new Set();
  const lines = new Map();
  const shared = new Set();
  for (const doc of records) {
    for (const f of Array.isArray(doc?.findings) ? doc.findings : []) if (Number.isInteger(f?.ordinal) && f.ordinal > 0) ordinals.add(f.ordinal);
    const inThisRecord = new Set();
    for (const [address, label] of partsOf(doc)) {
      if (!address.slice(address.indexOf(":") + 1).trim() || /[,[\]]/.test(address)) continue;
      if (inThisRecord.has(address)) shared.add(address);
      inThisRecord.add(address);
      lines.set(address, label);
    }
  }
  for (const n of narratives) for (const k of NARRATIVE_SECTIONS) if (hasContent(n?.[k])) lines.set(`section:${k}`, `the narrative's ${k} section`);
  for (const a of shared) lines.delete(a);
  return { schema: 1, ordinals: [...ordinals].sort((x, y) => x - y), lines: [...lines].map(([address, label]) => ({ address, label })) };
}

const loose = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * What a flag declares, resolved against the list. Returns `{ ok: true }`, or the first thing that does not
 * resolve: `{ ok: false, kind: "ordinal", value }` for an ordinal no finding handed in carries, `{ ok: false,
 * kind: "lines-shape" }` when `lines` is not an array of strings, or `{ ok: false, kind: "line", value, near }` for
 * an address not on the list. `near` is the listed address it matches when spacing and case are ignored, else null.
 * `on` is assumed already checked as positive integers, as acceptRefutation checks it today.
 */
export function resolveDeclared(list, { on = null, lines = null } = {}) {
  const ordinals = new Set(list?.ordinals ?? []);
  for (const n of Array.isArray(on) ? on : []) if (!ordinals.has(n)) return { ok: false, kind: "ordinal", value: n };
  if (lines == null) return { ok: true };
  if (!Array.isArray(lines) || lines.some((l) => typeof l !== "string")) return { ok: false, kind: "lines-shape" };
  const listed = (list?.lines ?? []).map((l) => l.address);
  const exact = new Set(listed);
  for (const value of lines) {
    if (exact.has(value)) continue;
    const near = listed.find((a) => loose(a) === loose(value)) ?? null;
    return { ok: false, kind: "line", value, near };
  }
  return { ok: true };
}

/**
 * Build the list and write it beside the review's exclusions, where the review's recording tool reads it. Returns the
 * list, or null when it could not be written: the dispatch then shows no address block, and the tool checks `on` as it
 * always did. IMPURE.
 */
export function writeReviewAddresses(runDir, { records = [], narratives = [] } = {}) {
  try {
    const list = reviewAddresses({ records: records.filter(Boolean), narratives: narratives.filter(Boolean) });
    ensureDriverDir(runDir);
    atomicWrite(driverDir(runDir, REVIEW_ADDRESSES_FILE), JSON.stringify({ ts: new Date().toISOString(), ...list }, null, 2) + "\n");
    return list;
  } catch { return null; }
}

// What the review dispatch shows the reviewer: the block's heading, then one row per address. No block for a list with
// no parts beyond the findings, whose ordinals the reviewer already reads off the report.
export const ADDRESS_LIST_HEADING = "THE ADDRESS LIST: each part of the report below is not a finding. A flag about one carries its address in `lines`, copied exactly; an address not on this list is refused.";
export const addressListLines = (list) => (Array.isArray(list?.lines) && list.lines.length
  ? [ADDRESS_LIST_HEADING, ...list.lines.map((l) => `- ${l.label} — address ${l.address}`)]
  : []);
