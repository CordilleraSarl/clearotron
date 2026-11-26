// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ── HOW MUCH WAS READ TO REACH THE ANSWER, AS MACHINE FIELDS ────────────────────────────────────────
//
// A deeper search reads more and finds no more, and until now the report could not say so: a run that
// read 1,455 register records and cleared 432 near-names delivered a page showing 13 findings and
// nothing of the rest. The negative evidence — the work that came back clean — existed only in the
// audit workbook, in the engine's own working voice.
//
// This module derives that body of negative evidence from artifacts the run has ALREADY written. It
// starts no search, asks no model and composes no sentence: every field here is a count, a token, or a
// fact copied from a record. That is the whole design constraint, and it is why this lives at publish
// time rather than in a stage — a republish of an archived run picks the fields up with no re-run.
//
// THE GROUP KEY IS THE PART THAT COULD HAVE GONE WRONG. Each cleared near-name is grouped by WHY it was
// cleared, and the honest source is the register providers' closed screening vocabulary, which every
// provider computes identically: `drop:dead` (a confidently dead status), `drop:out-of-class` (live but
// no in-scope-class overlap), `surface:in-scope-live` / `surface:all-class` (a real in-scope candidate),
// `deepfetch:ambiguous` (status unrecognised). A verdict and the record's own status are facts. The
// engine's `result` paragraph is not a fact about the record, it is prose about the reasoning, and
// classifying on it is how a report ends up asserting a reason the record does not support.
//
// SO THIS EMITS THREE GROUPS, NOT FOUR, AND THAT IS DELIBERATE. `dead-filing` and `different-goods` fall
// straight out of the vocabulary. Everything else is `other` — read, in scope, and cleared on judgment.
// A fourth group, "different word", cannot be derived from a screening verdict or a status: a name
// cleared because it reads as a different word was `surface:in-scope-live` like any other real
// candidate, and only the reasoning says otherwise. Splitting it would mean either reading that prose
// or inventing a similarity rule here, and a wrong group on a client page is worse than a coarse
// honest one. Recorded on the issue rather than guessed at.
//
// BREAK MATRIX:
//   · a dead status groups as dead-filing            → break: drop the status arm, arm 1 red
//   · an out-of-class verdict groups as goods        → break: map it to other, arm 2 red
//   · an in-scope live name groups as other          → break: classify on the result prose, arm 3 red
//   · a per-country count names every country read   → break: count only countries with a finding, arm 5 red
//   · court decisions distinguishes four states      → break: collapse none-found into not-checked, arm 6 red

import { parseCaseLawLedger, ledgerSeparatesUnsentQueries } from "../case-law-ledger.mjs";   // pure, like this module
import { normRegion, regionName } from "./regions.mjs";   // pure: the page's own folding of a territory's spellings
import { capabilitiesFor } from "../register-capabilities.mjs";   // a register's own territory-to-office translate
import { withPlanRegions } from "../../providers/_shared/execute-plan.mjs";   // pure: the territories a term is sent with

/** The closed set a group key may take. The renderer's headings are keyed on these, never on prose. */
export const CLEARED_GROUPS = Object.freeze(["dead-filing", "different-goods", "other"]);

/** Statuses a register reports for a filing that is no longer live. Surfaced by the provider, never date-cut. */
const DEAD_STATUS_RE = /^(?:CANCELLED|CANCELED|EXPIRED|ABANDONED|WITHDRAWN|REFUSED|DEAD|LAPSED|INVALID|SURRENDERED)\b/i;

/**
 * Why this near-name was cleared, from the two fields the engine records per name. PURE.
 *
 * @param {{screenVerdict?: string, status?: string}} a
 * @returns {"dead-filing"|"different-goods"|"other"}
 */
export function groupForCleared({ screenVerdict, status } = {}) {
  const v = String(screenVerdict ?? "").trim().toLowerCase();
  const s = String(status ?? "").trim();
  if (v.startsWith("drop:dead") || DEAD_STATUS_RE.test(s)) return "dead-filing";
  if (v.startsWith("drop:out-of-class")) return "different-goods";
  return "other";
}

/** One `## NRn` block's `- key: value` lines. The audit is written by a deterministic builder, so this is a contract. */
const field = (block, key) => (block.match(new RegExp(`^- ${key}:\\s*(.*)$`, "m")) || [])[1]?.trim() ?? "";
const noteField = (notes, key) => (notes.match(new RegExp(`${key}=([^;]+)`)) || [])[1]?.trim() ?? "";

// THE RUN'S OWN COMMON-LAW SEARCH RECORD, named where a web address would be. A row the assessing model backed with the
// run's own search ledger carries that file's name in its `url`; the page names it in words rather than linking it.
export const RUN_COMMON_LAW_RECORD = /^(?:\.\/)?(?:_driver\/)?common-law-grid(?:\.half-[a-z0-9]+)?\.json$/i;

// ── A WEB NAME'S ADDRESSES, READ OUT OF WHAT THE MODEL WROTE ───────────────────────────────────────
//
// The `url` field is model-written. Measured on the public demos, 2026-11-25: besides one address it held two
// addresses separated by a semicolon, whole Markdown links of the form `[label](address)` (one or several), and a
// sentence ("See cell-level receipts below"). The page printed each value as one link, so a Markdown link became a link
// to nowhere and a sentence became a link. Read here into the http(s) addresses it holds, in order and once each: a
// Markdown link gives its address, a bare address gives itself, and anything else gives nothing.
const MD_LINK_TARGET = /\[[^\]]*\]\(\s*(https?:\/\/[^\s)]+)\s*\)?/gi;
const BARE_ADDRESS = /https?:\/\/[^\s<>"'()[\]]+/gi;

/** The http(s) addresses one `url` value holds, in order and without repeats. PURE. */
export function webAddresses(value) {
  const text = String(value ?? "");
  const out = [];
  const add = (u) => { const a = u.replace(/[.,;:]+$/, ""); if (a && !out.includes(a)) out.push(a); };
  for (const m of text.matchAll(MD_LINK_TARGET)) add(m[1]);
  for (const m of text.replace(MD_LINK_TARGET, " ").matchAll(BARE_ADDRESS)) add(m[0]);
  return out;
}

/**
 * What a web name's `url` gives the page: its http(s) addresses (`links`), the run's own search record (`runRecord`), or
 * one other reference without spaces (`ref`), printed as it stands. A sentence gives nothing: the block is a note. PURE.
 */
export function webNameRow(url) {
  const value = String(url ?? "").trim();
  if (RUN_COMMON_LAW_RECORD.test(value)) return { links: [], runRecord: true, ref: null };
  const links = webAddresses(value);
  if (links.length) return { links, runRecord: false, ref: null };
  return value && /^\S+$/.test(value) ? { links: [], runRecord: false, ref: value } : null;
}

/**
 * Every near-name the run read and cleared, register and web, as facts. PURE.
 *
 * The register rows carry no sentence: mark, owner, country, class, status, group and the record URI.
 * The reasoning stays in the audit workbook, where the engine already wrote it — the owner ruled against
 * a second client-facing sentence per name (2026-09-16), so this deliberately does not carry `result`.
 *
 * @param {string} auditMd            the run's `audit.md`
 * @param {Record<string, object>} recordIndex  fetched records by URI, for the fuller mark and owner
 */
export function clearedNames(auditMd, recordIndex = {}) {
  const out = { register: [], web: [] };
  for (const block of String(auditMd ?? "").split(/^## /m).slice(1)) {
    const title = block.split("\n")[0].trim();
    const layer = field(block, "source_layer");
    if (/^NR\d+/.test(title) && /register/i.test(layer)) {
      const notes = field(block, "notes");
      const uri = (notes.match(/URI (\S+?);/) || [])[1] ?? "";
      const screenVerdict = noteField(notes, "screen_verdict");
      const status = noteField(notes, "status");
      const classes = noteField(notes, "class");
      const country = ((uri.match(/^\/mark\/([a-z]{2})\//) || [])[1] ?? "").toUpperCase();
      const rec = recordIndex[uri] ?? {};
      out.register.push({
        term: field(block, "search_term"),
        mark: rec.markText || rec.mark || field(block, "search_term"),
        owner: rec.owner ?? "", country, classes: rec.classes || classes,
        status: rec.statusText || status,
        group: groupForCleared({ screenVerdict, status: rec.statusText || status }),
        uri,
      });
    } else if (!/^NR\d+/.test(title) && /common-law/i.test(layer) && !/^\(none/i.test(title)) {
      // ── A NAME IS A NAME AT A PLACE. THE READINGS ARE NOT NAMES ─────────────────────────────────
      //
      // The common-law layer carries two kinds of block under one heading style: a name somebody is
      // trading under, and a reading of what the mark MEANS. The first has a `url` — it is a thing at a
      // place a reader can go and look at. The second has none, because there is nothing to open: it is
      // an etymology, a sensitivity, a piece of context.
      //
      // Both were listed as "Web and marketplace names", and a reading is a sentence, so the mark chip
      // built for a name truncated it with an ellipsis and its right-hand column rendered empty.
      // Measured on the delivered full country report: one such chip held 416px of content in a 200px
      // box. Across every demo product, 7 of 31 blocks carried no url and every one of the 7 was a
      // reading rather than a name.
      //
      // NOTHING IS LOST BY LEAVING THEM OUT, and that was measured rather than assumed: the report
      // already carries each of those readings in the section written for them — the Quechua one appears
      // five more times in the same document, under "Connotation & meaning" and again in the decision it
      // asks the reader to take — and the audit workbook carries every block whatever this does.
      //
      // WHAT IT COSTS, stated rather than hidden: a marketplace name sighted with no URL recorded would
      // not be listed here. None exists in any demo, and the row such a block produced was already a
      // name beside an empty column. If one appears, the fix is to record where it was seen.
      //
      // A `url` THAT IS A SENTENCE NAMES NO PLACE, and the block is a note, not a name. Measured on the public Global
      // preliminary demo, 2026-11-25: "No confirmed directly conflicting app or course identified." with the `url`
      // "See cell-level receipts below" was listed as a name, counted in the header, and printed with that sentence as
      // its link. A block counts as a name when its `url` gives at least one http(s) address, names the run's own search
      // record (which the page names in words), or is one other reference, such as a record file, which the page prints
      // as it stands and does not link. `links` is what the page links; `url` stays as written.
      const url = field(block, "url");
      const row = webNameRow(url);
      if (row) out.web.push({ title, url, ...row, type: field(block, "type") });
    }
  }
  return out;
}

/**
 * Register records read, per country, from the run's own `_records/` listing. PURE.
 *
 * EVERY COUNTRY THE RUN READ, including the ones that came back clean — those are the whole point. A
 * count keyed off the findings would list only countries with a conflict, which is the gap this closes.
 *
 * THREE-VALUED, in the house pattern outputMeta already uses for a stage's output: `null` in means the
 * run has NO `_records/` store, and `null` comes back out — we cannot say how many records were read.
 * An empty ARRAY is the other thing entirely: the store is there and holds nothing, which is a real zero
 * and renders as one. Collapsing the two is what this fixes; they arrived here as the same `[]` and the
 * renderer could only drop the section, so a register that archives nothing read as a register nobody
 * searched.
 *
 * @param {string[]|null} recordFileNames  the `_records/` listing, named `<cc>-<id>.json`; null = no store
 * @returns {object|null} counts by country code, or null when the run cannot say
 */
export function recordsByCountry(recordFileNames = []) {
  if (recordFileNames === null) return null;
  const out = {};
  for (const name of recordFileNames) {
    const cc = (String(name).match(/^([a-z]{2})-/i) || [])[1];
    if (cc) out[cc.toUpperCase()] = (out[cc.toUpperCase()] ?? 0) + 1;
  }
  return out;
}

/** Band record ids → `<office>-<id>` names, one per distinct record, in the archive's own naming. PURE. */
export function recordNamesFromIds(ids) {
  const out = new Set();
  for (const id of ids ?? []) {
    const m = /^\/mark\/([a-z]{2,4})\/(.+)$/i.exec(String(id ?? ""));
    if (m) out.add(`${m[1].toLowerCase()}-${m[2]}`);
  }
  return [...out];
}

/** Marketplace, web, reputation and meaning checks, from the deterministic grid the tools wrote. PURE. */
export function sweepCounts(commonLawGrid, auditMd = "") {
  const cells = Array.isArray(commonLawGrid?.cells) ? commonLawGrid.cells : [];
  const counts = {
    checks: cells.length,
    platforms: new Set(cells.map((c) => c?.platform).filter(Boolean)).size,
    spellings: new Set(cells.map((c) => c?.term).filter(Boolean)).size,
    reputation: Array.isArray(commonLawGrid?.extras?.pr_risk) ? commonLawGrid.extras.pr_risk.length : 0,
  };
  // A run old enough to predate the grid has no machine record; its per-term log is the audit's own
  // common-law rows. Not a fallback masking a defect — those runs have nothing else to read.
  if (!counts.checks && auditMd) counts.checks = (String(auditMd).match(/^- source_layer: Common-law/gm) || []).length;
  return counts;
}

/**
 * What the court-decisions pass came back with, as one token. PURE.
 *
 * FOUR STATES, BECAUSE THREE OF THEM MEAN DIFFERENT THINGS TO A READER. "None found" is a result and
 * "could not be checked" is a gap; collapsing them would let an unreachable source read as a clean
 * negative, which is the one thing a clearance may never do. "Not in scope" is neither — the product
 * offers the pass on a full country search only.
 *
 * THE STATE IS THE PASS'S OWN RECORD, NOT THE WORDS OF ITS FILE. The file was the only input, read for five
 * phrasings of an outage, and three wrong pages followed from that: a pass that failed its check but left
 * its file behind read as "searched" and "found"; a source described as "unavailable" read as "found"; and
 * one profile's "none found" turned a pass that cited authorities into "none found". So:
 *   · the stage's last attempt failed               → not-checked. What it left behind is not its result.
 *   · the retrieval record is there but unreadable  → not-checked. Nothing shows the search ran.
 *   · the record cites a decision                   → found.
 *   · no citation, and the source answered          → none-found: a query came back with hits, none of them
 *     on point, or a case-law source's own call log shows a call it answered.
 *   · no citation, and nothing shows an answer      → not-checked. At ledger version 1 the record carries
 *     a row per query at the count the model wrote, and on the six test runs whose source was down
 *     (measured 2026-09-25) it wrote 0 for queries that never reached one — on one of them with no search
 *     or fetch tool called. There a 0 is not evidence a search ran, and "none found" is the claim that one
 *     did. The cost, stated rather than hidden: an honest version-1 pass whose every query returned
 *     nothing, through a source whose calls are not logged, reads as not completed.
 *   · FROM LEDGER VERSION 2 a 0 IS AN ANSWER, because the instruction that version names tells the model
 *     to write null for a query it could not send and never 0. That is what buys the honest pass its
 *     "none found" back: the record now distinguishes the two cases the reader could only guess at, and
 *     the guess was resolved against the run. `null` is still not an answer at any version — it is the
 *     record saying the query never reached a source, which is the whole point of writing it.
 * Only a run that kept no record — one from before the record existed, or a demo — reads the file's words,
 * because they are all it has; its outage phrasings include "unavailable" for that reason.
 *
 * @param {string} caseLawText  the case-law findings file
 * @param {{lastAttemptOk?: boolean|null, ledgerRaw?: string|null, sourceAnswered?: boolean}} [record]
 *        the pass's own record, as caseLawPassRecord cuts it; omitted, the file's words decide
 * @returns {"found"|"none-found"|"not-checked"|"not-in-scope"}
 */
export function courtDecisionsState(caseLawText, { lastAttemptOk = null, ledgerRaw = null, sourceAnswered = false } = {}) {
  const t = String(caseLawText ?? "");
  if (!t.trim()) return "not-in-scope";
  if (lastAttemptOk === false) return "not-checked";
  if (ledgerRaw != null) {
    const { ledger } = parseCaseLawLedger(ledgerRaw);
    if (!ledger) return "not-checked";
    if (ledger.citations.length) return "found";
    // A query with a numeric count was SENT; one at null was not. Below version 2 the model was never
    // asked to make that distinction, so only a positive count can vouch for a search there.
    const answered = ledgerSeparatesUnsentQueries(ledger)
      ? ledger.queries.some((q) => Number.isFinite(q.results))
      : ledger.queries.some((q) => q.results > 0);
    if (sourceAnswered || answered) return "none-found";
    return "not-checked";
  }
  if (/source unreachable|could not be reached|CONNECTION_CLOSED|not reachable|quota|unavailable/i.test(t)) return "not-checked";
  if (/No on-point precedent found|none found|no decisions found/i.test(t)) return "none-found";
  return "found";
}

/**
 * The court-decisions pass's own record, cut to the three facts its state is read from. PURE: the caller
 * reads the files and hands their text in, and an absent file is null.
 *
 * @param {object} p
 * @param {string|null} p.attemptsJsonl    the stage's attempt rows, one JSON object per line
 * @param {string|null} p.ledgerRaw        the retrieval record as written; null when the run kept none
 * @param {string|null} p.readingLogJsonl  the call log the case-law sources write, one JSON object per line
 * @param {string[]} p.bridges             the case-law source servers, whose calls log as `<server>__<tool>`
 * @returns {{lastAttemptOk: boolean|null, ledgerRaw: string|null, sourceAnswered: boolean}}
 */
export function caseLawPassRecord({ attemptsJsonl = null, ledgerRaw = null, readingLogJsonl = null, bridges = [] } = {}) {
  // A torn last line costs its own row, nothing more.
  const rows = (text) => String(text ?? "").split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((r) => r && typeof r === "object");
  const attempts = rows(attemptsJsonl).filter((r) => typeof r.ok === "boolean");
  const servers = (Array.isArray(bridges) ? bridges : []).map((b) => `${b}__`);
  // THE LAST ATTEMPT'S CALLS, AND NO EARLIER ONE'S. The retrieval record read beside this flag is what the
  // last attempt left, so an answer from an attempt before it must not vouch for that record's zeros. The
  // call log is the stage's, every attempt in one file, and an attempt's row is written when it ends: a
  // call belongs to the last attempt when it settled after the row before it. A time that cannot be read
  // cannot be placed, and does not count.
  const prev = attempts.length > 1 ? attempts[attempts.length - 2] : null;
  const since = prev ? Date.parse(prev.ts ?? "") : null;
  const inLastAttempt = (r) => since === null || (Number.isFinite(since) && Date.parse(r.ts ?? "") > since);
  return {
    lastAttemptOk: attempts.length ? attempts[attempts.length - 1].ok : null,
    ledgerRaw: ledgerRaw ?? null,
    sourceAnswered: rows(readingLogJsonl).some((r) => r.ok === true && servers.some((s) => String(r.tool ?? "").startsWith(s)) && inLastAttempt(r)),
  };
}

/**
 * WHICH TERRITORIES THE RUN SEARCHED, AND WHICH IT COULD NOT REACH — from the register PLAN. PURE.
 *
 * The plan is the authority on what was asked of the register; the `_records/` archive is only the
 * authority on what came back and was kept. Reading "what was searched" off the archive is why a
 * provider that keeps no records read as a provider nobody asked: no records, no countries, no section.
 * Both halves are on the plan whether or not anything is archived — `entries[].regions` is what it will
 * query, and `deferred_coverage` is what this provider does not cover, carrying the reason for each.
 *
 * Null for a run with no plan to read, which is an archived or legacy run: that is "cannot say", and it
 * is not the same answer as a plan that named nothing.
 *
 * `open`, given the run's plan-execution receipt: every territory of a planned slice the receipt deferred, which the
 * register could not search. The page never chips such a territory "Nothing found". Absent when nothing was deferred.
 *
 * @param {object|null} plan     the parsed `register-plan.json`, or null when there is none
 * @param {object|null} receipt  the parsed `_driver/plan-execution.json`, or null when there is none
 */
export function planTerritoriesOf(plan, receipt = null) {
  if (!plan || typeof plan !== "object") return null;
  const entryRegions = (plan.entries ?? []).flatMap((e) => (Array.isArray(e?.regions) ? e.regions : []));
  // `plan.regions` is the older shape and is the fallback, not a second source: a plan carrying entries
  // has already said which regions it will query, and unioning the two would report a region the
  // compiler moved OUT of `regions` into the deferral list as though it had been searched.
  const searched = entryRegions.length ? [...new Set(entryRegions.map(String))]
    : [...new Set((Array.isArray(plan.regions) ? plan.regions : []).map(String))];
  // A WORLDWIDE PLAN THAT NAMES NO REGION CANNOT SAY WHERE IT REACHED. On a provider that takes no region
  // list, worldwide compiles to queries with no jurisdiction clause at all — the whole database — so the
  // plan names nothing, and read as "searched these" that is "searched nowhere": the section that says
  // where a search reached disappeared on exactly the searches that reached furthest. Null is the answer
  // the plan can actually give, and the page then reads the countries off what the register returned.
  // Only when nothing was deferred: a worldwide order with deferrals is not an unrestricted sweep.
  if (plan.scope_basis === "worldwide" && !searched.length
    && !(Array.isArray(plan.deferred_coverage) && plan.deferred_coverage.length)) return null;
  const unreached = (Array.isArray(plan.deferred_coverage) ? plan.deferred_coverage : [])
    .map((d) => ({ jurisdiction: String(d?.jurisdiction ?? "").trim(), reason: String(d?.reason ?? "").trim() }))
    .filter((d) => d.jurisdiction);
  const deferredQids = new Set((Array.isArray(receipt?.deferred) ? receipt.deferred : []).map((d) => String(d?.qid ?? "")).filter(Boolean));
  const open = [...new Set((plan.entries ?? []).filter((e) => deferredQids.has(String(e?.qid ?? "")))
    .flatMap((e) => (Array.isArray(e?.regions) ? e.regions : [])).map(String))];
  return { searched, unreached, ...(open.length ? { open } : {}) };
}

/**
 * HOW DEEP THE LOCAL-LANGUAGE INVESTIGATION ACTUALLY WENT, against what the matter configured. PURE.
 *
 * The engine can run this investigation shallower than the account asked for, and until now it said so
 * in exactly one place: a sentence a model wrote in the Methodology paragraph. The redesigned report
 * replaces that paragraph with counts and named rows, so a run that went shallow said so on no page at
 * all. This is the field behind that row.
 *
 * DERIVED FROM THE RUN'S OWN RECORD, NEVER FROM PROSE, and not derived here either: the caller hands in
 * what `deriveLaneDepthVerdicts` produced, which is the one author of asked-versus-ran and reads the
 * frozen lane sidecar against the slices that executed. A second opinion computed in the publish path
 * would be a second answer to a question the engine has already answered.
 *
 * THE FOUR STATES, and the order they are decided in matters:
 *   not-in-scope  no lane was asked for anything — a plain clearance, or every lane switched off
 *   not-run       lanes were asked and none of them ran
 *   ran-shallow   a lane fell short of its ask, or was asked and did not run while another did
 *   ran           every lane that was asked ran at the depth it was asked for
 *
 * `ran: null` IS NOT `candidates`. A lane whose slices settle to nothing readable cannot say what it
 * delivered, and the jx verdicts are careful to report that as unestablished rather than as the lesser
 * depth. Folding it to `ran` here would put that claim back on a client's page, so it counts as short.
 *
 * @param {object|null} verdicts  per-lane `{asked, ran, shortfall}` from deriveLaneDepthVerdicts
 */
export function localLanguageDepth(verdicts) {
  if (!verdicts || typeof verdicts !== "object") return { state: "not-in-scope", lanes: {} };
  const lanes = {};
  for (const [lane, v] of Object.entries(verdicts)) {
    lanes[lane] = { configured: v?.asked ?? null, achieved: v?.ran ?? null };
  }
  const asked = Object.entries(verdicts).filter(([, v]) => v?.asked && v.asked !== "off");
  if (!asked.length) return { state: "not-in-scope", lanes };
  const ran = asked.filter(([, v]) => v?.ran);
  if (!ran.length) return { state: "not-run", lanes };
  const short = asked.some(([, v]) => v?.shortfall === true || !v?.ran);
  return { state: short ? "ran-shallow" : "ran", lanes };
}

// WHICH NATIVE SCRIPTS THE RUN SEARCHED, READ OFF WHAT RAN (owner, 2026-11-19). This read the plan alone, and any
// non-ASCII character made the page claim local script: an accented Latin spelling did, and so did a native-script
// term that was planned and never ran. Measured on the test instance's saved runs: the claim was fully borne out on 18 of
// 80; on 59 a native-script search ran while another planned one did not, and on 3 none ran at all. Now a script
// counts as searched only when a plan term in it COMPLETED: its row in the run's execution record is `enumerated`. A
// row the record keeps as `incomplete` (1,193 of 11,813 on those runs), or with no state, did not complete and does not
// count. A Latin term names no native script however it is accented, and a run that kept no execution record says
// nothing either way.
const NATIVE_SCRIPTS = [
  ["Hani", /\p{Script=Han}/u], ["Hira", /\p{Script=Hiragana}/u], ["Kana", /\p{Script=Katakana}/u], ["Hang", /\p{Script=Hangul}/u],
  ["Cyrl", /\p{Script=Cyrillic}/u], ["Arab", /\p{Script=Arabic}/u], ["Grek", /\p{Script=Greek}/u], ["Hebr", /\p{Script=Hebrew}/u],
  ["Thai", /\p{Script=Thai}/u], ["Deva", /\p{Script=Devanagari}/u],
];
// WHERE EACH SCRIPT COMPLETED, so a script searched in one territory and not in another keeps that gap (2026-11-19).
// A territory is a plan term's region, folded the way the page folds the plan's territories (`normRegion`: EM and
// euipo are EU, GB is UK), so one territory under two spellings is never a gap.
// A TERM THAT NAMES NO REGION ASKS THE PLAN'S (design, 2026-11-20). The executor fills an empty list from the frozen
// plan before it sends (`withPlanRegions`), and this reads the term through the same function, so the page names the
// territories the register was asked. Where the plan names none either, the question went with no territory: on a plan
// stamped worldwide that is the worldwide search, and on any other plan the record does not say where it was asked, so
// the term is kept apart under `unnamed` rather than read as searching nowhere or everywhere. On the test instance's 88
// saved plans, 464 of 1,492 native-script terms name no region, and none is on an unstamped plan that names none.
// A WORLDWIDE SEARCH IS ONE THE PLAN SAYS IS WORLDWIDE, never one inferred from a long list. The plan stamps
// `scope_basis: "worldwide"` when the matter was unrestricted, because on some registers a worldwide matter compiles to
// the register's full office list, which reads by shape like 186 hand-picked territories. On such a plan, a term asked
// the plan's whole territory list, or no territory where the plan names none, is the worldwide search, kept under
// `worldwide` ("searched" or "missed"); its territories are not listed as planned one by one, and when it completed
// they all count as searched.
// A PLAN ON A REGISTER WITH ITS OWN OFFICE KEYS NAMES OFFICES, NOT TERRITORIES: `uspto`, `ipi`, `inpi-fr`. The page has
// no name for those, and a territory it cannot name would reach a reader as the key. Each is read back as the territory
// it serves through that register's own translate, territory to office, run in reverse over every two-letter code. It
// is asked only of a key the page cannot name, so a code that is already a territory keeps its meaning: one register
// files Benelux under BX, which its translate also reaches from Belgium. A key nothing translates to stays as written.
function officeTerritories(provider) {
  const out = new Map();
  let translate = null;
  try { translate = provider ? capabilitiesFor(provider)?.offices?.translate : null; } catch { translate = null; }
  if (typeof translate !== "function") return out;
  for (let a = 65; a < 91; a++) for (let b = 65; b < 91; b++) {
    const code = String.fromCharCode(a, b);
    let key = null;
    try { key = translate(code); } catch { key = null; }
    const k = String(key ?? "").toUpperCase();
    if (k && k !== code && !out.has(k)) out.set(k, code);
  }
  return out;
}

/**
 * The native scripts the run's plan searched in, `{ searched, missed, territories }`, keyed by ISO 15924 code: a script
 * is searched when a plan term written in it completed, and missed when terms in it were planned and none completed.
 * `territories` holds, per script, the territories where a term in it completed (`searched`) and those where terms in
 * it were planned and none completed (`missed`), plus `unnamed` ("searched" or "missed") when terms in it were asked no
 * territory the record names, and `worldwide` ("searched" or "missed") when a term in it asked the whole of a plan
 * stamped worldwide. A term with no region of its own is read with the plan's, as the executor sends it. Null
 * when the run kept no execution record, so none of it can be said. PURE.
 */
export function localScripts(registerPlan, planExecution) {
  if (!planExecution || !Array.isArray(planExecution.executed)) return null;
  const ran = new Set(planExecution.executed.filter((x) => x?.state === "enumerated").map((x) => x?.qid).filter(Boolean));
  const office = officeTerritories(registerPlan?.provider);
  const fold = (list) => [...new Set((Array.isArray(list) ? list : []).map((r) => {
    const code = normRegion(r);
    return regionName(code) === code && office.has(code) ? normRegion(office.get(code)) : code;
  }).filter(Boolean))];
  const whole = registerPlan?.scope_basis === "worldwide" ? new Set(fold(registerPlan?.regions)) : null;
  // The scripts whose question went out with no territory and completed: it reached every territory the register holds,
  // so a narrower search in that script that did not complete leaves no gap. A worldwide search sent as the plan's whole
  // list reaches that list, and counts it as searched, below.
  const searched = new Set(), planned = new Set(), at = {}, everywhere = new Set();
  for (const e of Array.isArray(registerPlan?.entries) ? registerPlan.entries : []) {
    const regions = fold(withPlanRegions({ regions: e?.regions }, registerPlan).regions);
    const worldwide = whole !== null && regions.length === whole.size && regions.every((r) => whole.has(r));
    const done = ran.has(e?.qid);
    for (const [code, re] of NATIVE_SCRIPTS) {
      if (!re.test(String(e?.term ?? ""))) continue;
      planned.add(code);
      if (done) searched.add(code);
      const t = (at[code] ??= { searched: new Set(), planned: new Set(), unnamed: null, worldwide: null });
      if (worldwide) t.worldwide = done || t.worldwide === "searched" ? "searched" : "missed";
      if (worldwide && done && !regions.length) everywhere.add(code);
      for (const r of regions) { if (!worldwide) t.planned.add(r); if (done) t.searched.add(r); }
      if (!regions.length && !worldwide) t.unnamed = done || t.unnamed === "searched" ? "searched" : "missed";
    }
  }
  const territories = {};
  for (const code of Object.keys(at).sort()) {
    const t = at[code];
    territories[code] = { searched: [...t.searched].sort(), missed: everywhere.has(code) ? [] : [...t.planned].filter((r) => !t.searched.has(r)).sort(),
      ...(t.unnamed ? { unnamed: t.unnamed } : {}), ...(t.worldwide ? { worldwide: t.worldwide } : {}) };
  }
  return { searched: [...searched].sort(), missed: [...planned].filter((c) => !searched.has(c)).sort(), territories };
}

/**
 * The whole record, composed from what the run holds. PURE — every argument is already-written material.
 *
 * @returns {{schemaVersion: number, cleared: object, counts: object}}
 */
export function searchDepthRecord({ auditMd = "", recordIndex = {}, recordFileNames = [], bandRecordIds = null, commonLawGrid = null, caseLawText = "", caseLawRecord = null, registerPlan = null, planExecution = null, laneDepthVerdicts = null, noMarketplacesPicked = false } = {}) {
  // `recordFileNames: null` travels all the way to the page — see recordsByCountry. The default stays `[]`
  // because that is "the caller said nothing", not "the store is absent"; only the publish path knows the
  // difference and it is the one producer.
  //
  // A PROVIDER THAT ARCHIVES NO RECORDS STILL RETURNED THEM. Its search answer is the band, and every
  // record in it carries its office in its own id (`/mark/<office>/<id>`). So where there is no archive
  // the band is what was read: counted by record, filed by office. Without it a run that read 785 register
  // records reported "cannot say" and the report carried no register row and no country at all.
  if (recordFileNames === null && Array.isArray(bandRecordIds)) recordFileNames = recordNamesFromIds(bandRecordIds);
  const cleared = clearedNames(auditMd, recordIndex);
  const groups = {};
  for (const key of CLEARED_GROUPS) groups[key] = 0;
  for (const c of cleared.register) groups[c.group] += 1;
  return {
    schemaVersion: 1,
    cleared: { register: cleared.register, web: cleared.web, groups },
    counts: {
      recordsByCountry: recordsByCountry(recordFileNames),
      recordsRead: recordFileNames === null ? null : recordFileNames.length,
      // The company picked no marketplaces: the report says the general web ran plus any stores chosen for
      // the matter. Stamped only when true, so every other run's record is unchanged.
      sweep: { ...sweepCounts(commonLawGrid, auditMd), ...(noMarketplacesPicked ? { noMarketplacesPicked: true } : {}) },
      localScripts: localScripts(registerPlan, planExecution),
      courtDecisions: courtDecisionsState(caseLawText, caseLawRecord ?? undefined),
      // `localScripts` above answers which scripts' spellings were searched; this answers how deep
      // the investigation went against what was configured. Two different facts, and the row the report
      // reserves is for the second.
      localLanguage: localLanguageDepth(laneDepthVerdicts),
    },
  };
}
