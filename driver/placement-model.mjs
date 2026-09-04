// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// placement-model.mjs — B2 (E2E-R2 addendum, charter 2026-07-31): the structured mirror of
// placement-inquiry's four tier sections. The measured requirement (E2E-R2-PLACEMENT-INPUT-
// REQUIREMENT-2026-07-30 §5): the digest "must adopt-or-counter-reason placement-inquiry's
// per-candidate tier … so what it needs is each candidate's tier WITH placement's stated reason
// attached, plus the rulings tail verbatim; not the tier alone, and not the full inquiry-trace
// prose." Five of fourteen digest departures on the measured run argued AGAINST placement's reason —
// strip the reason and the digest loses its correction power, so a bare {mark, tier} tuple is RULED
// OUT by the owner.
//
// THE REASON FIELD (defined first, per the addendum — assume no token saving):
//   `reason` is a SHORT PARAGRAPH carrying placement's STATED reasoning for the tier — the
//   characterisation of the candidate (what the owner actually does, the customer/channel overlap
//   read) plus the decisive placement ground and any Stage-2 mitigant flag. It must be substantial
//   enough that a downstream stage can argue WITH it — quote it and contradict it (the KENZO /
//   KANZ / ATVENZ override shape) — or keep it verbatim while tightening the label. It is never a
//   bare label ("off-field noise") and never the full 7-point inquiry trace. There is no upper cap:
//   the value of this artifact is the reason's arguability, not its brevity.
//
// THE BORDERLINE FLAG (optional, boundary package 2026-08-01):
//   `borderline` is placement's own declaration that its written answer to the promotion question —
//   "does this conflict change the advice, or only complete the record?" — could be argued either way by
//   two competent lawyers on THIS record. It exists because nine of ten measured tier disagreements
//   between two runs of the same matter sat on the headline-candidate / sheet-2 boundary: the runs were
//   not disagreeing about a fact, they were answering an under-posed question. Declaring the residue is a
//   correct professional outcome; a confident tier on a record the criterion does not decide is not.
//   ABSENT MEANS NOT BORDERLINE — every archived artifact, and every entry that never needed the flag,
//   parses unchanged. Present, it is a boolean and nothing else: the two readings and the one placement
//   chose live in `reason`, which is where a downstream stage argues with them. INTERNAL — it is an
//   adjudication input between stages (the digest is told a borderline entry is the expected place for
//   its judgment to differ, and must resolve it either way in `### Disagreement resolutions`, never
//   silently). It is not a report field, nothing in the publish path reads this file, and it must never
//   reach a client-facing surface as hedge language.
//
// The RULINGS TAIL (Band reconciliation, Disagreements / flags surfaced to downstream, Coverage
// rulings & open questions, Open questions for the client / reviewer) is NOT structured here — it
// travels verbatim as prose in placement-recommendations.md, exactly as the digest carries it into
// its three findings sections today.
//
// Four consumers read placement (register-digest, synthesis, narrative-refutation, report-overview
// — synthesis's UNDER-RATING check reads the tier BY NAME: "sheet-2 / lower-tier"), so the tier
// vocabulary below is load-bearing and closed.
//
// Validation is strict and token-first (the findings-model convention): the gateway's corrective
// ladder routes on the leading token. PURE — no IO.

export const PLACEMENT_TIERS = ["headline-candidate", "sheet-2", "watchlist-annex", "out-of-scope-filtered"];

const TOP_KEYS = ["schema_version", "placements"];
// `borderline` is appended LAST and is the only OPTIONAL key: the six before it are the documented join
// shape, echoed verbatim in stages.mjs's dispatch, the skill and digest.md, and `onlyKeys` prints this
// list in its error — so the order is part of what a reader is told the entry looks like.
const ENTRY_KEYS = ["mark", "owner", "jurisdiction", "records", "tier", "reason", "borderline"];

// ── The bare-label test, and an honest statement of what it does and does not decide ─────────────────
//
// This replaces a 40-CHARACTER floor (review 2026-07-31, finding 1). The character count did not
// enforce what B2 exists to protect, and the reviewer proved it on the header's own example: the probe
// `"Off-field noise; not relevant to this matter."` is 45 characters, so it PASSED the floor while
// being exactly the bare label the header said it rejected. The count was wrong in the other direction
// too — `"Identical mark, cl 32, US, registered"` is 37 characters and names four checkable facts, and
// the floor would have thrown it out. Length is simply not the axis; a bigger number is not the fix.
//
// WHAT IS CHECKED HERE, exactly: that the reason is not the TIER RESTATED. The old header claimed this
// as the floor's purpose ("it rejects 'off-field noise' / a re-typed tier word, nothing more") — that
// purpose was right and the proxy was wrong, so it is implemented directly now. The reason's words are
// reduced by the CLOSED tier vocabulary this module already owns (PLACEMENT_TIERS, the same closed set
// the four consumers read by name), by a small set of bare-conclusion words that can carry a whole
// "reason" without asserting one checkable thing about the candidate, and by stopwords. If nothing
// survives, the reason said only where the candidate was placed — which the `tier` field already says,
// so the reason adds nothing a downstream stage could join on, let alone argue with.
//
// WHAT IS NOT CHECKED HERE, stated plainly so this never reads as more than it is: ARGUABILITY. Whether
// a downstream stage can actually contradict a sentence is a judgment about meaning, and no parser
// decides it — a fluent, specific, entirely wrong reason passes this test, and should, because it is
// arguable and arguing with it is the digest's job, not the parser's. B2 puts that judgment where it
// belongs: the digest is instructed to adopt-or-counter each tier BY ENGAGING ITS STATED REASON
// (stages.mjs + prelim-register/digest.md + synthesis-rules.md §1/§2), and narrative-refutation joins
// on the same JSON. This function only guarantees there is a reason to engage WITH. It is a floor
// against a degenerate write, not a measure of quality, and it is deliberately the only test here that
// looks at the reason's words at all.
const TIER_RESTATEMENT = new Set([
  // the closed tier vocabulary, in the forms a model re-types it — derived from PLACEMENT_TIERS
  // itself rather than listed by hand, so a tier rename can never leave this behind.
  ...PLACEMENT_TIERS.flatMap((t) => t.split("-")),
  "sheet2", "offfield", "field", "tier", "tiered", "place", "placed", "placement", "annexed", "filter",
]);
// Bare-conclusion words: each one can stand as an entire "reason" while asserting nothing checkable
// about THIS candidate — they restate the decision or deny a relationship without giving a ground.
// Small and curated on purpose. A real reason that happens to use one of these still passes, because
// the test is whether ANYTHING survives, and real reasoning always carries more than these.
const BARE_CONCLUSION = new Set([
  "noise", "irrelevant", "relevant", "relevance", "immaterial", "material", "unrelated", "related",
  "none", "nothing", "nil", "na", "n/a", "excluded", "exclude", "dropped", "drop", "omitted", "omit",
  "ignored", "ignore", "skipped", "skip", "matter", "matters", "case", "run", "report", "client",
  "candidate", "record", "records", "mark", "obvious", "clear", "clearly", "simply", "just",
]);
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "not", "no", "is", "are", "was", "were", "be", "been", "being",
  "to", "of", "in", "on", "off", "at", "by", "for", "with", "from", "as", "it", "its", "this", "that", "these",
  "those", "there", "here", "any", "all", "so", "too", "very", "only", "does", "do", "did", "has",
  "have", "had", "will", "would", "can", "could", "should", "may", "might", "must", "than", "then",
  "which", "who", "whom", "what", "when", "where", "why", "how", "s", "t",
]);

/**
 * TRUE when a reason says only where the candidate was placed — the tier restated, and nothing a
 * downstream stage could join on. Exported so the test suite pins the behaviour directly and so a
 * reader can see the rule rather than infer it from an error string.
 */
export function isTierRestatementOnly(reason) {
  const words = String(reason ?? "").toLowerCase().match(/[a-z0-9/'-]+/g) ?? [];
  return !words.some((w) => {
    const bare = w.replace(/^[-']+|[-']+$/g, "");
    if (!bare) return false;
    if (STOPWORDS.has(bare) || BARE_CONCLUSION.has(bare) || TIER_RESTATEMENT.has(bare)) return false;
    // a hyphenated compound survives only if one of its parts does ("off-field" dies, "SLUSH-initial"
    // lives) — otherwise a re-typed tier word escapes by wearing its own hyphen.
    if (bare.includes("-")) return bare.split("-").some((p) => p && !STOPWORDS.has(p) && !BARE_CONCLUSION.has(p) && !TIER_RESTATEMENT.has(p));
    return true;
  });
}

const short = (v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
const isPlainObject = (v) => v && typeof v === "object" && !Array.isArray(v);
const onlyKeys = (obj, allowed, tokenFor) => {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) throw new Error(`${tokenFor(k)} (keys are EXACTLY: ${allowed.join(", ")})`);
};

/**
 * Parse + strictly validate placements.json (the structured tier mirror placement-inquiry writes
 * beside placement-recommendations.md). Returns { schemaVersion, placements } — placements is the
 * validated array. Throws on ANY defect, offending token FIRST:
 *   placements_unparseable | placements_key_unknown:<key>
 *   | placement_invalid:<idx> | placement_key_unknown:<key> | placement_mark_missing:<idx>
 *   | placement_owner_missing:<mark> | placement_jurisdiction_invalid:<mark>
 *   | placement_records_invalid:<mark> | placement_tier_invalid:<v>
 *   | placement_reason_missing:<mark> | placement_reason_bare:<mark>
 *   | placement_borderline_invalid:<mark>
 */
export function parsePlacementsJson(raw) {
  let doc;
  try { doc = JSON.parse(raw); }
  catch (e) { throw new Error(`placements_unparseable: ${short(e.message)}`); }
  if (!isPlainObject(doc)) throw new Error("placements_unparseable: top level must be a JSON OBJECT { schema_version, placements }");
  onlyKeys(doc, TOP_KEYS, (k) => `placements_key_unknown:${short(k)}`);
  const schemaVersion = typeof doc.schema_version === "number" ? doc.schema_version : 1;
  if (!Array.isArray(doc.placements)) throw new Error("placements_unparseable: \"placements\" must be a JSON ARRAY of placement objects");
  // An EMPTY array parses (review 2026-07-31). Placement normally places every surfaced candidate, so
  // an empty mirror is usually a write miss — but the model cannot conjure candidates a zero-candidate
  // funnel never surfaced, so a THROW here is an unrepairable fail-closed: the corrective/repair ladder
  // burns its attempts re-running the most expensive stage in the corrective cycle against a dead end.
  // "Empty" is therefore a predelivery-lint FLAG (placementsChecks, structural, never load-blocking),
  // where a human reads it beside the run — not a validator kill. Malformed ENTRIES still throw.
  return { schemaVersion, placements: doc.placements.map((e, idx) => validatePlacement(e, idx)) };
}

/** Validate ONE placement entry { mark, owner, jurisdiction, records[], tier, reason, borderline? }. Token-first. */
export function validatePlacement(e, idx) {
  if (!isPlainObject(e)) throw new Error(`placement_invalid:${idx} (every placement must be a plain object { mark, owner, jurisdiction, records, tier, reason } — plus the optional borderline flag)`);
  onlyKeys(e, ENTRY_KEYS, (k) => `placement_key_unknown:${short(k)}`);
  if (typeof e.mark !== "string" || !e.mark.trim())
    throw new Error(`placement_mark_missing:${idx} (every placement names its candidate's mark text, verbatim)`);
  const mk = short(e.mark);
  if (typeof e.owner !== "string" || !e.owner.trim())
    throw new Error(`placement_owner_missing:${mk} (every placement names the candidate's owner — the identifier downstream joins on is mark + owner + jurisdiction)`);
  // jurisdiction may be "" (a common-law candidate with no register leg, or a family spanning several
  // — the md entry carries the detail) but must be a string when present.
  if (e.jurisdiction != null && typeof e.jurisdiction !== "string")
    throw new Error(`placement_jurisdiction_invalid:${mk} (jurisdiction must be a string — the office/territory, or "" where none applies)`);
  if (!Array.isArray(e.records) || e.records.some((r) => typeof r !== "string" || !r.trim()))
    throw new Error(`placement_records_invalid:${mk} (records must be an ARRAY of record-URI strings — [] for a common-law candidate with no register record)`);
  if (!PLACEMENT_TIERS.includes(e.tier))
    throw new Error(`placement_tier_invalid:${short(e.tier)} (tier must be EXACTLY one of: ${PLACEMENT_TIERS.join(" / ")})`);
  if (typeof e.reason !== "string" || !e.reason.trim())
    throw new Error(`placement_reason_missing:${mk} (reason is the SHORT PARAGRAPH carrying placement's stated reasoning — the tier alone is ruled out; downstream stages argue with the reason)`);
  // OPTIONAL, same shape as the jurisdiction arm above: absent (or an explicit null) is the ordinary
  // case and means NOT borderline, so nothing minted before this flag existed has to be rewritten. Wrong
  // TYPE when present is the defect — a string here is a model writing its two readings into the flag
  // instead of into `reason`, which is the field a downstream stage can actually argue with.
  if (e.borderline != null && typeof e.borderline !== "boolean")
    throw new Error(`placement_borderline_invalid:${mk} (borderline must be a BOOLEAN — absent means not borderline; the two readings and the one you chose belong in reason, never in this flag)`);
  if (isTierRestatementOnly(e.reason))
    throw new Error(`placement_reason_bare:${mk} (reason "${short(e.reason)}" restates the TIER and nothing else — the tier field already says where this went. State the ground: what the owner does, the customer/channel read, the decisive fact, any Stage-2 mitigant. Length is not the test and there is no minimum — "Identical mark, cl 32, US, registered" passes; "Off-field noise; not relevant to this matter" does not)`);
  return e;
}
