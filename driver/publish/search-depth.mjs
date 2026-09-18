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
      const url = field(block, "url");
      if (url) out.web.push({ title, url, type: field(block, "type") });
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
 * @returns {"found"|"none-found"|"not-checked"|"not-in-scope"}
 */
export function courtDecisionsState(caseLawText) {
  const t = String(caseLawText ?? "");
  if (!t.trim()) return "not-in-scope";
  if (/source unreachable|could not be reached|CONNECTION_CLOSED|not reachable|quota/i.test(t)) return "not-checked";
  if (/No on-point precedent found|none found|no decisions found/i.test(t)) return "none-found";
  return "found";
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
 * @param {object|null} plan  the parsed `register-plan.json`, or null when there is none
 */
export function planTerritoriesOf(plan) {
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
  return { searched, unreached };
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

/** Was the name searched in a non-Latin script? Read off the plan's own terms, never asserted. PURE. */
export function localScriptSearched(registerPlan) {
  const entries = Array.isArray(registerPlan?.entries) ? registerPlan.entries : [];
  return entries.some((e) => /[^\x00-\x7F]/.test(String(e?.term ?? "")));
}

/**
 * The whole record, composed from what the run holds. PURE — every argument is already-written material.
 *
 * @returns {{schemaVersion: number, cleared: object, counts: object}}
 */
export function searchDepthRecord({ auditMd = "", recordIndex = {}, recordFileNames = [], bandRecordIds = null, commonLawGrid = null, caseLawText = "", registerPlan = null, laneDepthVerdicts = null } = {}) {
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
      sweep: sweepCounts(commonLawGrid, auditMd),
      localScriptSearched: localScriptSearched(registerPlan),
      courtDecisions: courtDecisionsState(caseLawText),
      // `localScriptSearched` above answers whether the spellings were searched; this answers how deep
      // the investigation went against what was configured. Two different facts, and the row the report
      // reserves is for the second.
      localLanguage: localLanguageDepth(laneDepthVerdicts),
    },
  };
}
