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
import { bandGoodsIndex, goodsFor } from "./record-goods.mjs";

export const QUESTION_PLAN_FILE = "register-plan.json";
export const BAND_DIR = "register-units";

/** Longest goods text a list row carries before it says `shortened`; the whole text is one call away, unbought. */
export const LIST_GOODS_CHARS = 600;

/** The register axis of one instructed name. The research key, so two names can never share one. PURE. */
export const knockoutAxis = (name) => `ko-${kebab(name)}`;

/** The band one name's questions are written to, inside this run's folder. PURE. */
export const knockoutBandPath = (runDir, name) => join(String(runDir ?? ""), BAND_DIR, `${knockoutAxis(name)}-band.json`);

/** The qid of a name's opening question, the name each row of the reading record answers to. PURE. */
export const openingQid = (name, key) => `${knockoutAxis(name)}:${key}`;

const ints = (v) => (Array.isArray(v) ? v : []).filter((n) => Number.isInteger(n));

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
    entries.push({ qid: openingQid(name, "identical"), axis, predicate: "exact", term: name, nice_classes: nice, regions: [],
      provenance: "mark", expected_kind: "enumerate", origin: "plan" });
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

/** The record ids a reading record's `carried` groups hold, flattened. PURE. */
export const carriedIds = (row) => new Set((row?.carried ?? []).flatMap((g) => (Array.isArray(g?.records) ? g.records : [])).map(String));

const rowsOf = (block) => (Array.isArray(block?.records) ? block.records : []);
/** Was this block answered with the rows the register holds under it? */
const wasRead = (block) => block?.state === "enumerated" && block?.error !== true;
/** A block with no answer: a failure, or a refusal the register's rules make permanent. Never a zero. */
const hasFailed = (block) => Boolean(block) && block.error === true;
/** A block the register answered with a count too large to fetch. */
const isCrowd = (block) => Boolean(block) && block.state === "incomplete" && block.error !== true;

/**
 * Which questions the reading record must say something about, per name: every list read whose rows were not all
 * carried, and every count or crowd nothing narrowed or read. A zero and a failure are not on it: the first says
 * itself, and the second is the engine's to report, not the model's to excuse. PURE over its inputs.
 */
export function questionsOwed({ name, countsEntry = null, blocks = new Map(), proposals = [], carried = new Set() }) {
  const owed = [];
  const answers = (qid) => proposals.some((e) => e?.narrows === qid && wasRead(blocks.get(String(e?.qid))));
  const asked = (test) => proposals.some((e) => test(e) && wasRead(blocks.get(String(e?.qid))));
  const nameKey = String(name ?? "").trim().toLowerCase();
  const isName = (e) => String(e?.term ?? "").trim().toLowerCase() === nameKey;

  const opening = [
    ["identical", countsEntry?.counts?.identical?.total, (e) => e?.predicate === "exact" && isName(e) && !e?.goods_text?.length],
    ["containing", countsEntry?.counts?.containing?.total, (e) => e?.predicate === "default" && isName(e)],
    ["close", countsEntry?.counts?.close?.total, (e) => e?.predicate === "exact" && !isName(e)],
  ];
  const identicalBlock = blocks.get(openingQid(name, "identical"));
  for (const [key, total, reads] of opening) {
    if (!(Number.isFinite(total) && total > 0)) continue;
    const qid = openingQid(name, key);
    if (key === "identical" && wasRead(identicalBlock)) continue;
    if (answers(qid) || asked(reads)) continue;
    owed.push({ question: qid, count: total, kind: "counted-not-read" });
  }
  for (const [qid, block] of blocks) {
    if (hasFailed(block)) continue;
    if (isCrowd(block)) {
      if (answers(qid)) continue;
      if (qid === openingQid(name, "identical") && owed.some((o) => o.question === qid)) continue;
      owed.push({ question: qid, count: block.total_hits ?? null, kind: "crowd-not-read" });
      continue;
    }
    if (!wasRead(block)) continue;
    const unread = rowsOf(block).filter((r) => !carried.has(String(r?.record_id ?? "")));
    if (unread.length) owed.push({ question: qid, count: unread.length, kind: "read-not-carried" });
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
function questionRow({ entry, block, name, alternatives = new Set() }) {
  const term = entry?.term ?? (Array.isArray(entry?.terms) ? entry.terms.join(" | ") : null);
  const asked = String(entry?.term ?? "").trim().toLowerCase();
  const isExactName = entry?.predicate === "exact" && !entry?.goods_text?.length && (asked === String(name).trim().toLowerCase() || alternatives.has(asked));
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
function identicalRow({ name, cell, block }) {
  const counted = Number.isFinite(cell?.total);
  const approximate = cell?.approximate === true;
  const answered = counted || approximate;
  const failed = hasFailed(block) || (!answered && !wasRead(block));
  const read = wasRead(block);
  const total = counted ? cell.total : (Number.isFinite(block?.total_hits) ? block.total_hits : null);
  return { term: name.toUpperCase(), basis: "identical", label: "the name itself", qid: openingQid(name, "identical"), predicate: "exact",
    ok: !failed, fetched: read ? rowsOf(block).length : 0, total: approximate ? null : total,
    state: failed ? "failed" : read ? "read" : total === 0 ? "zero" : "crowd-not-read",
    ...(approximate ? { approximate: true, floor: Number.isFinite(cell?.floor) ? cell.floor : null } : {}),
    ...(Array.isArray(block?.warnings) && block.warnings.length ? { warnings: block.warnings } : {}),
    ...(failed ? { reason: String(block?.reason ?? cell?.cause ?? cell?.unavailable ?? "the register did not answer this question").slice(0, 300) } : {}),
    ...(!failed && !read && (total > 0 || approximate) ? { setAside: true } : {}) };
}

/**
 * The run's record of its filings, as every later stage reads it: one row per question, the rows the reading step
 * carried forward, and what it set aside. PURE over its inputs.
 *
 * `reading` is the reading step's accepted record, or null when the step did not finish. Then every row the code read
 * of the name's own list is carried, so the rating step still has what the run paid for, and the step's absence is on
 * the record.
 */
export function knockoutRecordsDoc({ marks, classes = null, jurisdictions = null, provider, capabilities = null, unreachable = [],
  counts = null, reading = null, readBlocks, readProposals, now = () => new Date() }) {
  const { regions: covered, deferred, worldwide } = resolveRegions(jurisdictions, capabilities);
  const { regions, dropped } = reachableRegions(covered, unreachable, capabilities?.offices?.covered, worldwide === true);
  const officeScope = dropped.length
    ? { listed: regions, unlisted: dropped.map((d) => ({ office: d.office, memberId: d.memberId, missing: [...(d.missing ?? [])] })) } : null;
  const batchClasses = ints(classes);
  const countsByName = new Map((counts?.marks ?? []).map((m) => [String(m?.name ?? "").trim().toLowerCase(), m]));
  const readingByName = new Map((reading?.marks ?? []).map((m) => [String(m?.name ?? "").trim().toLowerCase(), m]));

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
    const identicalBlock = blocks.get(openingQid(name, "identical"));
    // A NAME THAT HOLDS ALTERNATIVES was asked as each of them: they stand in for its own question, which no register can
    // answer as a list, and each stays tied to this name.
    const alternatives = new Set((read?.alternatives ?? []).map((t) => String(t).trim().toLowerCase()));
    if (!alternatives.size) terms.push(identicalRow({ name, cell: identicalCell, block: identicalBlock }));
    // THE COUNTED FORMS, each as the question it was. Counted, not listed: a form with filings under it that nothing
    // read is a crowd not read, which is what stops a report saying no filing stands. A joined count holds no per-form
    // figure, so its total is the question's and its forms ride beside it.
    const formsCell = countsEntry?.counts?.close;
    const stackRead = entries.some((e) => e?.predicate === "exact" && !alternatives.has(String(e?.term ?? "").trim().toLowerCase())
      && String(e?.term ?? "").trim().toLowerCase() !== key && wasRead(blocks.get(String(e?.qid))));
    const formsTotal = Number.isFinite(formsCell?.total) ? formsCell.total : null;
    for (const f of Array.isArray(formsCell?.forms) ? formsCell.forms : []) {
      const n = formsCell.joined ? null : (Number.isFinite(f?.total) ? f.total : null);
      const approx = f?.approximate === true;
      const answered = formsCell.joined ? formsTotal !== null : (n !== null || approx);
      if (!answered && alternatives.size) continue;   // a list-shaped name's forms: its alternatives were asked instead
      const holds = formsCell.joined ? formsTotal > 0 : (n > 0 || approx);
      terms.push({ term: f?.form ?? null, basis: "close", label: `close variation (${(f?.rules ?? []).join(", ")})`, qid: openingQid(name, "close"), predicate: "exact",
        ok: answered, fetched: 0, total: n, state: !answered ? "failed" : holds ? "crowd-not-read" : "zero",
        ...(approx ? { approximate: true, floor: Number.isFinite(f?.floor) ? f.floor : null } : {}),
        ...(!answered ? { reason: String(f?.cause ?? f?.unavailable ?? formsCell?.cause ?? formsCell?.unavailable ?? "the register did not answer this question").slice(0, 300) } : {}),
        ...(holds && !stackRead ? { setAside: true } : {}) });
    }
    for (const e of entries) terms.push(questionRow({ entry: e, block: blocks.get(String(e?.qid)), name, alternatives }));

    // A QUESTION THE STEP ASKED AND THE RUN DID NOT SEND is on the record as one, the safety net's refusal included:
    // never a clean answer, and never missing.
    for (const r of rejected) {
      const q = r?.proposal ?? {};
      terms.push({ term: q.term ?? (Array.isArray(q.terms) ? q.terms.join(" | ") : null), basis: "close", predicate: q.predicate ?? null,
        ok: false, fetched: 0, total: null, state: "not-asked", ...(r?.issue ? { refused: String(r.issue).slice(0, 300) } : {}) });
    }

    // THE ROWS. Carried by the reading step with its reason, or, with no reading record, the name's own list as the
    // code read it. Every other row read stays with the question that found it, so a later step can reach it.
    const carried = read ? carriedIds(read) : null;
    const whyCarried = new Map((read?.carried ?? []).flatMap((g) => (g?.records ?? []).map((id) => [String(id), g?.why ?? null])));
    const found = new Map();
    const setAsideIds = new Map();
    const take = (block, term, basis, qid) => {
      if (!wasRead(block)) return;
      for (const raw of rowsOf(block)) {
        const id = String(raw?.record_id ?? "");
        if (!id || found.has(id)) continue;
        if (carried && !carried.has(id)) {
          if (!setAsideIds.has(qid)) setAsideIds.set(qid, new Set());
          setAsideIds.get(qid).add(id);
          continue;
        }
        found.set(id, { ...toRecord(neutralRow(raw), { term, basis, provider }), question: qid,
          ...(whyCarried.get(id) ? { carriedBecause: whyCarried.get(id) } : {}) });
      }
    };
    take(identicalBlock, name.toUpperCase(), "identical", openingQid(name, "identical"));
    for (const e of entries) {
      const row = questionRow({ entry: e, block: blocks.get(String(e?.qid)), name, alternatives });
      take(blocks.get(String(e?.qid)), row.term, row.basis, row.qid);
    }
    const records = [...found.values()];
    // A row carried under one question and read again under another is carried, whichever came first.
    for (const ids of setAsideIds.values()) for (const id of [...ids]) if (found.has(id)) ids.delete(id);

    // How many the register holds under the questions a reader meets: the name, the forms and each question that is
    // not a narrowing of one already counted. Stated only when every one of them gave a number.
    const counted = terms.filter((t) => !t.narrows && t.ok && t.qid !== openingQid(name, "close"));
    const noSum = counted.some((t) => !Number.isFinite(t.total)) || (formsCell?.forms?.length > 0 && !Number.isFinite(formsTotal) && !alternatives.size);
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
      reading: read
        ? { setAside: (read.set_aside ?? []).map((g) => ({ ...g, records: g.records ?? [...(setAsideIds.get(g.question) ?? [])] })),
            notAsked: read.not_asked ?? [], openQuestions: read.open_questions ?? [],
            ...(alternatives.size ? { alternatives: read.alternatives } : {}) }
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
 * The counts, with each name the reading step found to hold alternatives counted as those alternatives. The register
 * cannot count a list as one name, so the name's own cell was left open; each alternative's answer is the register's own
 * figure, and the cell says where its number came from. A name with any alternative unanswered keeps its open cell. PURE.
 */
export function countsWithAlternatives(counts, reading, { readBlocks, readProposals }) {
  if (!counts) return counts;
  const out = structuredClone(counts);
  for (const row of reading?.marks ?? []) {
    if (!row?.alternatives?.length) continue;
    const entry = (out.marks ?? []).find((m) => String(m?.name ?? "").trim().toLowerCase() === String(row.name ?? "").trim().toLowerCase());
    if (!entry?.counts) continue;
    const blocks = readBlocks(row.name);
    const { entries } = readProposals(row.name);
    const answers = row.alternatives.map((t) => {
      const e = entries.find((x) => x?.predicate === "exact" && !x?.goods_text?.length && String(x?.term ?? "").trim().toLowerCase() === String(t).trim().toLowerCase());
      const total = blocks.get(String(e?.qid))?.total_hits;
      return { term: t, total: Number.isFinite(total) ? total : null };
    });
    if (answers.some((a) => a.total === null)) continue;
    entry.counts.identical = { total: answers.reduce((n, a) => n + a.total, 0), source: "alternatives", alternatives: answers };
  }
  return out;
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

/** The lines the reading step opens on, code-owned and one per name: what it may ask under, and what the register said. PURE. */
export function readingTableLines({ marks, counts, classes = null, framedMarks = [], runDir }) {
  const framedByName = new Map((framedMarks ?? []).map((f) => [String(f?.name ?? "").trim().toLowerCase(), f]));
  const countsByName = new Map((counts?.marks ?? []).map((m) => [String(m?.name ?? "").trim().toLowerCase(), m]));
  const cell = (c) => (Number.isFinite(c?.total) ? String(c.total) : "not available");
  return (marks ?? []).map((m) => {
    const name = String(m?.name ?? "").trim();
    const key = name.toLowerCase();
    const framed = framedByName.get(key) ?? null;
    const c = countsByName.get(key)?.counts ?? {};
    const forms = (c.close?.forms ?? []).map((f) => f?.form).filter(Boolean).join(" · ");
    const nice = classesForName(m, classes, framed);
    const added = ints(framed?.beltAndBraces).filter((n) => !nice.includes(n));
    return [
      `- "${name}": axis \`${knockoutAxis(name)}\`, band \`${knockoutBandPath(runDir, name)}\`, classes [${nice.join(", ")}]${added.length ? `, added by the frame [${added.join(", ")}]` : ""}.`,
      `  Identical (\`${openingQid(name, "identical")}\`): ${cell(c.identical)}. Containing (\`${openingQid(name, "containing")}\`): ${cell(c.containing)}. Mechanical near-spellings${forms ? ` ${forms}` : ""} (\`${openingQid(name, "close")}\`): ${cell(c.close)}.`,
    ].join("\n");
  });
}

/** Text of one goods statement cut for a list row, and whether anything was cut. PURE. */
function cutGoods(goods, limit) {
  let left = limit;
  let cut = false;
  const out = [];
  for (const g of goods ?? []) {
    const chars = [...String(g?.text ?? "")];
    if (left <= 0) { cut = cut || chars.length > 0; continue; }
    const take = chars.slice(0, left).join("");
    if (take.length < chars.join("").length) cut = true;
    left -= chars.length;
    out.push({ classes: g?.classes ?? [], text: take });
  }
  return { out, cut };
}

/**
 * One list in full, as the reading step reads it: every row the question returned, with the goods the run holds for
 * it. `record_id` asks for one row with its goods whole, read from what the run already holds, so nothing is fetched
 * again. A record with no goods on file says so: absent is not a mismatch with the client's goods.
 */
export function knockoutListView(runDir, { qid, record_id: recordId = null }, { names = [] } = {}) {
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
  if (!found) return { error: `no question "${want}" has an answer in this run's bands. Ask it first; a name's counted opening questions have no list until one is read.`, names };
  const held = bandGoodsIndex(runDir);
  const viewRow = (r, whole) => {
    const goods = goodsFor(held, r);
    const { out, cut } = cutGoods(goods, whole ? Infinity : LIST_GOODS_CHARS);
    return {
      record_id: r?.record_id ?? null, mark: r?.mark_text ?? null, owner: r?.owner_name ?? null, owner_country: r?.owner_country ?? null,
      status: r?.status ?? null, office: r?.office ?? null, classes: r?.classes ?? null,
      filed: r?.application_date ?? null, registered: r?.registration_date ?? null,
      goods: out, goods_state: !goods?.length ? "absent" : cut ? "shortened" : "complete",
    };
  };
  if (recordId != null) {
    const row = rowsOf(found).find((r) => String(r?.record_id ?? "") === String(recordId));
    return row ? { qid: want, row: viewRow(row, true) } : { error: `record "${recordId}" is not in the list of ${want}.` };
  }
  return {
    qid: want, state: found.state ?? null, total_hits: found.total_hits ?? null,
    ...(found.reason ? { reason: String(found.reason).slice(0, 300) } : {}),
    ...(found.error ? { error_answer: true } : {}),
    ...(found.per_office_counts ? { per_office_counts: found.per_office_counts } : {}),
    rows: rowsOf(found).map((r) => viewRow(r, false)),
  };
}

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
  return { type: "text", text: JSON.stringify({ executed: blocks.length, skipped: [], states }) };
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
