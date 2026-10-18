// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// repair-scope.mjs — WHAT A DELIVERY-CHECK REPAIR CHANGED, AND WHAT RESTS ON IT.
//
// After the delivery check finds a fault in the narrative, the writer repairs its record, and the reviewer
// used to read the whole narrative again, cold, as if no review had happened. The review after a repair
// reads what the repair changed and every statement that rests on it, with the evidence to check both, and
// its flags go to one correction by the writer. This module works out the first two from the writer's
// saved record before and after the repair, by VALUE: a file written again with the same values is no
// change, and a reworded coverage area is one line removed and one added, said rather than hidden.
//
// PURE, apart from three thin IO helpers at the bottom. It holds no sentence the model reads: the composer
// in repair-composers.mjs renders the list from what this returns, and the labels below are the item names
// that list prints and the reviewer is asked to repeat, so a flag can be joined back to its item.
import { readFileSync, writeFileSync, renameSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";
import { synthesisCallPaths } from "./synthesis-record.mjs";
import { REPORT_LINE_KEY, REPORT_LINE_LABEL } from "./corrections-feedforward.mjs";

const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const collapse = (s) => String(s).replace(/\s+/g, " ").trim();

/**
 * One value's identity for "did it change": strings whitespace-collapsed, objects key-sorted, arrays in
 * order, an absent key the same as an absent value. PURE.
 */
export function canonicalValue(v) {
  if (v === undefined || v === null) return "null";
  if (typeof v === "string") return JSON.stringify(collapse(v));
  if (typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalValue).join(",")}]`;
  return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalValue(v[k])}`).join(",")}}`;
}
const same = (a, b) => canonicalValue(a) === canonicalValue(b);

/** The narrative's prose sections, with the titles the narrative renders them under. */
export const NARRATIVE_PROSE = Object.freeze([
  Object.freeze({ key: "verdict", title: "Verdict", read: (n) => n?.verdict }),
  Object.freeze({ key: "spine", title: "The spine", read: (n) => n?.spine }),
  Object.freeze({ key: "coverage", title: "Coverage", read: (n) => n?.coverage?.read }),
  Object.freeze({ key: "calibration", title: "Calibration challenges", read: (n) => n?.calibration }),
]);

/** A section's value as one line of text, the challenges joined in order. PURE. */
export function sectionText(v) {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map((c) => collapse(`${c?.challenge ?? ""} ${c?.answer ?? ""}`)).filter(Boolean).join(" ");
  return collapse(v);
}

// ── THE LABELS: one name per item, printed in the list and repeated by the reviewer ──────────────────
export const LABEL = Object.freeze({
  finding: (n) => `finding ${n}`,
  coverage: (row) => REPORT_LINE_LABEL.coverage(row),
  section: (title) => `the narrative's "${title}" section`,
  "coverage-judgment": () => "the coverage judgment",
  action: (a) => REPORT_LINE_LABEL.actions(a),
  answer: (ask) => `the answer to "${ask}"`,
  "mark-assessment": (key) => `the mark assessment's ${key}`,
  "four-answers": (key) => `the four answers' ${key}`,
  "context-notes": () => "the context notes",
});

const byKey = (list, keyOf) => {
  const m = new Map();
  for (const x of Array.isArray(list) ? list : []) m.set(keyOf(x), x);
  return m;
};
const keyedChanges = (before, after, keyOf) => {
  const b = byKey(before, keyOf), a = byKey(after, keyOf), out = [];
  for (const [k, x] of a) {
    if (!b.has(k)) out.push({ key: k, change: "added", before: null, after: x });
    else if (!same(b.get(k), x)) out.push({ key: k, change: "changed", before: b.get(k), after: x });
  }
  for (const [k, x] of b) if (!a.has(k)) out.push({ key: k, change: "removed", before: x, after: null });
  return out;
};
const objectKeyChanges = (before, after) => {
  const keys = new Set([...Object.keys(isObj(before) ? before : {}), ...Object.keys(isObj(after) ? after : {})]);
  return [...keys].sort().filter((k) => !same(before?.[k], after?.[k]))
    .map((k) => ({ key: k, before: before?.[k] ?? null, after: after?.[k] ?? null }));
};

/**
 * What the repair changed, from two accepted-call params `{narrative, findings}` in the model's numbering.
 *
 * `whole` is true when there is nothing to compare against, or when the record's version or framework moved:
 * then nothing here can say which statements rest on what, and the review stays whole. The writer's own
 * `corrections` note is not content a reader is given, so it is not compared. PURE.
 */
export function changedContent(before, after) {
  const none = { findings: [], lines: [], registers: [], sections: [], whole: false, why: null };
  const bf = before?.findings, af = after?.findings;
  if (!isObj(bf)) return { ...none, whole: true, why: "no-base" };
  if (!isObj(af)) return { ...none, whole: true, why: "no-record" };
  for (const k of ["schema_version", "rated_under_framework"]) {
    if (!same(bf[k], af[k])) return { ...none, whole: true, why: `${k}-changed` };
  }
  const findings = keyedChanges(bf.findings, af.findings, (f) => f?.ordinal)
    .map(({ key, change, before: b, after: a }) => ({
      ordinal: key, change,
      fields: change === "changed" ? objectKeyChanges(b, a).map((x) => x.key) : [],
      before: b, after: a,
    }))
    .sort((x, y) => Number(x.ordinal) - Number(y.ordinal));
  const lines = keyedChanges(bf.coverage, af.coverage, REPORT_LINE_KEY.coverage)
    .map((x) => ({ ...x, area: (x.after ?? x.before)?.area ?? "" }));
  const registers = [];
  for (const x of keyedChanges(bf.actions, af.actions, REPORT_LINE_KEY.actions))
    registers.push({ kind: "action", label: LABEL.action(x.after ?? x.before), ...x });
  for (const x of keyedChanges(bf.ask_answers, af.ask_answers, (q) => collapse(q?.ask ?? "")))
    registers.push({ kind: "answer", label: LABEL.answer((x.after ?? x.before)?.ask ?? ""), ...x });
  for (const x of objectKeyChanges(bf.four_answers, af.four_answers))
    registers.push({ kind: "four-answers", label: LABEL["four-answers"](x.key), change: "changed", ...x });
  for (const x of objectKeyChanges(bf.mark_assessment, af.mark_assessment))
    registers.push({ kind: "mark-assessment", label: LABEL["mark-assessment"](x.key), change: "changed", ...x });
  if (!same(bf.coverage_judgment, af.coverage_judgment))
    registers.push({ kind: "coverage-judgment", label: LABEL["coverage-judgment"](), key: "coverage_judgment", change: "changed",
      before: bf.coverage_judgment ?? null, after: af.coverage_judgment ?? null });
  if (!same(bf.context_notes, af.context_notes))
    registers.push({ kind: "context-notes", label: LABEL["context-notes"](), key: "context_notes", change: "changed",
      before: bf.context_notes ?? null, after: af.context_notes ?? null });
  const sections = [];
  for (const s of NARRATIVE_PROSE) {
    const b = s.read(before?.narrative), a = s.read(after?.narrative);
    if (!same(b, a)) sections.push({ key: s.key, title: s.title, before: sectionText(b), after: sectionText(a) });
  }
  return { findings, lines, registers, sections, whole: false, why: null };
}

/** Nothing changed: a file written again with the same values. PURE. */
export const isEmptyChange = (c) => Boolean(c) && !c.whole
  && !c.findings.length && !c.lines.length && !c.registers.length && !c.sections.length;

/**
 * The statements handed with the change because they rest on it, as they read now. The rule is typed and
 * uses no prose matching; the reviewer judges any other dependent statement itself.
 *   · whenever anything changed: every prose section that did not itself change, and the coverage judgment;
 *   · when findings changed: every action, answer and four-answers row whose `ordinals` name one of them.
 * PURE.
 */
export function restingOn(changed, after) {
  if (!changed || changed.whole || isEmptyChange(changed)) return [];
  const out = [];
  const changedSections = new Set(changed.sections.map((s) => s.key));
  for (const s of NARRATIVE_PROSE) {
    const text = sectionText(s.read(after?.narrative));
    if (!changedSections.has(s.key) && text) out.push({ kind: "section", key: s.key, title: s.title, label: LABEL.section(s.title), text });
  }
  const af = after?.findings ?? {};
  const changedRegister = (kind, key) => changed.registers.some((r) => r.kind === kind && String(r.key) === String(key));
  if (af.coverage_judgment != null && !changedRegister("coverage-judgment", "coverage_judgment"))
    out.push({ kind: "coverage-judgment", label: LABEL["coverage-judgment"](), value: af.coverage_judgment });
  const moved = new Set(changed.findings.map((f) => Number(f.ordinal)));
  if (moved.size) {
    const names = (row) => (Array.isArray(row?.ordinals) ? row.ordinals.map(Number) : []).filter((o) => moved.has(o));
    for (const a of Array.isArray(af.actions) ? af.actions : []) {
      const hit = names(a);
      if (hit.length && !changedRegister("action", REPORT_LINE_KEY.actions(a)))
        out.push({ kind: "action", key: REPORT_LINE_KEY.actions(a), label: LABEL.action(a), ordinals: hit, text: collapse(a?.text ?? "") });
    }
    for (const q of Array.isArray(af.ask_answers) ? af.ask_answers : []) {
      const hit = names(q);
      if (hit.length && !changedRegister("answer", collapse(q?.ask ?? "")))
        out.push({ kind: "answer", key: collapse(q?.ask ?? ""), label: LABEL.answer(q?.ask ?? ""), ordinals: hit, text: collapse(q?.answer ?? "") });
    }
    for (const [k, v] of Object.entries(isObj(af.four_answers) ? af.four_answers : {})) {
      const hit = names(v);
      if (hit.length && !changedRegister("four-answers", k))
        out.push({ kind: "four-answers", key: k, label: LABEL["four-answers"](k), ordinals: hit, text: collapse(v?.read ?? "") });
    }
  }
  return out;
}

/**
 * Every item the review is about, with the one label the list prints for it: the changed items first, then
 * the statements resting on them. A finding the delivery fold renumbered carries its delivered number too.
 * PURE.
 */
export function scopeItems(changed, resting, foldMap = null) {
  const delivered = (n) => {
    const m = foldMap?.modelToFolded?.[String(n)];
    return m != null && Number(m) !== Number(n) ? Number(m) : null;
  };
  const items = [];
  for (const f of changed?.findings ?? []) items.push({ kind: "finding", ordinal: Number(f.ordinal), delivered: delivered(f.ordinal), label: LABEL.finding(f.ordinal), change: f.change, role: "changed" });
  for (const l of changed?.lines ?? []) items.push({ kind: "coverage", key: l.key, label: LABEL.coverage(l.after ?? l.before), change: l.change, role: "changed" });
  for (const s of changed?.sections ?? []) items.push({ kind: "section", key: s.key, label: LABEL.section(s.title), change: "changed", role: "changed" });
  for (const r of changed?.registers ?? []) items.push({ kind: r.kind, key: r.key, label: r.label, change: r.change, role: "changed" });
  for (const r of resting ?? []) items.push({ kind: r.kind, key: r.key ?? null, label: r.label, ordinals: r.ordinals ?? null, role: "resting" });
  return items;
}

/** Whether a delivered number differs from the model's for any listed finding. PURE. */
export const anyRenumbered = (items) => (items ?? []).some((i) => i.kind === "finding" && i.delivered != null);

/**
 * The one target a flag names. A finding by its `on` ordinals, in the model's numbering as the review was
 * asked; anything else by a flag text that BEGINS with one of the list's exact labels, the longest first. A
 * label elsewhere in the text, or a quoted phrase, is not a target: matching prose is how a rewrite lands on
 * the wrong thing. Otherwise the target is none. PURE.
 */
export function resolveTarget(flag, items) {
  const on = Array.isArray(flag?.on) ? flag.on.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  if (on.length) return { kind: "finding", ordinals: on, label: on.map(LABEL.finding).join(", ") };
  const text = String(flag?.text ?? "").trim();
  const labels = [...new Set((items ?? []).filter((i) => i.kind !== "finding").map((i) => i.label))]
    .sort((a, b) => b.length - a.length);
  const hit = labels.find((l) => text.startsWith(l));
  if (hit) {
    const item = items.find((i) => i.label === hit);
    return { kind: item.kind, key: item.key ?? null, label: hit };
  }
  return { kind: "none", label: null };
}

/**
 * The three classes the scope decision asks for: MAPPED (the target is a changed item or a statement resting
 * on one), UNRELATED (the target resolved, to something outside both), UNRESOLVED (no target). Every point
 * goes to the correction either way; the class is recorded, so how often the review steps outside its scope
 * can be measured. PURE.
 */
export function classifyPoints(flags, items) {
  const findings = new Set((items ?? []).filter((i) => i.kind === "finding").map((i) => i.ordinal));
  const restingFindings = new Set((items ?? []).flatMap((i) => (i.role === "resting" && i.ordinals) ? i.ordinals : []));
  const labels = new Set((items ?? []).filter((i) => i.kind !== "finding").map((i) => i.label));
  return (flags ?? []).map((flag, i) => {
    const target = resolveTarget(flag, items);
    const cls = target.kind === "none" ? "unresolved"
      : target.kind === "finding" ? (target.ordinals.some((o) => findings.has(o) || restingFindings.has(o)) ? "mapped" : "unrelated")
      : (labels.has(target.label) ? "mapped" : "unrelated");
    return { n: i + 1, kind: flag?.kind ?? null, on: Array.isArray(flag?.on) ? flag.on : null, target, class: cls };
  });
}

/**
 * Which of the reviewer's files the repair changed, for its inputs line: the narrative when a section, a
 * coverage line or an answer moved (the narrative renders all three), the findings record when anything in it
 * moved. PURE.
 */
export function changedInputsOf(changed, { narrative, findings }) {
  if (!changed || changed.whole) return [];
  const inRecord = changed.findings.length || changed.lines.length || changed.registers.length;
  const inNarrative = changed.sections.length || changed.lines.length || changed.registers.some((r) => r.kind === "answer");
  return [inNarrative ? narrative : null, inRecord ? findings : null].filter(Boolean);
}

// ── IO: the repair base, and the review's own record ────────────────────────────────────────────────
const writeAtomic = (file, text) => {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
};

/** Where the writer's accepted record is kept from just before the delivery-check repair. */
export function repairBasePath(runDir) {
  return join(synthesisCallPaths(String(runDir ?? "")).dir, "accepted-before-repair.json");
}

/**
 * Keep the writer's accepted record as it stands, just before the delivery-check repair. With no accepted
 * record there is no base, and any earlier copy is removed so it cannot stand for this repair. Never throws.
 * Returns whether a base was kept.
 */
export function snapshotRepairBase(runDir) {
  const at = repairBasePath(runDir);
  try {
    const bytes = readFileSync(synthesisCallPaths(String(runDir ?? "")).accepted, "utf8");
    writeAtomic(at, bytes);
    return true;
  } catch {
    try { rmSync(at, { force: true }); } catch { /* nothing to remove */ }
    return false;
  }
}

/** The kept base's params, or null. Never throws. */
export function readRepairBase(runDir) {
  try { return JSON.parse(readFileSync(repairBasePath(runDir), "utf8"))?.params ?? null; } catch { return null; }
}

/** The review after a repair's own record: what it was handed, how each point was classed, what the pass did. */
export function postRepairRecordPath(runDir) { return driverDir(String(runDir ?? ""), "post-repair-review.json"); }

export function writePostRepairRecord(runDir, rec) {
  try { writeAtomic(postRepairRecordPath(runDir), JSON.stringify({ ts: new Date().toISOString(), ...rec }, null, 2) + "\n"); return true; }
  catch { return false; }
}

/**
 * The review's list, as the values its composer renders: each change with its before and after, each
 * statement resting on one, whether a delivered number differs, and which kinds of evidence to name. A
 * changed finding carries only the fields that moved, and `records` is its `source` as the model saved it.
 * PURE.
 */
export function listForReview(changed, resting, foldMap = null) {
  const delivered = (n) => {
    const m = foldMap?.modelToFolded?.[String(n)];
    return m != null && Number(m) !== Number(n) ? Number(m) : null;
  };
  const pick = (f, fields) => Object.fromEntries(fields.map((k) => [k, f?.[k] ?? null]));
  const changes = [];
  for (const f of changed?.findings ?? []) {
    const base = { kind: "finding", change: f.change, ordinal: Number(f.ordinal), delivered: delivered(f.ordinal) };
    if (f.change === "changed") changes.push({ ...base, fields: f.fields, before: pick(f.before, f.fields), after: pick(f.after, f.fields), records: f.after?.source ?? null });
    else if (f.change === "added") changes.push({ ...base, after: f.after, records: f.after?.source ?? null });
    else changes.push({ ...base, before: f.before });
  }
  for (const l of changed?.lines ?? []) changes.push({ kind: "coverage", change: l.change, label: LABEL.coverage(l.after ?? l.before), before: l.before, after: l.after });
  for (const s of changed?.sections ?? []) changes.push({ kind: "section", change: "changed", title: s.title, before: s.before, after: s.after });
  for (const r of changed?.registers ?? []) {
    const val = (x) => (r.kind === "answer" ? (x?.answer ?? null) : x);
    changes.push({ kind: r.kind, change: r.change, label: r.label, before: val(r.before), after: val(r.after) });
  }
  return {
    changes,
    resting: resting ?? [],
    renumbered: changes.some((c) => c.kind === "finding" && c.delivered != null),
    coverageChanged: changes.some((c) => c.kind === "coverage"),
    evidence: { coverage: changes.some((c) => c.kind === "coverage"), finding: changes.some((c) => c.kind === "finding") },
  };
}
