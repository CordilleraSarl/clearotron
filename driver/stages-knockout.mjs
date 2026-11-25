// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// stages-knockout.mjs — the KNOCKOUT (Depth 1) lane's stage table, paths, sweep prompt and status steps.
// Same def shape as stages.mjs STAGES ({model, thinking, timeoutSec, stallSec, out, validate, message}),
// kept in its OWN table: the knockout lane is a different product shape (a 5–15 mark triage batch), and
// its stages must never leak into the clearance STAGE_ORDER. New-named stages get [] MCP tool groups
// automatically (gather-config prefix map — the matter-frame precedent), so frame/assess run lean.
import { paths } from "./run-record.mjs";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //
import { validators as koValidators, registerLaneState, PERMITTED_SOURCES, useOf, FAMILIES_RULE, FRAME_REPAIR_RULE } from "./verify-knockout.mjs";
import { kebab, PRODUCT_POLICIES } from "./search-policy.mjs";
// — the door owns "did the request name any classes?"; this builder reads it rather than
// re-deriving it. A third copy is what put the knockout frame a class behind the intake.
import { requestNamesClasses } from "./enqueue-schema.mjs";
import { knockoutAssessChunkFile } from "./knockout-assess-record.mjs";
import { chunkScope, knockoutCorrectionFile, sameFinding, validateKnockoutCorrectionFile } from "./knockout-correction-record.mjs";
import { FROZEN_METHOD_FILE, methodDictation, inputsShape } from "./framework-method.mjs";
import { knockoutReviewFile, validateKnockoutReviewFile } from "./knockout-review-record.mjs";
import { knockoutRegisterChunkFile, knockoutRegisterFile, validateKnockoutRegisterFile } from "./knockout-register-record.mjs";
import { narrowingOrderLine } from "./effective-scope.mjs";
import { REVIEW_APPLIES_THE_SUPPLIED_FRAMEWORK } from "./stages.mjs";
import { declaredValidator } from "./stage-declarations.mjs";
import { defectEvidence } from "./ko-review-evidence.mjs";   // each stage's validator, by the name its declaration gives

// The Knockout's validators by the names its stages declare: the lane's own table, and the three records' own checks.
const KO_VALIDATORS = { ...koValidators, validateKnockoutRegisterFile, validateKnockoutReviewFile, validateKnockoutCorrectionFile };
export { kebab };   // one definition (search-policy) — re-exported for the lane's existing imports

const lines = (...xs) => xs.filter(Boolean).join("\n");
const reads = (skillReads) => `First, read and follow exactly: ${skillReads.join(", ")}.`;

/**
 * One line per owner the driver looked up, for the assess dispatch.
 *
 * BOTH OUTCOMES ARE NAMED, and that is the point. A row whose search answered gets its payload path; a
 * row whose search did NOT answer says so in the dispatch itself. Listing only the answered ones would
 * leave the seat unable to tell "nobody searched this owner" from "the search found nothing", and those
 * two license completely different reads — the second is a fact about the owner's visibility, the first
 * is a gap the seat would fill by inferring from the name, which is the defect this whole issue is about.
 *
 * Returns [] when the lane did not run or the store is unreadable, so the dispatch simply omits the block
 * rather than naming a path that is not there.
 */
export function ownerCheckLines(K, names = null) {
  let doc = null;
  try { doc = existsSync(K.ownerChecks) ? JSON.parse(readFileSync(K.ownerChecks, "utf8")) : null; } catch { doc = null; }
  // A name's rating reads the checks made for its own filings (`names`; every check when null). Another business that bears on it
  // arrives with the earlier rights handed across the order, with its checks.
  const want = names ? new Set(names.map((n) => String(n).trim().toLowerCase())) : null;
  const mine = (Array.isArray(doc?.checks) ? doc.checks : []).filter((c) => !want || want.has(String(c?.mark ?? "").trim().toLowerCase()));
  // A family reads an identical question's answer once.
  const asked = new Set();
  const checks = names && names.length > 1 ? mine.filter((c) => !c?.query || (!asked.has(c.query) && asked.add(c.query))) : mine;
  return checks.map((c) => {
    // The owner is named with the filing marks it holds, never with the name screened.
    const marks = (Array.isArray(c.filingMarks) ? c.filingMarks : []).map((f) => `"${f.mark}"`);
    const joined = marks.length > 1 ? `${marks.slice(0, -1).join(", ")} and ${marks.at(-1)}` : marks[0];
    const who = joined ? `${c.owner} (proprietor of the filings for ${joined})` : c.owner;
    // A row with no answer on disk is a lookup that did not answer — failed, empty, or unsaved — and the
    // line says exactly that. "Returned nothing" read as a search that ran and found nothing, which is the
    // other fact the comment above keeps apart, and the seat wrote it into the read as one.
    return c.ok && c.payloadFile
      ? `- ${who}: ${join(K.runDir, "research", c.payloadFile)}`
      : `- ${who}: THE SEARCH DID NOT ANSWER. Say so in the read; do not infer the trade from the name.`;
  });
}

// ── Paths (knockout-own; beside the standard _driver sidecars) ───────────────────────────────────────
export function koPaths(runDir) {
  return {
    runDir,
    frame: join(runDir, "knockout-frame.md"),
    plan: join(runDir, "knockout-plan.json"),
    findings: join(runDir, "knockout-findings.json"),
    assessment: join(runDir, "knockout-assessment.md"),
    // The reviewing pass's record of what it rewrote and what it let stand. At the RUN ROOT, like the
    // assess chunks and for the same reason: it is a model output, and `_driver/` is behind a deny hook.
    review: knockoutReviewFile(runDir),
    // Depth 2: the code-authoritative count sidecar + its per-call receipts. Both live under
    // _driver/ — they are the driver's own measurements, never a model's output.
    registerCounts: paths(runDir).registerCounts,
    countLedger: paths(runDir).registerCount,
    // part 5 — the filings behind the narrow counts, beside the counts they explain. Because the
    // MCP server serves run artifacts generically, landing it here makes the filings queryable over MCP
    // with no MCP-side work at all. Its receipts ride the count lane's ledger file and are the ONLY
    // lines there carrying `stage: "records"` — so one file answers "what did this run's register lane
    // cost", and the two lanes are told apart by a key the older lines simply do not have. The count
    // rows were left exactly as they were rather than gaining a matching marker: their shape is pinned
    // byte-for-byte by register-count.test.mjs, and a discriminator only one side needs is enough.
    registerRecords: paths(runDir).registerRecords,
    // A RATING GROUP'S SHARE OF THOSE FILINGS, where a batch is rated in groups: the held filings of the group's own names, so each
    // group reads its names' filings rather than the whole batch's. The driver's own slice of its own record, so under `_driver/`.
    groupRegisterRecords: (chunkNo) => driverDir(runDir, `register-records.group-${chunkNo}.json`),
    // THE READING STEP'S RECORD, a model output and so at the run root: what it carried forward, set aside and did not
    // ask. The questions and their rows are the register tool's, in the bands under `register-units/`.
    registerReading: knockoutRegisterFile(runDir),
    inboundRequest: paths(runDir).inboundRequest,
    // The scoped owner lookups this run owes its promoted filings, and their receipts. Both under `_driver/` because both are the DRIVER's own measurement of a call it made — the
    // rule stated fourteen lines above. The seat reads the payloads under research/, never these.
    ownerChecks: paths(runDir).ownerChecks,
    ownerCheckLedger: paths(runDir).ownerCheck,
    researchDir: join(runDir, "research"),
    research: (markKebab) => join(runDir, "research", `${markKebab}.md`),
    sweepLedger: paths(runDir).knockoutSweep,
    // What each web call returned, verbatim, one file per call: the pages a search reached, which the ledger
    // above and the payload under research/ do not carry. A directory, because every `_driver/*.jsonl` is
    // read as a stage log. The driver's own record of a call it made, so under `_driver/`.
    webResults: (name) => driverDir(runDir, "web-results", `${name}.json`),
    // That SHAPE, APPLIED: the WORK MOVES OUT OF THE GUARDED TREE — the hook is never weakened.
    //
    // This chunk is a MODEL OUTPUT, and it sat under `_driver/` in flat contradiction of the rule stated
    // fourteen lines above: those files "are the driver's own measurements, NEVER a model's output". So
    // relocation is not a workaround for the boundary; it is this module finally obeying its own doctrine.
    //
    // WHY IT ONLY FAILED NOW, which is the part worth keeping. E13 has denied Write/Edit under `_driver/`
    // since 2026-08-14, and seats complied anyway by shelling out — Bash redirects wrote the file the Write
    // tool refused. closed that bypass on 2026-08-16, and knockout-assess broke the same day: the seat
    // was refused on Write AND on Bash, all three attempts, and the corrective ladder exhausted against a
    // stage ordering it to write somewhere nothing would let it. THE BYPASS WAS LOAD-BEARING AND NOBODY
    // KNEW — a run delivered two days earlier only because the workaround still worked.
    //
    // Measured blast radius, both directions independently: six `_driver` constructions in this module and
    // exactly one of them is a stage's `out:`; zero in stages.mjs (all 19 messages composed — four name a
    // `_driver/` path and every one is a READ, checked in context, not by keyword).
    // DELEGATED, not re-spelled. This PR introduced a second constructor for this exact path in
    // `knockout-assess-record.mjs` (the transport now writes the file the seat used to), and two
    // independent constructions of one path is a write-path/read-path split waiting to happen: the
    // driver would write where the pipeline does not read and every arm on both sides would stay green.
    // One producer, imported.
    assessChunk: (n) => knockoutAssessChunkFile(runDir, n),
    instructedScope: paths(runDir).instructedScope,
    // The client's own words, written at intake as on the clearance lane (stages.mjs, the same two names).
    confirmationBrief: paths(runDir).confirmationBrief,
    // as on the clearance lane, and apart from instructed-scope.json for the same reason: the frame
    // quotes that file's values verbatim. Written at intake, read by no stage.
    defaultTerritories: paths(runDir).defaultTerritories,
    emailBody: paths(runDir).emailBody,
  };
}


// ── THE WEB SEARCH IS A GRID, AND IT RETURNS RESULTS (owner's ruling, 2026-09-25) ────────────────────
//
// The web half asked two summarising questions per mark, and each answer was the provider's own short
// write-up of what it found. Measured in testing, 2026-09-25: a store listing that one plain query returns
// reached the rating step in 9 of 11 runs, and a character's fan-wiki page in none, because the write-up
// decided what the rating step ever saw. Judgment is the rating step's, so the search now returns results
// and nothing else: every spelling the frame names for a mark, searched once on every place it names for
// the batch, through the clearance grid's own program path, with every result kept.
//
// THE REGISTER RULE LEFT WITH THE QUESTIONS. The paragraph telling the web search to say nothing about the
// registers was there because its answer landed in the research file as prose. A grid writes no prose, and
// the rating step keeps its own rule, where the report is composed.
//
// THE SETTINGS ARE PINNED, never read from the environment: the preset the grid path runs on, its
// reasoning raised from that preset's `minimal` through the vendor's documented override (measured
// 2026-09-25: the response echoes it back beside the search program), and, from the product's own row
// (search-policy.mjs PRODUCT_POLICIES), the results each cell asks for and keeps and the tier the owner
// lookups ask on.
const KO_WEB_ROW = PRODUCT_POLICIES["knockout-search"].web;
export const KNOCKOUT_WEB = Object.freeze({ preset: "pro-search", reasoning: Object.freeze({ effort: "low" }),
  resultsPerCell: KO_WEB_ROW.resultsPerCell, questionPreset: KO_WEB_ROW.questionPreset });

/**
 * The minutes a knockout is meant to come in under — the owner's bar, named in ruling 570 (2026-09-26).
 *
 * IT IS RECORDED AND DECIDES NOTHING. Nothing reads it to park a mark, trim a grid, skip a place or end a
 * sweep: the sweep writes its cells and its wall minutes beside this number so a run can be read against
 * the bar afterwards, and that is the whole of its job. A number that decided anything here would be the
 * kind of fixed stop the search design removes, and the frame's judgment about places (task 2d) is
 * deliberately not bounded by it.
 */
export const KNOCKOUT_MINUTES_BAR = 10;

/**
 * The bar's verdict for one run, from the run's own two timestamps. PURE, and it lives beside the constant
 * so the comparison and the number it compares against cannot drift apart.
 *
 * AN UNREADABLE OR ABSENT START IS NOT "UNDER THE BAR". `runMinutes` and `overBar` are both null then, and
 * `barNotMeasured` says why — a run whose span could not be read must not record a verdict that reads as a
 * pass. That is the whole reason this returns three fields rather than a boolean.
 *
 * @param {{startedAt?: string|null, deliveredAt?: string|null}} span the run's own ISO timestamps
 */
export function knockoutBarVerdict({ startedAt = null, deliveredAt = null } = {}) {
  const a = startedAt ? Date.parse(startedAt) : NaN;
  const b = deliveredAt ? Date.parse(deliveredAt) : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a)
    return { runMinutes: null, overBar: null,
      barNotMeasured: !Number.isFinite(a) ? "the run's own startedAt could not be read"
        : !Number.isFinite(b) ? "the run has no delivery time to measure to"
        : "the run's delivery time is before its start" };
  const runMinutes = Number(((b - a) / 60000).toFixed(1));
  return { runMinutes, overBar: runMinutes > KNOCKOUT_MINUTES_BAR };
}

/** The line a stage is told about the client's own request: the message as it came where it is on file, else the brief, which is never called the request, else nothing. */
/** The lines that say what this run's files establish about its register, where it holds no record of filings to weigh. */
function registerStateLine(K) {
  const lane = registerLaneState(K.runDir);
  if (lane.state === "skipped") return `The register component was skipped on this run, so it holds no filings.`;
  // THE REPORT STATES COVERAGE, NOT THE RATER (design, 2026-11-24). The unavailable state can arise from a counts file alone, so the
  // line names no cause; the counts and any recorded reason reach the report from code.
  if (lane.state === "unavailable") return `No register listing is available to this assessment. Weigh the evidence supplied. The report states what the register covered.`;
  if (lane.state === "unknown") return `The saved material does not establish whether the register search ran. Weigh the evidence supplied. The report states what the register covered.`;
  return "";
}
const registerRecordHeld = (K) => registerLaneState(K.runDir).state === "held";

/** The held-filings record cut to the named marks, every other field as held. PURE. */
export function groupRecordsDoc(doc, names) {
  const want = new Set([...names].map((n) => String(n).trim().toLowerCase()));
  return { ...doc, marks: (Array.isArray(doc?.marks) ? doc.marks : []).filter((m) => want.has(String(m?.name ?? "").trim().toLowerCase())) };
}

// A FAMILY'S FILINGS HELD ONCE BY RECORD ID. A filing listed under several
// names of a family is written once under `filings`, with every field all its listings share; each name keeps its own links, in its own
// order and its own list (carried or set aside), with whatever differs for that name: the reason it was carried, the question that
// returned it, the spelling it matched. expandFilingsOnce gives back the per-name record exactly, and a group's file uses the compact
// form only where that holds (pipeline-knockout). PURE.
const LINK_LISTS = ["records", "setAsideRecords"];
export function filingsOnce(doc) {
  const seen = new Map();   // recordId -> every listing of it
  for (const m of doc?.marks ?? []) for (const k of LINK_LISTS) for (const r of m?.[k] ?? []) {
    const id = String(r?.recordId ?? "");
    if (!seen.has(id)) seen.set(id, []);
    seen.get(id).push(r);
  }
  const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
  const filings = {};
  for (const [id, list] of seen) {
    const keys = [...new Set(list.flatMap((r) => Object.keys(r)))];
    filings[id] = Object.fromEntries(keys.filter((k) => list.every((r) => k in r && canon(r[k]) === canon(list[0][k]))).map((k) => [k, list[0][k]]));
  }
  const link = (r) => Object.fromEntries(Object.entries(r).filter(([k, v]) => k === "recordId" || !(k in filings[String(r.recordId ?? "")]) || canon(v) !== canon(filings[String(r.recordId ?? "")][k])));
  return { ...doc, form: "filings-once", filings,
    marks: (doc?.marks ?? []).map((m) => ({ ...m, ...Object.fromEntries(LINK_LISTS.filter((k) => Array.isArray(m?.[k])).map((k) => [k, m[k].map(link)])) })) };
}
export function expandFilingsOnce(compact) {
  const { form: _form, filings = {}, ...doc } = compact ?? {};
  return { ...doc, marks: (doc.marks ?? []).map((m) => ({ ...m, ...Object.fromEntries(LINK_LISTS.filter((k) => Array.isArray(m?.[k])).map((k) => [k, m[k].map((l) => ({ ...filings[String(l.recordId ?? "")], ...l }))])) })) };
}
/** Two records equal whatever their key order. PURE. */
export function sameRecord(a, b) {
  const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
  return canon(a) === canon(b);
}
// How a rating reads a family's filings-once file.
const FILINGS_ONCE_SENTENCE = `In this file each filing is held once, under \`filings\` by its recordId, with its whole record. Each name's \`records\` (carried) and \`setAsideRecords\` link to those filings by recordId, with that name's own reason, question and matched spelling.`;

// WHERE A SOURCE MAY COME FROM, in one form of words at every step: rating, correction and check.
const CITED_URL_RULE = `A cited URL must come from ${PERMITTED_SOURCES}.`;
const SIBLING_SOURCE = `When you use another name's research payload, explain how its held content bears on this name and its requested use. Keep the original search scope and provenance. A source's presence in the order does not establish that it supports the claim.`;
// The earlier rights a rating is handed from the order's other names (ko-earlier-rights.mjs), and what it says it did with each.
const EARLIER_RIGHTS_SENTENCE = (file) => `Earlier filings and market sources to consider for this name are in ${file}. Each suggested filing resembles a spelling being searched and overlaps a requested class. Read its goods, status and territory against the proposed use.`;
const EARLIER_RIGHTS_ANSWER = `For each filing, say what you concluded for this name: weigh it in a finding and list its recordId in \`weighedFilings\`, or write a \`registerReads\` row saying why it does or does not bear on this name. Where a filing or source was found is provenance only, and no reason either way.`;
// THE RATING WORKS FROM WHAT IT IS HANDED: its manuals, the customer's framework and the calibration below. A worked example is
// opened only for a calibration question that is still open, never as a collection.
const APPLY_THE_SUPPLIED_RULES = "Apply the supplied Knockout assessment rules and the customer’s risk framework to each finding. If a specific calibration question remains, consult the relevant rule or worked example for that question.";

/**
 * The calibration a rating carries from its framework's worked examples, framed for the opening message. PURE.
 *
 * THE CALIBRATION PART, NOT THE COLLECTION. The rest of a worked-examples file is written for the full clearance report: its
 * delivery prose, voice pairs and whole worked matters. Codex rating sessions opened those files whole, with the synthesis
 * rules, and got 25k to 400k characters back a session. On held inputs, Codex ratings that carried this part alone opened no
 * manual, took 50 steps where two draws of the old wording took 69 and 73, and moved no band beyond what those two draws moved
 * between themselves (measured in testing, 2026-11-24).
 *
 * A FILE WITHOUT BOTH HEADINGS HAS NO SUCH PART, and is carried whole: a calibration is never dropped. The files that lack them
 * are short. null only for an empty file.
 */
export function calibrationExcerptOf(text, ref) {
  const body = String(text ?? "").replace(/\s+$/, "");
  if (!body) return null;
  const L = body.split("\n");
  const start = L.findIndex((l) => /^## The reasoning to reproduce\b/.test(l));
  const moves = start < 0 ? -1 : L.findIndex((l, i) => i > start && /^### Two calibration moves\b/.test(l));
  if (moves < 0) return `=== MANUAL: ${ref} ===\n${body}\n=== END MANUAL: ${ref} ===`;
  let end = L.findIndex((l, i) => i > moves && /^#{1,3} /.test(l));
  if (end < 0) end = L.length;
  return `=== MANUAL EXCERPT: ${ref}, from "The reasoning to reproduce" to the end of "Two calibration moves" ===\n`
    + `${L.slice(start, end).join("\n").replace(/\s+$/, "")}\n=== END MANUAL EXCERPT ===`;
}

// A GROUP OF CLOSELY RELATED NAMES RATED IN ONE SESSION, each name with its own rating and reasons. A group of one keeps the
// one-name words, unchanged.
const FAMILY_OPENER = `You are rating a group of closely related names for a Knockout screen. Each name is a client choice and gets its own rating and reasons.`;
const FAMILY_RULE = `Read the common evidence once, and give each name its own comparison wherever its sound, appearance or a particular earlier filing changes the answer. A difference in band needs a reason grounded in the evidence. Matching bands are equally admissible. Spellings generated only to search for one name remain search terms, not names to rate.`;
const FAMILY_RIGHTS_SENTENCE = (file) => `Earlier filings and market sources to consider for these names are in ${file}, each listed under the name it is for. Each suggested filing resembles a spelling being searched and overlaps a requested class. Read its goods, status and territory against the proposed use.`;
const FAMILY_RIGHTS_ANSWER = `For each filing, say what you concluded for the name it is listed under: weigh it in a finding and list its recordId in \`weighedFilings\`, or write a \`registerReads\` row saying why it does or does not bear on that name. Where a filing or source was found is provenance only, and no reason either way.`;
// THE INTAKE GROUPS THE NAMES INTO FAMILIES, checked in code (knockout-frame-record.mjs, familiesDefect).
const FAMILIES_LINE = `Group the submitted names for the same proposed use when they share a recognisable word, phrase, stem, look or sound that could lead to the same earlier conflict. Consider each whole name and the proposed goods or services. Changes in word order, plural, ending or accompanying words can leave a family. A common descriptor, business suffix or theme alone is insufficient. Keep a short chain together when the middle name warrants both comparisons. Otherwise use the strongest direct relationship. Keep an uncertain name separate. ${FAMILIES_RULE}`;
const FAMILY_READER_OPENER = (n) => `You are reading the register for a group of ${n} names of a KNOCKOUT screen: close variations the client chose for one proposed use. Read each distinct filing once, and keep for each name its own source, goods, status, relevance and follow-up questions. Carry an uncertain filing that may matter to a rating with your reason; never drop one silently. You rate nothing; the step after you rates what you carry forward, with your reasons.`;
// THE REVIEW CHECKS FACTS AGAINST THEIR SOURCES AND THE RATINGS OF FINDINGS ON REGISTERED MARKS, and one correction answers what it
// raises. Measured in testing, 2026-11-23: of 23 review complaints on five real orders, 13 chased thin web leads and 4 were coverage
// gaps code now answers; 2 were wrong facts and 4 were findings rated too low.
const REVIEW_SCOPE = `Read the opinion summaries and their cited evidence together. For each name, check the stated use and scope, material claims against their sources, and registered findings against the filing and risk framework. Report each material defect with the affected name, claim or finding, source, and correction needed. Consult a specific held source only when the supplied evidence is insufficient to decide that point. Leave supported wording alone.`;
const CORRECTION_SCOPE = `Read the reported defect, the affected passage or finding, and its cited evidence. Correct the error and any conclusion for this name that depends on it. When the evidence leaves a material fact uncertain, state that limit.`;
// A THIN WEB LEAD GETS NO CARD, and the review does not chase one: a Knockout is a fast screen.
const THIN_LEADS = `Give a marketplace lead its own finding when the source supports a relevant commercial use. A thin unregistered mention or isolated listing with no evidence of trade does not warrant a separate finding or follow-up. When a source supports relevant trade but leaves its location or priority uncertain, describe the use and the uncertainty it actually supports.`;
const CORRECTION_OWN_REASONS = `Move a band only for a reason in this name's own goods, use, sound and the framework. Another name's band is not that reason. Where a defect rests only on a difference between names, the band stands; say why in \`why\`.`;
const EARLIER_RIGHTS_REVIEW = `EARLIER RIGHTS HANDED TO A RATING FROM ANOTHER NAME'S FILINGS. The rating of each name below was handed these filings because the saved evidence ties them to that name by resemblance and by a class asked for. Each row says whether the rating weighed it in a finding, read it with a reason, or left it unresolved.`;
const OWNER_SOURCE = `A recorded owner check linked to a held filing is held evidence. You may cite a URL in its saved answer when it supports the finding; preserve the owner and filing it belongs to.`;

const requestLine = (K, onRequest, onBrief) => (existsSync(K.inboundRequest) ? onRequest(K.inboundRequest)
  : existsSync(K.confirmationBrief) ? onBrief(K.confirmationBrief) : "");

/** The territories the request ordered, as the job carries them; empty for a worldwide screen. PURE. */
export const orderedTerritories = (job) =>
  (Array.isArray(job?.jurisdictions) ? job.jurisdictions.map((s) => String(s).trim()).filter(Boolean) : []);

/**
 * One mark's grid, dictated from the frozen plan: its spellings, with its kind of use, on the batch's
 * places. PURE.
 *
 * The spellings are the ones the plan carries: built from the name when the intake recorded it (marketSpellings), or the
 * frame's own in a plan frozen before that. The use and the places are the frame's own words, copied and never re-typed.
 * The plan's validator has already refused a plan without them, so an empty list here is a plan frozen before they
 * existed. So is a mark with no use, and its cells search the bare spelling as they did then.
 * THE USE IS THE FRAME'S JUDGMENT (ruled 2026-09-26), one phrase from the brief for the order's proposed use (design,
 * 2026-11-24): a cell searches the spelling plus that phrase, or the name's own where the client gave it a different use,
 * never a word from a list here.
 */
export function knockoutGridSpec(markRow, batch, { outputPath }) {
  // The name's own use where the client expressly gave one, else the order's (design, 2026-11-24).
  const use = useOf(markRow, batch);
  // THIS NAME'S OWN PLACES (ruling 570), falling back to the batch's for a plan frozen before the field
  // existed. The fallback is the whole of the back-compatibility: an archived plan carries one list for
  // the batch and every mark reads it, exactly as it did when it ran.
  const places = Array.isArray(markRow?.places) && markRow.places.length ? markRow.places
    : Array.isArray(batch?.places) ? batch.places : [];
  return {
    terms: [...(Array.isArray(markRow?.spellings) ? markRow.spellings : [])],
    platforms: [...places],
    ...(use ? { use } : {}),
    output_path: outputPath,
    results_per_cell: KNOCKOUT_WEB.resultsPerCell,
  };
}

// ── Assess chunking: one family per LLM turn, rated side by side; chunks merged in code (pipeline-knockout) ──
// ONE FAMILY PER RATING SESSION, and a name with no family alone: unrelated names are never pooled in one session, so each gets the
// rating it would get ordered alone. KO_ASSESS_CHUNK is the size of a family of one.
export const KO_ASSESS_CHUNK = 1;
export const koChunks = (marks, families = null) => {
  // The intake's families, in the order of their first name in the plan,
  // each family's names in plan order. A name no family places is a family of one; the intake's record has refused that already.
  if (Array.isArray(families) && families.length) {
    const key = (n) => String((typeof n === "string" ? n : n?.name) ?? "").trim().toLowerCase();
    const groups = families.map((f) => marks.filter((m) => f.some((n) => key(n) === key(m)))).filter((g) => g.length);
    const placed = new Set(groups.flat().map(key));
    const all = [...groups, ...marks.filter((m) => !placed.has(key(m))).map((m) => [m])];
    const at = (g) => marks.indexOf(g[0]);
    return all.sort((a, b) => at(a) - at(b));
  }
  const out = [];
  for (let i = 0; i < marks.length; i += KO_ASSESS_CHUNK) out.push(marks.slice(i, i + KO_ASSESS_CHUNK));
  return out;
};

// ── Status stepper (knockout drives writeRunStatus directly — never seedRunStatus's 9-step flow) ─────
//
// The steps a PLAIN knockout walks. Depth 2 inserts one more (below), so the lane addresses its
// steps BY LABEL rather than by index — a Depth 2 run's "Report & publish" is step 5 while a plain
// knockout's is step 4, and a hardcoded 3 would silently mislabel every screen the client watches.
export const KO_STEPS = [
  "Framing the batch",        // 1
  "Sweeping marks",           // 2
  "Knockout assessment",      // 3
  "Report & publish",         // 4
  "Sending to you",           // 5
];

// Depth 2's own step. It sits AFTER the frame (the counts are scoped by the frame's per-mark
// classes) and BEFORE the sweep, so the cheap deterministic question is answered before the batch
// spends anything on research.
export const KO_STEP_REGISTER_COUNT = "Counting register filings";

/** The step labels this run will actually walk, in order. stepTotal comes from THIS list. */
export function koSteps({ registerProbe = false } = {}) {
  if (!registerProbe) return [...KO_STEPS];
  return [KO_STEPS[0], KO_STEP_REGISTER_COUNT, ...KO_STEPS.slice(1)];
}

// ── Stage defs ───────────────────────────────────────────────────────────────────────────────────────
// ── WHAT EACH STAGE READS, SO A RESUME CAN TELL WHETHER ITS OUTPUT STILL STANDS ─────────────────────────────────
//
// A Knockout stage reuses its output only while what it read is unchanged, as a clearance stage does (stage-freshness.mjs).
// `reads` names the files a stage reads, read off its message: the files the message names, and the frozen files it
// rates or frames under. `dirs` are folders it may read any file of, recorded as the files they hold, so a research
// payload added or removed is a change. `message: true` records the message itself, which carries what the order and
// the frozen profile said in their own words (goods, instructions, territories, the profile's industry and classes),
// and the lines a review is given. The correction does not record its message: it is composed from the
// chunk the correction rewrites, so it would read the correction's own edit as a change. What it was based on is in the
// correction work, which holds the rated record and every defect, and in the first review.
//
// A stage that rates, reviews or corrects also reads the framework: its band words and order (`framework.json`) and its
// method (`framework-method.json`), both frozen with the run, and its deck, the prose the model reasons with. `deck: true`
// records the deck as the file the model is sent to, from the layer in force (pipeline-knockout.mjs koReadsNow).
const asRequested = (K) => [K.inboundRequest, K.confirmationBrief];
const frozenRules = (K) => [paths(K.runDir).profile, paths(K.runDir).framework, driverDir(K.runDir, FROZEN_METHOD_FILE)];

export const KO_STAGES = {
  "knockout-frame": {
    // THE FAST TIER AT LOW EFFORT reads the brief and groups the names (design, 2026-11-23); the judgment tier rates.
    model: "haiku", thinking: "low", timeoutSec: 420, stallSec: 300,
    skillReads: ["skills/knockout-frame/SKILL.md"],
    out: (K) => K.plan,
    validate: declaredValidator("knockout-frame", KO_VALIDATORS),
    reads: (K) => ({ files: [K.instructedScope, ...asRequested(K), paths(K.runDir).profile], message: true }),
    message: ({ K, job, profile }) => lines(
      reads(["skills/knockout-frame/SKILL.md"]),
      // ── NO DEPTH NUMBER ──────────────────────────────────────────────────────
      //
      // This read "(Depth 1 triage)". Depth is a rung on a ladder the offering retired, and the seat's
      // own doctrine — the file it is told to read on the line above — mentions Depth zero times. So
      // line 2 handed the model a product name line 1's authority does not contain, and left it to
      // decide what it meant.
      //
      // The rule already existed and had been applied to the surface a CLIENT reads and not to this
      // one: render-knockout.mjs says a depth number "is a rung on a ladder the offering no longer has,
      // and it must not appear on a client's page." If it is meaningless to a reader holding the
      // report, it is worse than meaningless to a seat being told what job it is doing.
      //
      // `RETIRED_POLICIES` keeps "Depth 1" deliberately, so an archived run re-renders under the name it
      // was sold under. That is a rendering concession for old artifacts, not live vocabulary.
      `You are framing a KNOCKOUT SEARCH order — a triage pass. You frame, you do NOT search.`,
      `The instructed scope (AUTHORITATIVE — quote mark names verbatim from it): ${K.instructedScope}`,
      // THE REQUEST LEADS. The structured brief can hold no goods at all while the client's message states them: on a
      // saved eight-name batch, 2026-10-28, the goods field was empty, neither this stage nor the rating read the message,
      // and uses guessed from the customer's profile steered the ratings.
      requestLine(K,
        (at) => `The VERBATIM inbound request is archived at ${at}. Read it before you frame: it leads on the goods, services and intended use, and the customer's profile only fills what it leaves open.`,
        (at) => `The archived original request is not available here. Read the available brief at ${at} before you frame. Use its stated scope and keep inferred uses explicit; the customer's profile fills gaps.`),
      job.goods ? `Goods/services (verbatim): ${job.goods}` : "",
      job.customer ? `Applicant (context only — never searched): ${job.customer}` : "",
      profile?.industry ? `Customer industry (context for marketplace selection): ${profile.industry}.` : "",
      // — "the request names none" reads the intake's classes-anywhere predicate, not a third copy
      // of it. This checked TOP-LEVEL classes only, and a knockout is a batch keyed on `job.marks`: a
      // request naming classes per mark was told it named none and handed the customer's defaults for a
      // layer it had not chosen. Measured: marks[{name, classes:[25]}] + defaultClasses [9,42] produced
      // "the request names none — consider them: 9, 42" on the knockout frame and nothing on the
      // clearance frame, from the same job.
      profile?.defaultClasses?.length && !requestNamesClasses(job)
        ? `Customer-default classes (the request names none — consider them): ${profile.defaultClasses.join(", ")}.` : "",
      job.upfrontInstructions ? `Requester instructions (verbatim — fold prior knowledge from here): ${job.upfrontInstructions}` : "",
      job.deadline ? `Requester deadline: ${job.deadline}` : "",
      // ── THE RETURN IS A CALL, AND IT CARRIES BOTH ARTIFACTS ( item C) ──────────
      //
      // THE DISPATCH NAMES NO PATHS. The driver writes the plan and the note from what the seat sends,
      // and the seat's grant carries no Write.
      //
      // THE NOTE IS ORDERED AS FINISHED PROSE, because the driver writes it byte-for-byte. Before this
      // conversion the seat wrote the file itself and could revise it; now what arrives IS the document.
      // It is also the only one of the two that was never checked — koStage takes `expectFile` and
      // `validate` from `out`, which is the plan — so a seat that wrote the plan and skipped the note
      // passed the stage. Saying "the driver writes it exactly as you send it" is what replaces the
      // second chance the Write tool used to give.
      `HAND THE FRAME BACK BY CALLING \`record_knockout_frame\`. THERE ARE NO FILES FOR YOU TO WRITE and this dispatch names none — the driver writes both the plan and the scope note from what you send, and nothing you write by hand is read.`,
      `Send \`scope_note\`: the 2–3 sentence scope note, FINISHED — what the order is, which classes, anything flagged. It is written to knockout-frame.md exactly as you send it, with no heading added and nothing composed into it, so it must read as a complete document on arrival.`,
      `Send \`marks\`: one row per instructed mark, names verbatim from the instructed scope, each with its classes, beltAndBraces, classesPlain, contextFraming, places (task 2d: the places THIS name is searched on, two or more, one of them the whole web, as many as the name needs) and priority, and useKind only where the request gives that name a different use (task 2c). The driver writes each name's spellings (task 2e). Two names that differ only in spacing, punctuation or case are REFUSED — they would share one research payload, and one of them would then be rated on the other's evidence.`,
      `Send \`batch\`: productContext, inUseAs (task 2c), useKind (task 2c), families, and executionOrder as a permutation of your mark names. THE PLACES ARE PER NAME (task 2d) and go on each mark, not here.`,
      FAMILIES_LINE,
      FRAME_REPAIR_RULE,
    ),
  },
  "knockout-register-read": {
    // THE MIDDLE TIER AT MEDIUM EFFORT reads a family's lists (design, 2026-11-23). The rating, the review and the correction keep
    // the judgment tier.
    model: "sonnet", thinking: "medium", timeoutSec: 900, stallSec: 600,
    // DECLARATIVE ONLY on this lane, as the assess stage records; the effective read is in the message.
    skillReads: ["skills/knockout-register-read/SKILL.md"],
    // A reader bound to a family writes its own record; one with no family bound (chunkNo null) writes the order's.
    out: (K, chunkNo) => (chunkNo == null ? K.registerReading : knockoutRegisterChunkFile(K.runDir, chunkNo)),
    validate: declaredValidator("knockout-register-read", KO_VALIDATORS),
    reads: (K) => ({ files: [K.instructedScope, K.inboundRequest, K.plan, paths(K.runDir).profile], message: true }),
    message: ({ K, job = {}, profile = null, readingLines = [], providerDoc = null, inScope = null, planFile = null, scopeFile = null, familySize = 1 }) => lines(
      reads(["skills/knockout-register-read/SKILL.md", providerDoc].filter(Boolean)),
      // The same assignment whether the name is ordered alone or in a shortlist.
      familySize > 1 ? FAMILY_READER_OPENER(familySize) : `You are reading the register for one name of a KNOCKOUT screen. You rate nothing; the step after you rates what you carry forward, with your reasons.`,
      existsSync(K.inboundRequest) ? `The client's request, as it arrived: ${K.inboundRequest}` : "",
      job.goods ? `Goods/services (verbatim): ${job.goods}` : "",
      job.upfrontInstructions ? `Requester instructions (verbatim): ${job.upfrontInstructions}` : "",
      `The instructed scope: ${scopeFile ?? K.instructedScope}`,
      familySize > 1 ? `The plan for these names, with what it is for: ${planFile ?? K.plan}` : `The plan for this name, with what it is for: ${planFile ?? K.plan}`,
      narrowingOrderLine(job, profile, inScope),
      `WHAT THE REGISTER HAS ANSWERED SO FAR, name by name. These are counts. For the identical question, decide whether to read the full answer or narrow it by the reading rule. Ask through the propose tool to obtain the list you select; read a held answer without asking it again.`,
      ...readingLines,
      `ASK with \`register_propose_supplemental\`: the name's \`axis\` and its band as \`output_path\`, and in \`proposals\` the question with \`nice_classes\` from that name's line and its purpose as \`rationale\`. To read a name's own list, ask \`exact\` on the name. An identical-name read keeps the original scope. Each class added from the client's own goods has its own identical-name question. A narrowing names the crowd it replaces as \`narrows\`. An answer you already hold is not asked again.`,
      `READ with \`read_register_list\`, by qid. The propose tool's answer shows only the first rows of a list; the list is the whole list, and the order it comes in means nothing.`,
      `HAND BACK with \`record_knockout_register_read\`, one row per name, when you are done. THERE IS NO FILE FOR YOU TO WRITE. If you call again, send only the names you are correcting: a name you send replaces its row.`,
    ),
  },
  "knockout-assess": {
    // THE LIMIT HAS TO COVER THE WRITING. This stage records one long call at its end, and Codex writes that call in silence,
    // so an attempt killed while writing keeps nothing. Measured in testing, 2026-11-05, with the kill lifted, on saved evidence
    // for eight names in fourteen classes: six Codex draws took 1,043 to 1,331 s and each recorded on its first attempt. At 900 s
    // every one of those would have been killed. Under that limit, four draws with class groups took up to 2,397 s and three of
    // them failed the stage, and two without were accepted, one after a retry. One attempt was killed for 600 s of silence while it wrote.
    model: "opus", thinking: "high", timeoutSec: 1500, stallSec: 900,
    // ── WHAT THIS STAGE READS, AND WHY IT IS THREE DOCUMENTS NOW ──────────────
    //
    // It read one: its own SKILL.md. So it rated in a framework's band words while never seeing that
    // framework's rulebook, and it carried private calibration rules that had drifted out of doctrine.
    // Measured against a lawyer over four marks: two of them two bands high, same direction, stable
    // across two engine commits.
    //
    //   · the stage's own doctrine — depth, degraded marks, batch output shape, tone
    //   · THE DECK IN FORCE — its matrix and its ceilings ("High and Very High REQUIRE Legal Level D
    //     or E") and its anti-escalation rule ("Optics — owner size, fame, partnership — never move
    //     the legal read"). `framework.json` carries vocabulary and order ONLY, by framework.mjs's own
    //     rule, so the ceilings could not reach this seat at all.
    //   · THE FIRM-WIDE SPINE — one copy, shared with the clearance lane, never transcribed.
    //
    // NOTE ON `skillReads` HERE: on this lane it is DECLARATIVE ONLY. Nothing in koStage reads it, and
    // the guards that read `STAGES.skillReads` walk the clearance lane's table, not this one — so the
    // effective read is the `reads([...])` call in the message and nothing checks that the two agree.
    // They are edited together and the asymmetry is written down rather than left to be discovered.
    skillReads: ["skills/knockout-assess/SKILL.md", "skills/clearance-search/firm-wide-reasoning.md"],
    // out/validate are per-CHUNK; the merged knockout-findings.json is validated separately in code.
    out: (K, chunkNo) => K.assessChunk(chunkNo),
    validate: declaredValidator("knockout-assess", KO_VALIDATORS),
    reads: (K) => ({ files: [K.plan, K.instructedScope, ...asRequested(K), ...frozenRules(K), K.registerRecords, K.registerCounts, K.ownerChecks],
      dirs: [K.researchDir], message: true, deck: true }),
    message: ({ K, job, chunkNo, chunkMarks, chunkTotal, framework, frameworkPath, probeNote, frameworkMethod, registerRecordsFile = null, registerRecordsForm = null, earlierRightsLines = [], earlierRightsFile = null, planFile = null, calibrationExcerpt = null }) => lines(
      // The deck path comes from ctx (attachKnockoutFramework resolves it once, on the fresh and the
      // resume path both) — never recomputed here, because "which deck" is one decision.
      reads(["skills/knockout-assess/SKILL.md", frameworkPath, "skills/clearance-search/firm-wide-reasoning.md"].filter(Boolean)),
      // The calibration of the framework's worked examples (calibrationExcerptOf), read once per run by the pipeline.
      ...(calibrationExcerpt ? [calibrationExcerpt] : []),
      APPLY_THE_SUPPLIED_RULES,
      // ONE JOB FOR A NAME, the same whether it is ordered alone or in a shortlist; a family's words where the group holds more than one.
      chunkMarks.length > 1 ? [FAMILY_OPENER, FAMILY_RULE].join("\n") : `You are rating one name for a Knockout screen.`,
      `Rate ONLY these marks (one entry each, names verbatim): ${chunkMarks.map((m) => m.name).join(" · ")}.`,
      chunkMarks.length > 1 ? `The plan for these names (context framing, classes): ${planFile ?? K.plan}` : `The plan for this name (context framing, classes): ${planFile ?? K.plan}`,
      requestLine(K,
        (at) => `THE CLIENT'S OWN REQUEST, VERBATIM: ${at}. Read it before you rate. Its stated goods, services, and intended use lead over the plan; the customer's profile fills gaps. Keep a guessed use as a possibility. Do not use that guess to narrow the instructed scope or lower a rating.`,
        (at) => `AVAILABLE BRIEF: ${at}. The original request is not held here. Read the brief before you rate, keep its stated scope, and distinguish supplied facts from inferred uses. Do not lower a rating on a guessed use.`),
      // ── contextFraming IS A RATING INPUT, AND SAYING SO IS THE OTHER HALF OF THE DOCTRINE ─────────
      //
      // The firm-wide reasoning calibrates on MANNER OF USE — a character name inside a franchise sits
      // further from a franchise title than the two strings look, and that pair moves a band. The plan
      // has carried a per-mark `contextFraming` all along and nothing ever told this seat to rate with
      // it, so the requester's per-name detail reached the run and stopped. Shipping the doctrine
      // without pointing at the field it turns on is half a fix.
      `Read each name's contextFraming against the client's request. Apply the manner-of-use calibration to the use the client actually states. Where the frame inferred a use, keep it as a possibility; it does not narrow the instructed scope or lower the rating. Correct a material framing error when the request or evidence contradicts it, and explain the correction in the assessment.`,
      `Each mark's RAW research payload: the record of its web searches, every spelling on every place, with the listings each search returned and any search that could not run. It holds no summary and no judgment; the judgment is yours. ${CITED_URL_RULE} The order's other recorded research payloads and its recorded owner checks are under ${K.researchDir}. ${SIBLING_SOURCE}`,
      ...chunkMarks.map((m) => `- ${m.name}: ${K.research(kebab(m.name))}${m.degraded ? `   (DEGRADED: ${m.degraded} — apply the null-results doctrine, never inflate)` : ""}`),
      // THE ORDERED TERRITORIES, where the request named some. The web questions used to carry them in
      // their own scope lines and drop what fell outside; the grid returns results and judges nothing, so
      // the territories reach the step that judges, which leaves such a use out and says it did.
      orderedTerritories(job).length
        ? `THE TERRITORIES THIS SCREEN WAS ORDERED FOR: ${orderedTerritories(job).join(", ")}. The web search was not limited to them. A use found only outside them is out of scope for this screen: leave it out of the findings, and say in that mark's assessment that you left it out.`
        : "",
      // NAMED ONLY WHEN IT IS ON DISK. The records land at step 2 of 5 and this stage is step 3 or 4, so
      // the file exists by now on a run that fetched them — and on a run that did not, a dispatch naming
      // a path that is not there teaches the seat that a missing file is normal.
      registerStateLine(K),
      registerRecordHeld(K)
        ? `THE REGISTER FILINGS THIS RUN ALREADY FETCHED — ${registerRecordsFile ?? K.registerRecords}. Real records, retrieved before you started: owner, jurisdiction, status, classes, dates. Read the held filings and weigh them for the names you are rating, against the client's requested goods. \`goods\` is a short view, \`goodsState\` records completeness, and \`goodsFrom\` records its source. If wording needed for your judgment is shortened or uncertain, read \`fullRecord\` where it is held (its path is under ${K.runDir}). Missing or incomplete wording does not establish that the goods are unrelated. A registration on this list is evidence about the name it names — treat its owner, its scope and its vulnerability the way the firm-wide reasoning tells you to (revocability above the lowest band; an enforcer's portfolio profile; a crowd as a mitigant under its gating precondition). What you may NOT do is describe the lane that fetched them — see the coverage rule below.` + (registerRecordsForm === "filings-once" ? ` ${FILINGS_ONCE_SENTENCE}` : "")
        : "",
      // ── WHAT THE OWNER ACTUALLY SELLS, ALREADY SEARCHED ────────────────────────────────────────────
      //
      // The defect this closes is not that the seat lacked an instruction — it is that the seat had no
      // way to know. It was handed an owner's NAME and its class numbers and nothing else, so a read
      // about what that owner sells could only ever be an inference from the string. The driver now runs
      // the scoped query before this stage and hands the answer over.
      //
      // ORDERED, NOT OFFERED. Naming a payload the seat may read is what produces "read and not applied,
      // no refusal" — a rule that names a downstream effect rather than the field the seat writes. This
      // names the field: the read on that filing's registerReads row.
      //
      // AND THE NEGATIVE CASE IS ORDERED TOO, because it is the one that produced the original defect:
      // where the lookup did not answer, the honest sentence is that it did not, NOT a fresh inference
      // from the owner's name dressed as a finding.
      ownerCheckLines(K, chunkMarks.map((m) => m.name)).length
        ? [
          `WHAT THESE OWNERS ACTUALLY SELL — the driver ran ONE scoped web search per promoted filing's proprietor BEFORE this stage, so you are not guessing from the company name. Payloads:`,
          ...ownerCheckLines(K, chunkMarks.map((m) => m.name)),
          `USE THEM. When you write a registerReads row for one of these filings, your "read" must state what the owner actually sells ACCORDING TO THAT PAYLOAD, not what the company's name suggests and not what its class numbers imply. An owner's name is not evidence of its trade. A company name that reads as a line of business is a guess that happens to land sometimes, and the run where it lands is indistinguishable from the run where it does not — which is the reasoning this rule exists to stop.`,
          `WHERE A PAYLOAD SAYS THE SEARCH FOUND NOTHING, say that plainly in the read — "a search for the proprietor's trade returned nothing" — and reason from the register record alone. Do NOT substitute an inference from the owner's name for the answer the search did not give. The report prints the filing card's owner-check source line from the driver's record. A finding may cite a supporting URL from the saved owner check under the held-source rule.`,
        ].join("\n")
        : "",
      // ── THE READ REACHES THE PAGE ────────────────────────────────────────────
      //
      // Until now nothing this seat concluded about an INDIVIDUAL filing could reach a reader. A filing
      // it was handed rendered as a card with no band and no rater text, carrying one code-owned
      // sentence for every filing on every run. The ruling on asked for the opposite:
      // a filing the rater weighed shows its read; one it did not carries a stated reason.
      //
      // THE ID IS THE JOIN, AND IT IS WHY THIS IS NOT A SELF-REPORT. The driver checks every id against
      // the record store above and refuses one it does not hold, so a Register label can never appear on
      // a finding with no register evidence. Omitting either field is always safe: the card keeps its
      // neutral line, which describes the card and is true.
      registerRecordHeld(K)
        ? `WHEN YOU WEIGH ONE OF THOSE FILINGS, SAY SO BY ITS OWN ID — copy "recordId" verbatim from the file above. "registerReads" on the MARK: rows of ${frameworkMethod ? "{recordId, read, band?, inputs?}" : "{recordId, read, band?}"} for a filing you weighed that did NOT become a findings[] record; "read" is what you concluded about THAT filing — how its goods meet the goods the client asked about, whether it bears on the rating, and why — and it prints on that filing's card in the reader's own report. "band" is OPTIONAL and is your rating of THAT filing on its own, in the framework's band words: send it whenever you formed a view on the filing itself, because a registered right left unbanded is the only card on the page with no rating while softer uses beside it carry one, which reads as though the registration mattered least. Omit it and your read still prints, claiming no rating.${frameworkMethod ? ' A row that carries "band" also carries "inputs", the framework\'s own inputs for that filing; a row with no band carries none.' : ""} "weighedFilings" on a FINDING: the recordIds whose evidence your reasoning for that conflict actually used, because the report derives that finding's source labelling from it. Omit these fields when their information does not apply. When a finding's reasoning uses a held filing, record its ID in \`weighedFilings\`. When you weigh a filing without making it a finding, record the read in \`registerReads\`. Never invent a read or citation to fill a field. Both are joined against the filings you were given, so an id we do not hold is refused by name.`
        : "",
      // THE EARLIER RIGHTS HELD UNDER THE ORDER'S OTHER NAMES that the held evidence ties to a name of this group (ko-earlier-rights.mjs),
      // after the lines that say how a filing is weighed or read.
      earlierRightsLines.length
        ? (chunkMarks.length > 1 ? [FAMILY_RIGHTS_SENTENCE(earlierRightsFile), ...earlierRightsLines, FAMILY_RIGHTS_ANSWER] : [EARLIER_RIGHTS_SENTENCE(earlierRightsFile), ...earlierRightsLines, EARLIER_RIGHTS_ANSWER]).join("\n")
        : "",
      `The FROZEN framework in force (rate in ITS band vocabulary, highest→lowest ${framework.bands.map((b) => b.label).join(" · ")}): ${paths(K.runDir).framework}`,
      frameworkMethod ? methodDictation(frameworkMethod) : "",
      frameworkMethod ? `- inputs: ${inputsShape(frameworkMethod)} — the framework's own inputs for this finding, each one of the values it lists, reasoned in its order before the band. On every rated finding.` : "",
      // A seam for a note about Depth 2, and it stays UNUSED on purpose (2026-07-22). The counts
      // are code-measured and code-rendered; showing them to this turn would let a rating be argued
      // from register data a knockout has not analysed, and would put a figure the report prints
      // exactly ("37") in reach of a turn that can only paraphrase it ("around forty"). The two
      // would then disagree on the same page. A count is code-rendered or absent; a turn never restates one.
      probeNote ?? "",
      // — THE READ IS TYPED, not narrated. Every summary this lane has ever written walks the same
      // skeleton (why this band → what is crowding the field → what holds it off the next band →
      // what would move it), and it walked it in sentence flow, where only a careful read recovers it.
      // A ~180-word paragraph is not what a lawyer scanning twenty names can use. Emitted as fields, the
      // renderer can lay it out; emitted as prose, no renderer can. Same rule as: structure at
      // source, never a regex over rendered prose.
      // ── THE PER-MARK OPENING ASSESSMENT ──────────────────────────────────────
      //
      // Ruling, 2026-08-26: a batch client gets the same kind of opening paragraph a single-mark
      // client gets, MODEL-AUTHORED and at full length — "the most useful piece of pre-triage; I don't
      // see why we constrain it; 4× longer like the single mark seems fine."
      //
      // Until now a per-mark document opened with nothing at all: the batch paragraph names every mark,
      // so publish blanked it on each mark's own page rather than print a summary about other people's
      // names. That was right and it left the page with no opening read.
      //
      // ADDITIONAL TO `chunkSummary`, NOT A REPLACEMENT. The cross-mark paragraph still exists and still
      // owns the grouped page — the two are different documents for different readers, and collapsing
      // them is what produced the blank.
      // ── STRUCTURE, AND A SCALE THAT HOLDS ─────────────────────────────────────────────────────────
      //
      // Owner, 2026-08-31, reading a delivered run: the per-mark opening was "now HUGE and formatted
      // even worse — no newlines, borderline not a summary". Measured on that run: 2,875 characters,
      // zero newlines, zero headings, zero bullets — and the same shape on a crowded register field as
      // on an empty one, so the seat was not sprawling under load. It was writing one block because the
      // line below asked for full length and said nothing about shape.
      //
      // His ruling, verbatim, and it AMENDS the 2026-08-26 "full length, not rationed" decision above
      // rather than quietly overriding it: "keep the length, add the structure, so long as length is
      // consistent more or less."
      //
      // The depth rule is not stylistic. `# ` opens a SECTION of the delivered report — parseSections
      // splits on /^# /m and batchSummaryOf terminates on it — so a single hash written here ends the
      // client's summary at that line and drops everything after it, silently, on the entry point.
      //
      // ── THE WHOLE CONTRACT, IN ONE INSTRUCTION (design, 2026-11-06) ───────────────────────────────────────
      //
      // Reviewing the knockout against the lawyer's original instructions, design kept the full opening, its structure, a broadly
      // consistent scale across the batch and the typed fields' requirements; an earlier proposal to shorten the opening and drop
      // those requirements was withdrawn. The line below says so to the rating step and changes none of it: the manual's "keep
      // the length" and the validators' minimums stand. Model words, landed as approved.
      `Give each name a complete opening assessment for a client reading that name's report alone. Explain the relevant landscape, what drives the rating, and what matters for the client's decision. Preserve the established depth and a broadly consistent scale across the order. Use sub-headings, short paragraphs and bullets to make the assessment easy to scan. Keep the existing structured fields and their requirements. Do not invent observations or repeat a point merely to fill space; preserve the material supporting and contrary facts, goods and class distinctions, implications and search limitations needed to understand the advice. The order summary compares the names separately and does not replace any name's own opening assessment.`,
      `SAY NOTHING ABOUT WHETHER THE REGISTER LANE RAN — whether registers were searched, counted, overlaid or checked, how many filings exist, or how far the search reached. Not in any field, not in the group summary. The report states its coverage in code from the run's own measurements, and the validator refuses a group that speaks for it. That is a rule about the lane, not about the filings: a filing you were handed is evidence like any other. You may say what a particular held filing's record does not show.`,
      THIN_LEADS,
      `EVERY conflicting name is a typed findings[] record. A named conflict belongs in findings[], not in bullets — write it once.`,
      `The manual sets out each mark's record: its \`findings[]\`, its opening read in \`assessment\`, its typed read, and the group's \`chunkSummary\`, which code joins into the order summary, so a mark missing from it is missing from the report.`,
      `HAND YOUR RATINGS BACK BY CALLING \`record_knockout_assess\`. THERE IS NO FILE FOR YOU TO WRITE and this dispatch names none — the driver writes this group itself from what you send, and nothing you write by hand is read. You are not told which group number to send and there is no field for it: the driver bound that when it dispatched you.`,
      // A REPAIR SENDS ONLY WHAT CHANGED (design, 2026-11-06). The recorder merges a correction onto the written record field by field
      // and validates the assembled record, so re-sending a whole name to fix one sentence was output the contract asked for and the
      // merge never needed. A refused first call writes nothing, so it is no base: a partial first call is still refused.
      `On the first call, send the complete assessment. Once the tool has confirmed a written record for this group, correct a name by sending its exact name and only the fields you changed. Omitted names and omitted fields within a name keep their recorded values. A field you send replaces that whole field: send a changed list or object complete, including unchanged entries. Update the group summary when the correction changes it. If the tool has written no record, send the complete corrected assessment.`,
      // NO GROUP CARRIES THE ORDER'S DUTIES. Code takes the product context from the plan and the framework from the frozen one, and
      // assembles the order's summary from each name's after every name is rated.
      (chunkMarks.length > 1 ? `You send \`marks\` and \`chunkSummary\`. Use \`batch.standardCaveats\` only for a qualification the brief establishes for every name in the order. Put a qualification specific to an assigned name in that name’s assessment. Use the supplied frozen framework. Open your \`chunkSummary\` with a line for each name; code assembles the order's summary from each name's once every name is rated.` : `You send \`marks\` and \`chunkSummary\`. Use \`batch.standardCaveats\` only for a qualification the brief establishes for every name in the order. Put a qualification specific to an assigned name in that name’s assessment. Use the supplied frozen framework. Open your \`chunkSummary\` with a line for this name; code assembles the order's summary from each name's once every name is rated.`),
    ),
  },

  // ── THE REVIEWING PASS ──────────────────────────────────────────────────────
  //
  // The third stage, after assess. It rewrites the lines a reader meets before opening anything, in the
  // words that reader already owns, and it does nothing else.
  //
  // SMALLER THAN THE STAGE IT COPIES, DELIBERATELY. The clearance lane's refutation stage re-derives the
  // headline, audits the plan and grades corrections; this one is handed a list of lines and returns
  // replacements for the ones it agrees are wrong. It has no verdict, no band, no evidence and no
  // decision. Copying that stage's SHAPE was the design; copying its size would have made a rewrite pass
  // into a second reviewer, on a product that screens rather than clears.
  //
  // NOT THE PRE-DELIVERY LINT, AND THIS IS THE REASON. That lint is deterministic and its own header
  // states what happens to a failing check: it ships as a visible flag at the top of the client's report.
  // That is a disclosure, and putting a note about the lawyer's vocabulary on the client's own page is
  // the opposite of the intent, on the surface the rule exists to protect. The lint is the right
  // instrument for a mechanical defect and the wrong one for a rewrite.
  //
  // MODEL AND EFFORT. Opus at high, like the two stages before it. A rewrite that keeps every fact while
  // changing the register is the same judgment the rating seats make, and the whole value of the pass is
  // that the replacement reads better than what it replaced. A cheaper rung would produce replacements
  // nobody would ship, which is a pass that runs and achieves nothing.
  "knockout-review": {
    model: "opus", thinking: "high", timeoutSec: 900, stallSec: 600,
    // DECLARATIVE ONLY on this lane, exactly as the assess stage records: nothing in koStage reads
    // `skillReads`, and the effective read is the `reads([...])` call in the message below. The two are
    // edited together and the asymmetry is written down rather than left to be discovered.
    skillReads: ["skills/knockout-assess/SKILL.md", "skills/clearance-search/firm-wide-reasoning.md"],
    // ONE REVIEW, and no second look at the corrected record: a correction is not read again.
    out: (K) => K.review,
    validate: declaredValidator("knockout-review", KO_VALIDATORS),
    reads: (K) => ({ files: [K.findings, K.plan, ...asRequested(K), ...frozenRules(K), K.registerRecords, K.ownerChecks],
      dirs: [K.researchDir], message: true, deck: true }),
    // ── THE MESSAGE PROMISES A TABLE ONLY WHEN IT HAS ONE ──────────────────────────
    //
    // `evidenceLines` is the driver's measurement, passed at dispatch. Two things follow, and the arms
    // found both: the defaults must not be absent — a message that throws on a ctx without them cannot
    // be composed by anything except the production call site, which is how a dispatch goes unexamined
    // — and the promise has to branch. A stage message that says "the lines are below" and then lists
    // none has handed the seat an absence dressed as a pass, which is the reading this whole rule
    // exists to stop. A record the driver's read flags nowhere is handed its first-read lines instead,
    // by the owner's ruling of 2026-10-10, so both branches have rows under them; a record with no such
    // line is not dispatched at all.
    message: ({ K, frameworkPath = null, digestLines = [], searchedRows = [], setAsideRows = [], sourceLines = [], ownerCheckRows = [], sourceAnswers = [], earlierRightsReview = [], registerTableFile = null }) => lines(
      // THE CLIENT'S QUESTION LEADS, in the owner's words (ruling 2026-09-24).
      `Does the report answer the client's question: who could object, how strong they are, what the client should do? Are the marks a lawyer would list present, and is each position written from the record that matters?`,
      reads(["skills/knockout-assess/SKILL.md", "skills/clearance-search/firm-wide-reasoning.md", frameworkPath].filter(Boolean)),
      REVIEW_APPLIES_THE_SUPPLIED_FRAMEWORK,
      `You are the INDEPENDENT CHECK on a knockout screen: another step rated this order. Check what the client is told against the request, the framework and the evidence. You change no band and no finding yourself.`,
      `Apply the frozen framework, the knockout assessment manual and shared firm-wide reasoning. An unidentified owner is an explicit evidence gap, not by itself grounds to remove or lower a finding's band. Never invent attribution or a right; explain what the held evidence supports and what remains uncertain.`,
      requestLine(K, (at) => `The client's request, as it arrived: ${at}`, (at) => `The available brief: ${at}. The original request is not held here.`),
      // THE REVIEW CHECKS THE OPINIONS AGAINST THEIR CITED EVIDENCE, handed to it in this message, and does not chase a thin web lead.
      // It does not reword: a supported line stands. A clean read is an answer, and the recorder refuses a call that sends neither.
      REVIEW_SCOPE,
      THIN_LEADS,
      `MATERIAL DEFECTS COME FIRST. A defect is material when repairing it would change what the client is told: a band the framework and the evidence do not support, including one band where the evidence divides the requested goods, or a division it does not support (\`band\`), a filing or use a lawyer would raise that the answer leaves out (\`missing\`), something set aside against the evidence (\`exclusion\`), scope the request asked for that the answer does not cover, including reasoning that never connects the requested use and the held goods to the conclusion (\`scope\`), or a line that contradicts the record beneath it (\`contradiction\`). Send each as a \`material\` row: \`kind\`, \`mark\` verbatim, the finding's ordinal as \`finding\` where it is about one, and what is wrong and why it matters as \`problem\`. Identify the held evidence behind the defect in rests_on. A defect about scope, the framework, or internal agreement may instead identify the supplied request passage, framework rule, or rated field in problem. Do not invent a filing or URL to justify that defect. A filing held for this order may bear on more than one name, so a defect on one name may rest on a filing held under another, by its held recordId and source. You repair nothing: the step that rated the order answers each row. A rating a lawyer could reasonably reach is not a defect, and neither is a preference about wording.`,
      // What each rating did with the earlier rights it was handed from the order's other names.
      earlierRightsReview.length ? [EARLIER_RIGHTS_REVIEW, ...earlierRightsReview].join("\n") : "",
      `rests_on takes a recordId, a question qid, or a URL from ${PERMITTED_SOURCES}. A failed question's qid supports a statement about the failure, not a finding about filings the question never returned. ${SIBLING_SOURCE}`,
      sourceAnswers.length
        ? [`THESE CITATIONS WERE LEFT OUT AS NOT HELD, AND THE FINDINGS THAT CITED THEM CHANGED AFTERWARDS. Read each against that problem: a claim still without held support is a material defect.`, ...sourceAnswers].join("\n")
        : "",
      // EVERYTHING THE REVIEW CHECKS, UP FRONT (ko-review-evidence.mjs): the opinions as rated, and what this run holds of each source
      // they cite. Each call the review makes carries the conversation so far, so what it would otherwise fetch in calls is here once.
      digestLines.length ? [`THE OPINION SUMMARIES, as rated, one block a name. Findings carry their ordinals; their sources are named by record ID or address.`, ...digestLines].join("\n") : "",
      sourceLines.length ? [`THEIR CITED EVIDENCE, each source once, with what this run holds of it and the opinion that cites it:`, ...sourceLines].join("\n") : "",
      ownerCheckRows.length ? [`THE OWNER CHECKS behind each name's filings, each with its answer:`, ...ownerCheckRows].join("\n") : "",
      searchedRows.length ? [`WHAT WAS SEARCHED, per name: each register question with its count, and what the reading read or left unread:`,
        `The report states each name's register coverage itself. Raise a search here only where a claim on the page depends on it.`, ...searchedRows].join("\n") : "",
      setAsideRows.length ? [`THE WEB LEADS THE RATING SET ASIDE, with its reason for each:`, ...setAsideRows].join("\n") : "",
      `A held source is one call away when the evidence above is not enough to decide a point: \`read_register_list\` by qid and record_id reads a filing's whole wording, the research payloads are under ${K.researchDir}${registerTableFile ? `, and what the reading set aside, and why, is in ${registerTableFile}` : ""}.`,
      `HAND YOUR ANSWER BACK BY CALLING \`record_knockout_review\`. THERE IS NO FILE FOR YOU TO WRITE. Send \`first_question\`, your answer to the question this message opens with, and \`material\`: one row per material defect, as above, or an empty list where there is none.`,
    ),
  },
  // A MATERIAL DEFECT'S REPAIR. Dispatched only when the check raised one, per chunk, on the chunk as rated. Its answer is its own
  // artifact because the chunk it changes is already valid: a turn that called nothing would otherwise pass.
  "knockout-correct": {
    model: "opus", thinking: "high", timeoutSec: 1200, stallSec: 600,
    // DECLARATIVE ONLY on this lane, as the assess stage records; the effective read is in the message. A CORRECTION READS ITS DEFECT,
    // NOT THE RATER'S MANUALS: measured in testing, 2026-11-24, Claude's corrections averaged 0.85M tokens each, reading those
    // manuals whole. It is handed its defect, what that rests on and the customer's framework.
    skillReads: [],
    out: (K, chunkNo) => knockoutCorrectionFile(K.runDir, chunkNo),
    validate: declaredValidator("knockout-correct", KO_VALIDATORS),
    reads: (K) => ({ files: [paths(K.runDir).knockoutCorrectionWork, knockoutReviewFile(K.runDir, 0), K.plan, K.instructedScope,
      ...asRequested(K), ...frozenRules(K), K.registerRecords, K.ownerChecks], dirs: [K.researchDir], deck: true }),
    message: ({ K, job = {}, chunkNo, work = null, chunkMarks = [], frameworkPath = null, frameworkMethod = null }) => {
      const asRated = (() => { try { return JSON.parse(readFileSync(K.assessChunk(chunkNo), "utf8")); } catch { return null; } })();
      const scope = chunkScope(work, chunkNo, asRated);
      const ordinalOf = (d) => (asRated?.marks ?? []).find((m) => m?.name === d.mark)?.findings?.find((f) => sameFinding(f, d.names))?.ordinal;
      // WHAT EACH DEFECT RESTS ON, handed to the correction with its defects (ko-review-evidence.mjs): the sources each one names and the
      // sources the finding it names cites, as the run holds them. The correction reads its defect, not the run's whole record.
      const plan = (() => { try { return JSON.parse(readFileSync(K.plan, "utf8")); } catch { return null; } })();
      const restsOn = defectEvidence(scope.defects, asRated, K.runDir, plan);
      return lines(
        frameworkPath ? reads([frameworkPath]) : "",
        REVIEW_APPLIES_THE_SUPPLIED_FRAMEWORK,
        `An independent check read this rated order and raised the defects below. Repair what the evidence supports, and nothing else.`,
        requestLine(K,
          (at) => `THE CLIENT'S OWN REQUEST, VERBATIM: ${at}. Read it before you rate. Its stated goods, services, and intended use lead over the plan; the customer's profile fills gaps. Keep a guessed use as a possibility. Do not use that guess to narrow the instructed scope or lower a rating.`,
          (at) => `AVAILABLE BRIEF: ${at}. The original request is not held here. Read the brief before you rate, keep its stated scope, and distinguish supplied facts from inferred uses. Do not lower a rating on a guessed use.`),
        `The record as rated: ${K.assessChunk(chunkNo)}. The ordinals you use are the ones in that file.`,
        `The order's plan: ${K.plan}. The frozen framework's bands: ${paths(K.runDir).framework}.`,
        orderedTerritories(job).length ? `THE TERRITORIES THIS SCREEN WAS ORDERED FOR: ${orderedTerritories(job).join(", ")}. A use found only outside them is out of scope for this screen.` : "",
        `THE DEFECTS.`,
        ...scope.defects.map((d) => `${d.n}. [${d.kind}] "${d.mark}"${d.names ? `, finding ${ordinalOf(d) ?? "?"} (${d.names.name})` : ""}: ${d.problem}${d.rests_on?.length ? ` Rests on: ${d.rests_on.join(", ")}.` : ""}`),
        restsOn.sources.length ? [`WHAT YOUR DEFECTS REST ON, as this run holds it: each source a defect names, and each source the finding it names cites.`, ...restsOn.sources].join("\n") : "",
        restsOn.ownerChecks.length ? [`THE OWNER CHECKS behind these names' filings, each with its answer:`, ...restsOn.ownerChecks].join("\n") : "",
        `A held source is one call away when the evidence above is not enough to decide a point: \`read_register_list\` by qid and record_id reads a filing's whole wording, and the research payloads are under ${K.researchDir}.`,
        `A DEFECT IS ANOTHER READER'S FINDING, NOT AN ORDER. Check it against the evidence. Where it holds, repair the finding or the rating. Where it does not, leave the record and say why.`,
        CORRECTION_SCOPE,
        CORRECTION_OWN_REASONS,
        frameworkMethod ? methodDictation(frameworkMethod) : "",
        frameworkMethod ? `- inputs: ${inputsShape(frameworkMethod)} — the framework's own inputs for this finding, each one of the values it lists, reasoned in its order before the band. On every rated finding.` : "",
        `HAND BACK BY CALLING \`record_knockout_correction\`, sending only what changes. THERE IS NO FILE FOR YOU TO WRITE. For a name: the fields that change. A finding goes back whole under its ordinal, and a new one takes the next ordinal. Change a name no defect concerns only for a finding it shares with a name you repair, or an answer that depends on your repair; a shared rating alone is not such a dependency. List each finding you change or remove there in that defect's \`findings\`, and say why. Within an affected name, repair the findings and dependent answers needed to resolve the defect, and explain their connection to it. Leave unrelated findings unchanged.`,
        `A filing held for this order may bear on more than one name. Weigh it against the particular name and its instructed scope, and cite its held recordId and source. Keep where it was found: using that filing does not mean its original search answered this name's register question.`,
        `${CITED_URL_RULE} ${SIBLING_SOURCE}`,
        OWNER_SOURCE,
        `BRING EVERY DEPENDENT ANSWER WITH IT. Whatever the repair changes, the name's lines that rest on it change with it: \`basis\`, \`factors\`, \`counterFactors\`, \`mitigation\`, \`assessment\`, \`bullets\`, \`classGroups\`, \`classesDriving\`, its \`registerReads\` and its block in \`chunkSummary\`. A rating that moves needs \`basis\`, \`assessment\` and \`chunkSummary\` in the call. The manual's rules still hold: a name is never rated above its worst card.`,
        `REMOVING A FLAGGED FINDING DOES NOT ANSWER ITS DEFECT ON ITS OWN. Use \`remove_findings\` only where the evidence shows the finding should not be there, and say so.`,
        `ANSWER EVERY DEFECT in \`answers\`: \`defect\`, \`outcome\` (\`changed\` or \`stands\`), \`why\`, and in \`findings\` the ordinal of any finding this repair moved beyond the one the defect names. If you call again, send only what you are correcting.`,
      );
    },
  },
};
