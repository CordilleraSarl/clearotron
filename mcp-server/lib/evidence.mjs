// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lib/evidence.mjs — the EVIDENCE layer a client account may interrogate: the records considered, the
// searches run, and the coverage statement. Read-only, and the ONE place the evidence projection lives.
//
// WHY THIS EXISTS. Until now a client's assistant could reach only the report's PROSE (brief,
// read_artifact→report, the curated cards). The run holds far more on disk — every register
// and common-law record considered, and the negative results ("we searched the German national register in
// classes 9/28/41/42 and found nothing") — and a lawyer defending a filing decision needs exactly that.
// scrub.mjs's rule was "no more than the delivered report"; this file is the deliberate, bounded exception
// to it, and scrub.mjs's header now says so. What the exception does NOT cover is the METHOD.
//
// ── THE RULE THAT MAKES THIS SAFE, stated once ───────────────────────────────────────────────────────
// Everything emitted from here is a NAMED STRUCTURED FIELD or an enum derived from one. There is no code
// path that forwards free prose. That is a deliberate choice over the obvious alternative — read the text
// and filter out the bad words — because a blocklist is only ever as complete as the last time someone
// looked at the corpus, and the whole point is to stop someone distilling the firm's method out of the
// system. A field nobody thought about is withheld by DEFAULT here, rather than leaked until noticed.
//
// So the audit blocks' `key_factors`, `notes`, `impact`, `own_rights` prose and `withdrawn_reason` are not
// filtered — they are never read. Concretely, `notes` on a negative result reads
//   "primary-sweep skeptic-re-run supplemental; blind-frame re-derivation fold-in; enumerated; 0 records"
// — the stage names and reviewer lanes are the method, and no projection here has that string in scope.
//
// THE ONE EXCEPTION, and why it is not one. findings.json `coverage[].note` IS forwarded — because the
// client report ALREADY renders it, verbatim, in its "What we covered — and what's open" grid
// (publish/render.mjs coverageGrid). Withholding it here would make the connector a LESS informative copy
// of the PDF in the client's inbox. It goes through the transforms the report applies to it, from
// the SAME definition in publish/parse.mjs — never a second copy — plus stripEngineInternals, the method
// filter; see the note on `clean` below for why that pair and not the whole composition.
// `coverage_judgment.reason` is NOT forwarded: render.mjs gates it `!CLIENT` as engine wording, so it stays
// internal here too.
//
// AND THE LESSON THE CORPUS ADDED (see valueField): "structured field" is not a synonym for "safe value".
// A model free-typing into `classes:` welded an engine clause onto a class list. Structured KEYS are the
// allowlist; structured VALUES still have to be recognised, not trusted.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAudit, stripEngineInternals } from "./driver.mjs";
import { readRecordArtifacts } from "../../driver/registry-fidelity.mjs";

// The client report's own display word per coverage state (publish/render.mjs COV_STATE). Carried here so
// the connector and the PDF call the same state the same thing; a state absent from the map degrades to
// its raw token rather than being dropped (an unknown state is still a fact about the run).
const COV_WORD = {
  "confirmed-clean": "Searched — clean",
  "coverage-limited": "Partially covered",
  open: "Open item",
  "not-searched": "Not run this run",
  note: "Note",
};

// The coverage-note transform, chosen to MATCH the client report's own rendering of these exact strings
// rather than to be maximally strict — scrub.mjs's warning applies in full here: "a scrubber stricter than
// the report would delete content the client was already sent, and would quietly make the MCP a different
// product from the PDF in their inbox."
// — `plainify` is GONE from both sides. It was find-and-replace over a client string and it ate
//                           a trademark; the rows now carry a driver-emitted `areaLabel`, which
//                           this surface reads for the same reason the report does.
//   stripEngineInternals  — added deliberately: it is the METHOD filter (its METHODOLOGY_INTERNAL_RE
//                           catches reviewer lanes, orchestration and model names), which is the exact
//                           thing this whole surface exists to withhold. It drops only sentences carrying
//                           an unambiguous engine token, so plain coverage prose is untouched.
//   stripTelemetry        — deliberately NOT applied. It drops record/search COUNTS, and on a coverage
//                           statement those are the evidence ("1,380 records reviewed" is what a lawyer
//                           wants to hear); the client report keeps them in this grid too. Composing it
//                           here cost a real delivered sentence in testing — over-stripping is a bug, not
//                           a safe default, when the report already showed the client the text.
const clean = (s) => {
  const t = stripEngineInternals(String(s ?? "")).trim();
  return t || null;
};

// ---- the record set ----------------------------------------------------------------------------

// findings.json is read RAW here, not through findings-model.parseFindingsJson, for two reasons: that
// parser is strict by design (one malformed row throws and would blank the whole evidence view on a
// surface that should degrade, never fail), and it pulls framework.mjs into what lib/driver.mjs keeps a
// deliberately light dependency surface. No client-safety RULE is restated by reading raw — the allowlist
// below IS the rule, and it lives in exactly one place.
function readFindingsJson(runDir) {
  try {
    const doc = JSON.parse(readFileSync(join(runDir, "findings.json"), "utf8"));
    return (doc && typeof doc === "object" && !Array.isArray(doc)) ? doc : null;
  } catch { return null; }
}

// "register-vendor" → register; "common-law-web"/"common-law-marketplace" → common-law. Also accepts the
// audit block's `source_layer` ("Register" / "Common-law"). Anything unrecognised is null, not guessed.
function layerOf(v) {
  const s = String(v ?? "").toLowerCase();
  if (s.startsWith("register")) return "register";
  if (s.startsWith("common-law")) return "common-law";
  return null;
}

const normMark = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

// IDENTITY IS MARK + OWNER, never the mark alone — and this is not a preference, it is the join
// publish/audit-from-spine.mjs already uses, for a reason it states: "mark alone would be far more
// false-positive-prone ... audit block titles ARE the mark and a run's own cleared mark commonly appears
// as a title." Keying the union on the mark alone produced a CHIMERA on a real run: findings.json's
// common-law "Venzy" (a children's-app operator) absorbed the audit's register "VENZY" (a pharmaceutical
// company's Class 5 registration), and the projection served one record with the first one's owner and the
// second one's classes and status. Fabricating a register record is the worst thing this surface could do,
// so two entries merge only when their owners agree or one of them has no owner to disagree with.
const normOwner = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function sameEntity(a, b) {
  const x = normOwner(a), y = normOwner(b);
  if (!x || !y) return true;                       // one side is silent — not a contradiction
  return x === y || x.startsWith(y) || y.startsWith(x);
}

// A structured field is not automatically a SAFE field, and this is the lesson the corpus taught: the
// audit's `classes` on the EA record reads `9/28/41 (target) — **register scope un-enumerated**`. The key
// is structured; the value is a class list with a coverage OPINION welded onto it in engine vocabulary.
//
// So "allowlist the field" is necessary and not sufficient — a value the model free-typed gets recognised
// as a VALUE, positively, or it does not ship. valueField keeps the fact and cuts the commentary: markdown
// emphasis is markup, and an em-dash clause is where prose starts in this corpus. Over-length is treated as
// prose too, because a register status is never a paragraph.
function valueField(s, max = 120) {
  if (typeof s !== "string") return null;
  const t = deMarkup(s).split(/\s+—\s+|\s+--\s+/)[0].trim();
  return t && t.length <= max ? t : null;
}

/**
 * evidenceRecords(run) → { source, records[] }
 *
 * The union of findings.json's findings and audit.md's `# Findings` blocks, so a record that never became
 * a curated report card still appears — that is the half of the picture the delivered report does not
 * enumerate, and the reason this tool exists. findings.json wins on overlap (it is the structured
 * contract; the audit block is markdown of the same fact).
 *
 * `retrieved` answers a question the corpus itself raises: this very run's findings.json `corrections`
 * records deleting CONFABULATED serials. A record handed to a client's assistant as a bare fact invites
 * reliance on it, so each one says whether its provider record was actually FETCHED and archived under the
 * run (_records/, the same set publish/index.mjs derives its 'retrieved' fetch-state from) or whether the
 * citation rests on the model's assembled prose. null when the run has no record archive at all — an
 * honest "unknown", never a fabricated true.
 */
export function evidenceRecords(run) {
  const { P, runDir } = run;
  const records = new Map();          // normalised mark → projected record
  const archived = readRecordArtifacts(runDir);
  // `_records/` is the REGISTER fetch archive — the provider record bodies the run pulled. It says nothing
  // about a common-law source, and asking it about one gets a confident wrong answer: run against a real
  // populated archive, every marketplace and regulator citation (an EMA product PDF, a pharmacy listing, a
  // storefront page) came back `false`, which the account SKILL.md reads as "rests on the write-up, not on
  // a fetched record". Telling a client their real evidence is unverified is the exact inverse of the
  // safeguard's purpose, so the question is only asked where the archive can answer it.
  const retrievedFor = (layer, url) => {
    if (layer !== "register") return null;              // not a question this archive can answer
    if (!archived.size) return null;                    // no archive on this run — unknown, not false
    if (!url) return false;
    const u = String(url).toLowerCase();
    for (const uri of archived.keys()) if (u.includes(uri) || uri.includes(u)) return true;
    return false;
  };

  // The provenance signal that DOES span both layers, straight out of findings.json's own contract:
  // whether the finding's use meter was read off a record or inferred from a signal. Available for a
  // marketplace listing exactly as for a register hit, and it needs no archive.
  const BASIS = new Set(["verified-from-record", "inferred-from-signal"]);
  const basisOf = (f) => {
    const b = f?.meters?.use?.basis;
    return BASIS.has(b) ? b : null;
  };

  // ── — A `url` IS A SHAPE, NOT A TYPE ────────────────────────────────────────────────────────
  //
  // Both sources of this field are MODEL-AUTHORED — `findings.json`'s `resolved_link` and audit.md's
  // `url:` line — and both used to accept anything that was a string. A prose sentence is a string, so a
  // seat that had no URI and said so in words had its explanation promoted into the field the client face
  // reads as a link. Off a real run (2026-08-13):
  //
  //   "URI carried under the primary-sweep ID/ZA/TR jurisdiction-gap supplemental
  //    (exact/compound-descriptor block)"
  //
  // The seat did nothing wrong: it had no URI and said so. The projection turned an explanation into a
  // link — and in doing so put a stage name ("primary-sweep") on a client surface. Closing the SHAPE is
  // what stops that recurring, because it does not depend on predicting which words the next seat picks.
  //
  // http/https ONLY, not "parses as a URI". `new URL()` happily accepts `mailto:`, `data:` and
  // `javascript:`, and this value is rendered as a link by the client face — a permissive parse here
  // would trade a prose leak for a worse one. Every url in the corpus is a web address, which is what
  // the field is for.
  //
  // THE PROSE IS DROPPED, DELIBERATELY, AND NOT RELOCATED. It is tempting to keep it in a field named for
  // what it is, and that is the wrong call HERE: the only such text observed was an explanation of
  // internal method, so a `linkNote` field would move a method leak from one client-visible key to
  // another while looking like diligence. The record still carries the finding, its owner and its layer;
  // what is lost is a sentence saying the seat had no URI, which `url: null` already says.
  const asUrl = (v) => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    if (!t) return null;
    let u;
    try { u = new URL(t); } catch { return null; }
    return (u.protocol === "http:" || u.protocol === "https:") ? t : null;
  };

  const doc = readFindingsJson(runDir);
  for (const f of (Array.isArray(doc?.findings) ? doc.findings : [])) {
    const mark = typeof f?.mark === "string" ? f.mark.trim() : "";
    if (!mark) continue;
    const url = asUrl(f?.source?.resolved_link);   // — shape, not type
    records.set(`${normMark(mark)}|${normOwner(f?.owner?.name)}`, {
      mark,
      layer: layerOf(f?.source?.source_type),
      owner: valueField(f?.owner?.name),
      ownerCountry: valueField(f?.owner?.country),
      registrations: Array.isArray(f?.owner?.registrations)
        ? f.owner.registrations.filter((r) => typeof r === "string") : [],
      classes: [],                      // findings.json carries no class list; the audit block below may
      status: null,
      url,
      retrieved: retrievedFor(layerOf(f?.source?.source_type), url),
      basis: basisOf(f),
      // The FLAG, never the reason. publish/audit-from-spine.mjs documents the copper-gantry defect:
      // shipping an asserted claim beside its refutation with nothing saying which won. Omitting the
      // marker entirely would rebuild that; carrying withdrawn_reason would ship the review's reasoning.
      superseded: f?.disposition === "withdrawn",
      source: "findings.json",
    });
  }

  // audit.md fills in what findings.json has no field for (classes, register status) and adds records that
  // never became a rated finding.
  let blocks = [];
  try { blocks = existsSync(P.audit) ? (parseAudit(P.audit).findings ?? []) : []; } catch { blocks = []; }
  for (const b of blocks) {
    // Block titles carry markdown emphasis in the corpus (`## **VENZY** (primary form)`) — the mark is the
    // word, not the markup.
    const mark = deMarkup(b?._title ?? "").trim();
    if (!mark) continue;
    const key = normMark(mark);
    // — the SECOND copy of the same check, and it is why the fix is a shared predicate rather
    // than an edit at the reported line. audit.md is generated from the same model output.
    const url = asUrl(b.url);
    const blockOwner = valueField(b.owner);
    const existing = [...records.values()].find((r) => normMark(r.mark) === key && sameEntity(r.owner, blockOwner));
    if (existing) {
      if (!existing.classes.length) existing.classes = classListFrom(b.classes);
      existing.status ??= valueField(b.status);
      existing.owner ??= valueField(b.owner);
      existing.ownerCountry ??= valueField(b.owner_country);
      existing.url ??= url;
      existing.layer ??= layerOf(b.source_layer);
      continue;
    }
    records.set(`${key}|${normOwner(blockOwner)}`, {
      mark,
      layer: layerOf(b.source_layer),
      owner: blockOwner,
      ownerCountry: valueField(b.owner_country),
      registrations: [],
      classes: classListFrom(b.classes),
      status: valueField(b.status),
      url,
      retrieved: retrievedFor(layerOf(b.source_layer), url),
      basis: null,                      // audit.md carries no meter — only findings.json does
      superseded: false,
      source: "audit.md",
    });
  }

  return {
    source: doc ? (blocks.length ? "findings.json + audit.md" : "findings.json") : (blocks.length ? "audit.md" : "none"),
    records: [...records.values()],
  };
}

// ---- the search log ----------------------------------------------------------------------------

// Register offices are recognised POSITIVELY, so "DPMA-national register (DE)" yields office=DPMA rather
// than mistaking DPMA for the searched term. Extend this list when a run names an office it lacks — the
// cost of a miss is office:null, never a leak.
const OFFICES = ["DPMA", "EUIPO", "USPTO", "WIPO", "UKIPO", "JPO", "KIPO", "CNIPA", "INPI", "IPOS", "CIPO"];

// The match-shape words a searcher would recognise, matched positively. Anything else in the string —
// counts, internal band names, stage vocabulary — is not captured, so it cannot be emitted.
const MATCH_SHAPES = [
  [/\bexact\b/i, "exact"], [/\bfuzzy\b/i, "fuzzy"], [/\btypo\b/i, "typo"],
  [/\bphonetic\b/i, "phonetic"], [/\bhomophone\b/i, "homophone"],
  [/\btranslit[\w-]*/i, "transliteration"], [/\bmeaning\b/i, "meaning"],
  [/\bphrase\b/i, "phrase"], [/\bpossessive\b/i, "possessive"],
  [/\bhyphen\b/i, "hyphen"], [/\bcompound\b/i, "compound"], [/\*/, "wildcard"],
];

// Markdown emphasis is presentation, not content: `**DPMA-national register (DE)**` must not read as a
// `*` wildcard, and the term extractor must see the word, not the markup.
const deMarkup = (s) => String(s ?? "").replace(/\*\*|__/g, "");

// Record COUNTS ride along in parentheses — `PARADISE (424)`, `パラダイス (34) / 파라다이스 (20)`. They are
// process exhaust rather than the query, and dropping them first is what lets the rest of the string be
// recognised as the bare term it is.
const deCount = (s) => String(s ?? "").replace(/\s*\(\s*~?\s*[\d,]+\s*\)/g, "");

// A searched term is recognised three ways, in order, and NOT recognised otherwise:
//   1. explicitly quoted — `exact "Drivers Haven" (default)`
//   2. the whole string, when it carries no query scaffolding at all. This is how the common-law sweep
//      writes them and it is the bulk of the corpus: `레이서스 파라다이스`, `赛车天堂`, `RACERZ`,
//      `PARADISE WORLD`. Those scripts are caseless, so a capitals rule cannot see them at all.
//      "No scaffolding" is checked positively: no match-shape keyword, no residual parenthetical, and
//      none of the structural punctuation the audit uses for anything OTHER than a query (a record path,
//      a bracketed class list, an em-dash clause, a key: value tail).
//   3. an ALL-CAPS token — `exact PARADISE`, `*PARADISE / fuzzy`. Two-letter tokens (ZH, JP, DE) are
//      language/jurisdiction codes, not marks, and the register offices above are offices, not marks.
const SCAFFOLD = /[[\]`:—]|\/mark\//;

// "Does this read as a NAME?" — the property that separates a searched mark from a description of a
// search. Every alphabetic token must start upper-case or be in a caseless script (CJK, Hangul, Kana,
// Arabic); a token that is entirely lower-case Latin is prose. So `Racer's Paradise`, `PARADISE WORLD`,
// `Вензи` and `레이서스 파라다이스` qualify and `national register`, `formative phrases` and
// `one-swap lead-noun neighbours` do not. A property, not a list of banned words — a description nobody
// anticipated still fails it.
function looksLikeName(s) {
  const tokens = String(s).split(/\s+/).filter((t) => /\p{L}/u.test(t));
  if (!tokens.length || tokens.length > 5) return false;
  // A lone two-letter capital is a language or jurisdiction code (ZH, DE, JP), never a mark. Caseless
  // scripts are exempt from the length floor — 天堂 is a whole word in two characters.
  const cased = tokens.filter((t) => /\p{Lu}|\p{Ll}/u.test(t));
  if (cased.length && cased.every((t) => t.replace(/[^\p{L}]/gu, "").length <= 2)) return false;
  return tokens.every((t) => !/^\p{Ll}/u.test(t.replace(/^[^\p{L}\p{N}]+/u, "")));
}

// Everything the extractors above RECOGNISED — bracketed and parenthesised groups, the match-shape words,
// a labelled class list, an office name — removed, leaving the residue. Only recognised scaffolding is
// removed, and the residue then has to pass both the structural guard and looksLikeName to count, so an
// unrecognised fragment cannot ride out as a "term".
function residue(s) {
  let t = String(s).replace(/\[[^\]]*\]/g, " ").replace(/\([^)]*\)/g, " ");
  for (const [re] of MATCH_SHAPES) t = t.replace(new RegExp(re.source, "gi"), " ");
  t = t.replace(/\bcl(?:ass(?:es)?)?\.?\s*[\d]{1,2}(?:\s*[/,]\s*\d{1,2})*/gi, " ");
  for (const o of OFFICES) t = t.replace(new RegExp(`\\b${o}\\b`, "g"), " ");
  // A fragment left starting with a hyphen is the tail of a compound we just recognised and removed
  // ("translit-numeric" → "-numeric"): it belongs to the scaffolding, not to the query.
  return t.replace(/[,;]/g, " ").replace(/\s+/g, " ").replace(/(^|\s)-\S+/g, " ").replace(/\s+/g, " ").trim();
}

function extractTerm(raw) {
  const s = deCount(deMarkup(raw));
  const quoted = s.match(/["“]([^"”]{1,120})["”]/);
  if (quoted) return quoted[1].trim();
  const bare = s.trim();
  if (bare && bare.length <= 60 && !SCAFFOLD.test(bare) && !bare.includes("(")
      && !MATCH_SHAPES.some(([re]) => re.test(bare)) && looksLikeName(bare)) return bare;
  for (const tok of s.match(/[\p{Lu}][\p{Lu}'’]{2,}/gu) ?? []) {
    if (!OFFICES.includes(tok)) return tok;
  }
  // `translit-numeric exact Вензи [cl 5]` — a real term in a cased script that is not ALL-CAPS, wrapped in
  // scaffolding the rules above recognise and can therefore take away.
  const rest = residue(s);
  if (rest && rest.length <= 40 && !SCAFFOLD.test(rest) && looksLikeName(rest)) return rest;
  return null;
}

const asClasses = (nums) => [...new Set(nums.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 45))];

// In a SEARCH TERM, classes are read only where they are LABELLED ("cl 9/28/41/42", "cl.25", "class 35") —
// never from a bare parenthesised number, which in this corpus is a record COUNT ("PARADISE (424)").
function extractClasses(s) {
  const m = String(s ?? "").match(/\bcl(?:ass(?:es)?)?\.?\s*([\d]{1,2}(?:\s*[/,]\s*\d{1,2})*)/i);
  return m ? asClasses(m[1].split(/[/,]/)) : [];
}

// In a RECORD's `classes:` field every number IS a class, so they are read directly — but only the numbers.
// This is what keeps `9/28/41 (target) — **register scope un-enumerated**` from shipping its opinion:
// [9, 28, 41] survives, the engine clause never enters the projection. `\b\d{1,2}\b` cannot match inside a
// year, so `(filed 2023-06-13)`-style tails contribute nothing.
function classListFrom(s) {
  if (typeof s !== "string") return [];
  return asClasses(deMarkup(s).split(/\s+—\s+/)[0].match(/\b\d{1,2}\b/g) ?? []);
}

// A parenthesised group of 2-letter uppercase codes — "(DE)", "(JP/KR/AR/CY)". "(default)", "(merch)" and
// "(424)" do not match, so they are not mistaken for jurisdictions.
function extractJurisdictions(s) {
  const out = [];
  for (const m of String(s).matchAll(/\(([A-Z]{2}(?:\s*\/\s*[A-Z]{2})*)\)/g)) {
    for (const c of m[1].split("/")) out.push(c.trim());
  }
  return [...new Set(out)];
}

// The closed outcome vocabulary. Derived from the block's `result` field alone; a shape nobody anticipated
// lands on "recorded" (an honest "this search is on the record and its result did not classify") rather
// than being forced into a bucket it may not belong in.
//   no-hit               nothing came back
//   found                it DID surface something, which is carried in the findings — the row is a search
//                        receipt, not a negative result, and calling it a clean would misread the file
//   out-of-scope         hits came back and were set aside as off-field
//   excluded-own-rights  hits that belong to the applicant or an affiliate: not a conflict at all
//   negligible           hits present but immaterial in the searched classes
//   screened-out         a record came back and was set aside on its own facts — most often a dead or
//                        expired registration. Distinct from out-of-scope (wrong field) and from no-hit
//                        (nothing there at all): a lawyer asking "did you see the expired VENZY marks?"
//                        is asking exactly this, and collapsing it into "recorded" would answer no.
function outcomeOf(result) {
  const r = String(result ?? "").toLowerCase();
  if (/applicant-affiliate|applicant'?s own|own[- ]rights/.test(r)) return "excluded-own-rights";
  if (/screened out|screened-out|dead-status|\bexpired\b/.test(r)) return "screened-out";
  if (/dropped|off-field|out-of-scope|out of scope/.test(r)) return "out-of-scope";
  if (/negligible/.test(r)) return "negligible";
  // A result that OPENS with "no" is a negative, whatever the corpus calls the thing it did not find:
  // "No results", "No similar listings (8 candidates reviewed)", "No pharmaceutical product named VENOSY".
  // Enumerating those nouns would be a list to keep up with; the leading "no" is the shape they share.
  if (/^\s*no\b/.test(r) || /no register hit|\bno\b[^.]*\bhit\b/.test(r)) return "no-hit";
  if (/similar listings found|see findings/.test(r)) return "found";
  return "recorded";
}

/**
 * searchLog(run) → { count, searches[] }
 *
 * The run's negative results — the "we looked here and found nothing" half of a defensible clearance,
 * which the delivered report does not enumerate. Each row is built by POSITIVE EXTRACTION from the block's
 * `search_term`: the term, the match shapes, the classes, the jurisdictions and the office, each captured
 * by a rule that recognises it. Whatever the string also contains is not captured and therefore cannot be
 * emitted. The block's `notes` field — which carries the stage and reviewer-lane names — is never read.
 *
 * A row whose term does not parse still ships (with term:null): the COUNT of searches that came back empty
 * is itself the defensibility signal, so a row is never dropped for being hard to structure.
 *
 * Per-row completeness ("was this enumerated to exhaustion or sampled?") is deliberately NOT derived here.
 * That question is answered by coverageStatement below, in the words the client report already uses for
 * it — deriving a second, weaker answer from prose we do not read would be a guess wearing a flag's
 * clothes.
 */
export function searchLog(run) {
  const { P } = run;
  let blocks = [];
  try { blocks = existsSync(P.audit) ? (parseAudit(P.audit).negatives ?? []) : []; } catch { blocks = []; }
  const searches = blocks.map((b, i) => {
    const raw = deMarkup(typeof b.search_term === "string" ? b.search_term : "");
    return {
      id: String(b._title ?? `NR${i + 1}`).trim() || `NR${i + 1}`,
      layer: layerOf(b.source_layer),
      term: extractTerm(raw),
      matchShapes: MATCH_SHAPES.filter(([re]) => re.test(raw)).map(([, name]) => name),
      classes: extractClasses(raw),
      jurisdictions: extractJurisdictions(raw),
      office: OFFICES.find((o) => new RegExp(`\\b${o}\\b`).test(raw)) ?? null,
      outcome: outcomeOf(b.result),
    };
  });
  return { count: searches.length, searches };
}

// ---- the coverage statement --------------------------------------------------------------------

/**
 * coverageStatement(run) → { areas[], note }
 *
 * findings.json's coverage ledger — what was searched, what is only partially covered, and what was not
 * reached — in the same words and with the same display wording the client report's "What we covered — and
 * what's open" grid uses. This is the honest answer to "is a clean result in this area actually clean?",
 * and it is the piece a lawyer most needs when the verdict is conditional.
 *
 * coverage_judgment is NOT included: render.mjs gates its `reason` behind !CLIENT as engine wording, and a
 * surface that is meant to match the client report must not out-disclose it.
 */
export function coverageStatement(run) {
  const doc = readFindingsJson(run.runDir);
  const areas = (Array.isArray(doc?.coverage) ? doc.coverage : []).map((c) => ({
    area: clean(c?.areaLabel || c?.area),   // — the reader label the report prints, falling back to the identifier on an archived row
    state: typeof c?.state === "string" ? c.state : null,
    stateLabel: COV_WORD[c?.state] ?? (typeof c?.state === "string" ? c.state : null),
    note: clean(c?.note),
  })).filter((c) => c.area || c.note);
  return {
    areas,
    note: areas.length
      ? "What the search covered, in the same terms as the report's own coverage section. An area that is not 'Searched — clean' is not cleared: treat it as open, not as a negative result."
      : "This run records no coverage ledger.",
  };
}
