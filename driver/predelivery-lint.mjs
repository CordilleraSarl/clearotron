// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// predelivery-lint.mjs — spec A2: the deterministic pre-delivery lint. CODE ONLY, no model anywhere.
// Runs over the assembled deliverable surfaces (report.md, client-summary.md, the composed email HTML)
// BEFORE anything outward-facing happens. Per the user's amended design it NEVER withholds delivery:
// every check writes into a receipt artifact (pass/fail per check), failing checks get ONE bounded
// named-correction redo where a drafting stage produced the surface, and anything still failing ships
// as a visible plain-language flag at the top of the triage email + report. Mechanical defects are
// surfaced, never silently shipped — and never block the lawyer from the rest of the work.
//
// Families (spec A2): registry arithmetic (+ A1 record-field fidelity), template integrity,
// reference integrity, counting consistency.
//
// ── `clientSummaryMd` is a REPLAY-ONLY input (2026-08-01) ───────────────────────────────────────────
// The `client-summary` STAGE is retired: a live clearance no longer writes client-summary.md, and
// pipeline.mjs's lint call now passes nothing for it. Every client-summary-capable check below is
// KEPT and is still exercised — driver/replay-archive.mjs calls runLint with the archived
// `clientSummaryMd`, and that replay is the contract that must stay green over the real matter
// archive forever. So: never delete a client-summary arm here, and never let one assume the file
// exists. Each is presence-gated, so on a live run it emits no check at all rather than a phantom
// pass or a phantom failure. The one check that deliberately did NOT follow that rule into
// retirement is the `:email` surface — see the note at its call site in runLint: it now runs on the
// report-derived cover text alone, because a gate that simply stops running is not a gate that passes.

import { REGION_NAMES } from "./publish/regions.mjs";
import { canonicalJurisdictionCode } from "./jurisdiction-codes.mjs";   // tracker issue 134 — one spelling of a territory code
import { searchedCovers } from "./frame-diff-model.mjs";                // tracker issue 134 — one copy of the EU-reach rule
import { partyFactSources, partyFactViolations, partyFactMessage, canJudgePartyFacts } from "./party-facts.mjs";   //
import { writeUpViolations, writeUpMessage } from "./narrative-write-ups.mjs";   //

import { findRegistryArithmeticIssues, findRegistryViolations, splitBlocks } from "./registry-fidelity.mjs";
import { CLIENT_TIER_BY_COMPOSITE, joinFindingToBlock, parseBlockOrd, worstLiveBand, NO_RATED_CONFLICTS, deriveActionConditions, isUnconditionalProceed, verdictStance, joinAskToAnswer, projectAssessmentField, POSITION_REQUIRED_DISPOSITIONS, OFF_FIELD_GROUNDS, FINDINGS_SCHEMA_VERSION, netChainMarkers, STATEMENT_CLAUSE_MAX } from "./findings-model.mjs";
import { normalizeBand } from "./framework.mjs";

// V4-3: diacritics FOLD (NFD strip) instead of being deleted — "Televisión" must normalize to
// "television" (deletion made it "televisin", so a diacritic mention never matched its introduction).
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/&amp;/g, "&").replace(/\s+/g, " ")
  .replace(/\band\b/g, "&").replace(/[^a-z0-9& ]/g, "").trim();

// Tokens that look like proper names but are vocabulary, not entities. Conservative by design — a missed
// orphan is a lost flag; a false orphan is reader noise on a delivered report.
const REF_ALLOWLIST = new Set([
  "us", "usa", "eu", "eutm", "uk", "gb", "ie", "de", "fr", "es", "it", "ch", "at", "nl", "be", "se", "dk",
  "no", "fi", "pl", "pt", "gr", "cz", "jp", "cn", "kr", "tw", "tr", "ca", "au", "nz", "in", "br", "mx",
  "ru", "ph", "hk", "sg", "za", "uspto", "ttab", "wipo", "euipo", "ipindia", "tmview", "madrid",
  "low", "medium", "high", "very", "manageable", "risk", "level", "composite", "clear", "conditional",
  "blocking", "live", "dead", "name", "names", "class", "classes", "cl", "reg", "no", "vs", "rtm", "tm",
  // register-status vocabulary — appears ALL-CAPS in status cells/actions ("RTVE's PENDING application")
  "pending", "registered", "abandoned", "cancelled", "canceled", "expired", "suspended", "opposed",
  "published", "renewed", "filed", "granted", "refused", "lapsed",
  "pdf", "url", "html", "faq", "llc", "inc", "gmbh", "ltd", "sa", "ag", "corp", "co", "the", "and", "of",
  "rts", "b2b", "executive", "summary", "analysis", "notes", "preliminary", "trademark", "review",
  "report", "project", "description", "manner", "use", "additional", "information", "recommendation",
  // doc-35 T3: report-structure / section-heading words are NEVER entities — a "# Methodology" heading or a
  // "Register Risk State" label is not a company. (The durable fix is validating the structured entity set;
  // this kills the named false positive — "Methodology Trademark Register" — without that larger rework.)
  "methodology", "register", "marks", "mark", "coverage", "scope", "conclusion", "drivers", "actions",
  "state", "states", "gap", "gaps", "found", "checks", "overview", "verdict", "only", "you", "close", "these",
  // marketplace-platform vocabulary (the common-law sweep's standing surfaces, not entities to introduce).
  // LOAD-BEARING — do NOT delete to "de-gaming" the lint: the per-run profile-platform union (runLint
  // `extraVocab`) is DOMAIN-derived, so a single-label domain yields the bare brand ("walmart.com" →
  // "walmart", so Zephyr Beverages' Walmart/Target/GNC are already covered with no static) but a MULTI-part domain
  // does NOT ("store.steampowered.com" → "store steampowered", never "steam"), and "xbox"/"playstation"/
  // "nintendo" appear in NO platform domain at all. Removing these would fire false orphan flags on every
  // gaming report. The structural de-gaming fix is per-customer marketplace ALIASES in the bundle data
  // model (Phase 1), after which the gaming-specific entries here can retire; until then they stay.
  "steam", "epic", "epic games store", "google play", "apple app store", "app store", "microsoft store",
  "itch.io", "itchio", "xbox", "playstation", "nintendo", "amazon", "etsy", "ebay",
]);

// ── — A TERRITORY IS NOT A PARTY, AND A MARK IS NOT A PARTY ────────────────────────────────────
// Two production clearances flagged six "parties the action list names that no finding identifies".
// FOUR were not parties: "European Union", "United Kingdom", "United Arab Emirates" and a mark. The
// check then emitted that into the report, which is 's other half.
//
// Territory names come from `publish/regions.mjs` — the ONE naming source every render surface already
// uses — rather than from the run's own jurisdiction list. Broader, and deliberately: a bare country
// name is never a party in this document, whether or not this run searched there, and binding to the
// existing map means a register added tomorrow cannot reintroduce the false positive. A real company
// whose name CONTAINS a country ("Ireland Brewing Ltd") keeps at least one non-vocabulary word and is
// still a candidate — `isVocab` requires EVERY word to be allowlisted.
const TERRITORY_VOCAB = new Set(Object.values(REGION_NAMES).map((n) => norm(n)));

function stripHtml(s) {
  return String(s ?? "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");
}

// "April 2014", "MAY 2026" — dates pass the Title-Case-multi-word shape but are never entities.
const DATE_TOKEN_RE = /^(january|february|march|april|may|june|july|august|september|october|november|december)(\s+\d{1,4})?$/i;

// Proper-name candidates in a text span: ALL-CAPS tokens (RTVE, IKEA, SATIN & BRONZE) and Title-Case
// multi-word names (High 5 Games). Single Title-Case words are excluded (too noisy).
export function properNameCandidates(text, extraVocab = null, { actionBullets = false, territories = false } = {}) {
  const t = String(text ?? "");
  // a candidate is vocabulary, not an entity, when EVERY word is allowlisted or a bare number
  // ("Class 41", "EXECUTIVE SUMMARY", "Level 3") — entities keep ≥1 non-vocabulary word (RTVE, High 5 Games).
  // extraVocab (WS-B): the run's profile platform names — a customer's marketplaces are standing
  // surfaces for THAT run, not entities needing introduction (else every non-gaming report fires
  // false orphan-reference flags).
  const inList = (n) => REF_ALLOWLIST.has(n) || (territories && TERRITORY_VOCAB.has(n)) || Boolean(extraVocab?.has?.(n));
  const isVocab = (tok) => {
    const n = norm(tok);
    if (inList(n)) return true;              // whole-phrase entries ("apple app store", "epic games store")
    return n.split(" ").every((w) => !w || inList(w) || /^\d+$/.test(w));
  };
  // norm-keyed so "AMAZON SILK" and "Amazon Silk" are ONE candidate; the mixed-case form wins the display
  const out = new Map();
  const add = (tok) => {
    const k = norm(tok);
    if (DATE_TOKEN_RE.test(k)) return;
    const prev = out.get(k);
    if (!prev || (/[a-z]/.test(tok) && !/[a-z]/.test(prev))) out.set(k, tok);
  };
  // doc-35 T3: inter-word separators are HORIZONTAL-only ([ \t], not \s) so a candidate can NEVER span a line
  // break — a markdown heading on its own line ("# Methodology") cannot glue to the next line's body opener
  // ("Trademark Register") into a phantom company. An entity name is always on one line in these surfaces.
  for (const m of t.matchAll(/\b([A-Z][A-Z0-9]{2,}(?:[ \t]*[&+][ \t]*[A-Z][A-Z0-9]{1,})*(?:[ \t]+[A-Z][A-Z0-9]{2,})*)\b/g)) {
    const tok = m[1].trim();
    if (!isVocab(tok) && norm(tok).length >= 3) add(tok);
  }
  // — A BULLET'S OPENING VERB IS NOT A NAME. The action list flagged "Instruct Japanese", which is
  // the first two words of "Instruct Japanese and Korean counsel": an imperative followed by an adjective,
  // matched as a Title-Case pair. The narrowing is STRUCTURAL rather than a verb list — an action bullet
  // opens with an imperative by construction, so a Title-Case candidate anchored at a bullet's first word
  // is a sentence opener. A verb list would need to be exhaustive to work and silent when it was not.
  //
  // IT APPLIES TO THE TITLE-CASE PATTERN ONLY. The ALL-CAPS pattern above is where the real detections
  // live (RTVE, the failure this check was built for), a bullet may legitimately open with one, and no
  // false positive on record came from that shape.
  const bulletOpens = new Set();
  if (actionBullets) for (const b of t.matchAll(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\*\*[^*]*\*\*[ \t]*)?/gm))
    bulletOpens.add(b.index + b[0].length);
  for (const m of t.matchAll(/\b([A-Z][a-z]+(?:[ \t]+(?:[A-Z][a-z0-9]+|\d+|&)){1,4}(?:[ \t]+(?:LLC|Inc\.?|GmbH|Ltd\.?|S\.?A\.?|AG|Corp\.?))?)\b/g)) {
    const tok = m[1].trim();
    if (bulletOpens.has(m.index)) continue;
    if (tok.split(/\s+/).length >= 2 && !isVocab(tok)) add(tok);
  }
  return [...out.values()].filter((tok) => !/^TMP\d+/i.test(tok));
}

// ── individual checks; each returns {id, family, surface, pass, detail} ─────────────────────────────────

function check(id, family, surface, pass, detail) {
  return { id, family, surface, pass: Boolean(pass), detail: detail ?? "" };
}

// Template integrity (A2): NAME(S) populated; every searched name has its own assessment row; rating
// positions hold searched names, never adverse marks. Works on the parsed client-summary structures the
// email is assembled from (the email assembly itself is code we control).
export function templateChecks({ headerName, ratedNames, searchedNames }) {
  const out = [];
  out.push(check("names-cell-populated", "template", "email",
    Boolean(String(headerName ?? "").trim()),
    headerName ? "" : "the NAME(S) row is empty — the searched name(s) must populate it"));
  const ratedN = (ratedNames ?? []).map(norm);
  const searchedN = (searchedNames ?? []).map(norm);
  for (const sn of searchedN) {
    out.push(check(`assessment-row:${sn}`, "template", "email",
      ratedN.some((r) => r.includes(sn) || sn.includes(r)),
      `searched name "${sn}" has no per-name assessment row in the summary table`));
  }
  for (const rn of ratedN) {
    const isSearched = searchedN.some((s) => rn.includes(s) || s.includes(rn));
    out.push(check(`rating-position:${rn}`, "template", "email", isSearched,
      isSearched ? "" : `risk rating attached to "${rn}", which is not a searched name — adverse marks belong in the analysis text, not the name-rating position`));
  }
  return out;
}

// Reference integrity (A2 + V4-3): no owner/mark named in the ASK bucket ("Only you can close") that is
// introduced nowhere else in the same surface (the RTVE failure). V4-3 precision, from the two real
// delivered TMP8552 surfaces (the 2026-06-12 banner fired nine false positives, missed nothing real):
//   - the mention zone is the only-you bucket ONLY — a "Checks we ran" bullet is a findings recap that
//     self-introduces its subject by construction ("Use-check on X…: found Y"), so it is introduction
//     territory, not mention territory (this alone killed 5 of the 6 surviving false positives);
//   - an entity referred to in ≥2 sentence-segments of the surface is CONTEXTUALIZED — the surface tells
//     the reader what role it plays even without a formal introduction (the garnet-RTVE discriminator:
//     no introduction-presence rule can pass garnet's email while failing flint's, verified by exhaustive
//     rule enumeration against the real texts; gameable by repetition, accepted — a false orphan is
//     reader noise, the worse failure under the lint's posture, and a missed one costs one flag).
// Orphans are reported in ONE check so a noisy heuristic costs one flag line, not many.
export function referenceChecks({ actionsText, fullSurface, searchedNames, surface = "report", extraVocab = null, markNames = null, structural = false }) {
  const body = stripHtml(fullSurface);
  const actions = stripHtml(actionsText);
  const rest = body.replace(actions, " ");
  const restN = norm(rest);
  // sentence-segments for the contextualization rule: sentence ends, em/en-dash asides, semicolons
  const segments = body.split(/(?<=[.!?])\s+|\s+[—–]\s+|;\s+/).map(norm);
  const searchedN = (searchedNames ?? []).map(norm);
  const wordSet = (s) => new Set(s.split(" ").filter(Boolean));
  const sameWords = (a, b) => a.size === b.size && [...a].every((w) => b.has(w));
  const searchedSets = searchedN.map(wordSet);
  // — A MARK IS NOT A PARTY. `searchedNames` covers the marks this run was ASKED about; the marks
  // the run FOUND are in the finding set, and one of them ("MINCRAFT") was emitted as a party
  // the report failed to identify. A conflicting mark is a thing, not a person: it is introduced by its
  // own finding card, and the entity that needs introducing is its OWNER — which stays a candidate,
  // because only `mark` joins this set and never `owner.name`.
  const markN = (markNames ?? []).map(norm).filter(Boolean);
  const orphans = properNameCandidates(actions, extraVocab, { actionBullets: true, territories: true }).filter((tok) => {
    const n = norm(tok);
    if (searchedN.some((s) => n.includes(s) || s.includes(n))) return false;
    if (markN.some((s) => n === s)) return false;
    // a word-reordering of a searched name ("Ember & Oak" for "Oak & Ember") is a search VARIANT of the
    // subject, not an entity needing introduction
    if (searchedSets.some((s) => sameWords(s, wordSet(n)))) return false;
    if (restN.includes(n)) return false;                                   // introduced elsewhere
    if (segments.filter((seg) => seg.includes(n)).length >= 2) return false; // contextualized in-surface
    return true;
  });
  const list = orphans.join(", ");
  // The flag is prose on the delivered email's opening: say what is wrong and what to do,
  // in one readable sentence — never a bare token dump.
  const detail = surface === "email"
    ? `the action items in this email mention ${list} without explaining who or what they are — open the full report for their identities before acting on those items (a summary-drafting gap, not a gap in the search)`
    // doc-35 T2 (completeness-by-construction): an action that names an entity with no finding card is an
    // internal-completeness defect — the disposition is FIX (card the on-point entity) or remove it, never a
    // reader-facing "verify who this is" caveat. (Reviewer-internal; the structural "actions derive from
    // findings.json ordinals" version is the durable follow-on.)
    : `the report's action items name ${list}, but no finding card identifies them — an action must reference a carded entity. Card the on-point one(s) (FIX) or remove them; do not ship a "verify who this is" note to the reader.`;
  // ── — THE REDO THIS USED TO TRIGGER COULD NOT REPAIR IT, AND COULD CLEAR IT ────────────────────
  // The remedy this check names is "card the on-point one(s) or remove them" — both are edits to
  // findings.json, and on a v4+ run the "Only you can close these" section is CODE-BUILT from
  // findings.json actions[] and replaced wholesale by assembleReportMd. So the warm report-overview redo
  // the lint used to route this to could not perform the repair at all.
  //
  // IT COULD, HOWEVER, CLEAR THE FLAG. `restN.includes(n)` above passes an orphan that appears anywhere
  // OUTSIDE the only-you bucket, and shell prose is outside it. A redo that merely explained who the
  // party was made the re-lint PASS with nothing carded — the engine satisfying the check by writing the
  // "verify who this is" note its own detail forbids, and no artifact recording that it had.
  //
  // So on a run whose actions are code-built this is STRUCTURAL, on the codebase's own existing meaning:
  // no drafting surface can repair it, it ships as a visible flag, and the redo is not attempted.
  // Pre-v4 runs keep the redo — there the authored section survives assembly and the redo IS the owner.
  // The flag rides a FAILURE only. `modelFixable` reads it off failures, so a structural bit on a pass
  // would be a state nothing means and a reader would have to guess at.
  return [{ ...check("reference-integrity", "reference", surface, orphans.length === 0,
    orphans.length ? detail : ""), ...(structural && orphans.length ? { structural: true } : {}) }];
}

// ── — AN ASK LONGER THAN THE VERDICT STATEMENT'S CLAUSE IS ONE THE STATEMENT ELLIPSISES ─────────
// The delivered verdict statement reads "<Tier> — conditional on: <clause> (and N more)." and renders on
// every surface the product has: index cells, run status, the report hero, the email headline, the xlsx
// Verdict row. findings-model clips that clause at STATEMENT_CLAUSE_MAX on a word boundary and marks the
// cut with an ellipsis, so an over-long ask does not read half-said — it reads truncated, on the one
// sentence every page joins.
//
// FIRST WRITTEN AGAINST A DIFFERENT CUT, AND THAT CUT IS GONE. The email's
// conditions box used to shorten the ask twice — first sentence, then 170 characters, neither marked —
// and the sentence half fired on "Inc." rather than on length. Both are removed; the box renders the ask
// whole. The bound survived because the STATEMENT clip is real and derived: a one-row surface has a
// width, and this is the number it chose.
//
// MEASURED ON WHAT ACTUALLY REACHES THE CLIP: `condition ?? text` (conditionClauses), condition-kind
// actions only, withdrawn findings' actions already dropped. Advisory asks never enter the statement and
// are no longer cut anywhere, so flagging them would be a check with nothing behind it.
//
// EVERY over-long clause is named, not just whichever sorts first into the lede: which one leads depends
// on the register's order, so a check that only measured the lede would pass today and fail on a reorder
// nobody made.
//
// Flag-only, like every check here, and it names the offenders with their lengths so the fix is obvious.
export function actionBoundLineChecks(actionsRegister, findings) {
  if (!Array.isArray(actionsRegister) || !actionsRegister.length) return [];
  const { conditionActions } = deriveActionConditions(actionsRegister, findings ?? []);
  const over = conditionActions
    .map((a) => ({ id: a?.id, len: String(a?.condition ?? a?.text ?? "").trim().length }))
    .filter((a) => a.len > STATEMENT_CLAUSE_MAX)
    .sort((x, y) => y.len - x.len);
  return [check("action-fits-bound-line", "actions", "report", over.length === 0,
    over.length
      ? `${over.length} condition${over.length === 1 ? "" : "s"} longer than the ${STATEMENT_CLAUSE_MAX}-character clause the verdict statement carries, so the delivered "conditional on:" sentence ends in an ellipsis on every surface that renders it: ${over.slice(0, 4).map((a) => `action ${a.id} at ${a.len}`).join(", ")}${over.length > 4 ? ` (+${over.length - 4} more)` : ""}. State the step; the reasoning belongs in the finding the action closes.`
      : "")];
}

// ── V4-5: actions-contract — reachability is checkable ─────────────────────────────────────────────────
// No item in the "Only you can close" bucket may have as its SUBJECT work the system has a tool for
// (register lookups, record fetches, marketplace sweeps, web checks). Client-only items are things like
// applicant identity, use intentions, commercial decisions, privileged facts. Detection is a tight
// verb→machine-object pattern (an explicit list, not semantic inference): a "Confirm whether X's scope
// is confusingly similar" legal-judgment ask must never flag.
const MACHINE_WORK_RE = new RegExp(
  String.raw`\b(?:run|re-?run|perform|conduct|execute|commission)\b[^.\n]{0,60}\b(?:search|sweep|lookup|check|monitor(?:ing)?)\b` +
  String.raw`|\brecord[- ]?fetch\b` +
  String.raw`|\b(?:check|verify|confirm|look\s*up|monitor)\b[^.\n]{0,50}\b(?:register\b|registry\b|TSDR|EUIPO|WIPO|USPTO|database|docket|marketplace|storefront|app ?store)`,
  "i");

export function actionsReachabilityChecks({ onlyYouText, actionsRegister, findings }) {
  // PR-3 (report voice) — with a typed actions register the rendered "Only you can close" lines are
  // CODE-BUILT from it (buildOnlyYouSection, subject code-joined from ordinals), so reachability is a
  // STORE assertion over the register itself: the defect and the fix both live in findings.json
  // actions[], never in the rendered prose. Condition-kind actions only — advisory kinds (monitoring
  // legitimately names a register to watch) never gate and never flag here, mirroring the prose
  // path's tag exclusion.
  if (Array.isArray(actionsRegister)) {
    const { conditionActions } = deriveActionConditions(actionsRegister, findings ?? []);
    const reachable = conditionActions.filter((a) =>
      MACHINE_WORK_RE.test(String(a?.text ?? "")) || (a?.condition != null && MACHINE_WORK_RE.test(String(a.condition))));
    return [check("actions-reachability", "actions", "report", reachable.length === 0,
      reachable.length
        ? `condition action(s) in findings.json actions[] ask the reader to commission work this system can run itself — fix the action at the store (re-author the register entry), never the rendered prose: ${reachable.map((a) => `#${a.id} "${String(a.text ?? "").replace(/\s+/g, " ").slice(0, 90)}"`).join(" | ")}`
        : "")];
  }
  // Legacy path (no typed register — archived/replay surfaces): scan the rendered section.
  const items = stripHtml(onlyYouText ?? "").split("\n")
    .map((l) => l.trim()).filter((l) => l.startsWith("-"));
  // spec 64 — advisory-tagged lines are CODE-BUILT from the typed actions register ([Monitor] /
  // [Open question] / [Your decision]); a monitoring ask legitimately names a register to watch,
  // and the tag word "Monitor" itself would otherwise match MACHINE_WORK_RE on every such line.
  const modelAuthored = items.filter((l) => !/^-\s*(\*\*)?\s*\[(open question|your decision|monitor)\]/i.test(l));
  const reachable = modelAuthored.filter((l) => MACHINE_WORK_RE.test(l));
  return [check("actions-reachability", "actions", "report", reachable.length === 0,
    reachable.length
      ? `the "Only you can close" items below ask the reader to commission work this system can run itself — they belong in the run, not the ask list: ${reachable.map((l) => l.replace(/\s+/g, " ").slice(0, 110)).join(" | ")}`
      : "")];
}

// Counting consistency (A2): "N live registrations/marks" cited for the same owner must agree across
// surfaces. Conservative: owner = nearest preceding proper-name within 90 chars.
export function countingChecks(surfaces, extraVocab = null) {
  const claims = []; // {owner, n, surface}
  for (const [surface, text] of Object.entries(surfaces)) {
    const t = stripHtml(text);
    for (const m of t.matchAll(/(\d{1,4})\s+(?:live\s+)?(?:registrations?|marks?)\b/gi)) {
      const before = t.slice(Math.max(0, m.index - 90), m.index);
      const owner = properNameCandidates(before, extraVocab).pop() ?? null;
      if (owner) claims.push({ owner: norm(owner), n: Number(m[1]), surface });
    }
  }
  const byOwner = new Map();
  for (const c of claims) {
    if (!byOwner.has(c.owner)) byOwner.set(c.owner, new Set());
    byOwner.get(c.owner).add(c.n);
  }
  const bad = [...byOwner.entries()].filter(([, ns]) => ns.size > 1);
  return [check("counting-consistency", "counting", "all", bad.length === 0,
    bad.length ? bad.map(([o, ns]) => `"${o}" counted differently across surfaces: ${[...ns].join(" vs ")}`).join("; ") : "")];
}

// Compute-don't-author (PR-4) — the counting-family FLIP: prose carries NO scope/coverage numbers at
// all. The old posture ("numbers must AGREE across surfaces") policed model-typed scope arithmetic;
// under store-backed scope rendering the numbers are computed from the run record (scope-facts.mjs)
// and stamped by code (`coverage_line:` front-matter), so a scope/coverage count typed into prose is
// a defect BY EXISTENCE — there is nothing for it to agree with, only something for it to drift from.
// Tight vocabulary on purpose: only counts of SEARCH-SCOPE nouns (classes/jurisdictions/queries/
// sweeps/platforms…) fire; a registration count ("8 registrations") stays countingChecks/
// countsFromFindings territory (finding content, dying separately under store-render), and a bare
// class IDENTIFIER ("Class 5") never matches — it is a name, not a count. Front-matter is excluded
// (the code-stamped classes/coverage_line legitimately carry numbers). Flag-only, like every check.
// Review issue 3 — the old single alternation (`\d+ <scope noun>`) false-flagged THIRD-PARTY
// portfolio facts ("the owner holds registrations across 14 classes", "senior rights in 3
// jurisdictions", "coexists in 4 markets"), which are FINDING content — crowd/dilution judgment
// fuel that must survive — not run-scope arithmetic; each false flag then fed a lint-repair pass
// whose instruction was "drop the number". Split vocabulary:
//   • RUN-ONLY nouns (queries/searches/sweeps/slices) — a third party cannot "hold 14 queries",
//     so a bare count of one is always a run-scope claim; matches on its own.
//   • AMBIGUOUS nouns (classes/jurisdictions/markets/registers/platforms/…) — count as run scope
//     only in the company of a run-scope VERB (searched/swept/dispatched/enumerated/…) in the
//     same clause; portfolio-breadth phrasing carries no such verb and no longer fires.
//     ("cover" is deliberately absent from the verb list: "the registration covers 3 classes"
//     is the single most common portfolio phrasing.)
// Plus: a class IDENTIFIER before a scope noun ("Class 25 marketplaces", "Cl. 25 searches") is a
// name, not a count — guarded by lookbehind; "searched in <year>" no longer reads the year as a
// count; and the singulars ("1 class", "1 search") now match (the old plural-only forms missed them).
const SCOPE_RUN_NOUN = String.raw`(?:quer(?:y|ies)|search(?:es)?|sweeps?|slices?)`;
const SCOPE_CTX_NOUN = String.raw`(?:nice\s+)?(?:class(?:es)?|jurisdictions?|countr(?:y|ies)|markets?|registers?|registries|offices?|variants?|storefronts?|marketplaces?|platforms?)`;
const SCOPE_VERB = String.raw`(?:search(?:ed|es)?|sweep(?:s|ing)?|swept|dispatch(?:ed|es|ing)?|enumerat(?:ed|es|ing|ion)|quer(?:ied|ies|ying)|screen(?:ed|ing)|scann(?:ed|ing)|checked|ran|run)`;
const CLASS_ID_GUARD = String.raw`(?<!\bclass\s)(?<!\bclasses\s)(?<!\bcl\.\s)(?<!\bcl\s)`;
const SCOPE_NUMBER_RE = new RegExp(
  CLASS_ID_GUARD + String.raw`\b\d{1,6}\s+` + SCOPE_RUN_NOUN + String.raw`\b` +
  `|` + String.raw`\b` + SCOPE_VERB + String.raw`\b[^.;:\n]{0,40}?` + CLASS_ID_GUARD + String.raw`\b\d{1,6}\s+` + SCOPE_CTX_NOUN + String.raw`\b` +
  `|` + String.raw`\bsearched\s+(?:across\s+|in\s+)?(?!(?:19|20)\d{2}\b)\d{1,6}\b`,
  "gi");
const stripFrontMatterBlock = (s) => String(s ?? "").replace(/^---\n[\s\S]*?\n---\n/, "");

export function scopeNumberProseChecks({ reportMd, clientSummaryMd }) {
  const out = [];
  for (const [surface, text] of [["report", stripFrontMatterBlock(reportMd)], ["client-summary", clientSummaryMd]]) {
    if (!String(text ?? "").trim()) continue;
    const hits = [...new Set((stripHtml(text).match(SCOPE_NUMBER_RE) ?? []).map((h) => h.replace(/\s+/g, " ").trim()))];
    out.push(check("scope-numbers-in-prose", "counting", surface, hits.length === 0,
      hits.length
        ? `scope/coverage counts are computed from the run record and rendered by code (the coverage_line) — prose must not re-type them (drop the number, keep the substance): ${hits.slice(0, 8).map((h) => `"${h}"`).join(", ")}${hits.length > 8 ? ` (+${hits.length - 8} more)` : ""}`
        : ""));
  }
  return out;
}

// doc-31 (counts from the finding set): a registration COUNT stated in prose must not be LOWER than the
// registrations the finding set actually attaches to that owner — you cannot claim fewer than you show. We
// only flag UNDER-counts (provably wrong: the report itself lists more): an OVER-count may legitimately cite
// the owner's broader portfolio beyond the rated subset, so it is left alone (conservative — zero false fails
// on "X holds 8 registrations" when only 2 are rated). Owner tie-in reuses countingChecks' nearest-name rule.
export function countsFromFindings(allFindings, surfaces) {
  // A1: withdrawn findings render nowhere, so their registrations must not inflate the
  // expected counts a delivered surface is checked against.
  const findings = (allFindings ?? []).filter((f) => f?.disposition !== "withdrawn");
  if (!Array.isArray(findings) || !findings.length) return [check("counting-vs-findings", "counting", "all", true, "")];
  const byOwner = new Map();   // owner NAME (as findings carry it) → Set(distinct registration uris) across its findings
  for (const f of findings) {
    const name = f.owner?.name;
    if (!name || typeof name !== "string") continue;
    if (!byOwner.has(name)) byOwner.set(name, new Set());
    for (const r of (f.owner?.registrations || [])) if (r?.uri) byOwner.get(name).add(String(r.uri).toLowerCase());
  }
  const bad = [];
  // Search for each KNOWN owner name (from the finding set) followed within a short same-sentence window by a
  // "<N> registrations" claim — robust where nearest-name extraction is not ("X holds 2 registrations").
  for (const [surface, text] of Object.entries(surfaces)) {
    const t = stripHtml(text ?? "");
    for (const [name, uris] of byOwner) {
      if (uris.size === 0) continue;
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`${esc}[^.\\n]{0,40}?\\b(\\d{1,4})\\s+(?:live\\s+)?registrations?\\b`, "gi");
      let m;
      while ((m = re.exec(t))) {
        const claimed = Number(m[1]);
        if (claimed < uris.size) bad.push({ surface, owner: name, claimed, shown: uris.size });
      }
    }
  }
  return [check("counting-vs-findings", "counting", "all", bad.length === 0,
    bad.length ? bad.map((b) => `"${b.owner}" states ${b.claimed} registration(s) but the finding set lists ${b.shown}`).join("; ") : "")];
}

// Registry family: A1 record-field fidelity + document-only arithmetic, over a markdown surface.
// V4-1/V4-2: registry-record-coverage now also FAILS on 'unfetched' citations (a cited record absent from
// the run's record set — the old vacuous-pass path). `fetchFailures` (Map uri → mechanical cause) lets the
// driver's targeted-fetch closure pass attach WHY a record could not be brought into the set.
export function registryChecks({ text, recordsByUri, surface = "report", fetchFailures }) {
  const out = [];
  const arith = findRegistryArithmeticIssues(text);
  out.push(check("registry-arithmetic", "registry", surface, arith.length === 0,
    arith.map((a) => `${a.block}: ${a.detail}`).join("; ")));
  const v = findRegistryViolations(text, recordsByUri);
  const mismatches = v.filter((x) => x.kind === "mismatch");
  const unverified = v.filter((x) => x.kind === "unverified");
  const unfetched = v.filter((x) => x.kind === "unfetched");
  out.push(check("registry-record-match", "registry", surface, mismatches.length === 0,
    mismatches.map((x) => `${x.block}: ${x.field} says "${x.claimed}" but the fetched record (${x.uri}) says "${x.record}"`).join("; ")));
  const coverage = check("registry-record-coverage", "registry", surface, unverified.length === 0 && unfetched.length === 0,
    [
      ...unfetched.map((x) => `${x.block}: cites ${x.uri} but this run's record set holds no fetched record for it` +
        (fetchFailures?.get(x.uri) ? ` — targeted fetch failed: ${fetchFailures.get(x.uri)}` : "") +
        " — the registry values in this card are unverified"),
      ...unverified.map((x) => `${x.block}: ${x.field} "${x.claimed}" could not be verified against the fetched record (${x.uri} lacks the field) — verify before relying on it`),
    ].join("; "));
  // STRUCTURAL = a drafting-surface re-emit cannot repair it: the ONLY failing citations are records the
  // driver's targeted closure fetch DEFINITIVELY could not retrieve (every unfetched URI carries a fetchFailures
  // cause — a 404/gone record), and there are no unverified-field cases. Such a coverage failure ships as a
  // visible plain-language flag (the standing delivery philosophy); firing a warm LLM redo is doomed — it cannot
  // conjure a non-existent record — and cost TONICA/ashen-keystone ~14 min re-emitting 35KB of report.md for a GB
  // record that does not exist. The driver redo-gate reads this flag; the receipt/flag path is unchanged.
  if (!coverage.pass && unverified.length === 0 && unfetched.length > 0 && unfetched.every((x) => fetchFailures?.get(x.uri))) {
    coverage.structural = true;
  }
  out.push(coverage);
  return out;
}

// Minimal client-summary.md shape extraction (self-contained mirror of publish/parse.mjs conventions):
// Header's `- name:` value + the rated names (each `## <MARK — owner (jur)>` block title's mark part).
export function clientSummaryShape(csMd) {
  const t = String(csMd ?? "");
  const header = t.split(/^#\s+/m).find((s) => /^Header/i.test(s)) ?? "";
  const nameLine = header.split("\n").map((l) => l.trim().match(/^- name:\s*(.*)$/i)).find(Boolean);
  const marksSec = t.split(/^#\s+/m).find((s) => /^Marks/i.test(s)) ?? "";
  const ratedNames = [...marksSec.matchAll(/^##\s+([^\n]+)/gm)]
    .map((m) => m[1].split(" — ")[0].trim()).filter(Boolean);
  return { headerName: nameLine ? nameLine[1].trim() : "", ratedNames };
}

// Applicant-unknown runs (2026-06-18): the candidate-self treatment is RETIRED. An identical hit is now an
// ordinary finding in the overall rating carrying a neutral "if this is the applicant's own prior filing,
// disregard" note — never downranked, never excluded from the overall. This flag-only check (flag, not block,
// per the standing delivery philosophy) catches a REGRESSION to the old phrasing — "Candidate-self:" /
// "is this you?" / an overall "computed excluding candidate-self" — which must no longer be produced.
// Self-contained: marker presence in the report is the trigger; no run context needed.
export function candidateSelfChecks({ reportMd }) {
  const t = String(reportMd ?? "");
  const legacy = /candidate-?self\s*:|is this you\?|excluding candidate-?self/i.test(t);
  if (!legacy) return [];
  return [check("candidate-self-legacy", "template", "report", false,
    "retired candidate-self phrasing appeared ('Candidate-self:' / 'is this you?' / 'excluding candidate-self') — an applicant-unknown run must report identical hits as ordinary findings in the rating with a neutral 'if this is the applicant's own prior filing, disregard' note")];
}

// B2 (report confabulation backstop) — per-card record provenance. The single-pass report renderer once
// pasted one finding's body (its record link, owner, filing dates) into ANOTHER finding's card (the
// ashen-lattice confabulation: BePharBel's body landed in cards #2 and #5). registry-record-match cannot
// catch it: a card carrying finding-M's whole body also cites finding-M's URI, so its claims agree with the
// cited record — but the card sits under finding-N's identity. This check binds each card to ITS finding (by
// the hidden `- ord: N` line the per-card renderer emits, else owner-name containment for a legacy/monolithic
// report.md) and asserts the card's CANONICAL record link — its `- Source:` bullet, the one render lifts as
// the head "View record →" — belongs to THAT finding, not to a different one. Deterministic, model-independent.
// A mismatch carries the ordinal so the driver can regenerate THAT card alone; residual ships as a flag.
const MARK_URI_RE = /\/mark\/[a-z]{2,6}\/[a-z0-9][a-z0-9_-]*/gi;
const normUri = (u) => String(u ?? "").toLowerCase().replace(/-+$/, "");
// the card heading is "## <owner> — <MARK>, <jur>": the owner is the segment before the first dash-with-spaces.
const headingOwner = (h) => String(h ?? "").split(/\s+[—–-]\s+/)[0].trim();

// Split report.md into per-card units: each `## ` block keeps its `### The read` / `### Full detail` body
// (h3s are body here, not boundaries); a `# ` top-section ends the current card. Unlike splitBlocks this keeps
// the `- Source:` bullet (which lives under `### Full detail`) attached to its card.
// `start`/`end` are the card's absolute character span in the SOURCE (heading line through last body line).
// `text` is not a contiguous slice (the heading and any `# ` line are dropped), so a caller that needs to
// ask "is this whole-text match inside a card?" must use the span, never a search of `text` — see
// permissionProseChecks, where a phrase-keyed answer sent the repair to the wrong surface.
function splitCards(md) {
  const src = String(md ?? "");
  const cards = [];
  let cur = null;
  let pos = 0;
  for (const ln of src.split("\n")) {
    const lineStart = pos;
    pos += ln.length + 1;
    if (/^#\s+/.test(ln)) { if (cur) { cards.push(cur); cur = null; } continue; }
    const h2 = ln.match(/^##\s+(.*)/);
    if (h2) { if (cur) cards.push(cur); cur = { heading: h2[1].trim(), body: [], start: lineStart, end: pos }; continue; }
    if (cur) { cur.body.push(ln); cur.end = pos; }
  }
  if (cur) cards.push(cur);
  return cards.map((c) => ({ heading: c.heading, text: c.body.join("\n"), start: c.start, end: c.end }));
}

export function findingProvenanceChecks({ reportMd, findings }) {
  const list = Array.isArray(findings) ? findings : (findings?.findings ?? []);
  if (!reportMd || !list.length) return [];
  // uri → ordinal across ALL findings (the attribution map); ordinal → finding for the keyed lookup.
  const uriToOrd = new Map();
  const byOrd = new Map();
  for (const f of list) {
    if (typeof f?.ordinal !== "number") continue;
    byOrd.set(f.ordinal, f);
    for (const r of (f.owner?.registrations ?? [])) { const u = normUri(r?.uri); if (u) uriToOrd.set(u, f.ordinal); }
  }
  const failures = [];
  for (const card of splitCards(reportMd)) {
    // a finding card: heading has the "<owner> — <MARK>" dash shape AND the body cites a record URI.
    if (!/\s[—–-]\s/.test(card.heading) || !MARK_URI_RE.test(card.text)) continue;
    MARK_URI_RE.lastIndex = 0;
    // key the card to its finding: the `- ord: N` line (exact), else owner-name containment (legacy report.md).
    let ord = (card.text.match(/^\s*-\s*ord:\s*(\d+)\s*$/im) || [])[1];
    ord = ord != null ? Number(ord) : null;
    if (ord == null) {
      const who = norm(headingOwner(card.heading));
      for (const f of list) {
        const fo = norm(f.owner?.name || "");
        if (who && fo && (who.includes(fo) || fo.includes(who))) { ord = f.ordinal; break; }
      }
    }
    if (ord == null || !byOrd.has(ord)) continue;   // unattributable → never false-flag
    // the card's canonical record link = its `- Source:` bullet; fall back to every record URI in the body.
    const srcLine = card.text.split("\n").find((l) => /^\s*-\s*Source\s*:/i.test(l));
    const cited = [...String(srcLine ?? card.text).matchAll(MARK_URI_RE)].map((m) => normUri(m[0]));
    for (const u of cited) {
      const owns = uriToOrd.get(u);
      if (owns != null && owns !== ord) {
        failures.push({ ...check("finding-provenance", "registry", "report", false,
          `card for finding ${ord} (${headingOwner(card.heading)}) cites record ${u} which belongs to finding ${owns} — the card body was cross-contaminated; regenerate finding ${ord}'s card from its own record`), ordinal: ord });
      }
    }
  }
  // one pass-row when clean (stable replay-snapshot shape, like registryChecks' single coverage row).
  return failures.length ? failures : [check("finding-provenance", "registry", "report", true, "")];
}

// 404-card caveat (c) (2026-07-22) — record-verification claim vs the assembled record set. A delivered
// card claimed "verified directly from the record" over a record whose closure fetch 404'd:
// registry-record-coverage flagged the unfetched citation, but nothing tied the VERIFICATION CLAIM to
// the missing record, so the uncaveated claim shipped. This check makes the regression visible: a card
// whose prose claims record-verification while the record set holds NO fetched record for ANY of its
// citations fails. Flag-and-deliver like its siblings (the render's code-owned caveat line + the
// evidence-join suppression are the fix; this is the net that shows a regression).
const RECORD_VERIFIED_CLAIM_RE = /\bverified\s+(?:directly\s+)?(?:from|against)\s+the\s+(?:official\s+|register\s+|registry\s+)*record\b|\brecord[- ]verified\b/i;
export function recordVerificationClaimChecks({ text, recordsByUri, surface = "report" }) {
  const failures = [];
  for (const card of splitCards(text)) {
    const claim = String(`${card.heading}\n${card.text}`).match(RECORD_VERIFIED_CLAIM_RE);
    if (!claim) continue;
    const cited = [...new Set([...String(card.text).matchAll(MARK_URI_RE)].map((m) => normUri(m[0])))];
    if (!cited.length) continue;                                   // no citation → registry-record checks own it
    if (cited.some((u) => recordsByUri?.has(u))) continue;         // ≥1 fetched record backs the card
    failures.push(check("record-verification-claim", "registry", surface, false,
      `${card.heading}: card claims record-verification ("${claim[0]}") but the record set holds no fetched record for its citation${cited.length > 1 ? "s" : ""} (${cited.join(", ")}) — the claim must not ship uncaveated`));
  }
  return failures.length ? failures : [check("record-verification-claim", "registry", surface, true, "")];
}

// ── P2-B: named competitors (charter P2b + the addendum's competitor-verification item) ────────────
//
// Two failures, one owner set, one paragraph scan.
//
// (1) THE UNVERIFIED "REPORTEDLY". A delivered card said a named incumbent's registration "has
//     reportedly been used by the USPTO to refuse other TIKI-formative marks". The record that
//     settles it was on disk the whole time (its refusalInformation lists six refused applications) —
//     so the claim had two honest endings available, a verified finding citing the record or a stated
//     open question, and it took neither. Second sighting: the same shape reached an animal-health
//     report about three named pharma competitors. On a matter where the named parties are exactly
//     the ones likely to hold conflicting rights, an unsourced rumour about them is the worst
//     sentence in the document.
// (2) THE NEGATIVE OVER AN UNSCREENED OWNER. "General sweeps for <owner> found no …" may only rest on
//     an owner slice that actually enumerated. A slice that did NOT run — signa declares no owner
//     surface at all, so every owner slice there defers by construction — is a disclosed gap, and a
//     negative written over it is a clean the run never earned.
//
// FALSE POSITIVES ARE THE WHOLE DIFFICULTY here too, so the trigger is narrow by construction:
//   * the owner set is CODE-KNOWN — the frozen plan's incumbent lane, via _driver/owner-screen.json.
//     This is never a general "reportedly" hunt over the prose.
//   * name forms are suffix-stripped but must stay >=2 tokens, or a single token of >=6 chars; and any
//     form whose tokens are all inside the matter's own mark vocabulary is DROPPED (the "Slush Oy"
//     problem — the owner's name is a word of the mark under search, and every sentence would match).
//   * scope is the PARAGRAPH (or card), because the owner and the hedge legitimately sit in different
//     sentences of the same read — and the escapes are paragraph-scoped too.
// Flag-and-deliver like its siblings: the artifact ships, the lawyer sees the flag.
const HEDGE_RE = /\breportedly\b|\b(?:is|are|was|were) (?:understood|believed|said|reputed) to\b|\bappears? to (?:hold|own|have|be the owner)\b|\bapparently\b|\bwe understand(?: that)?\b|\bit is understood\b|\bpurportedly\b|\brumou?red\b/i;
// The escapes: a paragraph that says the claim is unverified, or names it an open question, has
// already taken the honest ending. Deliberately explicit — a bare "may" or "possibly" is hedging, not
// disclosure, and must not excuse the sentence.
const VERIFICATION_CAVEAT_RE = /\bnot (?:been )?(?:independently )?verified\b|\bunverified\b|\bcould not (?:be )?(?:verified|confirmed|checked)\b|\bnot confirmed\b|\bopen question\b|\bnot established\b|\bwe could not confirm\b|\bno record (?:was )?read\b|\bnot searched\b|\bcould not be searched\b/i;
const CORPORATE_SUFFIX_RE = /[,\s]+(?:incorporated|inc|llc|l\.l\.c|ltd|limited|corp|corporation|company|co|gmbh|ag|sa|s\.a|srl|s\.r\.l|oy|ab|as|bv|b\.v|nv|n\.v|plc|kg|kk|pte|pty|sas|spa|s\.p\.a)\.?$/i;

/** The name forms a report would actually print for a watchlist owner. PURE. */
export function ownerNameForms(owner, markVocab = null) {
  const raw = String(owner ?? "").trim();
  if (!raw) return [];
  const forms = new Set([raw]);
  let stripped = raw.replace(/[.,]+$/, "");
  let prev;
  do { prev = stripped; stripped = stripped.replace(CORPORATE_SUFFIX_RE, "").trim(); } while (stripped !== prev);
  if (stripped) forms.add(stripped);
  const noThe = stripped.replace(/^the\s+/i, "").trim();
  if (noThe) forms.add(noThe);
  const vocab = markVocab instanceof Set ? markVocab : new Set((markVocab ?? []).flatMap((v) => norm(v).split(" ")).filter(Boolean));
  return [...forms]
    .map((f) => f.trim())
    .filter((f) => {
      const tokens = norm(f).split(" ").filter(Boolean);
      if (!tokens.length) return false;
      // one-token forms must be substantial; multi-token forms are distinctive enough as they stand.
      if (tokens.length === 1 && tokens[0].length < 6) return false;
      // the mark's own vocabulary can never identify an owner (SLUSH inside "CORAL FREEZE").
      if (tokens.every((t) => vocab.has(t))) return false;
      return true;
    })
    .sort((a, b) => b.length - a.length);
}

/**
 * Split a surface into CLAIM UNITS, keeping the heading of the block each sits in. A unit is a
 * paragraph, and inside a paragraph each LIST ITEM is its own unit (with its continuation lines):
 * a "Checks we ran" bullet list is five separate claims, and letting one bullet's hedge borrow the
 * next bullet's caveat is exactly the leak these checks exist to catch. PURE.
 */
function paragraphsOf(text) {
  const out = [];
  const push = (heading, t) => { const s = String(t).trim(); if (s) out.push({ heading, text: s }); };
  for (const block of splitBlocks(String(text ?? ""))) {
    for (const para of String(block.text).split(/\n{2,}/)) {
      let cur = null;
      for (const line of para.split("\n")) {
        if (/^\s*(?:[-*+]\s|\d+[.)]\s)/.test(line)) { push(block.heading, cur); cur = line; }
        else cur = cur === null ? line : `${cur}\n${line}`;
      }
      push(block.heading, cur);
    }
  }
  return out;
}

const ownerMentioned = (para, forms) => forms.find((f) => {
  const rx = new RegExp(`(?<![A-Za-z0-9])${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}(?![A-Za-z0-9])`, "i");
  return rx.test(para);
});

/**
 * A hedged claim about a named watchlist owner must end as a VERIFIED finding (a fetched record
 * behind a cited URI in the same paragraph) or as a STATED open question. PURE.
 */
export function competitorClaimChecks({ text, ownerScreen, recordsByUri, markVocab = null, surface = "report" }) {
  const owners = ownerScreen?.owners ?? [];
  if (!owners.length || !String(text ?? "").trim()) return [];
  const formsByOwner = owners.map((o) => ({ owner: o.owner, forms: ownerNameForms(o.owner, markVocab) })).filter((x) => x.forms.length);
  if (!formsByOwner.length) return [];
  const failures = [];
  for (const para of paragraphsOf(text)) {
    const hedge = para.text.match(HEDGE_RE);
    if (!hedge) continue;
    if (VERIFICATION_CAVEAT_RE.test(para.text)) continue;               // stated as an open question — the honest ending
    const cited = [...new Set([...para.text.matchAll(MARK_URI_RE)].map((m) => normUri(m[0])))];
    if (cited.some((u) => recordsByUri?.has(u))) continue;              // verified from a record that was really fetched
    for (const { owner, forms } of formsByOwner) {
      if (!ownerMentioned(para.text, forms)) continue;
      failures.push(check("competitor-claim-verification", "registry", surface, false,
        `${para.heading || "(front matter)"}: an unverified claim about ${owner} ("${hedge[0]}") ships with neither a fetched record behind a cited registration URI nor a stated open question — a claim about a named competitor must become a verified finding or an open question, never a rumour`));
      break;   // one flag per paragraph — the repair rewrites the sentence once
    }
  }
  return failures.length ? failures : [check("competitor-claim-verification", "registry", surface, true, "")];
}

// ── COVERAGE CLAIMS IN PROSE vs WHAT THE RUN ACTUALLY SEARCHED (tracker issue 134) ──────────────────
//
// THE DEFECT. `coverage_line:` is code-stamped from scope-facts.json; the narrative is model-written
// prose. Nothing bound them to one searched-territory set. On `amber-summit` the masthead read
// `registers: JP, WO` while the narrative said "Register searches covered Japan and Korea" — one of
// them was wrong and nothing detected it until a human compared the two surfaces by eye. They agree
// on today's runs because a prompt fix stopped the input contradicting itself, which is evidence the
// INPUT was fixed, not evidence the surfaces are bound.
//
// WHY A CHECK AND NOT ONE DERIVATION. The stamped line can derive from a structure; a narrative
// cannot — it is prose a model writes. So the binding has to be a comparison, and this is it.
//
// WHY IT KEYS ON A COVERAGE VERB, WHEN issue 129 IS ABOUT NOT KEYING GATES ON PROSE. Reports name
// territories constantly and legitimately — every adverse mark has one. "Territory named + not
// searched" fires on a competitor's German registration in a Swiss-only run, every time, so the check
// would be noise and get switched off. The discriminator is a positive coverage predicate in the same
// sentence, plus no negation.
//
// The 129 hazard does not transfer, and the asymmetry is the reason. A REQUIRED-section gate keyed on
// prose kills a delivered run when the model picks a synonym: the vocabulary gap is fatal. This is a
// CONTRADICTION detector, so a vocabulary gap costs a missed detection and nothing else. Same
// technique, opposite blast radius. It also routes as a lint flag into the repair round rather than
// failing the run, because a withheld report is a product failure and a prose-keyed kill is precisely
// the run-killer class 129 exists to remove.
const COVERAGE_PREDICATE_RE = /\b(search(?:ed|es)?|screen(?:ed|s)?|cover(?:ed|s|age)?|clear(?:ed|s|ance)?|examin(?:ed|es)|check(?:ed|s)?|ran|run)\b/i;

// A clause carrying any of these is NOT claiming coverage of the territory it names — it is disclaiming
// it, deferring it, or recommending it. Erring toward NOT firing is correct here: a missed detection is
// a quiet gap, a false fire spends a repair round on correct prose.
const COVERAGE_NEGATION_RE = /\b(not|no|never|without|excluded?|excluding|outside|beyond|unsearched|un-?covered|absent|lack(?:s|ing)?|omitted?|cannot|can't|couldn't|didn't|wasn't|weren't|would|should|recommend(?:ed|s|ation)?|further|additional|next step|future|advise|suggest(?:ed|s)?|require(?:d|s)?|pending|out of scope|beyond the scope)\b/i;

// REGION_NAMES is the canonical code→name map, but its names are not the only ones prose uses. The
// evidence case is exactly this: the map says `KR: 'South Korea'` and the failing narrative said
// "Korea". A check built on the map alone is green through the defect it was named for.
const TERRITORY_NAME_TO_CODE = (() => {
  const m = new Map();
  for (const [code, name] of Object.entries(REGION_NAMES)) m.set(norm(name), code);
  const alias = {
    "korea": "KR", "republic of korea": "KR",
    "america": "US", "usa": "US", "u.s.": "US", "u.s.a.": "US", "united states of america": "US",
    "britain": "UK", "great britain": "UK", "england": "UK", "scotland": "UK", "wales": "UK",
    "holland": "NL", "uae": "AE", "emirates": "AE",
    "wipo": "WO", "madrid": "WO", "international register": "WO", "madrid system": "WO",
    "euipo": "EU", "eutm": "EU", "european union": "EU",
    "prc": "CN", "mainland china": "CN", "roc": "TW",
  };
  for (const [n, code] of Object.entries(alias)) m.set(norm(n), code);
  return m;
})();

// Longest-first so "South Korea" and "United Kingdom" win over "Korea"/"Kingdom" fragments.
const TERRITORY_NAMES_BY_LENGTH = [...TERRITORY_NAME_TO_CODE.keys()].sort((a, b) => b.length - a.length);

// Plain sentence split for the coverage-claim scan. Deliberately NOT the `sentencesOf` further down,
// which protects mark-name forms from being split: territory names are exactly what this scan wants to
// see, so protecting name forms would hide them.
function coverageSentences(text) {
  return String(text ?? "")
    .split(/(?<=[.!?;:])\s+|\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Territory-coverage claims in a delivered surface, compared against what the run searched.
 *
 * Returns [] — NOT a pass — when there is no searched set to compare against. A run with no register
 * layer has nothing to contradict, and a green check on a comparison that never happened is the
 * absence-as-pass this codebase keeps paying for. The family being absent is the honest record.
 *
 * PURE.
 */
export function coverageClaimChecks({ text, searchedJurisdictions = null, surface = "report" } = {}) {
  const searched = (searchedJurisdictions ?? []).map((j) => canonicalJurisdictionCode(j)).filter(Boolean);
  if (!searched.length) return [];                       // nothing to compare — record nothing, claim nothing
  const body = stripHtml(text);
  if (!body.trim()) return [];
  const searchedSet = new Set(searched);
  const violations = [];
  for (const sentence of coverageSentences(body)) {
    if (!COVERAGE_PREDICATE_RE.test(sentence)) continue;
    if (COVERAGE_NEGATION_RE.test(sentence)) continue;
    const n = norm(sentence);
    for (const name of TERRITORY_NAMES_BY_LENGTH) {
      if (!new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(n)) continue;
      const code = TERRITORY_NAME_TO_CODE.get(name);
      if (searchedCovers(code, searchedSet)) continue;
      // display the canonical territory name, not the normalised token the match ran on ("korea" → South Korea)
      violations.push({ code, name: REGION_NAMES[code] ?? name, sentence: sentence.slice(0, 180) });
      break;                                             // one flag per sentence; the repair reads the sentence
    }
  }
  if (!violations.length) {
    return [check("coverage-claim-vs-searched", "scope", surface, true,
      `no coverage claim names a territory outside the searched set (${searched.join(", ")})`)];
  }
  return violations.map((v) => check("coverage-claim-vs-searched", "scope", surface, false,
    `prose claims coverage of ${v.name} (${v.code}), which the run did not search — searched: ${searched.join(", ")}. `
    + `The stamped coverage line and this sentence disagree about what was searched: "${v.sentence}"`));
}

/**
 * A negative about a named watchlist owner may only rest on an owner slice that ENUMERATED. PURE.
 */
// "found no CORAL-initial, exact-CORAL or FREEZE-containing register mark in Classes 5 or 32" — the real
// delivered sentence. The gap between "no" and the noun carries hyphenated mark forms and commas, so
// the window has to allow them; it stops at sentence punctuation so it can never span two claims.
const OWNER_NEGATIVE_RE = /\bno\s+(?:[\w'-]+[,]?\s+){0,6}?(?:marks?|registrations?|filings?|rights?|applications?|records?|conflicts?)\b|\bfound nothing\b|\bnothing (?:was )?found\b|\bholds? no\b|\bowns? no\b|\bnone (?:were|was) found\b/i;
// SAME SENTENCE, not same paragraph (2026-07-31 review round). Paragraph co-occurrence flags prose
// that states no negative about the owner at all — both of these were demonstrated, and neither is a
// defect:
//   "We found no conflicting registrations in Class 32 for CORAL FREEZE itself. Kestrel Beverages Inc.
//    is the largest incumbent in the category."          ← the negative is about the MARK
//   "Hochland Energie GmbH sells in every instructed territory. There are no filings by the applicant in
//    Class 5."                                            ← the negative is about the APPLICANT
// The check cannot block delivery, so the cost is a warm redo whose instruction invites rewriting
// correct prose — a doomed redo, the TONICA lesson. The real delivered true positive keeps both
// halves in ONE sentence ("General sweeps for Kestrel Beverages and Hochland Energie … found no TIKI-initial …
// register mark in Classes 5 or 32"), so the narrowing costs nothing it was catching.
// The ESCAPES stay paragraph-scoped on purpose: disclosing the gap anywhere in the claim unit is an
// honest ending for the whole unit, and narrowing an exemption is how a false NEGATIVE gets made.
//
// THE SPLIT IS NOT wipoLanguageChecks' SPLIT, and the difference is a corporate abbreviation. A bare
// `(?<=[.!?])\s+` boundary cuts owner names in half — and register owners are FULL of periods:
//   "Fairmile Snack Foods Corp. holds no filings in Class 5."
//   "Marumi Foods Inc. found no TIKI-formative marks in Class 32."
//   "Yamagata Holdings Co., Ltd. has no registrations in the searched classes."
//   "Harbourline Pte. Ltd. owns no TIKI mark in Class 32."
// Every one of those is the exact claim this check exists to catch, and every one of them splits
// after the suffix — owner in segment 1, negative in segment 2, no flag. Narrowing to the sentence
// would have bought two false positives at the price of a whole class of false NEGATIVES, on the
// register forms that dominate CN/JP/KR/SG data.
//
// The period after a corporate suffix and the period ending a sentence are genuinely ambiguous, so
// the boundary is decided by what FOLLOWS it: a real sentence starts with a capital, a digit or a
// quote; an abbreviation is followed by the rest of its own sentence, in lowercase. That resolves
// both directions with one rule and no enumerated suffix list to keep current:
//   "…Corp. holds no filings"   → lowercase follower → ONE sentence → flagged (the true positive)
//   "…Corp. There are no filings by the applicant" → capital follower → two sentences → not flagged
// Ties break toward MERGING, i.e. toward flagging, because this check's failure mode of record is a
// clean negative shipped over an owner nobody enumerated.
//
// One case the follower rule cannot see, and it is the commonest Asian register form: a legal-form
// abbreviation followed by ANOTHER one — "Harbourline Pte. Ltd. owns no TIKI mark" splits at
// "Pte." because "Ltd." is capitalised. That pair is NOT ambiguous (no sentence ends in "Pte." and
// begins with "Ltd."), so it gets a named list rather than a heuristic, and the list is deliberately
// only the STACKED pair: "Inc. There are no filings…" stays two sentences, because there the capital
// really can start a new claim. ("Co., Ltd." needs nothing — its period is followed by a comma, so
// no boundary was ever a candidate.)
//
// ── N1a/N1b (second review round, 2026-07-31): the narrowing's own recall regression ────────────────
// The rules above were measured on four owner shapes and missed five more that the PARAGRAPH-scoped
// predecessor flagged correctly. Every one of them is the exact claim this check exists for, on a
// legal form that is ordinary in this domain, so the misses are recall loss in the guard whose whole
// purpose is catching an unverified negative about a named owner:
//   N1a  "Bahlsen GmbH & Co. KG holds no filings…"        KG/KGaA were absent from LEGAL_FORM, so
//        "Henkel AG & Co. KGaA found no TIKI-formative…"  "Co." got no sentinel and the capitalised
//        "Ritter Sport Co. KG owns no TIKI mark…"         follower split owner from negative.
//   N1b  "Dr. Oetker AG holds no filings…"                the follower rule only ever handled a
//        "St. Michel Biscuits found no TIKI-formative…"   TRAILING legal form. A LEADING abbreviation
//        (and "Cia. Hering Ltda.", "Warner Bros. Entertainment", "Mt. Franklin Beverages") splits the
//        owner's own name in half before the negative is ever reached.
// Three rules close them, each doing something the other two cannot:
//   (1) KG|KGaA join LEGAL_FORM — the driven one-liner. Its direction is the tie-break this comment
//       already states: merging more.
//   (2) A NAME-PREFIX ABBREVIATION never ends a sentence. The list is restricted to abbreviations
//       that cannot be a company name's LAST token — "Dr.", "St.", "Mt.", "Ste." — precisely so the
//       sentinel can never swallow a real sentence end. "Bros." and "Jr." are deliberately NOT on it:
//       "Warner Bros." IS a whole name, and merging it would rebuild the false positive the sentence
//       narrowing was for ("…is Warner Bros. There are no filings by the applicant"). A lone capital
//       INITIAL ("J. R. Simplot Company") is the same rule with a one-letter list.
//   (3) The periods INSIDE an occurrence of the owner's own recorded name are protected, driven by the
//       code-known owner set rather than by any list. This is the general fix, and it is exactly as
//       wide as the check itself: if the printed name does not match a form, `ownerMentioned` could
//       not have flagged the sentence either way, so protection and detection cover the same ground
//       and no vocabulary has to be kept current. INTERNAL periods only — a form-FINAL period
//       ("Marumi Foods Inc.") stays a boundary candidate and is resolved by the follower rule, or
//       "The incumbent is Marumi Foods Inc. There are no filings by the applicant" would merge into
//       one sentence and become a false positive.
// Rules (1) and (2) are not made redundant by (3): the period that splits owner from negative does
// not have to sit in the OWNER's name. "Kestrel Beverages Inc., unlike Acme GmbH & Co. KG, holds no
// filings" and "…unlike Dr. Oetker AG, holds no filings" are split by a THIRD party's name, which no
// owner-driven protection can see.
//
// THE ONE RESIDUAL, stated rather than hunted: a form-FINAL period followed by a capitalised word
// that is neither a legal form nor inside the owner's recorded name — "Établissements Nicolas
// S.à r.l. No filings were found", "Warner Bros. None were found". That is character-for-character
// the shape of the false positive above ("…Inc. There are no filings by the applicant"), so no
// boundary rule can separate the two; resolving it toward merging buys the miss back at the price of
// the false positive this narrowing exists to prevent. It stays missed, on purpose, and is PINNED as
// missed so a future change that closes it shows up as a change.
const LEGAL_FORM = String.raw`(?:Pte|Pty|Pvt|Co|Corp|Inc|Ltd|Ltda|Llc|Plc|Bhd|Sdn|Cie|Cia|Oy|Ab|Ag|Sa|Nv|Bv|Spa|Srl|Kk|Kg|Kgaa)`;
const STACKED_LEGAL_FORM_RE = new RegExp(String.raw`\b${LEGAL_FORM}\.(?=\s+${LEGAL_FORM}\b)`, "gi");
// Abbreviations that PREFIX a name, so their period is never that name's sentence end. The follower
// class is the SPLITTER's own `[^a-z]`: this only ever removes a boundary that would otherwise have
// been taken, and never touches a period the splitter was going to ignore.
//
// TWO of them have a TERMINAL second sense, which is a false positive and not a theoretical one —
// register data carries owner ADDRESSES: "St." is Street and "Dr." is Drive, so "Kestrel Beverages
// Company is at 1 Main St. There are no filings by the applicant in Class 5." would merge into one
// sentence and become exactly the false positive the sentence narrowing was built to stop. The
// discriminator is what the abbreviation PREFIXES: an honorific always introduces a NAME, and a name
// never begins with a closed-class sentence opener. When the follower is one of those, the
// abbreviation was terminal in its other sense and the boundary is real. That keeps "Dr. Oetker"
// and "St. Michel" merged and "Main St. There…" split, on one rule, with no address vocabulary.
const NAME_PREFIX_ABBREV = String.raw`(?:Dr|Prof|Mr|Mrs|Ms|Messrs|Mme|Mlle|Mgr|Rev|Hon|St|Ste|Sta|Sto|Mt)`;
const NOT_A_NAME_FOLLOWER = String.raw`(?:There|These|Those|They|Their|This|That|The|It|Its|We|Our|You|Your|He|His|She|Her|A|An|And|But|Or|Nor|No|None|Not|Nothing|Nobody|All|Any|Both|Each|Every|Either|Neither|Some|Most|Many|Few|If|In|On|At|As|By|For|From|Of|To|With|Where|When|While|Because|However|Although|Since|So|Then|Thus)`;
const NAME_PREFIX_RE = new RegExp(String.raw`\b${NAME_PREFIX_ABBREV}\.(?=\s+(?!${NOT_A_NAME_FOLLOWER}\b)[^a-z])`, "g");
// A lone capital letter before a period is an INITIAL ("J. R. Simplot Company"), never a sentence
// end. The lookbehind keeps it off the second half of a stacked initialism ("K.K."), whose final
// period is form-final and belongs to the follower rule like any other. It carries the same
// sentence-opener guard, for the same reason: a street name abbreviates too ("100 Broadway W.").
const INITIAL_RE = new RegExp(String.raw`(?<![A-Za-z0-9.])[A-Z]\.(?=\s+(?!${NOT_A_NAME_FOLLOWER}\b)[^a-z])`, "g");
const RX_META_RE = /[.*+?^${}()|[\]\\]/g;
const SENTINEL = "\u0000";                            // never appears in delivered prose
/** The owner's own name is ONE token for splitting purposes: sentinel its INTERNAL periods. PURE. */
const protectNameForms = (t, forms) => {
  let out = String(t ?? "");
  for (const f of forms) {
    if (!f.includes(".")) continue;
    const rx = new RegExp(`(?<![A-Za-z0-9])${f.replace(RX_META_RE, "\\$&").replace(/\s+/g, "\\s+")}`, "gi");
    out = out.replace(rx, (m) => {
      const trailing = /\.+$/.exec(m)?.[0] ?? "";                     // form-FINAL periods stay boundaries
      const body = trailing ? m.slice(0, -trailing.length) : m;
      return body.split(".").join(SENTINEL) + trailing;
    });
  }
  return out;
};
const sentencesOf = (t, protectedForms = []) => protectNameForms(t, protectedForms)
  .replace(STACKED_LEGAL_FORM_RE, (m) => m.replace(".", SENTINEL))
  .replace(NAME_PREFIX_RE, (m) => m.replace(".", SENTINEL))
  .replace(INITIAL_RE, (m) => m.replace(".", SENTINEL))
  .split(/(?<=[.!?])\s+(?=[^a-z])|\n+/)
  .map((s) => s.split(SENTINEL).join("."))
  .filter((s) => s.trim());
export function ownerScreenNegativeChecks({ text, ownerScreen, markVocab = null, surface = "report" }) {
  const owners = (ownerScreen?.owners ?? []).filter((o) => o.state !== "enumerated");
  if (!owners.length || !String(text ?? "").trim()) return [];
  const formsByOwner = owners.map((o) => ({ o, forms: ownerNameForms(o.owner, markVocab) })).filter((x) => x.forms.length);
  if (!formsByOwner.length) return [];
  // rule (3): the split is told which strings are owner NAMES, so it can never cut one in half. The
  // set is exactly the set `ownerMentioned` matches on — protection and detection cover one ground.
  const protectedForms = formsByOwner.flatMap((x) => x.forms).sort((a, b) => b.length - a.length);
  const failures = [];
  for (const para of paragraphsOf(text)) {
    if (!OWNER_NEGATIVE_RE.test(para.text)) continue;
    if (VERIFICATION_CAVEAT_RE.test(para.text)) continue;      // already disclosed as a gap, not a clean
    if (/\bnot (?:screened|run|covered)\b|\bno owner (?:surface|search)\b|\bdid not run\b/i.test(para.text)) continue;
    let flagged = false;
    for (const sentence of sentencesOf(para.text, protectedForms)) {
      const neg = sentence.match(OWNER_NEGATIVE_RE);
      if (!neg) continue;
      for (const { o, forms } of formsByOwner) {
        if (!ownerMentioned(sentence, forms)) continue;
        failures.push(check("owner-screen-negative", "registry", surface, false,
          `${para.heading || "(front matter)"}: a negative is stated about ${o.owner} ("${neg[0].trim()}") but that owner's screen slice is ${o.state === "not-run" ? "NOT RUN" : o.state} (${o.reason ?? "no answer recorded"}) — a slice that did not enumerate is a disclosed gap, never a clean`));
        flagged = true;
        break;
      }
      if (flagged) break;   // one flag per claim unit — the repair rewrites the sentence once
    }
  }
  return failures.length ? failures : [check("owner-screen-negative", "registry", surface, true, "")];
}

// ION/copper-foundry (2026-07-22) — the false-outage claim.
// The incumbent-class unit reported `register_enumerate` as "persistently blocked
// by a tool-permission gate … including after two register MCP-server reconnects" and fell back to
// count-only sampling of a high-volume owner. Nothing was broken: pipeline.mjs excludes that tool
// BY DESIGN on the supplemental lane, where register_propose_supplemental is the sanctioned path. A
// report carried the claim, and the coverage it excused was never re-established. This check
// makes that claim undeliverable.
//
// FALSE POSITIVES ARE THE WHOLE DIFFICULTY: archived reports legitimately say "a blocked filing", "class 25
// would be blocked by the senior registration", "the owner can block use in Germany", "the mark is
// unavailable in class 9", "used without the owner's permission", "the register search returned 432 hits".
// Bare blocked/unavailable/permission therefore CANNOT be the trigger. We anchor only on TOOL/INFRASTRUCTURE
// context: the compounds tool-permission and permission-gate/permission-blocked, an "MCP server"/"MCP-server"
// mention (the incident used the hyphen), and a raw tool token near an outage word in the same CLAUSE.
// The second half of the difficulty is that a tool token appears in HONEST prose too — "the register_search
// results are broken down by class", and above all the by-design sentence the engine itself dictates. The
// clause window, the trimmed outage words and the by-design exemption below each exist for a sentence that
// really false-tripped; they are pinned in test/predelivery-lint.test.mjs BENIGN_PROSE + BY_DESIGN_PROSE.
const PERMISSION_TOOL_TOKEN = String.raw`(?:mcp__[a-z0-9_]+|register_[a-z_]+)`;
// "down" and bare "denied" are ordinary English and ordinary REGISTER vocabulary, not outage words: a report
// legitimately says "the register_search results are broken down by class", "narrowed down to the
// exact-in-class band that register_enumerate paged to completion", "US Reg 4,123,456 — denied on absolute
// grounds". Both false-tripped the window pair below before they were removed. "permission denied" still
// fires, on the bare `permission` token; "access denied" is kept as the compound it has to be.
const PERMISSION_OUTAGE_WORD = String.raw`(?:blocked|unavailable|not available|disabled|outage|unreachable|permission|access[\s-]denied)`;
const PERMISSION_PROSE_RES = [
  /\btool[\s-]permission\b/i,
  /\bpermission[\s-]?(?:gate|blocked)\b/i,
  /\bmcp[\s-]+servers?\b/i,
  // a raw tool token within a 60-char SAME-CLAUSE window of an outage word, both directions. The window stops
  // at sentence punctuation, at a SEMICOLON (the house clause boundary — stripEngineInternals splits on the
  // same one) and at a newline, so neither the next clause nor the next table row can lend it a word.
  new RegExp(`${PERMISSION_TOOL_TOKEN}[^.;!?\\n]{0,60}?\\b${PERMISSION_OUTAGE_WORD}\\b`, "i"),
  new RegExp(`\\b${PERMISSION_OUTAGE_WORD}\\b[^.;!?\\n]{0,60}?${PERMISSION_TOOL_TOKEN}`, "i"),
];
// The first three anchors are CLAIMS — a report that says "tool-permission", "permission-blocked" or
// "MCP server" is asserting the outage, and no surrounding words excuse it. The last two are a
// CO-OCCURRENCE window, and co-occurrence is exactly what the engine's OWN steering sentence produces:
// stages.mjs register-unit dictates "register_enumerate is NOT available to you on this run and its absence
// is BY DESIGN, never an outage or a permission fault", and a model obeying it writes the same pairing into
// an honest coverage note. Punishing that would make this check fight the steering — and on the findings
// surface the close is structural, with no in-run repair. So a WINDOW hit whose line also states the
// by-design truth is exempt. Kept deliberately narrow: "excluded"/"deliberately" alone are not markers
// (a table row saying "register_enumerate blocked, so 422 records were excluded" is the lie, not an
// exemption), and neither is a bare negation, which on a five-clause ledger row would exempt the row.
// PERMISSION_WINDOW_FROM is the INDEX of the first window regex: inserting a new literal anchor at or after
// it would silently make that anchor exemptible, so add literal anchors above it, never below.
const PERMISSION_WINDOW_FROM = 3;
const PERMISSION_BY_DESIGN_RE = /\bby[\s-]design\b|\bnever an outage\b|\bnot an outage\b|\b(?:never|not) a permission fault\b/i;
// Every regex is scanned for ALL occurrences: a coverage ledger carries the same lie on one row per owner
// (the real ION ledger has six offending spans across five rows), and the repair followup says "fix ONLY
// what the checks name" — a line the check never names is a line that never gets repaired.
const PERMISSION_PROSE_RES_G = PERMISSION_PROSE_RES.map((re) => new RegExp(re.source, `${re.flags}g`));

// The detail is quoted VERBATIM into the lint-repair followup for the shell/client-summary redo
// (pipeline.mjs redo()) and is handed to the ordinal-routed report-card redo as its `extra`, so it must
// demand HONESTY, never deletion: a redo that simply removes the sentence would re-open the coverage gate
// the incident is about. It says what to write instead, and that a real gap stays disclosed as a gap.
// It also leaves the TRUE-outage door open: a tool that genuinely failed gets named as the failure it was,
// because this check cannot tell a lie from an honest report of a real fault and must never demand that a
// true sentence be withdrawn.
const PERMISSION_QUOTE_CAP = 8;
const permissionProseDetail = (where, hits) => {
  const shown = hits.slice(0, PERMISSION_QUOTE_CAP).map((h) => `"${h.quoted}"`).join("; ");
  const more = hits.length > PERMISSION_QUOTE_CAP
    ? ` — and ${hits.length - PERMISSION_QUOTE_CAP} further line(s) of the same kind, every one of which must be fixed` : "";
  return `${where} explains missing coverage by saying a search tool was blocked or lacked permission (${shown}${more}) — on this run register coverage deliberately routes through the deterministic plan executor, and the enumerate tool is excluded BY DESIGN on the supplemental lane, so an exclusion there is not an outage or a permission fault. Re-emit stating the actual coverage honestly — what was searched, what was not, and why. If a tool genuinely did fail, name the failure and what it cost instead of calling it a permission block; where coverage really is incomplete disclose it as a gap, never delete it.`;
};

// Every offending LINE in a span, in source order. One row per line (not per regex — three anchors can
// match the same sentence and that is still one problem to fix), each carrying `index`, its absolute offset
// in the scanned string. The offset is what lets the whole-text pass tell a shell hit from a card hit it
// already reported: the phrase cannot, because a ledger row and a card body carry byte-equal anchors.
// `quoted` is the clipped LINE — the repair followup says "fix ONLY what the checks name", so the check has
// to hand the model a locator, and a bare two-word anchor like "tool-permission" is not one.
function permissionProseHits(s) {
  const src = String(s ?? "");
  const byLine = new Map();
  for (let i = 0; i < PERMISSION_PROSE_RES_G.length; i++) {
    const re = PERMISSION_PROSE_RES_G[i];
    re.lastIndex = 0;
    for (const m of src.matchAll(re)) {
      const from = src.lastIndexOf("\n", m.index) + 1;              // -1 → 0 for a first-line match
      const to = src.indexOf("\n", m.index);
      const line = src.slice(from, to === -1 ? src.length : to);
      if (i >= PERMISSION_WINDOW_FROM && PERMISSION_BY_DESIGN_RE.test(line)) continue;   // the by-design truth, not the lie
      if (byLine.has(from)) continue;
      const at = m.index - from;                                     // clip the LINE around the anchor, never past it
      const a = Math.max(0, at - 80), b = Math.min(line.length, at + m[0].length + 120);
      const body = line.slice(a, b).trim().replace(/\s+/g, " ");
      byLine.set(from, { index: m.index, anchor: m[0], quoted: `${a > 0 ? "…" : ""}${body}${b < line.length ? "…" : ""}` || m[0] });
    }
  }
  return [...byLine.values()].sort((x, y) => x.index - y.index);
}

/**
 * @param {object} a
 * @param {string} a.text            the surface to scan
 * @param {string} [a.surface]       receipt surface label
 * @param {string} [a.idSuffix]      "" | ":client" | ":narrative" | ":findings" — the sink stores ids ONLY,
 *                                   so each surface needs its own id for the client gate to discriminate.
 * @param {boolean} [a.structural]   true where NO redo route exists (narrative, findings): pipeline.mjs
 *                                   filters structural failures out of the warm-redo path, so marking a
 *                                   repairable surface structural would silently disable its repair.
 * @param {boolean} [a.cards]        false to skip the per-card split (raw JSON has no cards).
 */
// — A LINK THAT RENDERS AND GOES NOWHERE, on the publish path rather than in a browser.
//
// A delivered R5 run carried 29 `](#)` register-source anchors: links a reader clicks and nothing
// happens. The PRODUCER is already fixed — since `d134d35d` the driver composes the Source bullet
// itself (`renderSourceBullet` returns "" when the finding carries no record link), and the dictation
// branch that told a seat what to type when it could not build a link is gone with it. So this guard is
// not what stops the known cause; it is what makes the NEXT one visible on the surface a client reads.
//
// The issue asked for the detection `report-frame-check.mjs` "already names" to run on the publish
// path. Measured at HEAD: that detection does not exist, there or anywhere — so it is written here
// rather than moved. A guard that was believed to exist is worse than one nobody claimed.
//
// TARGET EXACTLY `#` OR EMPTY, never a fragment. `](#c3)` is an in-page jump to a card and the report
// is full of them, legitimately; `](#)` is an anchor with its destination removed.
//
// AND IT IS SCOPED TO MARKDOWN, which keeps it off a deliberate sibling: `portal-report.mjs` rewrites
// leaky cross-customer hrefs to `href="#"` ON PURPOSE at serve time, counts each one, and says so —
// neutralising a link that must not be a destination. That is HTML, a different module and a different
// surface, and a guard that fired on it would be reporting a safety measure as a defect.
const DEAD_LINK_RE = /\[([^\]\n]{0,120})\]\(\s*#?\s*\)/g;

/**
 * A markdown link in a delivered surface whose target is `#` or empty. PURE.
 * One pass row when clean, so the replay snapshot keeps a stable shape.
 */
export function deadRecordLinkChecks({ text, surface = "report", idSuffix = "" }) {
  const src = String(text ?? "");
  const id = `dead-record-link${idSuffix}`;
  if (!src.trim()) return [];
  const hits = [...src.matchAll(DEAD_LINK_RE)].map((m) => m[0]);
  if (!hits.length) return [check(id, "coverage", surface, true, "")];
  const shown = hits.slice(0, 6).map((h) => `\`${h}\``).join(", ");
  return [check(id, "coverage", surface, false,
    `${hits.length} link${hits.length === 1 ? "" : "s"} render and go nowhere: ${shown}`
    + (hits.length > 6 ? ` (+${hits.length - 6} more)` : "")
    + ". A link with no destination is worse than no link — it wears a citation's clothes. If the "
    + "provider publishes no per-record page, cite the office register in the text and compose nothing.")];
}

export function permissionProseChecks({ text, surface = "report", idSuffix = "", structural = false, cards = true }) {
  const src = String(text ?? "");
  const id = `permission-prose${idSuffix}`;
  if (!src.trim()) return [];                                       // nothing to judge → no row at all
  const failures = [];
  const reported = [];                                              // [start, end) spans of the cards that already failed
  const fail = (where, hits, ordinal) => {
    const c = check(id, "coverage", surface, false, permissionProseDetail(where, hits));
    if (ordinal != null) c.ordinal = ordinal;                       // routes the redo to THAT card alone
    if (structural) c.structural = true;
    failures.push(c);
  };
  if (cards) {
    for (const card of splitCards(src)) {
      const hits = permissionProseHits(`${card.heading}\n${card.text}`);
      if (!hits.length) continue;
      const ord = (card.text.match(/^\s*-\s*ord:\s*(\d+)\s*$/im) || [])[1];   // the per-card renderer's key
      fail(`the "${card.heading}" card`, hits, ord != null ? Number(ord) : null);
      reported.push([card.start, card.end]);
    }
  }
  // Whole-text pass: splitCards drops everything outside a `## ` card. On report.md that shell is the
  // front-matter, `# Actions` and `# Methodology` — all authored by report-overview, so the shell redo can
  // genuinely fix what this names. (The coverage LEDGER is not here: delivery-contract.md:147 forbids
  // report-overview from authoring a `# Coverage` section, and the panel renders from the typed coverage[]
  // array — so ledger prose reaches this check on the findings surface, which is structural with no redo by
  // design.) Deduped by POSITION, never by phrase: a card and the shell routinely carry the same anchor, and
  // a phrase-keyed dedupe silently dropped the shell hit — spending the run's single bounded repair on a card
  // while the shell line shipped. ONE row for the whole shell (one row ⇒ one report-overview redo), listing
  // every line it has to fix.
  const rest = permissionProseHits(src).filter((h) => !reported.some(([a, b]) => h.index >= a && h.index < b));
  if (rest.length) fail(surfaceProseLabel(surface), rest, null);
  return failures.length ? failures : [check(id, "coverage", surface, true, "")];
}

// flagLines() puts these details in front of the lawyer, so the surface is named in English, not in
// internal vocabulary (the file header's standing rule for banner lines).
function surfaceProseLabel(surface) {
  if (surface === "client-summary") return "the client summary";
  if (surface === "narrative") return "the synthesis narrative behind this report";
  if (surface === "findings") return "the recorded coverage behind this report";
  return "the report";
}

// ── the lint runner + flag composition ──────────────────────────────────────────────────────────────────

// R.1 reasoning-integrity primitive #4 (design document retired with the subsystem in): runLint
// receives the synthesis narrative (`narrativeMd`) so reasoning-integrity checks can read it. Its first
// consumer is permissionProseChecks (ION/copper-foundry, 2026-07-22) — a false tool-outage claim in the
// reasoning behind the report is worth seeing even though no redo route exists for that surface.
// A1 — correction-consistency: a review-KILLED finding (disposition "withdrawn") must not
// survive on any delivered surface. Deterministic resurrection detector:
//   report:  a card whose `- ord:` equals a withdrawn ordinal, or a `## ` head carrying the
//            withdrawn mark AND owner together (the pre-`- ord:` legacy card shape);
//   client-summary: a `## ` Marks head carrying the withdrawn mark AND owner together (heads are
//            `## <mark> — <owner>`). Mark-alone is NOT enough: when the withdrawn/confabulated finding's
//            mark equals the cleared mark itself (the common case — a hallucinated conflict named after
//            the mark under search), EVERY legitimate `## <mark> — <real owner>` head contains the mark
//            and would false-trip. Requiring the owner too matches the report head test and disambiguates.
// A hit is keyed per-ordinal (`correction-consistency:<ord>`). The pipeline routes these to the
// report-OVERVIEW redo (the residue lives in prose/heads, not in a findings card — re-assembly
// after a successful redo drops the withdrawn card); residue that survives the redo ships flagged
// AND closes the client gate (publish/index.mjs evaluateClientGate, prefix-matched).
/**
 * — a factual assertion about a named party must resolve to a source this run holds, of a KIND
 * that can support it. The partition and the rule live in party-facts.mjs; this is the delivery seam.
 *
 * Emitted on `report` so a failure routes to the warm named-correction redo like any other repairable
 * lint failure — the seat is told which term failed and why, and re-emits. A flag alone would leave the
 * sentence in the client's hands, which is what criterion 2 of the issue refuses.
 *
 * SILENT, NOT CLEAN, when the run holds neither corpus: `canJudgePartyFacts` false means there is
 * nothing to test against, and emitting a passing check there would record a verdict nobody measured.
 */
/**
 * — the delivered narrative, checked against the depth rules the seat was given.
 *
 * Emitted on the `narrative` surface so a failure routes to the warm synthesis redo. INERT WHEN THE
 * PER-PRODUCT ROW CARRIES NEITHER PARAMETER, which is every product until that row lands and the
 * ungraded product permanently — no rule, no row, nothing to read as a verdict.
 *
 * THE UNJOINED COUNT RIDES THE PASSING ROW TOO. A membership rule that examined three of eleven
 * write-ups looks exactly like one that found nothing wrong, and this issue has already paid three
 * times for a check that could not state its own coverage.
 */
export function narrativeWriteUpChecks({ narrativeMd, findings, depth, manifest, surface = "narrative" }) {
  const r = writeUpViolations({ narrativeMd, findings,
    bandOrder: manifest?.bands ?? null, maxBandRank: depth?.narrativeKeptBandRank ?? null,
    maxWords: depth?.narrativeWriteUpWords ?? null });
  // AN UNGRADED PRODUCT EXAMINES NOTHING, AND THAT IS THE ONLY SILENCE THIS CHECK MAY KEEP.
  if (!r.graded) return [];
  // — A GRADED NARRATIVE THE PARSER CANNOT KEY IS NOT A COMPLIANT ONE. The old line here was
  // `if (!r.total && !r.violations.length) return []`, which returned the SAME empty array for product
  // 4's correct inertness and for a graded run whose narrative carries no recognisable write-up block.
  // 6 of 22 graded runs on the box are the second kind, and every one of them read as compliant.
  //
  // STRUCTURAL, so it reports without sending a seat to fix it. The depth directive tells the seat
  // WHICH findings get a prose write-up and HOW LONG it may be. It does not ask for the `Finding N —
  // <mark>` heading this parser keys on, so a narrative without one breaks no rule the seat was given,
  // and a warm redo would hand it a correction it has no instruction to satisfy. What is wrong here is
  // that the DEPTH RULES WENT UNVERIFIED — a coverage fact, stated as one.
  if (!r.total && !r.violations.length) {
    if (!r.findingsTotal)
      return [check("narrative-write-ups", "narrative-depth", surface, true,
        "no findings on this run, so there is nothing to write up")];
    return [{ ...check("narrative-write-ups:could-not-read", "narrative-depth", surface, false,
      `this run has ${r.findingsTotal} finding(s) and the narrative carries NO recognisable prose `
      + "write-up block, so the depth rules were not verified on it — neither the band-rank cut nor the "
      + "word cap was applied to anything. This is NOT a fault in the narrative: the depth directive "
      + "states which findings get a prose write-up and how long it may be, and never asks for the "
      + "heading this check keys on. It means the rule is unenforced on this run."),
      // The flag rides the FAILURE, as everywhere else here, and it is what stops a warm redo handing
      // the seat a correction no directive lets it satisfy.
      structural: true }];
  }
  const coverage = r.unjoined
    ? ` (${r.examined} of ${r.total} write-ups joined to a finding; ${r.unjoined} could not be, and were not judged for membership)`
    : ` (${r.total} write-up${r.total === 1 ? "" : "s"} read)`;
  if (!r.violations.length)
    return [check("narrative-write-ups", "narrative-depth", surface, true, `depth rules hold${coverage}`)];
  return r.violations.map((v) => check(
    `narrative-write-ups:${v.kind}:${v.ordinal ?? v.heading.slice(0, 40)}`, "narrative-depth", surface, false,
    `${writeUpMessage(v)}${coverage}`));
}

export function partyFactChecks({ text, clientPartyName = null, ownerScreen = null, grid = null,
  records = null, matterContext = "", surface = "report" }) {
  if (!String(text ?? "").trim()) return [];
  const parties = [...new Set([clientPartyName, ...((ownerScreen?.owners ?? []).map((o) => o.owner))]
    .map((n) => String(n ?? "").trim()).filter((n) => n.length >= 3))];
  if (!parties.length) return [];
  const sources = partyFactSources({ grid, records, matterContext });
  if (!canJudgePartyFacts(sources)) return [];
  const v = partyFactViolations({ paragraphs: paragraphsOf(text), partyNames: parties, sources });
  if (!v.length) return [check("party-fact-sourcing", "party-fact", surface, true, "")];
  return v.map((x) => check(`party-fact-sourcing:${x.shape}:${(x.terms ?? [x.term]).join("-")}`, "party-fact", surface, false,
    partyFactMessage(x)));
}

export function correctionConsistencyChecks({ reportMd, clientSummaryMd, auditMd, findings }) {
  const out = [];
  const withdrawn = (findings ?? []).filter((f) => f?.disposition === "withdrawn");
  if (!withdrawn.length) return out;
  const report = String(reportMd ?? "");
  const cs = String(clientSummaryMd ?? "");
  const audit = String(auditMd ?? "");
  for (const f of withdrawn) {
    const ord = f.ordinal;
    const markN = norm(f.mark), ownerN = norm(f.owner?.name);
    const ordHit = ord != null && new RegExp(`^-\\s*ord:\\s*${ord}\\s*$`, "m").test(report);
    const headHit = [...report.matchAll(/^##\s+([^\n]+)$/gm)].some(([, h]) => {
      const hN = norm(h);
      return markN && ownerN && hN.includes(markN) && hN.includes(ownerN);
    });
    out.push(check(`correction-consistency:${ord}`, "corrections", "report", !(ordHit || headHit),
      (ordHit || headHit) ? `withdrawn finding resurrected in the report: ${f.mark} — ${f.owner?.name ?? ""} (ord ${ord}); the review killed it (${f.withdrawn_reason ?? "no reason recorded"})` : ""));
    // Presence-gated (2026-08-01, client-summary retirement): with the stage retired the live lane
    // passes no summary, and an absent surface cannot resurrect anything — the check would have
    // emitted one vacuous PASS row per withdrawn finding forever. Replay still passes the archived
    // summary, so the archived-run judgement is unchanged.
    if (cs.trim()) {
      const csHit = [...cs.matchAll(/^##\s+([^\n]+)$/gm)].some(([, h]) => {
        const hN = norm(h);
        return markN && ownerN && hN.includes(markN) && hN.includes(ownerN);
      });
      out.push(check(`correction-consistency:client:${ord}`, "corrections", "client-summary", !csHit,
        csHit ? `withdrawn finding resurrected in the client summary: ${f.mark} (ord ${ord})` : ""));
    }
    // AUDIT surface (2026-07-21) — different rule from the two client-facing surfaces above. The audit is
    // the defensibility record, so a withdrawn claim SHOULD appear there; what must not appear is the
    // UNRESOLVED presentation (copper-gantry shipped an assertion, its refutation and a "confirmed"
    // negative row side by side). So the check is not "is it absent" but "does it read as withdrawn":
    // buildAuditMd stamps `- disposition: withdrawn` on every block that joins a withdrawn finding, and
    // an unstamped joining block is the failure. Same mark+owner join as above (audit block titles ARE
    // the mark, so mark-alone would false-trip on every legitimate block for the cleared mark itself).
    // STRUCTURAL: the repair is code (re-run buildAuditMd with the findings), never a prose redo.
    if (audit) {
      const blocks = [...audit.matchAll(/^##\s+([^\n]+)\n((?:- [^\n]*\n)*)/gm)];
      const unresolved = blocks.filter(([, title, body]) => {
        const tN = norm(title), bN = norm(body);
        if (!(markN && ownerN && tN.includes(markN) && bN.includes(ownerN))) return false;
        return !/^-\s*disposition:\s*withdrawn\s*$/m.test(body);
      });
      const c = check(`correction-consistency:audit:${ord}`, "corrections", "report", unresolved.length === 0,
        unresolved.length
          ? `${unresolved.length} audit block(s) present the withdrawn finding "${f.mark} — ${f.owner?.name ?? ""}" (ord ${ord}) as live: the run withdrew it (${f.withdrawn_reason ?? "no reason recorded"}) but the block carries no "disposition: withdrawn". Re-run the audit build with the findings set (buildAuditMd's findings option) — never edit the audit prose.`
          : "");
      if (!c.pass) c.structural = true;
      out.push(c);
    }
  }
  return out;
}

// A2 (F4) — the client tier words are COPIED, never model-derived: on doc-50 (v4) runs from the
// finding's `band` (the framework in force's own word, via the run's frozen manifest); on legacy runs
// from the canonical composite→tier table. Pure rewriter (the autoCorrectRegistry pattern): joins each
// `## ` Marks block to a live finding DETERMINISTICALLY (wp50: ord line → exact mark → unique
// containment; the old first-match containment join bound "DEMVENZY — Novartis" to the VENZY finding and
// would have ENFORCED the wrong tier) and overwrites its `- risk:` value; the exec-summary `- risk:` is
// overwritten from the worst live band (v4) / max composite (legacy). Returns { text, corrections }.
export function applyClientTierCorrections(csMd, findings, manifest = null) {
  const live = (findings ?? []).filter((f) => f?.disposition !== "withdrawn"
    && (manifest ? true : Number.isInteger(f?.composite)));
  const corrections = [];
  if (!csMd || !live.length) return { text: csMd ?? "", corrections };
  const wantFor = (f) => manifest
    ? (f.band != null ? normalizeBand(manifest, f.band) : null)   // unrated (off-field) blocks are left alone
    : (Number.isInteger(f.composite) && CLIENT_TIER_BY_COMPOSITE[f.composite]);
  let text = String(csMd);
  // Blocks are edited LAST-FIRST: match offsets are captured once, and an earlier in-place correction
  // that changes the text length would silently shift every later block's slice (latent in the original
  // containment version; exposed by the wp50 join tests). Corrections are re-reversed to document order.
  const blocks = [...text.matchAll(/^##\s+([^\n]+)$/gm)].reverse();
  for (const m of blocks) {
    const start = m.index + m[0].length;
    const end = (() => { const nx = text.slice(start).search(/^##\s/m); return nx < 0 ? text.length : start + nx; })();
    const body = text.slice(start, end);
    const f = joinFindingToBlock({ ord: parseBlockOrd(body), head: m[1] }, live);
    const want = f && wantFor(f);
    if (!want) continue;
    const fixed = body.replace(/^(-\s*risk:\s*)([^\n]+)$/im, (whole, pre, got) => {
      if (got.trim().toUpperCase() === String(want).toUpperCase()) return whole;
      corrections.push({ scope: f.mark, from: got.trim(), to: want });
      return `${pre}${want}`;
    });
    if (fixed !== body) text = text.slice(0, start) + fixed + text.slice(end);
  }
  corrections.reverse();                                       // back to document order for the receipt
  // exec summary: overall = worst live band by the manifest's order (v4) / max composite (legacy).
  const overall = manifest
    ? (worstLiveBand(live, manifest) ?? NO_RATED_CONFLICTS)
    : CLIENT_TIER_BY_COMPOSITE[Math.max(...live.map((f) => f.composite))];
  if (overall) {
    const exec = text.match(/^#\s*Executive Summary\s*\n([\s\S]*?)(?=^#\s|$(?![\s\S]))/im);
    if (exec) {
      const fixed = exec[1].replace(/^(-\s*risk:\s*)([^\n]+)$/im, (whole, pre, got) => {
        if (got.trim().toUpperCase() === String(overall).toUpperCase()) return whole;
        corrections.push({ scope: "executive-summary", from: got.trim(), to: overall });
        return `${pre}${overall}`;
      });
      if (fixed !== exec[1]) text = text.replace(exec[1], fixed);
    }
  }
  return { text, corrections };
}

// applyRecommendationBound ( T2/H5) lived here and was DELETED 2026-08-03. It was orphaned by the
// 2026-08-01 client-summary retirement — its only call site went with the stage — and it was a MUTATOR,
// so replay never exercised it either. Its two caps (CLIENT_BOUND_MAX_REASONS/_LEN) went with it; the
// bindRecommendation it wrapped is untouched and still live in the pipeline and the report hero.

// The matching lint check — records tier fidelity in the receipt (and lets replay see it).
export function clientTierChecks({ clientSummaryMd, findings, manifest = null }) {
  const { corrections } = applyClientTierCorrections(clientSummaryMd, findings, manifest);
  return [check("client-tier-match", "client", "client-summary", corrections.length === 0,
    corrections.length ? corrections.map((c) => `"${c.scope}" states ${c.from} but the finding set's canonical tier is ${c.to}`).join("; ") : "")];
}

// wp50/wi10 — a card comparing a mark AGAINST ITSELF is a mechanical drafting defect: VENZY's card 7
// read "KITZY against KITZY: near-identical …" where "VENZY against KITZY" was meant (the applicant
// mark name was substituted with the conflicting mark's). Deterministic, per-card, ordinal-keyed so
// the existing lint-repair regenerates THAT card fresh from its record. A legitimate identical-mark
// comparison ("VENZY against VENZY", identical marks) PASSES because one side IS a searched name.
export function selfComparisonChecks({ reportMd, searchedNames }) {
  const out = [];
  if (!reportMd) return out;
  const searched = new Set((searchedNames ?? []).map((n) => norm(n)).filter(Boolean));
  for (const card of splitCards(reportMd)) {
    const ord = card.text.match(/^-\s*ord:\s*(\d+)\s*$/m)?.[1];
    const hits = [];
    for (const m of card.text.matchAll(/([A-Z][\w'’&.-]{1,})\s+(?:against|vs\.?|versus)\s+([A-Z][\w'’&.-]{1,})/g)) {
      const a = norm(m[1]), b = norm(m[2]);
      if (a && a === b && !searched.has(a)) hits.push(m[0]);
    }
    if (hits.length) out.push({ ...check(`self-comparison${ord ? `:${ord}` : ""}`, "reference", "report", false,
      `card "${card.heading.slice(0, 50)}" compares a mark against itself ("${hits[0]}") — the searched mark was likely meant on one side; regenerate this card from its record`),
      ordinal: ord ? Number(ord) : undefined });
  }
  if (!out.length) out.push(check("self-comparison", "reference", "report", true, ""));
  return out;
}

// wp50/wi2 — the overall-level WORD in reader prose must equal the derived tier (verdict sidecar).
// VENZY shipped overall_caption prose saying "High risk" under a stamped VERY HIGH label. Narrow by
// design: only phrases that name the OVERALL level (a caption leading with "<tier> risk", or
// "overall … <tier>[ risk]" / "Overall risk: <tier>") in front-matter overall_caption + # Summary —
// per-finding tier words are never touched. Alternation orders VERY HIGH before HIGH so "very high"
// can never be read as "high". Flag-and-deliver like every lint check.
const TIER_WORD_ALT = "(very[ -]high|high|medium|manageable|low)";
export function overallTierChecks({ reportMd, verdictDoc }) {
  const tier = String(verdictDoc?.tier ?? "").toUpperCase();
  if (!tier || !reportMd) return [];
  const capt = String(reportMd).match(/^overall_caption:\s*(.+)$/m)?.[1] ?? "";
  const summary = String(reportMd).match(/^#\s*Summary\s*\n([\s\S]*?)(?=^#\s|\s*$)/m)?.[1] ?? "";
  const bad = [];
  for (const [zone, text] of [["overall_caption", capt], ["summary", summary]]) {
    if (!String(text).trim()) continue;
    for (const re of [
      new RegExp(`\\boverall(?:\\s+risk)?\\b[^.\\n]{0,40}?\\b${TIER_WORD_ALT}(?:[ -]risk)?\\b`, "gi"),
      new RegExp(`^\\s*${TIER_WORD_ALT}[ -]risk\\b`, "gi"),
    ]) {
      for (const m of String(text).matchAll(re)) {
        const word = m[1].replace(/[ -]+/g, " ").toUpperCase();
        if (word !== tier) bad.push(`${zone} names ${word} but the delivered overall tier is ${tier} ("${m[0].trim().slice(0, 60)}")`);
      }
    }
  }
  return [check("overall-tier", "client", "report", bad.length === 0, bad.join("; "))];
}

// A6 — the four-link backstop: every frozen intake ask must be answered on BOTH delivered
// surfaces (report + client summary). Deterministic containment on the ask's distinctive slice —
// the labelled "You asked us to check X → …" line necessarily carries it. Keyed per-ask so the
// redo loop can name exactly what is missing; residue ships flagged.
// PR-9 — RE-POINTED AT THE JOIN when the run carries the ask_answers register (findings.json v5): the
// report's "Answers to your instructions" section is CODE-BUILT from that register (assembleReportMd ·
// buildAskAnswersSection), so the honest question is no longer "do the ask's words appear somewhere on
// the surface" but "did this frozen ask JOIN an answer" — judged with the same deterministic join the
// section builder used (joinAskToAnswer). A joined ask is answered by construction; an unjoined ask is
// named per-row. The client summary keeps the fuzzy surface check (that section is still model-voiced).
// Legacy runs (no register) keep the original two-surface fuzzy check byte-identically.
export function intakeAskChecks({ reportMd, clientSummaryMd, intakeAsks, askAnswers }) {
  const out = [];
  const asks = Array.isArray(intakeAsks) ? intakeAsks : [];
  if (!asks.length) return out;
  if (Array.isArray(askAnswers)) {
    asks.forEach((a, i) => {
      const hit = joinAskToAnswer(a.ask, askAnswers);
      out.push(check(`intake-ask:${i + 1}:register`, "intake", "report", Boolean(hit),
        hit ? "" : `the requester's explicit ask "${a.ask}" joins no entry in the findings.json ask_answers register — the code-built "Answers to your instructions" section cannot answer it (emit an ask_answers entry carrying the ask verbatim)`));
    });
    const csText = ` ${norm(clientSummaryMd ?? "")} `;
    if (String(clientSummaryMd ?? "").trim()) {
      const words = (s) => norm(s).split(" ").filter((w) => w.length >= 4).slice(0, 5);
      asks.forEach((a, i) => {
        const ws = words(a.ask);
        if (!ws.length) return;
        const present = ws.filter((w) => csText.includes(` ${w} `) || csText.includes(` ${w}`) || csText.includes(`${w} `)).length;
        const hit = present >= Math.max(1, Math.ceil(ws.length * 0.6));
        out.push(check(`intake-ask:${i + 1}:client-summary`, "intake", "client-summary", hit,
          hit ? "" : `the requester's explicit ask "${a.ask}" has no labelled answer on the client-summary ("You asked: X → …")`));
      });
    }
    return out;
  }
  // Containment = a MAJORITY (≥60%) of the ask's distinctive words (>=4 chars, up to 5) appear on the
  // surface. T5 (the copper-spire A1 false-missing): the old every-word match flagged answers
  // that PARAPHRASED one word of the ask ("descriptiveness" → "descriptive character") as missing —
  // a labelled, genuinely-answered ask read as a defect. Majority word-set matching keeps the check
  // (an unanswered ask still shares almost nothing with the surface) without punishing paraphrase.
  const words = (s) => norm(s).split(" ").filter((w) => w.length >= 4).slice(0, 5);
  // Presence-gated per surface (2026-08-01, client-summary retirement). This legacy branch runs
  // whenever findings.json carries no typed `ask_answers` register, and it was the ONE client-summary
  // call site that emitted a FAILING check against an absent surface: with no client summary the word
  // containment scores 0, `hit` is false, and every ask raised a phantom
  // `intake-ask:N:client-summary` defect about a document the run never had. Replay passes a real
  // summary and is unaffected.
  const surfaces = [["report", ` ${norm(reportMd ?? "")} `], ["client-summary", ` ${norm(clientSummaryMd ?? "")} `]]
    .filter(([, text]) => text.trim());
  asks.forEach((a, i) => {
    const ws = words(a.ask);
    if (!ws.length) return;
    for (const [surface, text] of surfaces) {
      const present = ws.filter((w) => text.includes(` ${w} `) || text.includes(` ${w}`) || text.includes(`${w} `)).length;
      const hit = present >= Math.max(1, Math.ceil(ws.length * 0.6));
      out.push(check(`intake-ask:${i + 1}:${surface}`, "intake", surface, hit,
        hit ? "" : `the requester's explicit ask "${a.ask}" has no labelled answer on the ${surface} ("You asked us to check X → …")`));
    }
  });
  return out;
}

// A5 (a staff lawyer's catch) — an international (WIPO/Madrid) registration reaches ONLY its designated
// countries; prose that pairs it with "worldwide"/"global" rights language invites the reader to
// over-read its scope. Deterministic sentence-level co-occurrence; a sentence that itself names the
// designations ("designating…") is doing the right thing and is exempt. Flag-only (ships visible,
// never blocks — the standing delivery philosophy).
const INTL_REG_RE = /\bWIPO\b|\bMadrid\b|\binternational registration\b|\bIR\s*\d/i;
const GLOBAL_RIGHTS_RE = /\bworld-?wide\b|\bglobal(?:ly)?\b/i;
export function wipoLanguageChecks({ reportMd, clientSummaryMd }) {
  const out = [];
  for (const [surface, text] of [["report", reportMd], ["client-summary", clientSummaryMd]]) {
    if (!text) continue;
    const hits = stripHtml(text).split(/(?<=[.!?])\s+|\n+/)
      .filter((s) => INTL_REG_RE.test(s) && GLOBAL_RIGHTS_RE.test(s) && !/designat/i.test(s));
    out.push(check("wipo-designation-language", "registry", surface, hits.length === 0,
      hits.length
        ? `international-registration prose implies worldwide reach — a WIPO/Madrid registration protects only its designated countries; name them or drop the global language: ${hits.map((s) => s.replace(/\s+/g, " ").trim().slice(0, 100)).join(" | ")}`
        : ""));
  }
  return out;
}

// WP-receipts W4 — senior-right coverage: one visible row per verdict-driving finding whose SENIOR
// right went unverified (the render code-adds the open item, so silence is impossible — this row is
// the review-bar/audit receipt of the same fact). ALWAYS structural: a redo cannot conjure an
// unreachable record (the TONICA doomed-redo lesson), so the flag ships visibly, never burns a re-emit.
// D1 fail-closed: `expected` is caller-asserted (the live pipeline arms it exactly when the closure
// owes the receipt — frozen framework + v4 findings; the replay harness never passes it, so archived
// runs never grow a failure). Expected-but-absent IS a failure: a closure that crashed before writing
// _driver/senior-rights.json used to slide through this presence-gated check silently.
export function seniorRightChecks({ seniorRights, expected = false }) {
  if (!Array.isArray(seniorRights)) {
    if (!expected) return [];
    const c = check("senior-rights-present", "registry", "report", false,
      "the senior-right receipt (_driver/senior-rights.json) is missing on a fresh v4 run — the verified-basis guarantee never settled, so the verdict-driving findings' senior rights are unaudited");
    c.structural = true;
    return [c];
  }
  const rows = seniorRights.filter((r) => r?.applicable && !r.verified);
  const c = check("senior-right-coverage", "registry", "report", rows.length === 0,
    rows.map((r) => r.seniorUri
      ? `"${r.mark}": the oldest registration in this family (${r.seniorUri}) could not be retrieved${r.fetchFailureCause ? ` — ${r.fetchFailureCause}` : ""}; verification rests on a later registration (stated as an open item on the card)`
      : `"${r.mark}": the family's oldest right could not be identified (no dates on the register index) — stated as an open item on the card`).join("; "));
  if (!c.pass) c.structural = true;
  return [c];
}

// WP-56 B2 — the standing mark-assessment block: fresh v4 runs must carry it (it renders as "The mark
// itself" at the top of both report variants). `expected` is caller-asserted — the live pipeline passes
// it for v4 runs; the replay harness never does, so replayed archived runs never grow a new failure.
// ALWAYS structural: the warm redo resumes report drafting and cannot add a findings.json field — the
// honest surface is a visible banner flag, never a burned re-emit (and never load-blocking).
export function markAssessmentChecks({ markAssessment, expected }) {
  if (!expected) return [];
  // PR-9 — the fields may be structured objects (v5); judge the PROJECTION, not String(object) (which
  // is "[object Object]" and would pass an empty structured block).
  const present = Boolean(String(projectAssessmentField(markAssessment?.distinctiveness) ?? "").trim()
    && String(projectAssessmentField(markAssessment?.connotation) ?? "").trim());
  const c = check("mark-assessment-present", "mark-assessment", "report", present,
    present ? "" : "the standing mark-assessment (distinctiveness + connotation, incl. non-English readings) is missing from findings.json — the report ships without its \"The mark itself\" section");
  if (!c.pass) c.structural = true;
  return [c];
}

/**
 * The DECLARED CONTRACT VERSION (, moved out of contentModelChecks by).
 *
 * It used to live inside contentModelChecks, whose first line is `if (!expected) return []`, where
 * `expected` is derived as `schema_version >= 5`. So the one check written to report a down-level
 * findings.json was DISABLED BY BEING DOWN-LEVEL — at v1–v4, the exact population it exists for, it
 * never ran, and the rest of the content-model family went silent with it.
 *
 * got this right one level down and the reasoning did not reach one file up. Its
 * `legal-practical-split` was made deliberately version-independent so that "a model that keeps typing
 * an old schema_version cannot silently disengage the requirement" — and then the version check itself
 * was put behind a version gate.
 *
 * It belongs outside because it is not a content-model PRESENCE flag. It says nothing about what is in
 * the record; it says the record declares a contract this driver has moved past. `expected` answers "did
 * the caller assert this run should carry the v5+ content model", and that is a different question from
 * "what version does this file claim". One switch cannot serve both.
 *
 * The replay harness stays clean the same way it always did: it passes no schemaVersion, and a
 * non-finite version emits nothing. Archived runs still never grow a failure.
 */
export function schemaVersionChecks({ schemaVersion }) {
  if (!Number.isFinite(schemaVersion)) return [];
  const current = schemaVersion >= FINDINGS_SCHEMA_VERSION;
  // The detail must name the gates THIS file missed, not a fixed list. Until 2026-08-06 it interpolated
  // the constant into a sentence describing v6's gates ("positions on every disposition, the off-field
  // ground"), so the moment the driver dictated v7 it told the reader that the v7 gates were those two —
  // naming the wrong reason to look, on the one row whose whole job is saying which contract is missing.
  // The gates are laddered, so a down-level file is missing every rung above the one it declares.
  const RUNGS = [[6, "positions on every disposition, the off-field ground"], [7, "the finding sentence refused as a chain"]];
  const missing = RUNGS.filter(([v]) => schemaVersion < v).map(([v, what]) => `v${v} (${what})`).join(", ");
  const c = check("findings-schema-current", "content-model", "report", current,
    current ? "" : `findings.json declares schema_version ${schemaVersion}; this driver dictates ${FINDINGS_SCHEMA_VERSION} — the parser gates this file is below did not engage on it: ${missing}`);
  if (!c.pass) c.structural = true;
  return [c];
}

// ── P5 (charter 2026-07-30, Reviewer §L) — content-model presence flags ────────────────────────────────────
// Same doctrine as markAssessmentChecks above: `expected` is caller-asserted (the live pipeline passes
// it for fresh v5 runs; the replay harness never does, so archived runs never grow a failure). All
// structural — the honest surface is a visible banner flag, never a burned re-emit and never
// load-blocking (validator-brittleness lesson: the parser accepts absence; the lint names it).
//
// schemaVersion is no longer read here — see schemaVersionChecks above for why it cannot be.
export function contentModelChecks({ findings, fourAnswers, expected }) {
  if (!expected) return [];
  const live = (findings ?? []).filter((f) => f && f.disposition !== "withdrawn");
  const out = [];
  // Reviewer §L: manageable ⇒ category (+ why). Promote-or-omit — a category-less manageable finding is
  // the third state that must not exist.
  const uncategorised = live.filter((f) => ["coexistence-partner", "distinguished"].includes(f.disposition) && !f.manageable?.category);
  const c1 = check("manageable-category", "content-model", "report", uncategorised.length === 0,
    uncategorised.length ? `notable-but-manageable finding(s) without a category + reason (ordinal ${uncategorised.map((f) => f.ordinal).join(", ")}) — each is a large competitor / commercial partner / troll / well-known enforcer with a stated why, or it is promoted to adversarial, or it is omitted; there is no category-less parking spot` : "");
  if (!c1.pass) c1.structural = true;
  out.push(c1);
  // Reviewer §L: legal vs practical, separated.: on EVERY disposition that reaches a reader, not only
  // the rated ones — the `f.band != null` condition this check used to carry meant an off-field finding
  // (which by definition has no band) could never fail it, so the 08-02 run shipped four positionless
  // negatives past a green check.
  //
  // DELIBERATELY NOT VERSION-GATED. The parser enforces this at schema_version 6; a model that keeps
  // typing 5 would disengage that gate and leave nothing behind it. This check judges the RECORD, not the
  // version it declares, so a down-level emission still surfaces the defect on the delivery banner
  // instead of shipping it silently. Same reason it must survive the lenient/quarantine parse path.
  const unsplit = live.filter((f) => POSITION_REQUIRED_DISPOSITIONS.includes(f.disposition) && f.ruled_out !== true
    && !(String(f.legal_position ?? "").trim() && String(f.practical_position ?? "").trim()));
  const c2 = check("legal-practical-split", "content-model", "report", unsplit.length === 0,
    unsplit.length ? `finding(s) without the separated legal_position + practical_position reads (ordinal ${unsplit.map((f) => `${f.ordinal} (${f.disposition})`).join(", ")}) — the legal read and the practical read are stated apart, never averaged, and no disposition is exempt: a negative with no structured position is silence with a label` : "");
  if (!c2.pass) c2.structural = true;
  out.push(c2);
  // — the one-clause net, on every finding a reader sees. Since the separately-authored `- one:`
  // line and the `### The read` condensation were deleted, this field is the ONLY per-finding summary
  // the report has: no net means no sentence on the card, none on the grouped-negative line, none in the
  // MCP brief. DELIBERATELY NOT VERSION-GATED, for the reason the split check above carries: the parser
  // enforces presence at schema_version 6, and a file that declares 5 — or one that arrived through the
  // lenient/quarantine path — would disengage that gate with nothing behind it.
  const netless = live.filter((f) => POSITION_REQUIRED_DISPOSITIONS.includes(f.disposition) && f.ruled_out !== true
    && !String(f.net ?? "").trim());
  const c2e = check("one-clause-net", "content-model", "report", netless.length === 0,
    netless.length ? `finding(s) with no one-clause net (ordinal ${netless.map((f) => `${f.ordinal} (${f.disposition})`).join(", ")}) — the net is the only per-finding summary the report renders, on every surface; a finding without one reaches the reader with its risk chip and no sentence` : "");
  if (!c2e.pass) c2e.structural = true;
  out.push(c2e);
  // — the net is a CONCLUSION, not a chain: the same field, one question further on. The row above
  // asks whether a sentence exists; this one asks whether it still carries the retired chain's mechanical
  // marks (a semicolon, or "→"/"->"). netChainMarkers is findings-model's — ONE definition, so the
  // parser's v7 throw and this row can never disagree about what a chain looks like.
  //
  // MECHANICAL MARKERS ONLY, and deliberately no length. deleted render.mjs's 240-character
  // NET_BUDGET fold on 2026-08-06; this row is what bounds the sentence in its place, and a row that
  // counted characters would just be that cap moved, earning the same defect it was deleted for (a model
  // told to be brief drops a fact). Quality — "does this read as a conclusion" — is the reviewer stage's
  // call, not code's.
  //
  // DELIBERATELY NOT VERSION-GATED, for the reason one-clause-net carries: the parser refuses this at
  // schema_version 7, and a file declaring 6 — or one that arrived through the lenient/quarantine path,
  // which validateNetShape exempts by design — would disengage that gate with nothing behind it. This
  // row judges the RECORD, not the version it declares.
  //
  // Both arms fire since the 2026-08-06 v7 bump: the parser refuses a chain on a v7 file and it rides the
  // corrective ladder; this row catches the two paths that throw cannot reach.
  //
  // LIVE-ONLY, like every contentModelChecks row: replay-archive.mjs passes no `findings`, so an archived
  // run — whose every net was written to the chain contract that was mandatory when it ran — can never
  // fail this. That is the same protection the parser gets from its version gate, by a different route.
  const chained = live.filter((f) => POSITION_REQUIRED_DISPOSITIONS.includes(f.disposition) && f.ruled_out !== true
    && netChainMarkers(f.net).length);
  const c2f = check("net-conclusion-form", "content-model", "report", chained.length === 0,
    chained.length ? `finding sentence(s) still written as a reasoning chain (${chained.map((f) => `ordinal ${f.ordinal}: ${netChainMarkers(f.net).join(" + ")}`).join("; ")}) — the net answers one question, "is this a problem for me", and a semicolon or an arrow means the reasoning is still in it; that reasoning belongs in legal_position / practical_position, moved whole and never trimmed to fit` : "");
  if (!c2f.pass) c2f.structural = true;
  out.push(c2f);
  // requirement 2 — off-field says WHICH ground it rests on. Flag-level here for the same reason as
  // above (the parser throws at v6; this catches the down-level and lenient paths).
  const groundless = live.filter((f) => f.disposition === "off-field" && f.ruled_out !== true && !OFF_FIELD_GROUNDS.includes(f.off_field_ground));
  const c2b = check("off-field-ground", "content-model", "report", groundless.length === 0,
    groundless.length ? `off-field finding(s) with no declared ground (ordinal ${groundless.map((f) => f.ordinal).join(", ")}) — an off-field negative rests on ${OFF_FIELD_GROUNDS.join(" or ")}; a mark argued apart on sound/rhythm/orthography is "distinguished", not off-field` : "");
  if (!c2b.pass) c2b.structural = true;
  out.push(c2b);
  // — the contradiction inside one record: a DIFFERENT-FIELD claim beside a goods meter that says
  // the goods meet. The parser rejects it at v6; named here so a down-level file cannot hide it.
  const proximate = live.filter((f) => f.disposition === "off-field" && f.off_field_ground === "different-field"
    && f.meters?.goods_proximity?.token != null && f.meters.goods_proximity.token !== "low");
  const c2c = check("off-field-goods-distance", "content-model", "report", proximate.length === 0,
    proximate.length ? `off-field finding(s) claiming a different commercial field while their own goods_proximity meter says otherwise (${proximate.map((f) => `ordinal ${f.ordinal}: ${f.meters.goods_proximity.token}`).join(", ")}) — one record cannot say both` : "");
  if (!c2c.pass) c2c.structural = true;
  out.push(c2c);
  // Charter P5: the four answers ride as data where computable. Absence of the whole block on a fresh
  // run means the report ships without its four-answers panel — flagged, never load-blocking (single
  // answers may legitimately be omitted where the run cannot ground them).
  const anyAnswer = fourAnswers && typeof fourAnswers === "object"
    && Object.values(fourAnswers).some((a) => a && typeof a.read === "string" && a.read.trim());
  const c3 = check("four-answers-present", "content-model", "report", Boolean(anyAnswer),
    anyAnswer ? "" : "four_answers is missing from findings.json — the report ships without its four-answers panel (emit the answers the run can ground; omit only what cannot be grounded)");
  if (!c3.pass) c3.structural = true;
  out.push(c3);
  return out;
}

// ── P5 (review 2026-07-31, finding 2) — the four answers must not contradict the run ──────────────────
//
// contentModelChecks above tests PRESENCE only: is there a manageable category, is there a split, is
// there a four-answers block. Nothing compared the four answers against the verdict or against the
// findings they are drawn from, so a block that flatly contradicted the run's own disposition — "third
// party rights: weak" over nine adversarial findings, "objection unlikely" under a BLOCKING verdict,
// a registrability answer citing finding #47 on a nineteen-finding run — shipped unflagged. The panel
// renders in the HERO, above everything: it is the first thing the reader sees, and the one block
// whose whole job is to decompose the verdict. A decomposition that disagrees with what it decomposes
// is the most visible defect the report can carry.
//
// DETERMINISTIC BY CONSTRUCTION, and deliberately not a prose read. Every comparison here joins two
// CLOSED vocabularies or two integers: FOUR_ANSWER_TOKENS (three tokens per answer, code-owned), the
// disposition set, the verdict set, and the ordinals. Nothing matches on `read` — the reason floor in
// placement-model.mjs is the standing lesson that a pattern list over model prose is a proxy, not a
// test, and `read` is exactly the field a lawyer is entitled to write freely.
//
// ONLY CONTRADICTIONS ARE FLAGGED, never the merely surprising. "Moderate" against adversarial
// findings is a judgment call and stays silent; "weak" against them is a statement the run's own data
// refutes. CONDITIONAL is compatible with every objection token, so it never fires. The point is a
// flag a lawyer trusts, which means it must not cry wolf on defensible readings.
//
// FLAG-ONLY, and that is load-bearing (the two-bit doctrine is binding: warn, never withhold). These
// checks are `structural` — pipeline.mjs filters structural failures out of the warm-redo path, which
// is right here because the bytes live in findings.json and a report re-emit cannot change them — and
// they carry NO gate id: evaluateClientGate closes on an explicit allowlist of ids
// (registry-record-match, registry-arithmetic, correction-consistency:*, …) and these are not on it,
// so they cannot suppress or delay the artifact. They ship to the reviewing lawyer on the receipt.
//
// ABSENT ⇒ SILENT. `fourAnswers` null/absent emits NOTHING, exactly as placementsChecks gates on
// Array.isArray. Every archived run carries `four_answers: null`, so an ungated check would grow a new
// failure across the whole replay corpus and flip verdicts the corpus depends on.
export function fourAnswersCoherenceChecks({ fourAnswers, findings, verdictDoc }) {
  if (!fourAnswers || typeof fourAnswers !== "object") return [];
  const out = [];
  const add = (id, pass, detail) => { const c = check(id, "content-model", "report", pass, pass ? "" : detail); if (!c.pass) c.structural = true; out.push(c); };
  // "live" exactly as contentModelChecks computes it — a withdrawn finding is not a fact about the
  // matter any more, and treating the two differently is how the correction-consistency check earned
  // its false-positive history.
  const live = (findings ?? []).filter((f) => f && f.disposition !== "withdrawn");
  const byOrdinal = new Map(live.map((f) => [Number(f.ordinal), f]));
  const withdrawn = new Set((findings ?? []).filter((f) => f && f.disposition === "withdrawn").map((f) => Number(f.ordinal)));
  const tokenOf = (k) => (fourAnswers[k] && typeof fourAnswers[k].token === "string" ? fourAnswers[k].token : null);

  // (1) THE ORDINALS JOIN. An answer citing a finding this run does not have, or one the review
  // withdrew, is incoherent by construction — no reading of the prose rescues it, and the renderer
  // emits the ordinal as a live #anchor, so the reader gets a link to nothing.
  const dangling = [];
  for (const [key, a] of Object.entries(fourAnswers)) {
    if (!a || !Array.isArray(a.ordinals)) continue;
    for (const n of a.ordinals) {
      const ord = Number(n);
      if (withdrawn.has(ord)) dangling.push(`${key} cites #${ord}, which the review WITHDREW`);
      else if (!byOrdinal.has(ord)) dangling.push(`${key} cites #${ord}, which this run has no finding for`);
    }
  }
  add("four-answers-ordinals", dangling.length === 0,
    `the four-answers panel cites finding(s) that are not there: ${dangling.join("; ")} — the panel links each ordinal as a card anchor, so the reader follows it to nothing; re-cite the findings the answer actually rests on`);

  // (2) THIRD-PARTY RIGHTS vs the findings. "weak" is a statement about the field the findings
  // contradict when the run itself rated conflicts adversarial; "strong" over a run with no rated
  // finding at all rests on nothing this run recorded.
  const rated = live.filter((f) => f.band != null);
  const adversarial = live.filter((f) => f.disposition === "adversarial");
  const tpr = tokenOf("third_party_rights");
  add("four-answers-rights-vs-findings",
    !(tpr === "weak" && adversarial.length > 0) && !(tpr === "strong" && rated.length === 0),
    tpr === "weak"
      ? `four_answers.third_party_rights reads "weak", but this run rated ${adversarial.length} finding(s) ADVERSARIAL (ordinal ${adversarial.map((f) => f.ordinal).join(", ")}) — the hero answer contradicts the cards under it; either the answer is wrong or those dispositions are`
      : `four_answers.third_party_rights reads "strong", but no finding on this run carries a band — the answer asserts a rights position the run recorded no evidence for (omit an answer the run cannot ground; never fake one)`);

  // (3) OBJECTION LIKELIHOOD vs the verdict. Both closed sets. CONDITIONAL is compatible with all
  // three tokens and never fires — a conditional run is precisely one where the objection question is
  // open, so flagging it would fire on the commonest verdict we ship.
  const verdict = String(verdictDoc?.verdict ?? "").toUpperCase();
  const obj = tokenOf("objection_likelihood");
  const objBad = (verdict === "BLOCKING" && obj === "unlikely") || (verdict === "CLEAR" && obj === "likely");
  add("four-answers-objection-vs-verdict", !objBad,
    `four_answers.objection_likelihood reads "${obj}" on a ${verdict} run — the panel decomposes the verdict, so it cannot disagree with it; riskStatement() is the single assembler and this answer is a decomposition of the same record, not a second opinion`);

  // (4) REGISTRABILITY vs its own obstacles rows. "registrable" is the CLEAN token; obstacles rows are
  // this run's record of what stands in the way. Both present is a self-contradiction inside one
  // answer — the two other tokens (with-conditions / obstructed) both accommodate obstacles.
  const reg = fourAnswers.registrability;
  const obstacles = Array.isArray(reg?.obstacles) ? reg.obstacles.filter((r) => r && String(r.note ?? "").trim()) : [];
  add("four-answers-registrability-obstacles", !(tokenOf("registrability") === "registrable" && obstacles.length > 0),
    `four_answers.registrability reads "registrable" (the clean token) while carrying ${obstacles.length} obstacle row(s) — ${obstacles.map((r) => `class ${r.class}`).join(", ")}. An answer that names its own obstacles is "registrable-with-conditions" or "obstructed"; the clean token states the position the rows refute`);

  return out;
}

// ── B2 (review 2026-07-31) — placements.json presence-of-content flag ──────────────────────────────────
// The parser used to THROW on `placements: []`, which made a zero-candidate run an unrepairable
// fail-closed: the model cannot conjure candidates the funnel never surfaced, so the corrective ladder
// burned attempts on the most expensive stage in the cycle. The empty mirror is a fact a human should
// see, not a run-killer — so it lands here, flag-only and structural (never load-blocking), beside its
// content-model siblings. `placements` null/absent (every archived run, and any run whose sibling is
// legitimately pre-B2) emits NOTHING, so the replay corpus can never grow a failure from this.
// ── — the retrieval→findings record trace's two reportable defects ────────────────────────────
// The ruling: "A drop with no recorded reason is itself a defect the run reports." Two facts qualify
// and they are NEVER merged, because they have opposite fixes:
//
//   unreasoned      a retrieved record reached a step obliged to speak about it and nothing recorded a
//                   ground. The judgment seam leaked.
//   upstream_absent a retrieved record was dropped because the stage that would have judged it never
//                   completed. Nothing judged it at all. Placement-inquiry hard-walled twice and was
//                   then SKIPPED on the partial artifact a killed attempt had left. Read as judgment,
//                   that run looks like a lawyer's call; read correctly it is a stage that never ran.
//
// FLAG-ONLY and never load-blocking, like its placements sibling above: this is disclosure, and the
// run that motivated it delivered a report a human needed to see. `recordCarry` null/absent (every
// archived run, and any register-less matter) emits NOTHING, so the replay corpus cannot grow a
// failure from this. A NON-computable trace is itself flagged — an absence is a finding, and a trace
// that could not run must not read the same as a trace that found nothing.
export function recordCarryChecks({ recordCarry }) {
  if (!recordCarry || typeof recordCarry !== "object") return [];
  const out = [];
  if (recordCarry.computable !== true) {
    const c = check("record-carry-computable", "content-model", "register-digest", false,
      `the retrieval→findings record trace could not be computed (${String(recordCarry.reason ?? "no reason recorded")}) — so this run can say nothing about whether a retrieved record became a finding, which is not the same as saying none were dropped`);
    c.structural = true;
    return [c];
  }
  const t = recordCarry.totals ?? {};
  const unreasoned = Number(t.unreasoned ?? 0) || 0;
  const upstream = Number(t.upstream_absent ?? 0) || 0;
  const retrieved = Number(t.retrieved ?? 0) || 0;

  // — THE TWO ARMS THAT WOULD HAVE CAUGHT THE SHIPPED DEFECT. Both are about the TRACE, never about
  // the run's recall, and both are absent from a v1 artifact by design: `degenerate` and `basis` are v2
  // fields, so an archived run reads `undefined` and neither arm fires. An absence is a finding for a
  // FRESH run, and on a fresh run these fields are always written.
  if (recordCarry.degenerate === true) {
    const d = check("record-carry-degenerate", "content-model", "register-digest", false,
      `the trace says NOT ONE of ${retrieved} retrieved register record(s) became a finding, and findings.json names ${Number(recordCarry.delivered_findings ?? 0) || 0}. Those are statements about the same records, so the TRACE is wrong — do not read this as a recall failure and do not quote its drop counts. This is the #420 shape: a join evaluated before the thing it joins against exists`);
    d.structural = true;
    out.push(d);
  }
  if (recordCarry.basis === "reconstructed") {
    const r = check("record-carry-basis-recorded", "content-model", "register-digest", false,
      "every ending in this trace was INFERRED by comparing artifacts after the fact, because no per-seam discard ledger (_driver/record-discard.jsonl) was present. Inference is what reported a clean run as a total loss in #420. Expected on a run archived before that fix; on a fresh run it means no seam recorded what it did");
    r.structural = true;
    out.push(r);
  }

  const a = check("record-carry-unreasoned", "content-model", "register-digest", unreasoned === 0,
    unreasoned ? `${unreasoned} of ${retrieved} retrieved register record(s) were dropped with NO step recording a ground — every retrieved record either becomes a finding or carries a reason it did not, and these carry neither. Named per record in _driver/record-carry.json .unreasoned; each also ships as an OPEN doubt` : "");
  if (!a.pass) a.structural = true;
  out.push(a);

  const stages = Array.isArray(recordCarry.incomplete_stages) ? recordCarry.incomplete_stages : [];
  const b = check("record-carry-upstream-absent", "content-model", "register-digest", upstream === 0,
    upstream ? `${upstream} of ${retrieved} retrieved register record(s) were dropped because an upstream stage never completed (${stages.join(", ") || "unnamed"}) — NOT because any judgment step rejected them. Whatever those stages left on disk is PARTIAL, so a record they do not name cannot be read as considered-and-not-selected. Filter _driver/record-carry.json .rows on reason ending :stage-incomplete` : "");
  if (!b.pass) b.structural = true;
  out.push(b);

  // THE BOUNDARY RIDES THE FAILING MESSAGES, not a check of its own. A check that always passes is a
  // green tick nobody renders — only failing checks' `detail` reaches a reader — so the scope is
  // appended to the two messages above instead, and it also travels on the artifact (`scope`), the
  // run.jsonl row and the pipeline's note. A zero must never be read wider than it was measured.
  const un = (Array.isArray(recordCarry.scope?.uninstrumented) ? recordCarry.scope.uninstrumented : []).map((u) => u.path);
  if (un.length) {
    const boundary = ` — NOTE this trace covers the REGISTER path only and emits no rows for: ${un.join(", ")}, so it is silent about drops there rather than clearing them`;
    for (const c of out) if (!c.pass) c.detail += boundary;
  }

  return out;
}

// — THE SAME SELF-CHECK, ON THE FAMILY THAT HAD NO ARM AT ALL.
//
// `commonlaw-carry.mjs:441` computes `degenerate` for the common-law grid and for each jx slice, on
// exactly the shape `record-carry.mjs` uses: not one retrieved candidate reached a finding, while the
// findings themselves name URLs. Those are statements about the same candidates, so the trace is
// wrong. The pipeline noted it and nothing else read it — `recordCarryChecks` above reads
// `record-carry` alone, and no arm anywhere read the common-law or jx carries. On R6 (2026-08-23) the
// `jx-zh-grid` slice recorded `degenerate: true` — 567 retrieved, 0 findings, 65 findings_urls —
// while `record-carry.degenerate` was `false`, so the one arm that existed never fired and no surface
// a person reads carried it.
//
// Both arms are mirrored, not just the degenerate one. A partial mirror recreates the asymmetry this
// issue is about: a slice whose trace could not be COMPUTED is equally unable to say that nothing was
// dropped, and leaving that silent here would reproduce the defect one field along.
//
// `carries` is the artifacts already read for this run, in the order the pipeline names them. A slice
// that is absent contributes nothing — an archived run predating these fields grows no check, the
// same rule `recordCarryChecks` follows.
export function commonLawCarryChecks({ carries }) {
  const list = (Array.isArray(carries) ? carries : []).filter((c) => c && typeof c === "object");
  const out = [];
  for (const carry of list) {
    // The artifact names its own slice; falling back keeps a v1 artifact from producing a bare id.
    const slice = String(carry.slice ?? carry.unit ?? "common-law").trim() || "common-law";
    if (carry.computable !== true) {
      const c = check(`commonlaw-carry-computable:${slice}`, "content-model", "register-digest", false,
        `the retrieval→findings trace for the ${slice} lane could not be computed (${String(carry.reason ?? "no reason recorded")}) — so this run can say nothing about whether a retrieved candidate became a finding, which is not the same as saying none were dropped`);
      c.structural = true;
      out.push(c);
      continue;
    }
    if (carry.degenerate === true) {
      const t = carry.totals ?? {};
      const retrieved = Number(t.retrieved ?? 0) || 0;
      const urls = Number(carry.findings_urls ?? 0) || 0;
      const d = check(`commonlaw-carry-degenerate:${slice}`, "content-model", "register-digest", false,
        `the ${slice} trace says NOT ONE of ${retrieved} retrieved candidate(s) reached a finding, and the findings name ${urls} URL(s) from this lane. Those are statements about the same candidates, so the TRACE is wrong — do not read this as a recall failure and do not quote its drop counts`);
      d.structural = true;
      out.push(d);
    }
  }
  return out;
}

export function placementsChecks({ placements }) {
  if (!Array.isArray(placements)) return [];
  const c = check("placements-empty", "content-model", "placement", placements.length > 0,
    placements.length ? "" : "placements.json carries no entries — placement normally places EVERY surfaced candidate (even a barren band carries out-of-scope-filtered rows), so either the funnel surfaced nothing this pass or placement's structured mirror was written empty; confirm which before delivery");
  if (!c.pass) c.structural = true;
  const out = [c];

  // — DISCLOSURE, NOT A DEFECT, and the distinction is the whole point of the row.
  //
  // A placement row with no `records[]` is CONTRACTUAL for a common-law candidate (stages.mjs dictates
  // `records: []`). It is also, per this driver's own note in placement-carry.mjs, the class every
  // URI-keyed carry gate is blind to: recall-reconciliation's parseFindingsEndings,
  // presence-reconciliation's parseRatedRows (`if (!uris.length) continue`) and band-shape's
  // dominantElementComposites all key on a `/mark` URI, so a row without one is in no band and reaches
  // none of them. Those are exactly the entities the sandboxed arms lost — company-shaped names that
  // only ever existed as a placement — and their absence read as a clean pass on all three.
  //
  // So this NEVER blocks and is never structural. It states the boundary, so a zero from a URI-keyed
  // gate is not read wider than it was measured. Only failing checks' `detail` reaches a reader, which
  // is why it is written to flag on presence rather than to pass quietly with a count nobody renders.
  const withoutUri = placements.filter((e) => !(Array.isArray(e?.records) && e.records.length)).length;
  if (placements.length && withoutUri) {
    out.push(check("placement-rows-without-uri", "content-model", "placement", false,
      `${withoutUri} of ${placements.length} placement row(s) name no record URI. This is expected for a common-law candidate (records: [] by contract) and is NOT a defect — it is a COVERAGE BOUNDARY: every URI-keyed carry gate in this driver is silent about these rows rather than clearing them, so a clean result from those gates says nothing about this ${withoutUri}. placement-carry's own join is what covers them; read its classes before treating any of this as carried.`));
  }
  return out;
}

// ── spec 64 — verdict ⇄ actions ⇄ statement coherence (the "one risk statement" guards) ────────────────
// All three families are GATED on the new fields being present (actionsRegister array / statement), so
// the replay corpus (archived runs without them) never grows a failure. All structural: the repair is
// CODE-FIRST — the pipeline re-derives the sidecar (applyCoverageFloor + writeVerdictSidecar) — never a
// prose redo; an unfixed defect ships as a visible banner flag.

// A CLEAR verdict over live condition-kind actions is the exact incoherence spec 64 exists to prevent
// (copper-causeway/ashen-gantry: "consent before filing" beside a delivered CLEAR); the mirror check
// catches a stale sidecar (kinds.legalActions with no surviving condition action).
export function verdictActionsCoherenceChecks({ actionsRegister, findings, verdictDoc }) {
  if (!Array.isArray(actionsRegister) || !verdictDoc) return [];
  const { conditions } = deriveActionConditions(actionsRegister, findings ?? []);
  const v = String(verdictDoc.verdict ?? "").toUpperCase();
  const out = [];
  const clearOverConditions = v === "CLEAR" && conditions.length > 0;
  const c1 = check("verdict-actions-coherence", "verdict", "report", !clearOverConditions,
    clearOverConditions ? `the findings name ${conditions.length} forward legal action(s) a human must take, but the delivered verdict is CLEAR — re-derive the verdict sidecar from the FINAL findings (applyCoverageFloor + writeVerdictSidecar); never edit the actions to fit the verdict` : "");
  if (!c1.pass) c1.structural = true;
  out.push(c1);
  const stale = Boolean(verdictDoc.kinds?.legalActions) && conditions.length === 0;
  const c2 = check("verdict-actions-stale", "verdict", "report", !stale,
    stale ? "verdict.json kinds.legalActions is set but the findings carry no live condition action — the sidecar describes a superseded findings set; re-derive it" : "");
  if (!c2.pass) c2.structural = true;
  out.push(c2);
  return out;
}

// THE one statement must carry the tier word it claims to bind, and a CONDITIONAL statement can never
// read as an unconditional proceed. Cheap belt-and-braces over a code-built artifact.
// PR-3 (report voice, user decision 2026-07-28): the retired "do not rely on this as-is" self-caveat
// is GONE and so is its magic-string coupling — coherence now tests the STRUCTURED stance field plus
// the conditional FORM riskStatement composes ("<Tier> — conditional on: <facts>"), never a wording
// regex. Legacy sidecars (no stance) get the tier + unconditional-proceed checks only — judged
// against the wording THEIR era composed (the retired-phrase exemption below), never the new form.
export function statementCoherenceChecks({ verdictDoc }) {
  if (!verdictDoc?.statement) return [];
  const st = String(verdictDoc.statement), tier = String(verdictDoc.tier ?? "");
  const v = String(verdictDoc.verdict ?? "").toUpperCase();
  const out = [];
  const hasTier = Boolean(tier) && st.toLowerCase().includes(tier.toLowerCase());
  const c1 = check("statement-tier", "verdict", "report", hasTier,
    hasTier ? "" : `the delivered risk statement ("${st.slice(0, 80)}") does not carry the tier word "${tier}" — re-derive the sidecar (riskStatement composes tier + stance from the same record)`);
  if (!c1.pass) c1.structural = true;
  out.push(c1);
  // The conditional form's own "conditional on:" clause contains the word "condition", so
  // isUnconditionalProceed is false on every correctly composed NEW-form statement — no wording
  // exemption needed there (a condition text containing "proceed", e.g. "Proceed with the
  // coexistence deal", arrives after the clause and cannot false-fire). A LEGACY sidecar (no
  // stance field) composed the retired "do not rely on this as-is:" phrase instead, which carries
  // no condition-vocabulary token — for those the old wording exemption stays, so a pre-PR run
  // that resumes and re-lints its previously-valid sidecar never takes a spurious structural
  // failure (and never burns its single code-first re-derive repair pass on it).
  const uncond = v === "CONDITIONAL" && isUnconditionalProceed(st) &&
    (verdictDoc.stance != null || !/do not rely on this as-is/i.test(st));
  const c2 = check("statement-unconditional", "verdict", "report", !uncond,
    uncond ? `a CONDITIONAL run's statement reads as an unconditional proceed ("${st.slice(0, 80)}") — re-derive the sidecar` : "");
  if (!c2.pass) c2.structural = true;
  out.push(c2);
  if (verdictDoc.stance != null) {
    const expected = verdictStance(v);
    const stanceOk = expected != null && verdictDoc.stance === expected;
    const c3 = check("statement-stance", "verdict", "report", stanceOk,
      stanceOk ? "" : `verdict.json stance "${verdictDoc.stance}" does not match the verdict ${v || "(missing)"} (expected "${expected ?? "?"}") — the sidecar fields diverged; re-derive it (writeVerdictSidecar composes both from one record)`);
    if (!c3.pass) c3.structural = true;
    out.push(c3);
    const formOk = verdictDoc.stance !== "conditional" || /—\s*conditional on:/.test(st);
    const c4 = check("statement-conditional-form", "verdict", "report", formOk,
      formOk ? "" : `a conditional-stance statement must state what conditions reliance ("<Tier> — conditional on: <facts>"), but reads "${st.slice(0, 80)}" — re-derive the sidecar`);
    if (!c4.pass) c4.structural = true;
    out.push(c4);
  }
  return out;
}

// qw/verdict-text-coherence — badge/text CONTRADICTION lint: a delivered CONDITIONAL (clamped or
// native — the sidecar does not distinguish, deliberately) whose caption/summary/actions prose
// asserts a CLEAN outcome is the wp50/wi2 defect one register over: the badge says "conditions
// attached" while the words say "clear to proceed". This check polices CONTRADICTION, never
// OMISSION — by design (stages.mjs report-overview "overall_caption VOICE": the caption is plain
// consequence + action, ≤3 sentences) the caption is ALLOWED to not mention the conditional; only
// prose that affirmatively asserts there are no conditions is a defect. Hence the TIGHT curated
// phrase list below rather than any broad semantic grep: each entry asserts the matter is clear to
// proceed/file with no conditions, and adding to it is an editorial decision, not a tuning knob.
// NOT structural: this is drafting prose a warm redo can fix — it rides the existing lint-repair
// pathway (one report-overview / client-summary followup), then flag-and-deliver like every check.
const CLEAN_ASSERTION_RES = [
  /\bclear to proceed\b/i,
  /\bclear to file\b/i,
  /\bno conditions\b/i,
  /\bunconditionally clear\b/i,
  /\bnothing further (?:is )?required before filing\b/i,
];
// A sentence that CARRIES its condition is not contradicting it: "clear to proceed once the consent
// is signed" states the conditional, exactly what a CONDITIONAL run's prose should do (the
// isUnconditionalProceed vocabulary, minus the bare "condition" token — the "no conditions" ASSERTION
// itself contains it, so the matched phrase is stripped before this guard is applied).
const CONDITION_QUALIFIER_RE = /\b(?:subject to|provided|pending|unless|after|once|until|contingent|condition(?:al|ed) on|if)\b/i;
export function conditionalTextCoherenceChecks({ reportMd, clientSummaryMd, verdictDoc }) {
  if (String(verdictDoc?.verdict ?? "").toUpperCase() !== "CONDITIONAL") return [];
  const md = String(reportMd ?? "");
  const capt = md.match(/^overall_caption:\s*(.+)$/m)?.[1] ?? "";
  const summary = md.match(/^#\s*Summary\s*\n([\s\S]*?)(?=^#\s|\s*$)/m)?.[1] ?? "";
  const actions = md.match(/^#\s*Actions\s*\n([\s\S]*?)(?=^#\s|\s*$)/m)?.[1] ?? "";
  const zones = [
    ["overall_caption", capt, "report"],
    ["summary", summary, "report"],
    ["actions", actions, "report"],
    ["client-summary", stripHtml(clientSummaryMd ?? ""), "client-summary"],
  ];
  const badBySurface = new Map();
  for (const [zone, text, surface] of zones) {
    if (!String(text).trim()) continue;
    for (const sentence of String(text).split(/(?<=[.!?])\s+|\n+/)) {
      for (const re of CLEAN_ASSERTION_RES) {
        const m = sentence.match(re);
        if (!m) continue;
        if (CONDITION_QUALIFIER_RE.test(sentence.replace(m[0], " "))) continue;   // the sentence carries its condition
        const hits = badBySurface.get(surface) ?? [];
        hits.push(`${zone} asserts a clean outcome on a CONDITIONAL run ("${sentence.trim().replace(/\s+/g, " ").slice(0, 90)}") — the delivered verdict carries conditions; state the condition or drop the clean assertion (omitting the conditional is fine; contradicting it is not)`);
        badBySurface.set(surface, hits);
        break;   // one flag per sentence — the sentence is the defect, however many phrases it stacks
      }
    }
  }
  const out = [];
  for (const surface of ["report", "client-summary"]) {
    if (surface === "client-summary" && !String(clientSummaryMd ?? "").trim()) continue;
    const bad = badBySurface.get(surface) ?? [];
    out.push(check("conditional-text-coherence", "verdict", surface, bad.length === 0, bad.join("; ")));
  }
  return out;
}

// ── PR-3 (report voice) — the advice sweep's deterministic net ─────────────────────────────────────────
// The report carries facts that condition, never advice — and never undermines itself. This check
// polices the two retired voices on the delivered model-authored surfaces: prescription grammar (the
// forced "practical path" filler and its family — forward asks live ONLY in the typed actions
// register) and self-caveat language (the retired "do not rely" wording — reliability is decided by
// the GATE, never narrated; user decision 2026-07-28). CURATED list — each entry is an editorial
// decision, not a tuning knob. FLAG-ONLY, never structural: drafting prose with a warm redo route.
// Scope: the assembled report MINUS its code-built regions — the "Only you can close these" section
// is code-built from the register and its asks are LEGITIMATELY imperative, so it is stripped before
// the scan; the verdict statement is excluded by construction (it lives in verdict.json, not here).
const PRESCRIPTION_RES = [
  /\bpractical path\b/i,                      // the retired card-template filler grammar
  /\brealistic path\b/i,                      // its sibling (the retired caption/lead echo)
  /\bdo not rely on this\b/i,                 // the retired self-caveat — banned product-wide
  /\bwe (?:recommend|advise|suggest)\b/i,     // advice voice — the product states judgment, never counsel's tip
  /\bit is (?:recommended|advisable) to\b/i,
  /\byou should\b/i,                          // second person is already banned (rule 9); prescriptive form of it
];
const stripOnlyYou = (md) => String(md ?? "")
  .replace(/^###\s+Only you can close these\b[^\n]*\n?[\s\S]*?(?=^###\s|^#\s|$(?![\s\S]))/m, " ");
// P5 (review 2026-07-31): the content model routes six MODEL-AUTHORED free-prose fields from
// findings.json STRAIGHT onto the report surface (the card reads and the hero's four-answers panel).
// They are delivered prose the reader sees, so they are governed by the same retired voices as the
// markdown — the old zone list scanned only reportMd + clientSummaryMd and never saw them, which left
// the most prescription-prone field in the product (registrability / registrable-with-conditions)
// unguarded. Same CURATED pattern list, same flag-only severity: the surface widens, the rule does not.
// An archived run carries none of these fields ⇒ the zone is empty ⇒ no check is emitted (the replay
// corpus cannot grow a failure). DELIBERATELY OFF THE WARM-REDO ROUTE: the pipeline's lint repair keys
// on surface "report"/"client-summary", and these bytes live in findings.json, whose contract is CLOSED
// (spec 64) — a report re-emit cannot fix them, and a doomed redo is the TONICA lesson. The failure
// ships to the reviewing lawyer on the receipt with the report (A10, two-bit gate), which is also why
// it is not a gate id: evaluateClientGate consumes no prescription-prose id on any surface.
const contentModelProse = (findings, fourAnswers) => {
  const parts = [];
  for (const f of Array.isArray(findings) ? findings : []) {
    if (!f || f.disposition === "withdrawn") continue;
    for (const v of [f.legal_position, f.practical_position, f.manageable?.reason]) if (v) parts.push(String(v));
  }
  for (const a of Object.values(fourAnswers && typeof fourAnswers === "object" ? fourAnswers : {})) {
    if (!a || typeof a !== "object") continue;
    for (const v of [a.read, a.basis]) if (v) parts.push(String(v));
    for (const o of Array.isArray(a.obstacles) ? a.obstacles : []) if (o?.note) parts.push(String(o.note));
  }
  return parts.join("\n");
};
export function prescriptionProseChecks({ reportMd, clientSummaryMd, findings, fourAnswers }) {
  const zones = [
    ["report", stripOnlyYou(reportMd)],
    ["client-summary", stripHtml(clientSummaryMd ?? "")],
    ["content-model", contentModelProse(findings, fourAnswers)],
  ];
  const out = [];
  for (const [surface, text] of zones) {
    if (!String(text).trim()) continue;
    const hits = [];
    for (const sentence of String(text).split(/(?<=[.!?])\s+|\n+/)) {
      const re = PRESCRIPTION_RES.find((r) => r.test(sentence));
      if (re) hits.push(`"${sentence.trim().replace(/\s+/g, " ").slice(0, 90)}"`);
    }
    out.push(check("prescription-prose", "voice", surface, hits.length === 0,
      hits.length ? `advice-shaped or self-caveating language on a delivered surface — the report states facts that condition, never advice (forward asks live only in the actions register; reliability is decided by the gate, never narrated): ${hits.slice(0, 4).join("; ")}${hits.length > 4 ? `; +${hits.length - 4} more` : ""}` : ""));
  }
  return out;
}

// The code-built "Only you can close these" must carry every live condition (assembly regression /
// hand-edit net — normalized containment, never semantic grep).
export function onlyYouRegisterChecks({ actionsRegister, findings, reportMd }) {
  if (!Array.isArray(actionsRegister) || !String(reportMd ?? "").trim()) return [];
  const { conditions } = deriveActionConditions(actionsRegister, findings ?? []);
  if (!conditions.length) return [];
  const flat = norm(reportMd);
  const missing = conditions.filter((t) => !flat.includes(norm(t)));
  const c = check("only-you-register", "verdict", "report", missing.length === 0,
    missing.length ? `${missing.length} live condition action(s) from the findings register are missing from the delivered report — re-run the assembly (assembleReportMd builds the ask list from the register): ${missing.map((t) => `"${t.slice(0, 60)}"`).join("; ")}` : "");
  if (!c.pass) c.structural = true;
  return [c];
}

// spec 64 — the promised presence flag (the markAssessmentChecks pattern): a fresh v4 run whose
// findings carry NO actions register ships with the whole gate stack disengaged (derivation,
// coherence checks, code-built ask list all key on it) — that state must be a VISIBLE structural
// banner flag, never distinguishable from a healthy clean run only in the run log. `expected` is
// caller-asserted (the live pipeline passes lintSv >= 4; the replay harness never does).
export function actionsRegisterChecks({ actionsRegister, expected }) {
  if (!expected) return [];
  const present = Array.isArray(actionsRegister);
  const c = check("actions-register-present", "verdict", "report", present,
    present ? "" : "the typed forward-actions register (findings.json actions[]) is missing on a fresh v4 run — the derived disposition, the coherence checks and the code-built ask list are all disengaged; the delivered verdict is the reviewer's alone");
  if (!c.pass) c.structural = true;
  return [c];
}

// PR-9 (Levels) — the fold-observability row: a fold is ROUTINE assembly (motion, never deletion), so
// the row ALWAYS PASSES — it exists so the receipt artifact and any reviewer can see where the assembly
// moved words, without triggering a repair loop or a gate. Emitted only when the run actually folded
// (archived/replay runs have no sidecar and never grow a row).
export function cardBudgetChecks({ cardFolds }) {
  const folds = Array.isArray(cardFolds) ? cardFolds : [];
  if (!folds.length) return [];
  return [check("card-budget-fold", "levels", "report", true,
    `assembly folded ${folds.length} surface(s) to the level budgets (moved, never deleted): ${folds.map((f) => `${f.surface} → +${f.movedSentences} sentence(s)/${f.movedWords} word(s) into depth`).join("; ")}`)];
}

export function runLint({ depth, commonLawGrid, matterContext, clientPartyName, reportMd, clientSummaryMd, narrativeMd, auditMd, recordsByUri, searchedNames, headerName, ratedNames, actionsText, fetchFailures, extraPlatformNames, findings, findingsRaw, actionsRegister, actionsExpected, intakeAsks, askAnswers, cardFolds, verdictDoc, manifest, seniorRights, seniorRightsExpected, markAssessment, markAssessmentExpected, fourAnswers, contentModelExpected, findingsSchemaVersion, placements, ownerScreen, recordCarry, commonLawCarries, searchedJurisdictions = null }) {
  // WS-B: the run's profile platforms join the vocabulary for this run. Profiles carry store
  // DOMAINS by contract, so derive the name tokens a report would actually print: the raw norm
  // ("thomasnetcom"), the separator-spaced phrase ("thomasnet com" / "made in china com"), and the
  // phrase minus its trailing TLD token ("thomasnet", "made in china") — that last form is what
  // matches a THOMASNET orphan candidate. Single bare words beyond the platform's own name are
  // never added (a broad word-vocab could suppress a REAL adverse-owner orphan).
  const extraVocab = new Set();
  for (const x of extraPlatformNames ?? []) {
    const rawN = norm(x);
    if (rawN) extraVocab.add(rawN);
    const phrase = norm(String(x).replace(/[._-]+/g, " "));
    if (!phrase) continue;
    extraVocab.add(phrase);
    const words = phrase.split(" ").filter(Boolean);
    if (words.length >= 2) extraVocab.add(words.slice(0, -1).join(" "));   // drop the TLD token
  }
  const checks = [];
  if (reportMd) {
    checks.push(...registryChecks({ text: reportMd, recordsByUri, surface: "report", fetchFailures }));
    if (findings) checks.push(...findingProvenanceChecks({ reportMd, findings }));   // B2 — per-card record provenance (confabulation backstop)
    // V4-3: the MENTION zone is the only-you bucket alone (the asks the lawyer must act on); the
    // checks-we-ran bucket is a self-introducing findings recap and counts as introduction territory.
    // Both buckets still compose the email's full surface (that is what the cover carries).
    const onlyYou = (splitBlocks(reportMd).filter((b) => /only you can close/i.test(b.heading))
      .map((b) => `${b.heading}\n${b.text}`).join("\n")) || actionsText || "";
    const actions = (splitBlocks(reportMd).filter((b) => /checks we ran|only you can close/i.test(b.heading))
      .map((b) => `${b.heading}\n${b.text}`).join("\n")) || actionsText || "";
    // — every mark the run knows about: the ones it was asked about and the ones it found.
    const markNames = [...new Set([
      ...(searchedNames ?? []),
      ...((findings ?? []).map((f) => f?.mark).filter(Boolean)),
    ])];
    checks.push(...referenceChecks({ actionsText: onlyYou, fullSurface: reportMd, searchedNames, surface: "report", extraVocab, markNames, structural: actionsExpected === true }));
    // V4-5 (+ PR-3): with a typed register the reachability check asserts over the STORE the
    // rendered lines are code-built from; the prose scan remains the legacy fallback.
    checks.push(...actionsReachabilityChecks({ onlyYouText: onlyYou, actionsRegister, findings }));
    checks.push(...actionBoundLineChecks(actionsRegister, findings));   // — the ask must fit the clause the statement carries
    checks.push(...selfComparisonChecks({ reportMd, searchedNames }));     // wp50/wi10
    // The EMAIL surface = the report's actions + (on an archived run) the client-summary content —
    // that is what the cover carries. An entity introduced only by a deep report card is an orphan
    // THERE — the delivered TMP8552 email's RTVE failure lived exactly in this gap (the report itself
    // introduced RTVE fine).
    //
    // 2026-08-01 (client-summary retirement) — this check used to be GATED on `clientSummaryMd`, which
    // meant retiring the stage would have deleted the whole `:email` surface from the live lane rather
    // than narrowing it: a gate that stops running is not a gate that passes, and the absence would
    // have read as success on every future run. The cover note still exists and still carries
    // report-derived text (composeEmailHtml renders the `# Actions`-derived conditional bound), so the
    // check keeps running over what the mail actually carries. On a REPLAY of an archived run the
    // client summary is still on disk and joins the surface exactly as before — byte-identical.
    checks.push(...referenceChecks({
      actionsText: onlyYou, fullSurface: [actions, clientSummaryMd].filter(Boolean).join("\n"), searchedNames, surface: "email", extraVocab, markNames, structural: actionsExpected === true,
    }).map((c) => ({ ...c, id: `${c.id}:email` })));
  }
  if (clientSummaryMd) checks.push(...registryChecks({ text: clientSummaryMd, recordsByUri, surface: "client-summary", fetchFailures }));
  // 404-card caveat (c): a record-verification CLAIM with no fetched record behind any of its citations
  if (reportMd) checks.push(...recordVerificationClaimChecks({ text: reportMd, recordsByUri, surface: "report" }));
  if (clientSummaryMd) checks.push(...recordVerificationClaimChecks({ text: clientSummaryMd, recordsByUri, surface: "client-summary" }));
  // ION/copper-foundry: a false "the tool was permission-blocked" claim. report + client-summary are NOT
  // structural — both have a warm named-correction redo, and that redo is the repair (a card hit carries
  // its ordinal so only that card is re-emitted). narrative + findings have no redo route, so they are
  // structural: they ship as visible flags rather than triggering a doomed redo.
  // P2-B — named-competitor claims and owner-screen negatives, on both delivered prose surfaces. The
  // mark vocabulary keeps an owner whose name is a word of the mark from matching every sentence.
  if (ownerScreen?.owners?.length) {
    const markVocab = new Set([...(searchedNames ?? []), headerName ?? ""].flatMap((v) => norm(v).split(" ")).filter(Boolean));
    if (reportMd) {
      checks.push(...competitorClaimChecks({ text: reportMd, ownerScreen, recordsByUri, markVocab, surface: "report" }));
      checks.push(...ownerScreenNegativeChecks({ text: reportMd, ownerScreen, markVocab, surface: "report" }));
    }
    if (clientSummaryMd) {
      checks.push(...competitorClaimChecks({ text: clientSummaryMd, ownerScreen, recordsByUri, markVocab, surface: "client-summary" }));
      checks.push(...ownerScreenNegativeChecks({ text: clientSummaryMd, ownerScreen, markVocab, surface: "client-summary" }));
    }
  }
  // tracker issue 134 — the delivered prose's coverage claims against what the run actually searched.
  // Top-level, NOT inside the owner-screen guard above: a coverage claim has nothing to do with whether
  // this run has an owner screen, and nesting it there would have silently switched the check off for
  // every run without one. Both prose surfaces: the narrative is where the issue measured the
  // disagreement, and the report is what the client is handed.
  if (reportMd) checks.push(...coverageClaimChecks({ text: reportMd, searchedJurisdictions, surface: "report" }));
  if (narrativeMd) checks.push(...coverageClaimChecks({ text: narrativeMd, searchedJurisdictions, surface: "narrative" }));
  if (reportMd) checks.push(...deadRecordLinkChecks({ text: reportMd, surface: "report" }));
  if (clientSummaryMd) checks.push(...deadRecordLinkChecks({ text: clientSummaryMd, surface: "client-summary", idSuffix: ":client" }));
  if (narrativeMd) checks.push(...deadRecordLinkChecks({ text: narrativeMd, surface: "narrative", idSuffix: ":narrative" }));
  if (reportMd) checks.push(...permissionProseChecks({ text: reportMd, surface: "report" }));
  if (clientSummaryMd) checks.push(...permissionProseChecks({ text: clientSummaryMd, surface: "client-summary", idSuffix: ":client" }));
  if (narrativeMd) checks.push(...permissionProseChecks({ text: narrativeMd, surface: "narrative", idSuffix: ":narrative", structural: true }));
  // — the narrative's own depth rules, on the narrative surface so they route to the synthesis redo.
  if (narrativeMd) checks.push(...narrativeWriteUpChecks({ narrativeMd, findings, depth, manifest }));
  // — the same rule on both surfaces the client's words come from. The narrative is where the
  // shipped defect was authored; the report is what a client reads, and a repair to one that left the
  // other standing is how this family's previous cures kept being re-applied by hand.
  for (const [text, surface] of [[reportMd, "report"], [narrativeMd, "narrative"]])
    if (text) checks.push(...partyFactChecks({ text, surface, clientPartyName,
      ownerScreen, grid: commonLawGrid, records: recordsByUri, matterContext }));
  // the RAW findings text, not the parsed findings array: the incident's claim lived in coverage[] notes,
  // which the parsed `findings` param never carries. Cards are meaningless in JSON, so skip the split.
  if (findingsRaw) checks.push(...permissionProseChecks({ text: findingsRaw, surface: "findings", idSuffix: ":findings", structural: true, cards: false }));
  checks.push(...candidateSelfChecks({ reportMd }));
  // NARROWED, and worth stating plainly so its pass rows are not over-read (2026-08-01). This family
  // was written for the retired email review TABLE, and its teeth came from a MODEL-authored header on
  // client-summary.md. Two of its three arms compare `ratedNames` against `searchedNames`, and BOTH
  // callers — the live pipeline and replay-archive.mjs — pass the same array for both, so
  // `assessment-row:*` and `rating-position:*` are tautological in both lanes and were ALREADY so
  // before this change. `names-cell-populated` keeps real teeth in REPLAY (headerName comes from the
  // archived summary). On the LIVE path headerName is now code-derived from the searched names, so it
  // asserts only that the run knows what it searched — a weaker claim than it used to make, but not a
  // vacuous one, and it still fails when that is empty.
  checks.push(...templateChecks({ headerName, ratedNames, searchedNames }));
  checks.push(...seniorRightChecks({ seniorRights, expected: seniorRightsExpected }));   // WP-receipts W4 (+ D1: expected-but-absent fails)
  checks.push(...markAssessmentChecks({ markAssessment, expected: markAssessmentExpected }));   // WP-56 B2
  checks.push(...contentModelChecks({ findings, fourAnswers, expected: contentModelExpected }));   // P5 — legal/practical split · manageable category · four answers; — off-field ground
  // UNGATED. contentModelExpected is `schema_version >= 5`, so leaving this inside the call above
  // meant a down-level file switched off the check that reports a down-level file.
  checks.push(...schemaVersionChecks({ schemaVersion: findingsSchemaVersion }));   // — the declared contract version
  checks.push(...fourAnswersCoherenceChecks({ fourAnswers, findings, verdictDoc }));   // P5 review — the four answers must not contradict the verdict or the findings (flag-only, absent ⇒ silent)
  checks.push(...placementsChecks({ placements }));   // B2 — an empty structured mirror is a flag a human reads, never an unrepairable validator kill
  checks.push(...recordCarryChecks({ recordCarry }));   // — a retrieved record dropped with no recorded ground, and a drop that is really an incomplete stage
  checks.push(...commonLawCarryChecks({ carries: commonLawCarries }));   // — the same self-check on the common-law and jx carries, which no arm read at all
  checks.push(...countingChecks({ report: reportMd ?? "", "client-summary": clientSummaryMd ?? "" }, extraVocab));
  checks.push(...scopeNumberProseChecks({ reportMd, clientSummaryMd }));   // PR-4 counting flip: no scope/coverage numbers in prose at all
  if (findings) checks.push(...countsFromFindings(findings, { report: reportMd ?? "", "client-summary": clientSummaryMd ?? "" }));
  if (findings) checks.push(...correctionConsistencyChecks({ reportMd, clientSummaryMd, auditMd, findings }));   // A1 (+ audit surface, 2026-07-21)
  if (findings && clientSummaryMd) checks.push(...clientTierChecks({ clientSummaryMd, findings, manifest }));   // A2 (doc 50: band words via the frozen manifest)
  if (verdictDoc?.tier && reportMd) checks.push(...overallTierChecks({ reportMd, verdictDoc }));         // wp50/wi2
  checks.push(...verdictActionsCoherenceChecks({ actionsRegister, findings, verdictDoc }));              // spec 64
  checks.push(...statementCoherenceChecks({ verdictDoc }));                                              // spec 64
  checks.push(...conditionalTextCoherenceChecks({ reportMd, clientSummaryMd, verdictDoc }));             // qw/verdict-text-coherence — CONDITIONAL badge vs clean-outcome prose
  checks.push(...prescriptionProseChecks({ reportMd, clientSummaryMd, findings, fourAnswers }));         // PR-3 report voice — facts that condition, never advice; flag-only (P5: the findings-derived prose is a delivered surface too)
  checks.push(...onlyYouRegisterChecks({ actionsRegister, findings, reportMd }));                        // spec 64
  checks.push(...actionsRegisterChecks({ actionsRegister, expected: actionsExpected }));                 // spec 64
  checks.push(...intakeAskChecks({ reportMd, clientSummaryMd, intakeAsks, askAnswers }));               // A6 (PR-9: judged on the ask_answers join when the register exists)
  checks.push(...wipoLanguageChecks({ reportMd, clientSummaryMd }));                                     // A5
  checks.push(...cardBudgetChecks({ cardFolds }));                                                       // PR-9 — fold observability (always-pass; motion, never deletion)
  const failures = checks.filter((c) => !c.pass);
  return { checks, failures };
}

// ── The KNOCKOUT lane's applicable subset (2026-07-31) ──────────────────────────────────────────────
// The knockout (Stage 0/0.5) lane wrote NO predelivery-lint.json at all, by a decision recorded in
// docs/DELIVERY.md (2026-07-28). That decision rested on two premises this tranche has since moved:
// the lint artifact is now the WORKBOOK's QC record (/), so a lane that writes none produces an
// EMPTY QC record rather than a deliberately-absent one; and 's A10 projects recorded defects onto
// the cover note that reaches the reviewing lawyer, so a knockout defect reached nobody. What has NOT
// moved is the other half of the memo: this lane's deliverable is store-rendered, and most clearance
// checks read surfaces it does not produce. So the extension is a SUBSET, derived from what the lane
// emits, and it is FLAGS-ONLY — the hard permission-prose gate in verify-knockout.mjs is untouched and
// nothing here can refuse a delivery.
//
// Derivation. The knockout lane's ONE model-authored artifact is knockout-findings.json. It has no
// register RECORD store (it counts, it does not retrieve), no actions register, no verdict sidecar, no
// client summary, no card assembly, no reviewer correction cycle, no intake-ask register. So the
// applicable checks are exactly those whose whole input is model-authored TEXT:
//   permission-prose · scope-numbers-in-prose · counting-consistency · wipo-designation-language ·
//   prescription-prose
// Everything else is ABSENT BY DESIGN and says so in the receipt (KNOCKOUT_ABSENT_BY_DESIGN below) —
// never an entry that silently passes, which is the failure mode this tranche exists to kill. Measured
// against two real archived knockout runs (2026-07-28 BRIMSTONE, 2026-07-29 TASTICLES): zero flags on the
// applicable five, and templateChecks false-FAILED names-cell-populated on both (there is no NAME(S)
// row on this lane) — which is why it is excluded rather than run.
//
// The two prose surfaces are split the way the RENDERER splits them (publish/render-knockout.mjs
// analysisSection + summary): `bullets`, each finding's `name` and its authored prose, the executive
// summary and the standing caveats are on the client-facing page; `contextFraming`, `purpleNotes` and
// `registerEstimate` are internal working material that lives in the workbook. The split is load-bearing
// for the projection — every DELIVERY_LINES sentence says "the report …", so only report-surface
// failures may be projected onto a delivery surface.
//
// — the typed finding's `net` and `basis` ARE the report's lead prose (the renderer prints net as
// the conclusion sentence and basis beneath it), and until this line read them they were scanned by
// nothing at all: this function read `name`/`description`, and verify-knockout.mjs's merged backstop
// reads neither. So a permission excuse, a banned-tone phrase or a prescription in the sentence a client
// reads first passed every check on the lane. KNOCKOUT PROSE ARM 2026-08-06 — `description`, `impact`
// and `notes` are the archived prose row's fields and are read only so an archived republish is scanned
// on the same terms; drop them with the other prose arms.
const knockoutSurfaces = (findings) => {
  const report = [String(findings?.batch?.executiveSummary ?? ""), ...(findings?.batch?.standardCaveats ?? []).map(String)];
  const working = [];
  for (const m of findings?.marks ?? []) {
    for (const b of m?.bullets ?? []) report.push(String(b));
    for (const f of m?.findings ?? []) {
      report.push([f?.name, f?.owner, f?.net ?? f?.description, f?.basis].filter(Boolean).map(String).join(" — "));
      working.push(...[f?.impact, f?.notes].filter(Boolean).map(String));
    }
    working.push(...[m?.contextFraming, m?.registerEstimate, ...(m?.purpleNotes ?? [])].filter(Boolean).map(String));
  }
  return { report: report.filter(Boolean).join("\n\n"), working: working.filter(Boolean).join("\n\n") };
};

/**
 * KNOCKOUT_ABSENT_BY_DESIGN — the clearance checks this lane does NOT run, each with the reason its
 * input does not exist here. This is the third state (/'s rule, in the lint's own vocabulary):
 * a check is RAN-AND-PASSED, RAN-AND-FAILED, or ABSENT BY DESIGN. It is deliberately not modelled as a
 * check object: `pass:false` would project onto the cover note as a defect, and `pass:true` would be
 * the silent pass. Adding a check to runLint without adding it here or to the subset above leaves the
 * receipt honestly incomplete rather than falsely complete.
 */
export const KNOCKOUT_ABSENT_BY_DESIGN = [
  ["names-cell-populated", "template", "the summary table is code-rendered from the rated marks — there is no NAME(S) row to populate"],
  ["assessment-row", "template", "one row per rated mark is code-rendered, and plan⇄rated parity is already a hard gate on this lane (validateMergedFindings)"],
  ["rating-position", "template", "the rating sits on the mark's own code-rendered row; no model-typed table places it"],
  ["candidate-self-legacy", "template", "polices a retired clearance report treatment this lane never had"],
  ["reference-integrity", "reference", "no \"Only you can close\" ask bucket — this lane authors no actions"],
  ["self-comparison", "reference", "reads per-card \"X against Y\" prose; the knockout report has no cards"],
  ["registry-arithmetic", "registry", "no register record store — this lane counts register hits, it does not retrieve records"],
  ["registry-record-match", "registry", "same: no retrieved record to check a filing or registration year against"],
  ["registry-record-coverage", "registry", "same: no per-record fetch state to report coverage over"],
  ["record-verification-claim", "registry", "same: no record set behind which a verification claim could be empty"],
  ["finding-provenance", "registry", "binds a report card to its record URI; this lane has neither cards nor record URIs"],
  ["senior-rights-present", "registry", "no senior-right receipt — the closure that owes it is clearance machinery"],
  ["senior-right-coverage", "registry", "same"],
  ["counting-vs-findings", "counting", "reads the clearance finding set's owner + registration URIs; knockout findings carry neither"],
  ["correction-consistency", "corrections", "no reviewer correction cycle on this lane — nothing is corrected or withdrawn after rating"],
  ["client-tier-match", "client", "no client summary (one report), so there is no second tier word to disagree"],
  ["overall-tier", "client", "the overall band is DERIVED in code (worstBand over the rated marks) and cannot drift from the finding set"],
  ["actions-reachability", "actions", "no actions register and no ask bucket"],
  ["actions-register-present", "verdict", "the typed actions register is clearance machinery this lane never arms"],
  ["only-you-register", "verdict", "same"],
  ["verdict-actions-coherence", "verdict", "no verdict sidecar and no actions to cohere with it"],
  ["verdict-actions-stale", "verdict", "same"],
  ["statement-tier", "verdict", "no composed risk statement — the knockout headline is the band word itself"],
  ["statement-stance", "verdict", "same"],
  ["statement-conditional-form", "verdict", "same"],
  ["statement-unconditional", "verdict", "same"],
  ["conditional-text-coherence", "verdict", "same: no CONDITIONAL disposition exists on this lane"],
  ["intake-ask", "intake", "no intake-ask register on this lane"],
  ["mark-assessment-present", "mark-assessment", "the standing \"The mark itself\" block is a v4 clearance field"],
  ["card-budget-fold", "levels", "no card assembly and no level budgets to fold against"],
].map(([id, family, reason]) => ({ id, family, reason }));

/**
 * runKnockoutLint — the applicable subset, over the knockout lane's own merged findings.
 * Returns { checks, failures, notApplicable } in runLint's shape. FLAG-ONLY by construction: it
 * decides nothing, throws nothing, and the caller writes its receipt best-effort.
 */
export function runKnockoutLint({ findings }) {
  const { report, working } = knockoutSurfaces(findings);
  const checks = [];
  // The client-facing page. permission-prose here is NOT a re-run of the hard gate: verify-knockout's
  // mergedProse is executiveSummary + contextFraming/bullets/purpleNotes/registerEstimate, and it does
  // NOT include each finding's name/description — which analysisSection renders straight onto the page.
  // A fabricated tool-blocked excuse in a finding description ships past the hard gate today.
  // The surface label is NORMALIZED to "report" as they are pushed, and that is load-bearing rather
  // than tidy: the caller projects on `surface === "report"` exactly, so a check that labels itself
  // anything else would be recorded in the receipt and dropped from both delivery surfaces — the "flag
  // nobody reads" shape this whole change exists to close. countingChecks is the live case: it hardcodes
  // "all", because on the clearance lane it asserts agreement BETWEEN surfaces. This lane has one
  // surface, so "report" is also the truer label here. The filter is deliberately not `!== "findings"`:
  // that would default a check added next year to PROJECTING onto a surface a client principal reads.
  const onReport = (list) => list.map((c) => ({ ...c, surface: "report" }));
  checks.push(...permissionProseChecks({ text: report, surface: "report", idSuffix: ":knockout", structural: true, cards: false }));
  checks.push(...onReport(scopeNumberProseChecks({ reportMd: report })));
  checks.push(...onReport(countingChecks({ report })));
  checks.push(...onReport(wipoLanguageChecks({ reportMd: report })));
  checks.push(...onReport(prescriptionProseChecks({ reportMd: report })));
  // The internal working prose, scanned but NEVER projected (it is not in the reader's document). On a
  // live run the hard gate has already closed on these exact fields; on the REPUBLISH path
  // (publish/report-registry.mjs re-renders archived findings without re-running the merged validator)
  // this scan is the only permission-prose coverage there is.
  if (working.trim()) checks.push(...permissionProseChecks({ text: working, surface: "findings", idSuffix: ":knockout-working", structural: true, cards: false }));
  const failures = checks.filter((c) => !c.pass);
  return { checks, failures, notApplicable: KNOCKOUT_ABSENT_BY_DESIGN };
}

// The raw check detail, INTERNAL side only: the _driver sink, the run log, the staff diagnosis lane.
// It is written for whoever is fixing the run — it quotes fetch causes, register URIs, field names and
// the check's own id — so it must never be handed to a delivery surface. deliveryFlagLines() below is
// what the cover note and the audit workbook read. (Named `flagLines` since 2026-06; the "no internal
// ids" claim in its old comment was only ever true of the id fallback, never of `detail`.)
export function flagLines(failures) {
  return (failures ?? []).map((f) => f.detail || f.id).filter(Boolean);
}

// ── A10 delivery projection (2026-07-31) ────────────────────────────────────────────────────────────
// A10 puts surviving machine-check failures in front of the reviewing lawyer. What it does NOT license
// is shipping the checks' own prose there: `detail` is engine-side diagnosis, and the cover note is
// mailed to job.forwarderEmail — which on a client-principal run IS the client (portal-service stamps
// clientPrincipal; the FAILURE mail already sanitizes for exactly that recipient). Measured on the
// republished archived runs, the unprojected block shipped `/mark/em/ctmsi0b65…`, `filingYear`,
// a 900-character semicolon-joined bullet and `Card the on-point one(s) (FIX)`.
//
// So the delivery surfaces read a CODE-OWNED projection instead: one plain sentence per check, keyed on
// the check's base id (the part before the first ':' — ids carry ordinals, surfaces and names after it),
// with a family sentence and then a generic as fallbacks. The fallback is deliberately NOT `detail`: a
// check added next year projects safely by construction instead of leaking on its first failure.
// Failures of the same check collapse to one line with a count, so the block stays a block.
//
// Rule for anything added here: it states what the reader's document says wrong, as a fact. No engine or
// vendor vocabulary, no ids, no paths, no field names, no instructions to whoever regenerates the run,
// never "certified"/"signed". deliveryVocabViolations() below enforces that mechanically.
const DELIVERY_LINES = {
  // template — the summary table against the names actually searched
  "names-cell-populated": "The summary table does not name the mark that was searched.",
  "assessment-row": "A searched name has no assessment of its own in the summary table.",
  "rating-position": "A rated position in the summary table holds a name that was not searched.",
  "candidate-self-legacy": "The summary table treats a searched name as though it were a conflicting mark.",
  // registry — what the report says about a right against the record behind it
  "registry-arithmetic": "A right is described as registered before it was filed.",
  "registry-record-match": "A filing or registration year given in the report differs from the year on the official register record.",
  "registry-record-coverage": "The report relies on a register entry whose full record could not be pulled this run.",
  "finding-provenance": "A conflicting mark is described without saying which register or source it came from.",
  "record-verification-claim": "The report presents a right as confirmed against a register record where no record was pulled for it.",
  "senior-rights-present": "The earlier rights the report leans on are not recorded in the finding set.",
  "senior-right-coverage": "The oldest registration in a mark family could not be pulled, so the read rests on a later one.",
  "wipo-designation-language": "An international registration is described in terms that do not match how that designation works.",
  // reference — who the document names
  "reference-integrity": "The action list names parties that no finding in the report identifies.",
  "self-comparison": "A finding compares a mark against itself.",
  // counting
  "counting-consistency": "The same figure is stated two different ways in the report.",
  "counting-vs-findings": "A figure stated in the prose does not match the findings behind it.",
  "scope-numbers-in-prose": "Coverage figures are written into the prose, where they can drift from the figures on the page.",
  // voice
  "prescription-prose": "The report instructs the reader where it should state a fact.",
  // actions / verdict
  "actions-reachability": "An action asks the reader to commission work this search itself covers.",
  "action-fits-bound-line": "An action is longer than the line it renders on, so the reader is shown a sentence that stops mid-clause.",
  "actions-register-present": "The report's actions are not carried on the run's action register.",
  "only-you-register": "An item presented as one only the client can close is not recorded as one.",
  "verdict-actions-coherence": "The delivered outcome and the open actions do not agree.",
  "verdict-actions-stale": "An open action refers to a position the outcome has already moved past.",
  "statement-tier": "The delivered risk statement does not carry the band the matter was rated at.",
  "statement-stance": "The delivered risk statement does not state where it comes out.",
  "statement-conditional-form": "A conditional outcome is not written in conditional terms.",
  "statement-unconditional": "An outcome with nothing outstanding is written as though something were.",
  "conditional-text-coherence": "The report reads as a clean outcome while the delivered outcome is conditional.",
  // client-facing consistency
  "client-tier-match": "A risk band in the client summary differs from the band the finding set carries.",
  "overall-tier": "The overall risk band in the report differs from the band the finding set carries.",
  "correction-consistency": "A finding the review corrected or withdrew still appears in its earlier form.",
  // intake / mark itself / coverage
  "intake-ask": "Something the client asked for at intake is not answered in the report.",
  "mark-assessment-present": "The standing assessment of the mark itself is missing.",
  "permission-prose": "The report describes a search as blocked or not permitted, and the run's own record does not bear that out.",
  "card-budget-fold": "Detail was folded to keep the report inside its length budget; nothing was dropped.",
};
const DELIVERY_FAMILY_LINES = {
  template: "The summary table does not hold together against the names that were searched.",
  registry: "A register detail in the report does not match the record behind it.",
  reference: "The report names a party it does not identify anywhere else.",
  counting: "A figure in the report does not agree with the findings behind it.",
  corrections: "A change made at review is not carried through the report.",
  client: "The client summary and the finding set state different risk bands.",
  verdict: "The delivered outcome and the report's own text do not agree.",
  actions: "An action does not hold against the run's action register.",
  intake: "Something the client asked for at intake is not answered in the report.",
  "mark-assessment": "The assessment of the mark itself is incomplete.",
  coverage: "The report describes what was searched in terms the run's own record does not bear out.",
  voice: "The report instructs the reader where it should state a fact.",
  levels: "The report did not fit its length budget cleanly.",
};
const DELIVERY_GENERIC = "A machine check on the report did not pass.";

// The house rules, as regexes, so "no engine vocabulary on a reader surface" is testable rather than a
// habit. Any composed delivery line is run through this: a hit means the projection table is wrong, and
// the line degrades to the generic rather than shipping. The audit workbook's own BANNED list is applied
// on top of this by the gate (publish/xlsx.mjs validateAudit) and by the tests.
export const DELIVERY_VOCAB_RULES = [
  ["engine error text", /\berrors?\b/i],
  ["protocol / status vocabulary", /\bhttps?\b|\bstatus\s+\d{3}\b|\b\d{3}\s+(?:not found|forbidden|error)\b/i],
  ["vendor or tool name", /\bcorsearch\b|\bclarivate\b|\bcompumark\b|\btmview\b|\bmarcaria\b|\bsigna\b/i],
  ["snake_case identifier", /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/],
  ["camelCase field name", /\b[a-z]+[A-Z][A-Za-z]*\b/],
  ["register URI or path", /\/mark\/|\buri\s*=|(?:^|\s)\/[a-z]{2,}\//i],
  ["internal identifier", /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+:[a-z0-9]/i],
  ["opaque record id", /\b[A-Z0-9]{10,}\b/],
  ["instruction to the producer", /\bFIX\b|\b(?:regenerate|re-?emit|re-?render|redo|do not ship|card the)\b/i],
  ["assurance language", /\bcertif(?:y|ied|ication)\b|\bsigned\b/i],
];
const DELIVERY_LINE_MAX = 200;

/**
 * deliveryVocabViolations — the house-rule scan for a single composed delivery line.
 * Returns [] when the line is clean; otherwise the names of the rules it trips.
 * Exported so the cover note, the workbook gate and the tests all judge by the same list.
 */
export function deliveryVocabViolations(line) {
  const t = String(line ?? "");
  const hits = DELIVERY_VOCAB_RULES.filter(([, re]) => re.test(t)).map(([name]) => name);
  if (t.length > DELIVERY_LINE_MAX) hits.push(`over ${DELIVERY_LINE_MAX} characters`);
  return hits;
}

/**
 * deliveryFlagLines — the ONLY thing a delivery surface may enumerate. Takes the failing checks
 * ({ id, family, detail }) and returns code-owned lawyer-language lines, one per distinct check,
 * counted where a check failed more than once. Never returns `detail`; never returns an id.
 * An empty input returns [] (no block, byte-identical mail and workbook — archived republish safe).
 */
export function deliveryFlagLines(failures) {
  const groups = new Map();
  for (const f of failures ?? []) {
    const base = String(f?.id ?? "").split(":")[0];
    const family = String(f?.family ?? "");
    const key = base || `family/${family}`;
    const g = groups.get(key) ?? { base, family, n: 0 };
    g.n += 1;
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => {
    const sentence = DELIVERY_LINES[g.base] ?? DELIVERY_FAMILY_LINES[g.family] ?? DELIVERY_GENERIC;
    // Belt and braces: a table entry that trips the house rules degrades to the generic instead of
    // shipping. This is what makes "no engine vocabulary reaches a reader" structural rather than a
    // matter of everyone remembering the rule when they add a check.
    const safe = deliveryVocabViolations(sentence).length ? DELIVERY_GENERIC : sentence;
    return g.n > 1 ? `${safe} (${g.n} occurrences)` : safe;
  });
}
