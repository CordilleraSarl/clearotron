// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lib/knockout.mjs — the KNOCKOUT lane, projected into the audit tools' own shapes.
//
// THE DEFECT THIS CLOSES, and it is worth stating plainly because the failure mode was a confident wrong
// answer rather than an error. Every read-only tool whose job is to show HOW a search reached its answer
// returned empty on a delivered Knockout search: `get_run` listed eleven clearance documents and reported
// each missing, `list_searches` returned zero, `read_artifact report` said the report did not exist while
// it sat on disk in the pool. An assistant session asked those tools whether a delivered knockout had
// checked a particular use, was shown a wall of empties, correctly applied "an absence is a finding", and
// told the account owner the report was ungrounded prose. Every part of that was false, and it was the
// only conclusion the tools supported.
//
// TWO CAUSES, BOTH MECHANICAL:
//   1. WRONG DIRECTORY. A knockout writes report.md/report.html/report-data.json to the POOL, never into
//      the run dir. `resolveRun` has returned `poolDir` beside `P` for exactly this reason since brief.mjs
//      needed it — and brief was the only reader that used it, which is precisely why brief was the only
//      tool that worked.
//   2. WRONG SCHEMA. The projections read clearance artifacts (findings.json, audit.md, the coverage
//      ledger) that this product never writes. The data they want is in `knockout-findings.json`.
//
// THE RULE THIS MODULE FOLLOWS, from the issue: the reader adapts to the product, never the product to the
// reader. Nothing here asks the knockout lane to emit a clearance-shaped artifact it has no use for.
//
// AND THE RULE THAT MATTERS MOST: a projection with no knockout equivalent returns a STATED refusal, never
// an empty list. `[]` reads as "we looked and found nothing" — that reading is the whole incident above.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

import { koPaths, addressListedFilings, declaredRecordOrigins } from "./driver.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

/**
 * Is this run a knockout? Answered from DISK, never from a stored lane string.
 *
 * `knockout-plan.json` is the frame stage's output and lands before any assessment exists, so a run that
 * failed mid-flight is still recognised as the product it is — which is the case where an audit tool being
 * wrong about the lane is least recoverable and most likely to be asked about.
 */
export function isKnockoutRun(run) {
  if (!run?.runDir) return false;
  const K = koPaths(run.runDir);
  return existsSync(K.findings) || existsSync(K.plan) || existsSync(K.frame);
}

/** The assessment artifact, parsed. `null` when the run has not reached the assess stage (or it failed). */
export function knockoutDoc(run) {
  return run?.runDir ? readJson(koPaths(run.runDir).findings) : null;
}

const marksOf = (doc) => (Array.isArray(doc?.marks) ? doc.marks : []);

/**
 * A stated non-answer. The shape carries `available: false` AND a sentence, so a caller that reads only
 * the flag and a caller that reads only the prose both get the same fact — and neither can mistake it for
 * a search that came back empty.
 */
export function notProducedOnThisProduct(what, insteadSee) {
  return {
    available: false,
    product: "knockout",
    note: `A Knockout search does not produce ${what}. This is a statement about the product, not a result: `
      + `nothing was searched and found empty here.${insteadSee ? ` ${insteadSee}` : ""}`,
  };
}

// ── artifacts ────────────────────────────────────────────────────────────────────────────────────────

/**
 * What this lane ACTUALLY writes, with its real presence — run directory and pool together.
 *
 * The old list was `artifactStatus(P)` plus every REGISTER_AXES entry appended unconditionally: eleven
 * clearance documents, every one reported `exists: false` on a product that never writes them. That is not
 * an empty result, it is eleven false negatives, and it is what a reader was shown before concluding the
 * pipeline had a data-integrity gap.
 */
export function knockoutArtifacts(run) {
  const K = koPaths(run.runDir);
  const out = [
    { name: "frame", file: basename(K.frame), path: K.frame },
    { name: "plan", file: basename(K.plan), path: K.plan },
    { name: "findings", file: basename(K.findings), path: K.findings },
    { name: "assessment", file: basename(K.assessment), path: K.assessment },
    { name: "registerCounts", file: basename(K.registerCounts), path: K.registerCounts },
    { name: "registerRecords", file: basename(K.registerRecords), path: K.registerRecords },
    { name: "sweepLedger", file: basename(K.sweepLedger), path: K.sweepLedger },
    { name: "runLog", file: "run.jsonl", path: driverDir(run.runDir, "run.jsonl") },
  ].map((a) => ({ name: a.name, file: a.file, exists: existsSync(a.path) }));

  // The published half. A knockout's report lives in the pool and NOWHERE in the run dir, so a list built
  // from the run dir alone reports a delivered report as missing — the exact reading that made
  // `read_artifact report` say `exists: false` about a file on disk.
  for (const [name, file] of publishedFiles(run)) out.push({ name, file, exists: true });

  // The research payloads, one per mark, named so a reader can ask for one by name.
  for (const f of listDir(join(run.runDir, "research"))) {
    if (f.endsWith(".md")) out.push({ name: `research:${f.replace(/\.md$/, "")}`, file: f, exists: true });
  }
  return out;
}

const listDir = (d) => { try { return readdirSync(d); } catch { return []; } };

/** The pool-side documents this run actually published, as [name, file] pairs. Empty before delivery. */
function publishedFiles(run) {
  const out = [];
  if (!run?.poolDir) return out;
  for (const f of listDir(run.poolDir)) {
    if (f === "report.md") out.push(["report", f]);
    else if (f === "report.html") out.push(["reportHtml", f]);
    else if (/^report-data(-.+)?\.json$/.test(f)) out.push([f === "report-data.json" ? "reportData" : `reportData:${f.slice(12, -5)}`, f]);
    else if (/^report-.+\.html$/.test(f)) out.push([`reportHtml:${f.slice(7, -5)}`, f]);
    else if (/^knockout-audit-.+\.xlsx$/.test(f)) out.push(["auditWorkbook", f]);
  }
  return out;
}

/**
 * Resolve a knockout artifact name to a path. Pool first for the published names, because those are the
 * ones a reader asks for by name and the ones that are NOT in the run dir.
 */
export function knockoutArtifactPath(run, name) {
  const K = koPaths(run.runDir);
  const direct = {
    frame: K.frame, plan: K.plan, findings: K.findings, assessment: K.assessment,
    registerCounts: K.registerCounts, registerRecords: K.registerRecords,
    sweepLedger: K.sweepLedger, "run.jsonl": driverDir(run.runDir, "run.jsonl"),
  }[name];
  if (direct) return direct;
  if (name?.startsWith("research:")) return K.research(name.slice("research:".length));
  const published = publishedFiles(run).find(([n]) => n === name);
  if (published && run.poolDir) return join(run.poolDir, published[1]);
  return null;
}

// ── findings ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The run's findings, in `filterFindings`' shape ({ source, kind, items }).
 *
 * `kind: "audit"` has NO knockout equivalent and says so. The clearance lane's audit trail is a per-finding
 * rationale spine; this lane's deeper record is the audit workbook, which is a spreadsheet and not a thing
 * this tool can hand back as rows. Returning `[]` there would report "the audit trail is empty" about a
 * product that keeps its audit trail somewhere else.
 */
export function knockoutFindings(run, { kind, sourceLayer } = {}) {
  const doc = knockoutDoc(run);
  if (!doc) return { ...notProducedOnThisProduct("an assessment artifact yet", "This run has not completed its assess stage."), kind: kind ?? "findings", items: [] };

  if (kind === "audit") {
    return {
      ...notProducedOnThisProduct("a per-finding audit-trail spine",
        "Its deeper record is the audit workbook published beside the report (read_artifact auditWorkbook names the file); the reasoning behind each band is on the finding itself, in `basis`."),
      kind: "audit", items: [],
    };
  }
  if (kind === "negatives") return { source: "knockout-findings.json", kind: "negatives", items: knockoutNegatives(doc) };

  const items = [];
  for (const m of marksOf(doc)) {
    for (const f of (Array.isArray(m.findings) ? m.findings : [])) {
      items.push({
        id: `${m.name} #${f.ordinal}`, mark: m.name, ordinal: f.ordinal,
        name: f.name, owner: f.owner ?? null, band: f.band ?? null, type: f.type ?? null,
        net: f.net ?? null, basis: f.basis ?? null, evidence: f.evidence ?? [],
        source_layer: sourceLayerOf(f),
      });
    }
    // The promoted register filings the rater READ. They are findings a reader asks about by name, and
    // omitting them here would make this tool disagree with the report, which prints them as cards.
    for (const r of (Array.isArray(m.registerReads) ? m.registerReads : [])) {
      items.push({
        id: `${m.name} ${r.recordId}`, mark: m.name, ordinal: null,
        name: null, owner: null, band: r.band ?? null, type: "Register filing",
        net: r.read ?? null, basis: r.read ?? null, evidence: [], recordId: r.recordId ?? null,
        source_layer: "Register",
      });
    }
  }
  const filtered = sourceLayer
    ? items.filter((f) => String(f.source_layer ?? "").toLowerCase() === String(sourceLayer).toLowerCase())
    : items;
  return { source: "knockout-findings.json", kind: kind ?? "findings", items: filtered };
}

// A finding that reasoned from a fetched filing carries `weighedFilings`; everything else on this lane
// came off the marketplace/common-law sweep. Derived from the record, never from a word the seat typed.
const sourceLayerOf = (f) =>
  (Array.isArray(f?.weighedFilings) && f.weighedFilings.length) ? "Register" : "Common-law";

const knockoutNegatives = (doc) => marksOf(doc).flatMap((m) =>
  (Array.isArray(m.negatives) ? m.negatives : []).map((n, i) => ({
    id: `${m.name} NR#${i + 1}`, mark: m.name,
    term: n?.term ?? null, source: n?.source ?? null, note: n?.note ?? null,
  })));

// ── evidence ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The records this search considered, in `evidenceRecords`' shape ({ source, records }).
 *
 * Two layers, from two stores: the register filings the run FETCHED (`_driver/register-records.json` — the
 * driver's own measurement, not a model's) and the common-law uses the assessment cited.
 */
export function knockoutEvidence(run) {
  const doc = knockoutDoc(run);
  const recordsDoc = readJson(koPaths(run.runDir).registerRecords);
  // EACH FILING ADDRESSED AS PUBLISH ADDRESSES IT, keyed on the sidecar's own register. On a register with
  // no record pages of its own, the listing's link is the engine's handle, `/mark/<office>/<id>`, which a
  // reader can open nowhere, and the report never shows it for a filing with an office number: it gives the
  // office's own page, or the office and the number and why that is not a link. This view states the same,
  // from the same function over the same sidecar, so the connector and the report cannot give one filing
  // two links. On any other register the call sets nothing, and every row is exactly as it was.
  if (Array.isArray(recordsDoc?.marks)) addressListedFilings(recordsDoc, declaredRecordOrigins(recordsDoc?.provider));
  const out = [];

  for (const entry of (Array.isArray(recordsDoc?.marks) ? recordsDoc.marks : [])) {
    for (const r of (Array.isArray(entry.records) ? entry.records : [])) {
      // report-data.json's own field for the same filing, in its shape.
      const office = r.officeLink ? { label: r.officeLink.label, href: r.officeLink.href, reason: r.officeLink.reason } : null;
      out.push({
        layer: "register", mark: r.mark ?? entry.name ?? null, owner: r.owner ?? null,
        country: r.territory ?? null, classes: r.classes ?? [], status: r.status ?? null,
        // The source link: the office's page where the filing has one, none where it is cited by number,
        // and the listing's own link only for a filing publish did not address.
        url: office ? office.href : (r.url ?? null), recordId: r.recordId ?? null,
        ...(office ? { officeRecord: office } : {}),
        matchedForm: r.matchedForm ?? null, matchedBasis: r.matchedBasis ?? null,
        // `retrieved` is what the provider actually returned for this row, and it is a FACT about the
        // fetch rather than about the filing. A reader deciding how much weight to give a row needs it.
        retrieved: true, superseded: false, source: "register-records.json",
      });
    }
  }
  for (const m of marksOf(doc)) {
    for (const f of (Array.isArray(m.findings) ? m.findings : [])) {
      for (const u of (Array.isArray(f.evidence) ? f.evidence : [])) {
        out.push({
          layer: "common-law", mark: m.name, owner: f.owner ?? null, country: null, classes: [],
          status: null, url: u, name: f.name ?? null,
          retrieved: true, superseded: false, source: "knockout-findings.json",
        });
      }
    }
  }
  const source = [recordsDoc ? "register-records.json" : null, doc ? "knockout-findings.json" : null]
    .filter(Boolean).join(" + ") || "none";
  return { source, records: out };
}

// ── the search log ───────────────────────────────────────────────────────────────────────────────────

/**
 * The defensibility record, in `searchLog`'s shape ({ count, searches }).
 *
 * `list_searches` is documented as "proof of where the search looked and found nothing", and on every
 * knockout we sell it returned zero — while the proof sat in `negatives` inside knockout-findings.json.
 * That is the single most quotable line of this issue: if a client challenged a knockout result, the
 * product could not produce its own proof of search.
 */
export function knockoutSearches(run) {
  const doc = knockoutDoc(run);
  const searches = [];

  for (const m of marksOf(doc)) {
    // The term the sweep actually ran for this mark. One row per mark, always — a mark that was swept and
    // surfaced nothing is the row a defensibility question is ABOUT.
    searches.push({
      id: `${m.name} S#1`, term: m.name, mark: m.name,
      classes: m.classesSearched ?? [], jurisdictions: [], office: null,
      matchShapes: ["exact"],
      outcome: (Array.isArray(m.findings) && m.findings.length) ? "found" : "no-hit",
      note: m.degraded ? "Research payload unavailable for this mark — rated as degraded." : null,
      source: "knockout-findings.json",
    });
    for (const [i, n] of (Array.isArray(m.negatives) ? m.negatives : []).entries()) {
      searches.push({
        id: `${m.name} NR#${i + 1}`, term: n?.term ?? null, mark: m.name,
        classes: m.classesSearched ?? [], jurisdictions: [], office: null, matchShapes: ["exact"],
        outcome: "no-hit", note: n?.note ?? null, source: n?.source ?? "knockout-findings.json",
      });
    }
  }
  // The register lane's own asked-and-unanswered terms, when it ran. `terms[].ok === false` is a search
  // that did NOT answer — reporting it as a clean no-hit would be the un-run check dressed as a negative.
  const recordsDoc = readJson(koPaths(run.runDir).registerRecords);
  for (const entry of (Array.isArray(recordsDoc?.marks) ? recordsDoc.marks : [])) {
    for (const t of (Array.isArray(entry.terms) ? entry.terms : [])) {
      searches.push({
        id: `${entry.name} REG:${t.term}`, term: t.term, mark: entry.name,
        classes: entry.classes ?? [], jurisdictions: [], office: recordsDoc.providerLabel ?? recordsDoc.provider ?? null,
        matchShapes: [t.basis ?? "exact"],
        outcome: t.ok === false ? "recorded" : "found",
        note: t.ok === false ? `This search did not answer: ${t.reason ?? "no reason recorded"}` : null,
        source: "register-records.json",
      });
    }
  }
  return { count: searches.length, searches, source: doc ? "knockout-findings.json" : "none" };
}

// ── coverage ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * What the search covered, in `coverageStatement`'s shape ({ areas, note }).
 *
 * A knockout keeps no coverage LEDGER — that artifact is the clearance lane's, and saying "this run
 * records no coverage ledger" was true and useless. What it does hold is a per-mark record of what was
 * swept and what the register lane did, and that is what an area is here.
 */
export function knockoutCoverage(run) {
  const doc = knockoutDoc(run);
  if (!doc) {
    return {
      ...notProducedOnThisProduct("a coverage statement before its assess stage completes"),
      areas: [],
    };
  }
  const areas = marksOf(doc).map((m) => ({
    area: `${m.name} — common-law and marketplace sweep`,
    state: m.degraded ? "Partially covered" : "Searched",
    // NEVER "clean". This lane's own doctrine: a mark this screen did not knock out is not knocked out at
    // the configured depth — a result about the SCREEN, not about the mark.
    detail: m.degraded
      ? "Research could not be completed for this name; the rating reflects an analytical assessment pending fuller data."
      : `Screened at the configured depth${(m.classesSearched ?? []).length ? ` in classes ${m.classesSearched.join(", ")}` : ""}. `
        + `${(m.findings ?? []).length} conflict(s) recorded, ${(m.negatives ?? []).length} search(es) recorded as returning nothing.`,
  }));

  const recordsDoc = readJson(koPaths(run.runDir).registerRecords);
  const countsDoc = readJson(koPaths(run.runDir).registerCounts);
  if (recordsDoc || countsDoc) {
    areas.push({
      area: "Register",
      state: recordsDoc?.unavailable ? "Open item" : "Searched",
      detail: recordsDoc?.unavailable
        ? String(recordsDoc.unavailable)
        : "Filings were fetched and counted for the searched names; the filings themselves are in list_evidence.",
    });
  } else {
    areas.push({
      area: "Register",
      state: "Not run this run",
      detail: "This run has no register component — the assessment rests on the common-law and marketplace sweep.",
    });
  }
  return {
    areas,
    note: "A Knockout search screens; it does not enumerate. An area marked Searched means it was screened "
      + "at the configured depth and nothing blocking surfaced there — never that the name is clear.",
    source: "knockout-findings.json",
  };
}

// ── trace ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stages this lane runs, in pipeline order. `trace`'s table is the clearance STAGE_ORDER, so its error
 * enumerated fifteen stages and none of them was a knockout stage — the tool could resolve nothing on this
 * product, including the word "verdict".
 *
 * `knockout-assess` is chunked (`knockout-assess#N`), so a caller may name the bare stage or one chunk.
 */
export const KNOCKOUT_STAGES = ["knockout-frame", "knockout-sweep", "knockout-register", "knockout-assess"];

export function knockoutStageFor(target) {
  const t = String(target ?? "").trim();
  const bare = t.split("#")[0];
  return KNOCKOUT_STAGES.includes(bare) ? t : null;
}

/**
 * `trace` for this lane — HOW the run reached its answer, from the run's own event log.
 *
 * Deliberately NOT threaded through the clearance trace's walk. That walk is built on `paths()`, the
 * register axes and the clearance findings spine; teaching it a second lane would put a knockout branch in
 * every one of its enrichments, and the clearance trace is the surface that currently works. This answers
 * the same question off the artifacts this product actually writes.
 *
 * `events` is the caller's already-read run log, passed in so this module never re-reads it.
 */
export function traceKnockout(run, target, events = []) {
  const t = String(target ?? "").trim();
  const doc = knockoutDoc(run);
  const verdict = () => ({
    kind: "verdict",
    verdict: doc?.batch?.overall ?? runVerdictFromEvents(events) ?? null,
    marks: marksOf(doc).map((m) => ({ mark: m.name, band: m.rating ?? null, basis: m.basis ?? null })),
    note: "A Knockout verdict is the batch's worst band across its marks; each mark's own band and the "
      + "one-sentence ground for it are listed here.",
  });

  if (!t || /^verdict$/i.test(t)) return { runId: run.runId, target: t || "verdict", ...verdict() };

  const stage = knockoutStageFor(t);
  if (stage) {
    const bare = stage.split("#")[0];
    const rows = events.filter((e) => String(e.stage ?? "").split("#")[0] === bare
      || String(e.event ?? "").startsWith(bare));
    return {
      runId: run.runId, target: t, kind: "stage", stage,
      events: rows,
      // What the stage wrote, by presence — the honest answer to "did this stage produce anything".
      produced: knockoutArtifacts(run).filter((a) => a.exists && STAGE_OUTPUTS[bare]?.includes(a.name)),
      note: STAGE_NOTES[bare] ?? null,
    };
  }

  // A mark or an owner named directly — the fuzzy target the clearance trace also supports.
  const hit = marksOf(doc).find((m) => String(m.name ?? "").toLowerCase().includes(t.toLowerCase()));
  if (hit) {
    return {
      runId: run.runId, target: t, kind: "mark", mark: hit.name, band: hit.rating ?? null,
      basis: hit.basis ?? null, factors: hit.factors ?? [], counterFactors: hit.counterFactors ?? [],
      findings: (hit.findings ?? []).map((f) => ({ ordinal: f.ordinal, name: f.name, band: f.band, evidence: f.evidence ?? [] })),
      registerReads: hit.registerReads ?? [],
      note: "The band, the one-sentence ground for it, and the observations it rests on.",
    };
  }

  return {
    runId: run.runId, target: t,
    error: `Could not resolve target "${t}" on this Knockout search. Try a stage (${KNOCKOUT_STAGES.join(", ")}), `
      + `a mark name, an artifact (${knockoutArtifacts(run).filter((a) => a.exists).map((a) => a.name).join(", ")}), or "verdict".`,
  };
}

// Which artifacts each stage is responsible for — used to answer "did it produce anything" by presence
// rather than by trusting a completion event, which is written before the file is fsynced.
const STAGE_OUTPUTS = {
  "knockout-frame": ["frame", "plan"],
  "knockout-sweep": ["sweepLedger"],
  "knockout-register": ["registerCounts", "registerRecords"],
  "knockout-assess": ["findings", "assessment"],
};

const STAGE_NOTES = {
  "knockout-frame": "Reads the order and writes the plan: which names, which classes, at what depth.",
  "knockout-sweep": "One research call per mark against the marketplace/common-law provider; the payloads land in research/.",
  "knockout-register": "Fetches and counts register filings for the searched names. Absent on a run with no register component.",
  "knockout-assess": "Rates each mark from its own payload and the fetched filings, and writes knockout-findings.json.",
};

const runVerdictFromEvents = (events) =>
  [...events].reverse().find((e) => e.event === "verdict")?.verdict ?? null;
