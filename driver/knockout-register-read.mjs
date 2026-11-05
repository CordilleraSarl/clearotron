// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// knockout-register-read.mjs — the knockout's register moment: the counts, then a reading step that asks what the
// reading rule calls for, name by name.
//
// WHAT IT REPLACED. The lane listed the name and up to twelve forms from a fixed table, each with an equal share of
// 100 records, cut in the register's own order. Measured on an eight-name production batch: 160 records read, 125 of
// them on a mechanical form and none of those on the reviewing lawyer's list; one exact answer held 903 filings and
// 25 reached the rating step; five names answered zero on all three counts while she listed 97 rows for them.
//
// ONE SEARCH SHAPE WITH THE CLEARANCE (ruled 2026-09-26: a knockout is a clearance with less effort and depth). The
// run writes a small frozen plan, one register axis per instructed name, and the questions go through the clearance's
// own mint and executor: `register_propose_supplemental`, with its goods, market and class narrowing, its 600-record
// fetch limit, its capability gaps and its safety net. What differs is the lever: the plan holds only the name itself.
//
// THE MODEL SEES THE COUNT BEFORE ANYTHING IS READ. Code takes the counts and fetches nothing; the step then reads a list
// it can read in full or narrows the question, and the name's own question is one it must ask. Code reads a name's own
// list itself only when no model turn can: the step failed, or a test injected its register in-process.
//
// WHAT THE RECORD SAYS. A zero, a failure, a question not asked and a crowd not read are four different facts, and
// `terms` keeps them four. Counts come from the register. What the reading step carried forward goes to the rating
// step; what it set aside stays on the record with its reason, and in the band with its rows.
//
// NO MODEL TOUCHES A ROW. The step names record ids; this module joins them to what the register answered.

import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { driverDir } from "../shared/driver-dir.mjs";
import { kebab } from "./search-policy.mjs";
import { resolveRegions } from "./register-plan.mjs";
import { reachableRegions } from "./register-availability.mjs";
import { RECORD_BASIS, fixtureLister, toRecord } from "./register-records.mjs";
import { ENUMERATE_CEILING_DEFAULT } from "../providers/_shared/enumerate.mjs";
export { writeFixtureMarker } from "./register-fixture-marker.mjs";
import { withFilingGoods } from "./filing-goods.mjs";

export const QUESTION_PLAN_FILE = "register-plan.json";
export const BAND_DIR = "register-units";

/** The register axis of one instructed name. The research key, so two names can never share one. PURE. */
export const knockoutAxis = (name) => `ko-${kebab(name)}`;

/**
 * The forms a name is asked as: its written alternatives where the request gives one item in more than one spelling or
 * word order (the frame's `alternatives`), each its own question and all tied to the name; else the name itself. PURE.
 */
export function formsOfName(name, framed = null) {
  const alternatives = (Array.isArray(framed?.alternatives) ? framed.alternatives : []).map((t) => String(t ?? "").trim()).filter(Boolean);
  return alternatives.length ? alternatives : [String(name ?? "").trim()];
}

/** The qid of one form's own question: the name's identical qid, or that with its position after the first. PURE. */
export const formQid = (name, i = 0) => (i ? `${openingQid(name, "identical")}:${i}` : openingQid(name, "identical"));

/** The band one name's questions are written to, inside this run's folder. PURE. */
export const knockoutBandPath = (runDir, name) => join(String(runDir ?? ""), BAND_DIR, `${knockoutAxis(name)}-band.json`);

/** The qid of a name's opening question, the name each row of the reading record answers to. PURE. */
export const openingQid = (name, key) => `${knockoutAxis(name)}:${key}`;

const ints = (v) => (Array.isArray(v) ? v : []).filter((n) => Number.isInteger(n));
const sameClassList = (a, b) => JSON.stringify([...a].map(String).sort()) === JSON.stringify([...b].map(String).sort());

/** The classes one name is searched in: its own where the request names them, else the batch's, else the frame's. PURE. */
export function classesForName(row, batchClasses, framed = null) {
  const own = ints(row?.classes);
  if (own.length) return own;
  const batch = ints(batchClasses);
  return batch.length ? batch : ints(framed?.classes);
}

/**
 * The run's frozen question plan: the name itself, per instructed name, on that name's own axis. PURE.
 *
 * Provenance "mark" is what tells the safety net these are the identical mark's own required read, and regions on an
 * entry stay empty so each inherits the plan's: the order's offices, less any this deployment cannot reach. Classes the
 * frame added carry the question the bound allows them, the identical mark in that class (ruled 2026-09-21), and a class
 * another name was instructed in is not an addition.
 */
export function knockoutQuestionPlan({ marks, classes = null, jurisdictions = null, capabilities = null, unreachable = [], framedMarks = [] }) {
  const { regions: covered, worldwide } = resolveRegions(jurisdictions, capabilities);
  const { regions } = reachableRegions(covered, unreachable, capabilities?.offices?.covered, worldwide === true);
  const framedByName = new Map((framedMarks ?? []).map((f) => [String(f?.name ?? "").trim().toLowerCase(), f]));
  const rows = (marks ?? []).map((m) => {
    const name = String(m?.name ?? "").trim();
    const framed = framedByName.get(name.toLowerCase()) ?? null;
    return { name, framed, nice: classesForName(m, classes, framed).map(String) };
  });
  const instructed = new Set(rows.flatMap((r) => r.nice));
  const entries = [];
  const added = new Map();
  for (const { name, framed, nice } of rows) {
    const axis = knockoutAxis(name);
    formsOfName(name, framed).forEach((term, i) => entries.push({ qid: formQid(name, i), axis, predicate: "exact", term, nice_classes: nice, regions: [],
      provenance: "mark", expected_kind: "enumerate", origin: "plan" }));
    for (const c of ints(framed?.beltAndBraces).map(String)) {
      if (instructed.has(c)) continue;
      const reason = String(framed?.classesPlain ?? "").trim() || "added by the frame for the client's own goods";
      entries.push({ qid: openingQid(name, `added-class-${c}`), axis, predicate: "exact", term: name, nice_classes: [c], regions: [],
        provenance: "mark", expected_kind: "enumerate", origin: "plan", added_class_reason: reason });
      if (!added.has(c)) added.set(c, reason);
    }
  }
  return {
    schema: "register-plan/1", plan_version: 1,
    derived_from: { job_key: "knockout", variants_fingerprint: "knockout" },
    regions, nice_classes: [...instructed],
    added_classes: [...added].map(([cls, reason]) => ({ class: cls, reason })),
    entries,
  };
}

/** The questions the frame's added classes owe one name, from the run's frozen plan: each class's identical-name question. */
export function addedClassQuestions(runDir, name) {
  let plan = null;
  try { plan = JSON.parse(readFileSync(questionPlanPath(runDir), "utf8")); } catch { return []; }
  return addedOf(plan, name);
}
const addedOf = (plan, name) => (plan?.entries ?? []).filter((e) => e?.axis === knockoutAxis(name) && e?.added_class_reason)
  .map((e) => ({ qid: String(e.qid), class: String(e.nice_classes?.[0]) }));

/** The blocks of one name's band as they stand, by qid. A band not yet written holds none. */
export function knockoutBandBlocks(runDir, name) {
  const out = new Map();
  let doc;
  try { doc = JSON.parse(readFileSync(knockoutBandPath(runDir, name), "utf8")); } catch { return out; }
  for (const b of Array.isArray(doc) ? doc : []) if (b?.qid) out.set(String(b.qid), b);
  return out;
}

/** The questions a name's reading step asked, in the order it asked them. A file not yet written holds none. */
export function knockoutProposals(runDir, name) {
  const path = join(String(runDir ?? ""), BAND_DIR, `${knockoutAxis(name)}-supplemental-plan.json`);
  try {
    const doc = JSON.parse(readFileSync(path, "utf8"));
    return { entries: Array.isArray(doc?.entries) ? doc.entries : [], rejected: Array.isArray(doc?.rejected) ? doc.rejected : [] };
  } catch { return { entries: [], rejected: [] }; }
}

/** Does this row of a reading record speak for that added class's question: by its qid, or by naming the class? PURE. */
export const namesAddedClass = (question, owed) => {
  const said = String(question ?? "");
  return said === owed.question || new RegExp(`\\bclass(?:es)?\\s*${owed.addedClass}\\b`, "i").test(said);
};

/** The record ids a reading record's `carried` groups hold, flattened. PURE. */
export const carriedIds = (row) => new Set((row?.carried ?? []).flatMap((g) => (Array.isArray(g?.records) ? g.records : [])).map(String));

const rowsOf = (block) => (Array.isArray(block?.records) ? block.records : []);
/** Was this block answered with the rows the register holds under it? */
const wasRead = (block) => block?.state === "enumerated" && block?.error !== true;
/** A block with no answer: a failure, or a refusal the register's rules make permanent. Never a zero. */
const hasFailed = (block) => Boolean(block) && block.error === true;
/** A block the register answered with a count too large to fetch. */
const isCrowd = (block) => Boolean(block) && block.state === "incomplete" && block.error !== true;
/** Every term one question named, trimmed and in lower case. PURE. */
const termsAsked = (e) => (Array.isArray(e?.terms) ? e.terms : [e?.term]).map((t) => String(t ?? "").trim().toLowerCase()).filter(Boolean);
/** Does this question reach only classes the frame added? It then has no bearing on the name's original scope. PURE. */
const onlyAddedClasses = (e, framed) => {
  const added = new Set(ints(framed?.beltAndBraces).map(String));
  for (const c of ints(framed?.classes)) added.delete(String(c));
  const asked = Array.isArray(e?.nice_classes) ? e.nice_classes.map(String) : [];
  return asked.length > 0 && asked.every((c) => added.has(c));
};

/**
 * Which questions the reading record must say something about, per name: every list read whose rows were not all
 * carried, and every count or crowd nothing narrowed or read. A zero and a failure are not on it: the first says
 * itself, and the second is the engine's to report, not the model's to excuse. PURE over its inputs.
 */
export function questionsOwed({ name, countsEntry = null, blocks = new Map(), proposals = [], carried = new Set(), framed = null, addedQuestions = [] }) {
  const owed = [];
  const answered = (e) => wasRead(blocks.get(String(e?.qid)));
  const narrowedBy = (qid) => proposals.some((e) => e?.narrows === qid && answered(e));
  const norm = (v) => String(v ?? "").trim().toLowerCase();
  const forms = formsOfName(name, framed);
  const isForm = (e, form) => termsAsked(e).includes(norm(form));
  const identical = countsEntry?.counts?.identical;
  const figures = Array.isArray(identical?.alternatives) ? identical.alternatives : [{ term: forms[0], total: identical?.total }];

  // A FORM'S OWN QUESTION IS ASKED WHATEVER ITS COUNT. A count above zero with no question on the form is not work that
  // can be set aside with a reason: the rule reads the identical mark first, narrowing it if it is a crowd. A question
  // the register then failed to answer has been asked.
  forms.forEach((form, i) => {
    const total = figures.find((f) => norm(f?.term) === norm(form))?.total;
    if (!(Number.isFinite(total) && total > 0)) return;
    const qid = formQid(name, i);
    const onForm = proposals.filter((e) => e?.predicate === "exact" && isForm(e, form) && !onlyAddedClasses(e, framed));
    if (!blocks.has(qid) && !onForm.some((e) => blocks.has(String(e?.qid)))) {
      owed.push({ question: qid, count: total, kind: "identical-not-asked", mustAsk: true });
      return;
    }
    const read = wasRead(blocks.get(qid)) || onForm.some(answered);
    const failed = hasFailed(blocks.get(qid)) || onForm.some((e) => hasFailed(blocks.get(String(e?.qid))));
    if (!read && !failed && !narrowedBy(qid)) owed.push({ question: qid, count: total, kind: "counted-not-read" });
  });

  // A COMBINED COUNT IS ANSWERED FORM BY FORM. Reading one variant says nothing about the others under the same number, so
  // the count stays owed until every form that can hold a filing has been read, or a row says why not.
  const heldTerms = (predicate) => new Set(proposals.filter((e) => e?.predicate === predicate && answered(e)).flatMap(termsAsked));
  const opening = [
    ["containing", countsEntry?.counts?.containing, "default", (c) => (Array.isArray(c?.alternatives) ? c.alternatives.map((a) => ({ form: a?.term, holds: a?.total > 0 })) : [{ form: forms[0], holds: true }])],
    ["close", countsEntry?.counts?.close, "exact", (c) => (Array.isArray(c?.forms) ? c.forms : []).map((f) => ({ form: f?.form, holds: c.joined === true || f?.total > 0 || f?.approximate === true }))],
  ];
  for (const [key, cell, predicate, formsUnder] of opening) {
    const total = cell?.total;
    if (!(Number.isFinite(total) && total > 0)) continue;
    const qid = openingQid(name, key);
    const under = formsUnder(cell);
    const read = heldTerms(predicate);
    const unread = under.filter((f) => f.holds && !read.has(norm(f.form))).map((f) => String(f.form));
    if (under.length ? !unread.length : narrowedBy(qid)) continue;
    owed.push({ question: qid, count: total, kind: "counted-not-read", ...(under.length > 1 && unread.length ? { unread } : {}) });
  }
  // AN ADDED CLASS OWES AN OUTCOME THOUGH NOTHING WAS COUNTED IN IT: the plan took it on. An answer of any kind is one; a crowd
  // or a failure goes on as any other question's does.
  for (const q of addedQuestions) {
    if (!blocks.has(q.qid) && !proposals.some((e) => e?.predicate === "exact" && forms.some((f) => isForm(e, f)) && (e?.nice_classes ?? []).map(String).includes(q.class) && blocks.has(String(e?.qid)))) {
      owed.push({ question: q.qid, count: null, kind: "added-class-no-outcome", addedClass: q.class });
    }
  }
  const byQid = new Map(proposals.map((e) => [String(e?.qid), e]));
  const formOfQid = (qid) => forms.find((_, i) => formQid(name, i) === qid) ?? forms.find((f) => isForm(byQid.get(qid), f)) ?? null;
  for (const [qid, block] of blocks) {
    if (hasFailed(block)) continue;
    if (isCrowd(block)) {
      // A crowd on a form's own question is answered by any list read on that form; any other by what names it.
      const form = byQid.get(qid)?.predicate === "exact" || !byQid.has(qid) ? formOfQid(qid) : null;
      if (narrowedBy(qid) || (form && proposals.some((e) => e?.predicate === "exact" && isForm(e, form) && !onlyAddedClasses(e, framed) && answered(e)))) continue;
      if (owed.some((o) => o.question === qid)) continue;
      owed.push({ question: qid, count: block.total_hits ?? null, kind: "crowd-not-read" });
      continue;
    }
    if (!wasRead(block)) continue;
    const unread = rowsOf(block).map((r) => String(r?.record_id ?? "")).filter((id) => !carried.has(id));
    if (unread.length) owed.push({ question: qid, count: unread.length, kind: "read-not-carried", records: unread });
  }
  return owed;
}

/**
 * One band row as the neutral record's mapper reads it. A row holds the office's numbers on its screen row where the
 * register hydrates (Clarivate), or in its own raw body where the search row is the record (Signa). PURE.
 */
function neutralRow(r) {
  const s = r?.screen && typeof r.screen === "object" ? r.screen : {};
  const raw = r?.raw && typeof r.raw === "object" ? r.raw : {};
  return { ...r,
    application_number: r?.application_number ?? s.application_number ?? raw.application_number ?? null,
    registration_number: r?.registration_number ?? s.registration_number ?? raw.registration_number ?? raw.ir_number ?? null,
    ir_number: r?.ir_number ?? s.ir_number ?? raw.ir_number ?? null,
    filing_route: r?.filing_route ?? s.filing_route ?? raw.filing_route ?? null,
    office_url: r?.office_url ?? s.office_url ?? raw.office_url ?? null };
}

/** What one question was, for the record's `terms` row and for the basis a report prints. PURE. */
function questionRow({ entry, block, formKeys = new Set() }) {
  const term = entry?.term ?? (Array.isArray(entry?.terms) ? entry.terms.join(" | ") : null);
  const isExactName = entry?.predicate === "exact" && formKeys.has(String(entry?.term ?? "").trim().toLowerCase());
  const failed = hasFailed(block);
  const crowd = isCrowd(block);
  const fetched = wasRead(block) ? rowsOf(block).length : 0;
  const total = Number.isFinite(block?.total_hits) ? block.total_hits : null;
  return {
    term, basis: isExactName ? "identical" : "close",
    qid: entry?.qid ?? null, predicate: entry?.predicate ?? null,
    ...(Array.isArray(entry?.goods_text) && entry.goods_text.length ? { goods: entry.goods_text } : {}),
    ...(Array.isArray(entry?.regions) && entry.regions.length ? { regions: entry.regions } : {}),
    ...(Array.isArray(entry?.nice_classes) && entry.nice_classes.length ? { classes: entry.nice_classes } : {}),
    ...(entry?.narrows ? { narrows: entry.narrows } : {}),
    ...(entry?.rationale ? { purpose: entry.rationale } : {}),
    ok: !failed && Boolean(block), fetched, total,
    ...(Array.isArray(block?.warnings) && block.warnings.length ? { warnings: block.warnings } : {}),
    state: !block ? "not-asked" : failed ? "failed" : crowd ? "crowd-not-read" : total === 0 ? "zero" : "read",
    ...(crowd ? { setAside: true } : {}),
    ...(failed ? { reason: String(block?.reason ?? "the register did not answer this question").slice(0, 300) } : {}),
  };
}

/** The name's own question, from its count and, where it was read, its block. A failed read is a failure whatever was counted. PURE. */
function identicalRow({ term: form, qid, cell, block, plainRead = false, narrowed = false }) {
  const counted = Number.isFinite(cell?.total);
  const approximate = cell?.approximate === true;
  const answered = counted || approximate;
  const failed = hasFailed(block) || (!answered && !wasRead(block));
  // Read under its own qid, or by a question on the name that kept the name's scope. A list a narrowing answered keeps
  // its own count and its own state: the crowd it replaced stays on the record.
  const read = wasRead(block) || plainRead;
  const total = counted ? cell.total : (Number.isFinite(block?.total_hits) ? block.total_hits : null);
  return { term: form.toUpperCase(), basis: "identical", label: "the name itself", qid, predicate: "exact",
    ok: !failed, fetched: wasRead(block) ? rowsOf(block).length : 0, total: approximate ? null : total,
    state: failed ? "failed" : read ? "read" : total === 0 ? "zero" : narrowed ? "narrowed" : "crowd-not-read",
    ...(approximate ? { approximate: true, floor: Number.isFinite(cell?.floor) ? cell.floor : null } : {}),
    ...(Array.isArray(block?.warnings) && block.warnings.length ? { warnings: block.warnings } : {}),
    ...(failed ? { reason: String(block?.reason ?? cell?.cause ?? cell?.unavailable ?? "the register did not answer this question").slice(0, 300) } : {}),
    ...(!failed && !read && !narrowed && (total > 0 || approximate) ? { setAside: true } : {}) };
}

/**
 * The run's record of its filings, as every later stage reads it: one row per question, the rows the reading step
 * carried forward, and what it set aside. PURE over its inputs.
 *
 * `reading` is what the reading step had settled when it ended. A name with no row in it carries every row its questions
 * hold, so the rating step still has what the run paid for, and the step's absence is on the record.
 */
export function knockoutRecordsDoc({ marks, classes = null, jurisdictions = null, provider, capabilities = null, unreachable = [],
  counts = null, reading = null, readBlocks, readProposals, framedMarks = [], now = () => new Date() }) {
  const { regions: covered, deferred, worldwide } = resolveRegions(jurisdictions, capabilities);
  const { regions, dropped } = reachableRegions(covered, unreachable, capabilities?.offices?.covered, worldwide === true);
  const officeScope = dropped.length
    ? { listed: regions, unlisted: dropped.map((d) => ({ office: d.office, memberId: d.memberId, missing: [...(d.missing ?? [])] })) } : null;
  const batchClasses = ints(classes);
  const plan = knockoutQuestionPlan({ marks, classes, jurisdictions, capabilities, unreachable, framedMarks });
  const countsByName = new Map((counts?.marks ?? []).map((m) => [String(m?.name ?? "").trim().toLowerCase(), m]));
  const readingByName = new Map((reading?.marks ?? []).map((m) => [String(m?.name ?? "").trim().toLowerCase(), m]));
  const framedByName = new Map((framedMarks ?? []).map((f) => [String(f?.name ?? "").trim().toLowerCase(), f]));

  const rows = (marks ?? []).map((m) => {
    const name = String(m?.name ?? "").trim();
    const own = ints(m?.classes);
    const scoped = own.length ? own : batchClasses;
    const key = name.toLowerCase();
    const blocks = readBlocks(name);
    const { entries, rejected = [] } = readProposals(name);
    const countsEntry = countsByName.get(key) ?? null;
    const read = readingByName.get(key) ?? null;

    const terms = [];
    const identicalCell = countsEntry?.counts?.identical;
    // ONE ROW PER FORM OF THE NAME, all tied to it. A name given in two word orders is asked as each, and neither is a
    // near form of the other.
    const forms = formsOfName(name, framedByName.get(key));
    const formKeys = new Set(forms.map((f) => f.toLowerCase()));
    const ownLists = [];
    forms.forEach((form, i) => {
      const qid = formQid(name, i);
      const block = blocks.get(qid);
      const figure = Array.isArray(identicalCell?.alternatives) ? identicalCell.alternatives.find((a) => String(a?.term).toLowerCase() === form.toLowerCase()) : identicalCell;
      const onForm = entries.filter((e) => e?.predicate === "exact" && termsAsked(e).includes(form.toLowerCase()) && !onlyAddedClasses(e, framedByName.get(key)) && wasRead(blocks.get(String(e?.qid))));
      const sameScope = (e) => !e?.nice_classes?.length || sameClassList(e.nice_classes, scoped);
      const isPlain = (e) => !e?.goods_text?.length && !e?.regions?.length && sameScope(e);
      terms.push(identicalRow({ term: form, qid, cell: figure, block, plainRead: onForm.some(isPlain), narrowed: onForm.some((e) => !isPlain(e)) }));
      ownLists.push({ form, qid, block });
    });
    // THE COUNTED FORMS, each as the question it was. Counted, not listed: a form with filings under it that nothing
    // read is a crowd not read, which is what stops a report saying no filing stands. A joined count holds no per-form
    // figure, so its total is the question's and its forms ride beside it.
    const formsCell = countsEntry?.counts?.close;
    const stackRead = entries.some((e) => e?.predicate === "exact" && !formKeys.has(String(e?.term ?? "").trim().toLowerCase()) && wasRead(blocks.get(String(e?.qid))));
    const formsTotal = Number.isFinite(formsCell?.total) ? formsCell.total : null;
    for (const f of Array.isArray(formsCell?.forms) ? formsCell.forms : []) {
      const n = formsCell.joined ? null : (Number.isFinite(f?.total) ? f.total : null);
      const approx = f?.approximate === true;
      const answered = formsCell.joined ? formsTotal !== null : (n !== null || approx);
      const holds = formsCell.joined ? formsTotal > 0 : (n > 0 || approx);
      terms.push({ term: f?.form ?? null, basis: "close", label: `close variation (${(f?.rules ?? []).join(", ")})`, qid: openingQid(name, "close"), predicate: "exact",
        ok: answered, fetched: 0, total: n, state: !answered ? "failed" : holds ? "crowd-not-read" : "zero",
        ...(approx ? { approximate: true, floor: Number.isFinite(f?.floor) ? f.floor : null } : {}),
        ...(!answered ? { reason: String(f?.cause ?? f?.unavailable ?? formsCell?.cause ?? formsCell?.unavailable ?? "the register did not answer this question").slice(0, 300) } : {}),
        ...(holds && !stackRead ? { setAside: true } : {}) });
    }
    for (const e of entries) terms.push(questionRow({ entry: e, block: blocks.get(String(e?.qid)), formKeys }));
    // AN ADDED CLASS WITH NO ANSWER STAYS ON THE RECORD UNRESOLVED, with the reason where one was given: neither searched nor
    // clean. A reading that did not finish leaves the same gap, recorded the same way.
    const owedAdded = questionsOwed({ name, countsEntry: null, blocks, proposals: entries, framed: framedByName.get(key) ?? null, addedQuestions: addedOf(plan, name) }).filter((o) => o.addedClass != null);
    for (const o of owedAdded) {
      const said = [...(read?.not_asked ?? []), ...(read?.set_aside ?? [])].find((r) => namesAddedClass(r?.question, o));
      terms.push({ term: name.toUpperCase(), basis: "identical", label: "the name itself", qid: o.question, predicate: "exact", classes: [Number(o.addedClass)], ok: true, fetched: 0, total: null,
        state: "not-asked", unresolved: true, setAside: true, ...(said ? { reason: String(said.why).slice(0, 300) } : {}) });
    }

    // A QUESTION THE STEP ASKED AND THE RUN DID NOT SEND is on the record as one, the safety net's refusal included:
    // never a clean answer, and never missing.
    for (const r of rejected) {
      const q = r?.proposal ?? {};
      terms.push({ term: q.term ?? (Array.isArray(q.terms) ? q.terms.join(" | ") : null), basis: "close", predicate: q.predicate ?? null,
        ok: false, fetched: 0, total: null, state: "not-asked", ...(r?.issue ? { refused: String(r.issue).slice(0, 300) } : {}) });
    }

    // THE ROWS. Carried by the reading step with its reason, or, with no row for the name, all it held. Every other row
    // read stays with the question that found it, so a later step can reach it.
    const carried = read ? carriedIds(read) : null;
    const groupOf = new Map((read?.carried ?? []).flatMap((g) => (g?.records ?? []).map((id) => [String(id), g])));
    const found = new Map();
    const setAside = new Map();
    const take = (block, term, basis, qid) => {
      if (!wasRead(block)) return;
      for (const raw of rowsOf(block)) {
        const id = String(raw?.record_id ?? "");
        if (!id || found.has(id)) continue;
        const row = { ...toRecord(neutralRow(raw), { term, basis, provider }), question: qid };
        if (carried && !carried.has(id)) { if (!setAside.has(id)) setAside.set(id, row); continue; }
        found.set(id, { ...row, ...(groupOf.get(id)?.why ? { carriedBecause: groupOf.get(id).why } : {}) });
      }
    };
    for (const { form, qid, block } of ownLists) take(block, form.toUpperCase(), "identical", qid);
    for (const e of entries) {
      const row = questionRow({ entry: e, block: blocks.get(String(e?.qid)), formKeys });
      take(blocks.get(String(e?.qid)), row.term, row.basis, row.qid);
    }
    const records = [...found.values()];
    // A row carried under one question and read again under another is carried, whichever came first.
    for (const id of found.keys()) setAside.delete(id);
    const setAsideRecords = [...setAside.values()];
    // A ROW NAMING FILINGS HOLDS THOSE; A ROW NAMING NONE ANSWERS FOR THE REST OF THAT QUESTION'S LIST.
    const namedUnder = (qid) => new Set((read?.set_aside ?? []).filter((g) => g.question === qid).flatMap((g) => g.records ?? []));
    const setAsideIds = (qid) => rowsOf(blocks.get(qid)).map((r) => String(r?.record_id ?? "")).filter((id) => setAside.has(id) && !namedUnder(qid).has(id));

    // How many the register holds under the questions a reader meets: the name, the forms and each question that is
    // not a narrowing of one already counted. Stated only when every one of them gave a number.
    const counted = terms.filter((t) => !t.narrows && t.ok && t.qid !== openingQid(name, "close"));
    const noSum = counted.some((t) => !Number.isFinite(t.total)) || (formsCell?.forms?.length > 0 && !Number.isFinite(formsTotal));
    const available = noSum ? null : counted.reduce((n, t) => n + t.total, 0) + (formsTotal ?? 0);
    return {
      name,
      classes: scoped.length ? scoped : null,
      classScope: scoped.length ? (own.length ? "mark" : "batch") : "all-classes",
      terms,
      records,
      fetched: records.length,
      available,
      capped: false,
      // WHAT THE STEP READ AND DID NOT CARRY, whole, so the rating step and the review can reach it and cite it.
      ...(setAsideRecords.length ? { setAsideRecords } : {}),
      reading: read
        ? { setAside: (read.set_aside ?? []).map((g) => ({ ...g, records: g.records ?? setAsideIds(g.question) })),
            notAsked: read.not_asked ?? [], openQuestions: read.open_questions ?? [],
            ownerChecks: (read.carried ?? []).filter((g) => g?.check_owner === true).flatMap((g) => g.records ?? []) }
        : { notFinished: true },
      ...(officeScope ? { officeScope } : {}),
      ...(deferred.length ? { deferredScope: deferred.map((d) => d.jurisdiction) } : {}),
    };
  });

  return {
    schema: 2,
    provider, providerLabel: capabilities?.label ?? provider,
    takenAt: now().toISOString(),
    basis: RECORD_BASIS,
    listedPredicates: ["identical", "close", "containing", "phonetic"],
    scope: {
      jurisdictions: (jurisdictions ?? []).length ? jurisdictions : null,
      regions: regions.length ? regions : null,
      deferredJurisdictions: deferred.length ? deferred.map((d) => d.jurisdiction) : null,
      ...(officeScope ? { unreachableOffices: officeScope.unlisted } : {}),
      classes: batchClasses.length ? batchClasses : null,
    },
    marks: rows,
  };
}

/**
 * The counts of a name given in several forms, one row per name. The count lane counted each form as its own name, because
 * no register can count a list as one; the name's cells are their sum and say where the number came from, and a form with
 * no answer leaves the cell open, as a partial sweep does. The forms' own rows stay on it, so a resume re-bills none. PURE.
 */
export function foldFormCounts(counts, marks, framedMarks = []) {
  const framedByName = new Map((framedMarks ?? []).map((f) => [String(f?.name ?? "").trim().toLowerCase(), f]));
  const rowsByName = new Map((counts?.marks ?? []).map((m) => [String(m?.name ?? "").trim().toLowerCase(), m]));
  const folded = (marks ?? []).flatMap((m) => {
    const name = String(m?.name ?? "").trim();
    const forms = formsOfName(name, framedByName.get(name.toLowerCase()));
    const rows = forms.map((f) => rowsByName.get(f.toLowerCase())).filter(Boolean);
    if (forms.length === 1 && forms[0].toLowerCase() === name.toLowerCase()) return rows;
    if (!rows.length) return [];
    const cell = (key) => {
      const each = rows.map((r) => ({ term: r.name, total: r.counts?.[key]?.total ?? null, ...(r.counts?.[key]?.unavailable ? { unavailable: r.counts[key].unavailable } : {}) }));
      const open = each.find((a) => !Number.isFinite(a.total));
      return { total: open ? null : each.reduce((n, a) => n + a.total, 0), source: "alternatives", alternatives: each, ...(open ? { unavailable: open.unavailable ?? "not every written form could be counted" } : {}) };
    };
    const closeForms = rows.flatMap((r) => r.counts?.close?.forms ?? []);
    return [{ ...rows[0], name, formRows: rows,
      counts: { identical: cell("identical"), containing: cell("containing"), close: { ...cell("close"), forms: closeForms,
        generated: rows.reduce((n, r) => n + (r.counts?.close?.generated ?? 0), 0), counted: rows.reduce((n, r) => n + (r.counts?.close?.counted ?? 0), 0),
        truncated: rows.some((r) => r.counts?.close?.truncated), ...(rows.every((r) => r.counts?.close?.joined) ? { joined: true } : {}) } } }];
  });
  return { ...counts, marks: folded };
}

/** A folded counts record back to the rows the count lane reuses on a resume. PURE. */
export const unfoldFormCounts = (counts) => (counts ? { ...counts, marks: (counts.marks ?? []).flatMap((m) => m?.formRows ?? [m]) } : counts);

/** The rows the count lane counts: each written form of each name, on its own. PURE. */
export const countRowsOf = (marks, framedMarks = []) => {
  const framedByName = new Map((framedMarks ?? []).map((f) => [String(f?.name ?? "").trim().toLowerCase(), f]));
  return (marks ?? []).flatMap((m) => formsOfName(m?.name, framedByName.get(String(m?.name ?? "").trim().toLowerCase())).map((form) => ({ ...m, name: form })));
};

/**
 * The record once the rating step has spoken: a set-aside filing it cited moves up with the carried ones, so the report
 * has a row for what the rating rests on. A later step may overturn a set-aside, and this is how that reaches the page. PURE.
 */
export function withCitedFilings(doc, findings) {
  if (!doc?.marks?.some((m) => m?.setAsideRecords?.length)) return doc;
  const marksByName = new Map((findings?.marks ?? []).map((m) => [String(m?.name ?? "").trim().toLowerCase(), m]));
  return { ...doc, marks: doc.marks.map((entry) => {
    const rated = marksByName.get(String(entry?.name ?? "").trim().toLowerCase());
    if (!entry?.setAsideRecords?.length || !rated) return entry;
    const cited = new Set([...(rated.registerReads ?? []).map((r) => r?.recordId), ...(rated.findings ?? []).flatMap((f) => f?.weighedFilings ?? [])].filter(Boolean).map(String));
    const moved = entry.setAsideRecords.filter((r) => cited.has(String(r?.recordId)));
    if (!moved.length) return entry;
    const left = entry.setAsideRecords.filter((r) => !cited.has(String(r?.recordId)));
    const { setAsideRecords: _old, ...rest } = entry;
    return { ...rest, records: [...entry.records, ...moved.map((r) => ({ ...r, citedFromSetAside: true }))], fetched: entry.records.length + moved.length,
      ...(left.length ? { setAsideRecords: left } : {}) };
  }) };
}

/** One ledger line per question, beside the counts' own, so one file answers what the register lane asked. */
export function appendQuestionReceipts(ledgerPath, doc, { provider, now = () => new Date() } = {}) {
  if (!ledgerPath) return;
  for (const m of doc?.marks ?? []) {
    for (const t of m?.terms ?? []) {
      if (t?.predicate === "exact" && t?.qid?.endsWith(":close")) continue;   // counted by the count lane, which wrote its own line
      try {
        appendFileSync(ledgerPath, JSON.stringify({ ts: now().toISOString(), stage: "records", mark: m.name, term: t.term, basis: t.basis,
          qid: t.qid ?? null, predicate: t.predicate ?? null, classes: m.classes, provider, ok: Boolean(t.ok), fetched: t.fetched ?? 0,
          total: Number.isFinite(t.total) ? t.total : null, state: t.state ?? null,
          ...(Array.isArray(t.warnings) && t.warnings.length ? { warnings: t.warnings } : {}),
          ...(t.ok ? {} : { cause: String(t.reason ?? "unknown").slice(0, 300) }) }) + "\n");
      } catch { /* receipts are best-effort, never fatal */ }
    }
  }
}

/** The lines the reading step opens on, code-owned and one per name: what it may ask under, and the counts. Nothing is read yet. PURE. */
export function readingTableLines({ marks, counts, classes = null, framedMarks = [], runDir }) {
  const framedByName = new Map((framedMarks ?? []).map((f) => [String(f?.name ?? "").trim().toLowerCase(), f]));
  const countsByName = new Map((counts?.marks ?? []).map((m) => [String(m?.name ?? "").trim().toLowerCase(), m]));
  const cell = (c) => (Number.isFinite(c?.total) ? String(c.total) : "not available");
  const instructed = new Set((marks ?? []).flatMap((m) => classesForName(m, classes, framedByName.get(String(m?.name ?? "").trim().toLowerCase()) ?? null)));
  return (marks ?? []).map((m) => {
    const name = String(m?.name ?? "").trim();
    const key = name.toLowerCase();
    const framed = framedByName.get(key) ?? null;
    const c = countsByName.get(key)?.counts ?? {};
    const nearSpellings = (c.close?.forms ?? []).map((f) => f?.form).filter(Boolean).join(" · ");
    const nice = classesForName(m, classes, framed);
    const added = ints(framed?.beltAndBraces).filter((n) => !instructed.has(n));
    const forms = formsOfName(name, framed);
    const own = c.identical?.alternatives
      ? forms.map((f, i) => `"${f}" (\`${formQid(name, i)}\`): ${cell(c.identical.alternatives.find((a) => String(a?.term).toLowerCase() === f.toLowerCase()))}`).join("; ")
      : `(\`${openingQid(name, "identical")}\`): ${cell(c.identical)}`;
    return [
      `- "${name}": axis \`${knockoutAxis(name)}\`, band \`${knockoutBandPath(runDir, name)}\`, classes [${nice.join(", ")}]${added.length ? `, added by the frame: ${added.map((n) => `class ${n} (\`${openingQid(name, `added-class-${n}`)}\`)`).join(", ")}` : ""}.`,
      `  Identical ${own}. Containing (\`${openingQid(name, "containing")}\`): ${cell(c.containing)}. Mechanical near-spellings${nearSpellings ? ` ${nearSpellings}` : ""} (\`${openingQid(name, "close")}\`): ${cell(c.close)}.`,
    ].join("\n");
  });
}

/**
 * One list in full, as a later step reads it: every row the question returned, each with the goods the run holds for it
 * in the shipped evidence states (filing-goods.mjs). With `record_id`, all the wording this run holds for that one filing.
 * Nothing is fetched. A row with no goods on file says so, and that is not a mismatch with the client's goods.
 */
export function knockoutListView(runDir, { qid, record_id: recordId = null }, goodsOptions = {}) {
  const want = String(qid ?? "").trim();
  if (!want) return { error: "qid is required: the question whose list you are reading, as the propose tool or your opening message named it." };
  const dir = join(String(runDir ?? ""), BAND_DIR);
  let found = null;
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith("-band.json")); } catch { files = []; }
  for (const f of files) {
    let doc;
    try { doc = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { continue; }
    for (const b of Array.isArray(doc) ? doc : []) if (String(b?.qid ?? "") === want) found = b;
    if (found) break;
  }
  if (!found) return { error: `no question "${want}" has an answer in this run's bands. Ask it first; a name's counted opening questions have no list until one is read.` };
  const records = rowsOf(found).map((r) => toRecord(neutralRow(r), { term: null, basis: null, provider: null }));
  const held = withFilingGoods({ marks: [{ records }] }, runDir, goodsOptions).marks[0].records;
  if (recordId != null && String(recordId).trim()) {
    const one = held.find((r) => r.recordId === String(recordId).trim());
    if (!one) return { error: `no filing "${String(recordId).slice(0, 120)}" under question "${want}". Copy record_id from that question's list.` };
    return { qid: want, record_id: one.recordId, goods_state: one.goodsState, goods_from: one.goodsFrom, ...heldWording(one, runDir) };
  }
  return {
    qid: want, state: found.state ?? null, total_hits: found.total_hits ?? null,
    ...(found.reason ? { reason: String(found.reason).slice(0, 300) } : {}),
    ...(found.error ? { error_answer: true } : {}),
    ...(found.per_office_counts ? { per_office_counts: found.per_office_counts } : {}),
    rows: held.map((r) => ({ record_id: r.recordId, mark: r.mark, owner: r.owner, owner_country: r.ownerCountry, status: r.status, office: r.territory, classes: r.classes,
      filed: r.applicationDate, registered: r.registrationDate, goods: r.goods, goods_state: r.goodsState, goods_from: r.goodsFrom, goods_shortened: r.goodsShortened })),
  };
}

/** All the wording held for one filing: its whole held record where one was written, else the statements its view carries. */
function heldWording(record, runDir) {
  try { if (record.fullRecord) return { full_record: JSON.parse(readFileSync(join(String(runDir ?? ""), record.fullRecord), "utf8")) }; }
  catch { /* the view below is what is left to read */ }
  return { goods: record.goods };
}

/**
 * The record with its goods on every row it holds, the carried and the set aside alike. Sends nothing. `runPrefix` is what
 * lets a fetch that failed read as failed, not as a record never held: the call ledger answers it by run.
 */
export function withHeldGoods(doc, runDir, goodsOptions = {}) {
  const carried = withFilingGoods(doc, runDir, goodsOptions);
  const setAside = withFilingGoods({ marks: (carried?.marks ?? []).map((m) => ({ records: m?.setAsideRecords ?? [] })) }, runDir, goodsOptions);
  return { ...carried, marks: (carried?.marks ?? []).map((m, i) => (m?.setAsideRecords?.length ? { ...m, setAsideRecords: setAside.marks[i].records } : m)) };
}

/** The run a stage's session key belongs to: the key as the lane composes it, without its stage label. PURE. */
export const runPrefixOfSession = (sessionKey) => String(sessionKey ?? "").replace(/-knockout-[a-z-]+(#\d+)?(-rerun\d+)?$/, "") || null;

export const questionPlanPath = (runDir) => driverDir(runDir, QUESTION_PLAN_FILE);

// ── THE QUESTIONS' EXECUTOR: injected (tests) → a fixtures dir (the $0 offline guarantee) → the live register ─────────

const MATCH_MODES = Object.freeze({ exact: "exact", default: "default", phonetic: "phonetic", wildcard: "wildcard" });

/**
 * A plan's questions, answered by a lister instead of a register, under the executor's own contract: one block per
 * question merged into the band, a list over the fetch limit answered as a crowd, a failure answered as a failure and
 * never as a zero. For offline runs and tests alone, and it sends nothing anywhere. Returns the executor's summary text.
 */
export async function executeQuestionsWithLister(lister, { plan_path: planPath, axis, output_path: outputPath, qids = null }) {
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const wanted = Array.isArray(qids) && qids.length ? new Set(qids.map(String)) : null;
  const entries = (plan?.entries ?? []).filter((e) => e?.axis === axis && (!wanted || wanted.has(String(e?.qid))));
  if (!entries.length) return { type: "text", text: `ERROR: the plan carries no entries for axis "${axis}".` };
  let band = [];
  try { const had = JSON.parse(readFileSync(outputPath, "utf8")); if (Array.isArray(had)) band = had; } catch { /* first write */ }
  const owned = new Set(entries.map((e) => String(e.qid)));
  const states = {};
  const blocks = [];
  // What the name's own question was asked over: a question over other classes is a narrower one, and is keyed as one.
  let nameClasses = null;
  try {
    const frozen = JSON.parse(readFileSync(driverDir(dirname(dirname(outputPath)), QUESTION_PLAN_FILE), "utf8"));
    nameClasses = (frozen?.entries ?? []).find((f) => f?.axis === axis && f?.provenance === "mark" && !f?.added_class_reason)?.nice_classes ?? null;
  } catch { nameClasses = null; }
  const sameClasses = (a) => JSON.stringify([...(a ?? [])].map(String).sort()) === JSON.stringify([...(nameClasses ?? [])].map(String).sort());
  for (const e of entries) {
    const terms = Array.isArray(e?.terms) ? e.terms : [e?.term];
    const base = { qid: e.qid, query: { term: e.term ?? null, terms: e.terms ?? null, predicate: e.predicate ?? null } };
    const rows = [];
    const seen = new Set();
    const warnings = [];
    let total = 0;
    let failure = null;
    if (e?.unsupported) failure = String(e.unsupported_reason ?? "this register cannot express this question");
    for (const t of failure ? [] : terms) {
      let r;
      try {
        r = await lister(t, { classes: sameClasses(e.nice_classes) ? [] : (e.nice_classes ?? []), regions: e.regions ?? [],
          matchMode: MATCH_MODES[e?.predicate] ?? "default", goods: e.goods_text ?? null, scoped: true });
      } catch (err) { r = { ok: false, reason: `record listing threw: ${String(err?.message ?? err).slice(0, 200)}` }; }
      if (!r?.ok || !Array.isArray(r?.records)) { failure = String(r?.reason ?? "the question was not answered"); break; }
      total += Number.isFinite(r.total) ? r.total : r.records.length;
      if (Array.isArray(r.warnings)) warnings.push(...r.warnings);
      for (const row of r.records) {
        const id = String(row?.record_id ?? "");
        if (id && !seen.has(id)) { seen.add(id); rows.push(row); }
      }
    }
    if (failure) {
      blocks.push({ state: "incomplete", ...base, total_hits: 0, fetched: 0, sample: [], error: true, reason: `provider error: ${failure}` });
      states[e.qid] = "error";
    } else if (total > ENUMERATE_CEILING_DEFAULT) {
      blocks.push({ state: "incomplete", ...base, total_hits: total, fetched: 0, sample: [], reason: `total_hits ${total} exceeds the enumerate ceiling ${ENUMERATE_CEILING_DEFAULT}` });
      states[e.qid] = "incomplete";
    } else {
      blocks.push({ state: "enumerated", ...base, total_hits: total, count: rows.length, records: rows, ...(warnings.length ? { warnings } : {}) });
      states[e.qid] = "enumerated";
    }
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(`${outputPath}.tmp`, JSON.stringify([...band.filter((b) => !owned.has(String(b?.qid))), ...blocks], null, 2) + "\n");
  renameSync(`${outputPath}.tmp`, outputPath);
  return { type: "text", text: JSON.stringify({ skipped: [], states }) };
}

/**
 * Who answers this run's questions, and how. A fixture run never falls through to a live register: `offline` with no
 * directory is `none`, and the lane says the filings were not listed.
 */
export function resolveQuestionExecutor({ lister = null, adapter = null, agentId = null, sessionKey = null, recordLog = null, fixtureDir = null, offline = false } = {}) {
  const viaLister = (fn) => async ({ planPath, axis, outputPath, qids }) => {
    const r = await executeQuestionsWithLister(fn, { plan_path: planPath, axis, output_path: outputPath, qids });
    return String(r?.text ?? "").startsWith("ERROR") ? { ok: false, cause: r.text } : { ok: true };
  };
  if (typeof lister === "function") return { source: "injected", execute: viaLister(lister) };
  if (fixtureDir) return { source: `fixtures:${fixtureDir}`, fixtureDir, execute: viaLister(fixtureLister(fixtureDir)) };
  if (offline || typeof adapter?.executePlan !== "function") return { source: "none", execute: null };
  return { source: "provider", execute: ({ planPath, axis, outputPath, qids }) =>
    adapter.executePlan({ planPath, axis, outputPath, qids }, { agentId, sessionKey, recordLog }) };
}
