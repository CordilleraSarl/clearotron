// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// reasoning-tripwires.mjs — the v5 "Appendix A" mechanical net under the recall/coverage/honesty
// PRINCIPLES (the reasoning holds the principle holistically in skills/*; these tripwires catch the
// principle's MISSES). CODE ONLY, pure (no node imports → tests offline). Each function reads only the
// run's own MECHANICAL artifacts (register-findings.md negative-results matrix, findings.json, the
// coverage ledger, the review file, matter-context/placement) — NEVER the headline-verdict reviewer,
// which is empirically noisy. A trip never withholds delivery (the lint's standing posture); it forces
// the delivered status to carry the gap.
//
// Brittleness lives here in the net, never in the reasoning: each check is a tight mechanical pattern
// that catches a catastrophic miss the holistic principle alone cannot guarantee against (an
// identical-name in-class hit culled from a large pull; a "clear" headline over an un-run material
// layer; a review that only re-read its own inputs; a seed pre-graded as the answer; a risk-raising
// fact with no "why it bears on this conflict").

// canonicalUri (recall-regression class fix, 2026-07-22): the store contract says rows hold canonical
// /mark paths, but a human-edited/legacy row may hold the FULL provider URL — and the carried side
// arrives canonicalized (pipeline normalizeRecordUri), so an uncanonicalized store side false-positives
// forever ("https://tm.corsearch.com/mark/int/1054099" never equals "/mark/int/1054099"). Canonicalize
// BOTH sides. Pure at call time (no I/O) — the import keeps the offline tests offline.
import { canonicalUri } from "./known-conflicts.mjs";

// Normalisation shared with the rest of the lint family: fold diacritics, "&"≡"and", case-insensitive,
// punctuation-insensitive, whitespace-collapsed. Mirrors predelivery-lint.mjs `norm`.
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/&amp;/g, "&").replace(/\band\b/g, "&")
  .replace(/[^a-z0-9& ]/g, " ").replace(/\s+/g, " ").trim();

// ── Negative-results drop-row parsing (FROZEN schema, shared with screen-gate.mjs) ─────────────────────
//   | Mark | Search Term / Variant | Result | Notes |
// Notes carries `URI <uri>; screen_verdict=<verdict>; class=<n>; status=<live|dead>; <reason>`.
function parseDropRows(registerFindingsMd) {
  const rows = [];
  let inNeg = false;
  for (const ln of (registerFindingsMd || "").split("\n")) {
    const h = ln.match(/^#{1,6}\s+(.*)/);
    if (h) { inNeg = /negative results/i.test(h[1]); continue; }
    if (!inNeg || !ln.trimStart().startsWith("|")) continue;
    const cells = ln.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((s) => s.trim());
    if (cells.length < 4) continue;
    const mark = cells[0];
    if (/^mark$/i.test(mark) || /^[-:\s]+$/.test(mark)) continue;       // header / separator
    const notes = cells.slice(3).join(" | ");
    const verdict = (notes.match(/screen_verdict\s*=\s*([\w:-]+)/i) || [])[1]?.toLowerCase() ?? null;
    const klass = (notes.match(/class\s*=\s*([\dA-Za-z,;/ -]+)/i) || [])[1]?.trim() ?? null;
    const live = /status\s*=\s*live/i.test(notes);
    const uri = (notes.match(/\/mark\/[a-z]{2,6}\/[\w-]+/i) || [])[0] ?? null;
    rows.push({ mark, result: cells[2], notes, verdict, klass, live, uri });
  }
  return rows;
}

const SURFACE_VERDICTS = new Set(["surface:in-scope-live", "surface:all-class", "deepfetch:ambiguous"]);
const classTokens = (s) => String(s ?? "").split(/[^\dA-Za-z]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);

/**
 * S1 — Recall floor. The catastrophic miss: a live registration whose NAME is identical to the proposed
 * mark (or one of its searched variants), in the applicant's own in-scope class, that the run DROPPED
 * (appears in the negative-results population) and did NOT carry as a finding. "An identical name in the
 * applicant's actual goods is always recorded" — crowding/filer-size never license dropping it. Conservative
 * on purpose (the brittleness is in the net): IDENTICAL normalized name only; near-identical is left to the
 * reasoning layer. In-scope is established by the run's own signal — an explicit in-scope class match, or
 * (when no class list is supplied) the screen's own surface:* verdict.
 *
 * @param {string} registerFindingsMd
 * @param {{carriedMarks?:string[], searchedNames?:string[], inScopeClasses?:string[]}} ctx
 * @returns {Array<{mark:string, klass:string|null, uri:string|null, why:string}>}
 */
export function findRecallFloorViolations(registerFindingsMd, { carriedMarks = [], searchedNames = [], inScopeClasses = [] } = {}) {
  const searched = new Set((searchedNames ?? []).map(norm).filter(Boolean));
  if (!searched.size) return [];                                          // nothing to compare names against
  const carried = new Set((carriedMarks ?? []).map(norm).filter(Boolean));
  const scope = new Set((inScopeClasses ?? []).flatMap(classTokens));
  const out = [];
  for (const r of parseDropRows(registerFindingsMd)) {
    const markN = norm(r.mark);
    if (!searched.has(markN)) continue;                                   // not an identical-name conflict
    if (!r.live) continue;                                                // dead/expired drops are authoritative
    if (carried.has(markN)) continue;                                     // the same-name mark IS carried elsewhere
    const inScope = scope.size
      ? classTokens(r.klass).some((c) => scope.has(c))
      : (r.verdict ? SURFACE_VERDICTS.has(r.verdict) : false);            // no class list ⇒ trust the screen's own verdict
    if (!inScope) continue;
    out.push({
      mark: r.mark, klass: r.klass, uri: r.uri,
      why: `dropped live in-scope mark "${r.mark}" shares the proposed mark's name but was not carried as a finding — an identical name in the applicant's goods is always recorded (recall floor)`,
    });
  }
  return out;
}

/**
 * U2 — Self-check freshness. A real review brings in an input the run did not already consume. With the
 * fresh-probe protocol the reviewer records `Fresh probe: <query> → <result/URL>`; failing that, ANY URL
 * in the review absent from every upstream artifact counts as fresh input. If the review contains neither,
 * it only re-derived → trip. (Run only on the live path — old archives predate the protocol.)
 *
 * @param {string} reviewMd
 * @param {{upstreamTexts?:string[]}} ctx
 * @returns {{pass:boolean, detail:string}|null}  null when there is no review to judge
 */
export function findReviewFreshnessViolation(reviewMd, { upstreamTexts = [] } = {}) {
  const review = String(reviewMd ?? "").trim();
  if (!review) return null;
  if (/(^|\n)\s*(>|-)?\s*fresh probe\s*:/i.test(review)) return { pass: true, detail: "" };
  const up = (upstreamTexts ?? []).join("\n");
  const urls = [...review.matchAll(/https?:\/\/[^\s)>\]]+/gi)].map((m) => m[0]);
  const freshUrl = urls.find((u) => !up.includes(u));
  if (freshUrl) return { pass: true, detail: "" };
  return {
    pass: false,
    detail: "the review brought in no input the run had not already produced — re-reading the same files can only show they agree with themselves; it cannot surface what the run missed (no fresh probe / no new record cited)",
  };
}

// S2 — the seed/incumbent artifacts may state FACTS, never a grade or a headline claim. These patterns are
// the anti-pattern, kept tight to avoid colliding with legitimate placement vocabulary (a `headline-candidate`
// PLACEMENT tier is fine; "this is the headline / must not be softened / Composite N / Level X on a seed" is not).
const SEED_GRADE_RES = [
  { re: /\b(?:must not be softened|do not soften|cannot be softened)\b/i, why: 'a "do not soften" instruction' },
  { re: /\bcomposite\s*[:=]?\s*[1-5]\b/i, why: "an overall Composite score" },
  { re: /\blegal[ -]?risk[ -]?level\s*[:=]?\s*[A-E]\b/i, why: "an overall Legal Risk Level" },
  { re: /\b(?:this is|it is|name(?:d)? as) the headline\b/i, why: 'a "this is the headline" claim' },
];

/**
 * S2 — Seed neutrality. Scan the seed-bearing artifacts (matter-context.md's watchlist seeds and the
 * per-candidate placements) for an OVERALL risk grade or a headline/"do not soften" claim — severity and
 * the headline are set ONCE, later, comparatively at synthesis. Returns one violation per matched anti-pattern.
 *
 * @param {Array<{name:string, text:string}>} artifacts  e.g. [{name:"matter-context", text}, {name:"placements", text}]
 * @returns {Array<{where:string, why:string, snippet:string}>}
 */
export function findSeedNeutralityViolations(artifacts = []) {
  const out = [];
  for (const a of artifacts ?? []) {
    const text = String(a?.text ?? "");
    if (!text.trim()) continue;
    for (const { re, why } of SEED_GRADE_RES) {
      const m = text.match(re);
      if (m) out.push({ where: a.name ?? "seed-artifact", why, snippet: m[0].slice(0, 80) });
    }
  }
  return out;
}

/**
 * U3 — Probative grading. A risk-raising signal must say what it proves about THIS conflict. The most
 * mechanical hook is the enforcer meter: a finding rated `enforcer: high` must carry a non-empty `bears_on`
 * line. Gated on ADOPTION — runs as soon as the findings doc uses the convention (schema_version >= 2, or
 * any finding carries `bears_on`), so legacy v1 findings.json is exempt (no regression). The reasoning layer
 * (risk-framework.md + the narrative-refutation probative-grading flag) does the real work; this is the
 * mechanical backstop.
 *
 * @param {{schemaVersion?:number, findings?:Array}} parsedFindings  (the parseFindingsJson result)
 * @returns {Array<{ordinal:number, mark:string, why:string}>}
 */
export function findProbativeGradingViolations(parsedFindings = {}) {
  const findings = parsedFindings?.findings ?? [];
  const adopted = (parsedFindings?.schemaVersion ?? 1) >= 2 || findings.some((f) => f && f.bears_on != null);
  if (!adopted) return [];
  const out = [];
  for (const f of findings) {
    if (!f || f.meters?.enforcer?.token !== "high") continue;
    const bearsOn = typeof f.bears_on === "string" ? f.bears_on.trim() : "";
    if (!bearsOn) {
      out.push({
        ordinal: f.ordinal, mark: f.mark,
        why: `"${f.mark}" is rated enforcer=high but carries no one-line "why this bears on this conflict" — enforcement counts only where the owner asserted this element in a comparable situation; state it, or it is annotation not a level-mover`,
      });
    }
  }
  return out;
}

// Appendix B — the customer's risk MATRIX is the authority for the rating: Composite is DERIVED from
// (Legal Level × Dispute Type), with hard ceilings (4/5 require Level D/E; a Level-C finding tops out at
// Medium 3; A→1, B→2). Elevate/mitigate move the INPUTS (Level/Dispute Type), never the output number.
// acpCeiling returns the MAX Composite the matrix permits for a (level, dispute_type) pair; a finding rated
// ABOVE it is a ceiling violation (the NOVA PULSE "Level C → Composite 4 on an aggressive-enforcer
// adjustment" defect). Firm-wide: the neutral fallback keeps the same shape so it cannot violate either.
const DISPUTE_4 = new Set(["horse-trade", "nuisance-claim"]);          // D/E + these → 4
export function acpCeiling(level, disputeType) {
  const L = String(level ?? "").trim().toUpperCase();
  const dt = String(disputeType ?? "").trim().toLowerCase();
  if (L === "A") return 1;
  if (L === "B") return 2;
  if (L === "C") return 3;                                              // C tops out at Medium, any dispute type
  if (L === "D" || L === "E") {
    if (dt === "classic") return 5;
    if (DISPUTE_4.has(dt)) return 4;
    if (dt === "paper-conflict" || dt === "descriptive-terms") return 3;
    return 5;                                                          // unknown dispute type on D/E: lenient (no false trip)
  }
  return 5;                                                            // unknown level: do not police
}

/**
 * Appendix B — Matrix-ceiling check. A finding whose Composite EXCEEDS the matrix ceiling for its
 * (Legal Level × Dispute Type) is a grading error — a practical/optics factor was let move the output
 * number instead of an input. Reads findings.json only (composite + level + dispute_type all exist in v1+).
 *
 * @param {{findings?:Array}} parsedFindings
 * @returns {Array<{ordinal:number, mark:string, composite:number, level:string, dispute_type:string, ceiling:number, why:string}>}
 */
export function findMatrixCeilingViolations(parsedFindings = {}) {
  const out = [];
  for (const f of parsedFindings?.findings ?? []) {
    if (!f || typeof f.composite !== "number") continue;
    const ceiling = acpCeiling(f.level, f.dispute_type);
    if (f.composite > ceiling) {
      out.push({
        ordinal: f.ordinal, mark: f.mark, composite: f.composite, level: f.level, dispute_type: f.dispute_type, ceiling,
        why: `"${f.mark}" is rated Composite ${f.composite} but Legal Level ${f.level} + ${f.dispute_type} caps it at ${ceiling} via the risk matrix — High/Very-High require Level D/E; a practical factor (enforcer/size/partner) moves the Level or Dispute Type, never the output rating`,
      });
    }
  }
  return out;
}

/**
 * U1 (surface side) — Status honesty. Given the material coverage gaps (from coverage-ledger
 * deriveCoverageStatus) and a delivered surface, trip when the surface declares a clean / complete /
 * "no conflicts" headline while a material layer did not complete. The deterministic verdict clamp in
 * pipeline.mjs already forces CONDITIONAL; this is the surface-level backstop that catches a clean
 * headline slipping through in the prose.
 *
 * @param {Array<{unit:string,status:string}>} materialGaps  deriveCoverageStatus(...).materialGaps
 * @param {string} surfaceText  the delivered report/summary text
 * @returns {{pass:boolean, detail:string}|null}  null when there is no gap to police
 */
export function findStatusHonestyViolation(materialGaps = [], surfaceText = "") {
  if (!materialGaps?.length) return null;
  const t = String(surfaceText ?? "");
  // a clean/complete OVERALL claim — kept tight: a verdict word or a "no conflicts / clean worldwide" headline
  const cleanClaim = /\b(?:verdict|overall)\b[^.\n]{0,40}\bclear\b/i.test(t)
    || /\b(?:no (?:conflicts?|live filings|adverse marks)|clean (?:worldwide|across all)|all clear)\b/i.test(t);
  if (!cleanClaim) return { pass: true, detail: "" };
  return {
    pass: false,
    detail: `the delivery reads as clean/complete while a material layer did not finish (${materialGaps.map((g) => g.unit).join(", ")}) — the headline cannot be cleaner than the weakest coverage unit; state the gap in the status, not only the footnotes`,
  };
}

/**
 * #6 — Deadline urgency. A conflict that imposes a TIME-CRITICAL date on the CLIENT (an opposition window, a
 * statement-of-use deadline, a renewal the client must contest/file) must reach the deliverable as an ACTION /
 * alert, not be narrated inside the risk letter where it can be missed until it lapses. Reads ONLY the
 * STRUCTURED `deadline:{kind,date}` on findings.json (synthesis populates it per synthesis-rules.md) — never a
 * prose date. ADOPTION-GATED: a legacy findings.json with no `deadline` produces nothing (no regression). The
 * caller passes `nowMs` (Date.now()) so this stays PURE + deterministic for tests. Time-critical = due within
 * `withinDays`, or lapsed within the last `graceDays` (a missed window a late action / extension may still
 * reach); a far-future / long-past date is not urgent. A trip never withholds — it forces the date onto the
 * action surface.
 *
 * @param {{findings?:Array}} parsedFindings  (parseFindingsJson result)
 * @param {{nowMs?:number, withinDays?:number, graceDays?:number}} opts
 * @returns {Array<{ordinal:number, mark:string, kind:string, date:string, daysUntil:number, why:string}>}
 */
/**
 * spec 64 (B3) — deadline CARRY-FORWARD (the DEMVENZY shape): a remembered conflict row whose recorded
 * opposition window is IN the action window must resurface on the delivered findings WITH its structured
 * deadline. recall-regression cannot catch this — the uri WAS carried; only its date silently vanished
 * (copper-causeway ran two days before the CH window closed and delivered no urgency at all). Scope split:
 * an UNCARRIED remembered conflict already belongs to findRecallRegressionViolations; THIS check judges
 * only carried-without-deadline rows, so the two tripwires never double-clamp one uri. All violations
 * are material (an in-window deadline is inherently material). PURE — caller supplies the clock; absent
 * ledger/fields/clock ⇒ [] (replay purity).
 *
 * @returns {Array<{uri:string, mark_text:string|null, opposition_end:string, ordinal:number|null, material:boolean, why:string}>}
 */
export function findDeadlineCarryViolations({ knownConflicts = null, searchedNames = [], parsedFindings = {}, nowMs = 0, withinDays = 60, graceDays = 14 } = {}) {
  if (!nowMs || !knownConflicts || typeof knownConflicts !== "object") return [];
  const marks = knownConflicts.marks && typeof knownConflicts.marks === "object" && !Array.isArray(knownConflicts.marks) ? knownConflicts.marks : {};
  const searched = new Set((searchedNames ?? []).map(norm).filter(Boolean));
  // canonical uri → the finding that carries it (for the deadline check + the ordinal in the why).
  // review fix: findings carry FULL provider URLs while store rows are canonical /mark paths — fold
  // both sides to the path form (raw-lowercase fallback for non-record uris) or a genuinely carried
  // row would read as uncarried and the check would silently skip it.
  const canonUri = (u) => {
    const m = String(u ?? "").trim().match(/\/mark\/[a-z]{2,6}\/[a-z0-9][a-z0-9_-]*/i);
    return (m ? m[0] : String(u ?? "").trim()).toLowerCase();
  };
  const carrier = new Map();
  for (const f of parsedFindings?.findings ?? [])
    for (const r of (Array.isArray(f?.owner?.registrations) ? f.owner.registrations : []))
      if (r?.uri) carrier.set(canonUri(r.uri), f);
  const out = [];
  for (const [markKey, entries] of Object.entries(marks)) {
    if (searched.size && !searched.has(norm(markKey))) continue;
    for (const e of Array.isArray(entries) ? entries : []) {
      const end = typeof e?.opposition_end === "string" ? e.opposition_end.slice(0, 10) : null;
      if (!end) continue;
      const due = Date.parse(end);
      if (!Number.isFinite(due)) continue;
      const days = Math.round((due - nowMs) / 86400000);
      if (days > withinDays || days < -graceDays) continue;             // outside the action window
      const uri = canonUri(e?.uri);
      if (!uri || !carrier.has(uri)) continue;                          // uncarried → recall-regression owns it
      const f = carrier.get(uri);
      if (f?.deadline?.date) continue;                                  // carried WITH its deadline — pass
      out.push({
        uri: e.uri, mark_text: e?.mark_text ?? null, opposition_end: end, ordinal: f?.ordinal ?? null, material: true,
        why: `deadline-carry: the remembered opposition window on ${e.uri}${e?.mark_text ? ` ("${e.mark_text}")` : ""} closes ${end} (${days < 0 ? `${-days} day(s) ago` : days === 0 ? "TODAY" : `in ${days} day(s)`}) and the conflict is carried this run WITHOUT its structured deadline — a recorded deadline must never silently disappear between runs`,
      });
    }
  }
  return out;
}

export function findDeadlineUrgencyMiss(parsedFindings = {}, { nowMs = 0, withinDays = 60, graceDays = 14 } = {}) {
  if (!nowMs) return [];                                  // no clock supplied → cannot judge urgency
  const out = [];
  for (const f of parsedFindings?.findings ?? []) {
    const d = f?.deadline;
    if (!d || typeof d.date !== "string") continue;
    const due = Date.parse(d.date);
    if (!Number.isFinite(due)) continue;                  // unparseable date → leave it to the reasoning layer
    const days = Math.round((due - nowMs) / 86400000);
    if (days > withinDays || days < -graceDays) continue; // not in the action window
    const kind = (typeof d.kind === "string" && d.kind.trim()) ? d.kind.trim() : "deadline";
    const when = days < 0 ? `that lapsed ${-days} day(s) ago` : days === 0 ? "due TODAY" : `due in ${days} day(s)`;
    out.push({
      ordinal: f.ordinal, mark: f.mark, kind, date: d.date, daysUntil: days,
      why: `"${f.mark}" carries a ${kind} ${when} (${d.date}) — surface it as a time-critical ACTION/alert at the top of the deliverable, not only inside the risk narrative`,
    });
  }
  return out;
}

/**
 * #7 — Unresolved placement disagreement. The digest (MODE B) consumes placement-inquiry's "Disagreements /
 * flags surfaced to downstream" and must EXPLICITLY adopt or override-with-reasoning each one (digest.md). The
 * PHINIA miss: a disagreement that neither resolved — it just vanished. The digest authors a STRUCTURED
 * `### Disagreement resolutions` table (`| Disagreement | Resolution |`); this parses it (a frozen-schema
 * table read, NOT a loose prose regex — same shape as parseDropRows) and trips on any row whose Resolution is
 * empty or a non-answer (tbd / pending / open). No table (legacy / no disagreements) → nothing. Non-blocking.
 *
 * @param {string} registerFindingsMd
 * @returns {Array<{disagreement:string, why:string}>}
 */
export function findUnresolvedDisagreements(registerFindingsMd) {
  const out = [];
  let inSec = false;
  for (const ln of String(registerFindingsMd ?? "").split("\n")) {
    const h = ln.match(/^#{1,6}\s+(.*)/);
    if (h) { inSec = /disagreement/i.test(h[1]); continue; }
    if (!inSec || !ln.trimStart().startsWith("|")) continue;
    const cells = ln.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((s) => s.trim());
    if (cells.length < 2) continue;
    const item = cells[0];
    if (/^disagreement/i.test(item) || /^[-:\s]+$/.test(item)) continue;     // header / separator row
    const resolution = cells[cells.length - 1];
    if (!resolution || /^(tbd|n\/?a|—|–|-|pending|open|unresolved|\?)$/i.test(resolution)) {
      out.push({
        disagreement: item.slice(0, 120),
        why: `the placement disagreement "${item.slice(0, 80)}" carries no resolution — every disagreement surfaced between placement-inquiry and the digest must be explicitly adopted or overridden-with-reasoning, never left open`,
      });
    }
  }
  return out;
}

// #8 — only a REGISTER-asserted finding needs a grounding record; common-law / case-law findings legitimately
// carry none (their grounding is the resolved_link / use_check, not a registration URI).
const REGISTER_SOURCE_TYPES = new Set(["register-vendor", "register-euipo"]);

/**
 * #8 — Orphan finding. A finding sourced from a REGISTER but carrying NO grounding registration (no record URI)
 * is an orphan — a register conflict asserted with nothing behind it (the orphan "VELTRI" fragment finding). A
 * knowledge-cited ungrounded neighbour (a famous one-keystroke mark with no fetched record) belongs in
 * `context_notes`, never as a finding — so a register finding with empty registrations is always a defect. This
 * reads ONLY the STRUCTURED findings.json (source_type + owner.registrations) — no prose. It complements the
 * F-14 URI guard (validateOwner) at the GRADING surface. Non-blocking: flagged + disclosed, never withheld.
 *
 * @param {{findings?:Array}} parsedFindings
 * @returns {Array<{ordinal:number, mark:string, source_type:string, why:string}>}
 */
export function findOrphanVerificationFlags(parsedFindings = {}) {
  const out = [];
  for (const f of parsedFindings?.findings ?? []) {
    if (!f) continue;
    const st = f.source?.source_type;
    if (!REGISTER_SOURCE_TYPES.has(st)) continue;          // only register-asserted findings must cite a record
    const regs = f.owner?.registrations ?? [];
    const grounded = Array.isArray(regs) && regs.some((r) => r && typeof r.uri === "string" && r.uri.trim());
    if (!grounded) {
      out.push({
        ordinal: f.ordinal, mark: f.mark, source_type: st,
        why: `"${f.mark}" is a ${st} finding but cites NO grounding registration (no record URI) — a register conflict must rest on the record it names; an ungrounded knowledge-cited neighbour belongs in context_notes, not as a finding (orphan)`,
      });
    }
  }
  return out;
}

/**
 * Cross-check demotion tripwire (copper-lattice recovery net #3 — the S1 sibling). A same-field, in-use
 * common-law hit with an extracted owner may not be demoted off-field / dropped without a register
 * cross-check RECEIPT: either the owner/mark is carried as a finding, or the xcheck dispatcher's
 * directive for that owner actually EXECUTED (its qid is in the plan-execution executed set). Signals
 * come pre-parsed (findSimilarListingSignals over the common-law findings); the receipt is
 * _driver/register-xcheck.json. No receipt at all (archived/pre-xcheck runs, replay) ⇒ [] — replay
 * purity. FLAG-ONLY, like every tripwire.
 *
 * @returns {Array<{owner:string, markText:string|null, why:string}>}
 */
export function findUncrossCheckedDemotions(signals = [], { carriedOwners = [], carriedMarks = [], xcheckReceipt = null, executedQids = [] } = {}) {
  if (!xcheckReceipt || !Array.isArray(xcheckReceipt.directives)) return [];
  const carriedO = new Set((carriedOwners ?? []).map(norm).filter(Boolean));
  const carriedM = new Set((carriedMarks ?? []).map(norm).filter(Boolean));
  const exec = new Set(executedQids ?? []);
  const byOwner = new Map();
  for (const d of xcheckReceipt.directives) if (d?.owner) byOwner.set(norm(d.owner), d);
  const out = [];
  const seen = new Set();
  for (const s of signals ?? []) {
    if (!s?.owner) continue;
    const oN = norm(s.owner);
    if (!oN || seen.has(oN)) continue;
    seen.add(oN);
    if (carriedO.has(oN)) continue;
    if (s.markText && carriedM.has(norm(s.markText))) continue;
    const d = byOwner.get(oN);
    if (d && exec.has(d.qid)) continue;
    out.push({
      owner: s.owner, markText: s.markText ?? null,
      why: `crosscheck-missing: same-field in-use common-law hit "${s.owner}${s.markText ? ` / ${s.markText}` : ""}" carries no executed register cross-check receipt and is not carried as a finding`,
    });
  }
  return out;
}

/**
 * Recall-regression tripwire (copper-lattice — the fixture-seeded S1 sibling). The slug's
 * _known-conflicts.json remembers every prior-confirmed live registered conflict per mark (auto-appended
 * at delivery, human-editable; the VIBRANTE FROSTPLUM anchor row is us/90491258). A re-run that
 * neither CARRIES a remembered uri as a finding nor JUSTIFIES it (the uri was record-fetched AND a
 * negative-results drop row cites it — a reasoned dead/irrelevant call over the real record) trips.
 * `material` = live ∧ class∩in-scope — the pipeline routes material regressions into the registerGap
 * clamp (the tripwire itself stays FLAG-ONLY). Absent/malformed fixture ⇒ [] — replay purity.
 *
 * @returns {Array<{uri:string, mark_text:string|null, classes:any, material:boolean, why:string}>}
 */
export function findRecallRegressionViolations({ knownConflicts = null, searchedNames = [], carriedUris = [], fetchedUris = [], registerFindingsMd = "", inScopeClasses = [] } = {}) {
  if (!knownConflicts || typeof knownConflicts !== "object") return [];
  const marks = knownConflicts.marks && typeof knownConflicts.marks === "object" && !Array.isArray(knownConflicts.marks) ? knownConflicts.marks : {};
  const searched = new Set((searchedNames ?? []).map(norm).filter(Boolean));
  const carried = new Set((carriedUris ?? []).map((u) => String(u).toLowerCase()));
  const fetched = new Set((fetchedUris ?? []).map((u) => String(u).toLowerCase()));
  const dropUris = new Set(parseDropRows(registerFindingsMd).map((r) => r.uri).filter(Boolean).map((u) => u.toLowerCase()));
  const scope = new Set((inScopeClasses ?? []).flatMap(classTokens));
  const out = [];
  for (const [markKey, entries] of Object.entries(marks)) {
    if (searched.size && !searched.has(norm(markKey))) continue;   // fixture rows for the slug's OTHER marks
    for (const e of Array.isArray(entries) ? entries : []) {
      // class fix (2026-07-22): canonicalize the STORE side too — the carried/fetched/drop sides all
      // arrive as canonical /mark paths, so a full-URL store row compared raw can never match.
      const uri = canonicalUri(e?.uri).toLowerCase();
      if (!uri) continue;
      if (carried.has(uri)) continue;                              // resurfaced — pass
      if (fetched.has(uri) && dropUris.has(uri)) continue;         // justified against the fetched record
      const material = String(e?.status ?? "live").toLowerCase() === "live"
        && (!scope.size || classTokens((Array.isArray(e?.classes) ? e.classes : []).join(",")).some((c) => scope.has(c)));
      out.push({
        uri: e.uri, mark_text: e?.mark_text ?? null, classes: e?.classes ?? null,
        owner: e?.owner ?? null, material,   // owner rides along so the clamp reason can NAME the row
        why: `recall-regression: prior-confirmed live registered conflict ${e.uri}${e?.mark_text ? ` ("${e.mark_text}")` : ""} was neither carried as a finding nor justified against its fetched record this run`,
      });
    }
  }
  return out;
}

/**
 * The clamp-reason NAME for one recall regression: `<MARK> (<owner> — <canonical uri>)`. A real run
 * shipped "…neither carried nor justified this run: ION, ION, ION" — three indistinguishable strings
 * over three different registrations; the owner + canonical uri make each one identifiable. Front-loads
 * the mark (the clamp statement truncates from the tail) and bounds the owner at 40 chars. PURE.
 */
export function formatRecallRegression(v) {
  const canon = canonicalUri(v?.uri);
  const owner = String(v?.owner ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  const id = [owner, canon].filter(Boolean).join(" — ");
  if (!v?.mark_text) return id || String(v?.uri ?? "");
  return id ? `${v.mark_text} (${id})` : v.mark_text;
}
