// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// named-band.mjs — the COMPLETE NAMED BAND contract (judgment-relocation Move 2: lift the firewall).
//
// The funnel emits this from `register_enumerate` results: the dangerous *named* band — the exact mark + each
// manifest variant × in-scope class × material/major jurisdiction — ENUMERATED to has_more:false, every record
// carried forward WITH its screening facts; plus CROWD DESCRIPTORS (count + sample + reason) for any query that
// came back `incomplete`. This is exactly what crosses the lifted firewall (the old `unit.md:146` "raw dies in
// session" rule): the **complete named band + crowd descriptors**, NOT the raw character-noise pile. Judgment
// (placement / digest / synthesis) reads THIS — the real material — instead of a pre-pruned digest.
//
// PURE (no node imports → tests offline), like coverage-ledger.mjs / scope-ledger.mjs. This module only PARSES
// and SURFACES; it makes NO relevance/sufficiency/materiality judgment — that is Layer B's job (the mandate's
// hard line: no judgment in the machine). Whether a crowd is "material" and what to do about it (command a
// narrower enumeration, or halt) is decided by judgment, never by a threshold here.
//
// Block shapes the funnel writes (a JSON array, one block per enumerate / count-probe call):
//   { "state":"enumerated", "query":"<what was searched>", "total_hits":N, "records":[ {record_id, mark_text,
//        classes, status, owner_name, owner_country, application_date, registration_date, expiry_date,
//        jurisdictions, screen_verdict}, … ] }      — paged to has_more:false; the complete named slice.
//   { "state":"incomplete", "query":"…", "total_hits":N, "fetched":K, "sample":[ … ], "reason":"…" }
//        — a crowd / unreachable slice the funnel did NOT enumerate; a DESCRIPTOR for judgment, never a clean.
//   (A count-only saturation probe is just an `incomplete` block: fetched 0–1, reason names it a crowd descriptor.)

// — TRUNCATION MARKS THE CUT. `abbrev` appends `…`; a bare slice does not, and a cut that lands
// mid-word produces something READABLE and wrong. Importing a pure sibling keeps this module's
// "no node imports → tests offline" invariant, exactly as connotation-search.mjs already does.
import { abbrev } from "./repair-contract.mjs";

export const BAND_STATES = ["enumerated", "incomplete"];

/**
 * Parse + lightly validate the named-band artifact. Returns { enumerated:[…records], crowds:[…descriptors] }.
 * Throws `named_band_*` tokens (token FIRST) so the stage validator + corrective-retry can key on the defect,
 * mirroring coverage-ledger.mjs. A record keeps its fields verbatim plus `_query` (which slice surfaced it)
 * and — when the block is qid-stamped by the plan executor — `_qid` (the register-plan entry id), so judgment
 * can see provenance down to the plan-execution ledger (band_lookup's `qid` filter joins on it) without the
 * funnel having pre-grouped anything. Model-authored blocks carry no qid, so their records carry no `_qid`.
 */
/**
 * A COUNT, OR `null` FOR "no count was taken" —.
 *
 * `Number(x) || 0` collapsed four different inputs into the same `0`: a real counted zero, a vendor's
 * documented refusal to count (signa: "null means UNKNOWN: never 0, and never a number inferred from
 * the pages you saw"; uspto-local: "a copy older than 24 hours cannot support a clean negative, so the
 * count refuses with total:null rather than answering 0"), an absent field on a legacy block, and a
 * non-numeric. Only the first of those is a measurement.
 *
 * Everything that is not a finite number becomes `null`, which is the FAIL-SAFE direction: an unknown
 * is never read as a clean, and the modules that read the RAW blocks already work this way
 * (`close-verify.mjs`: "the executor writes total_hits NULL for a count it could not [take]";
 * `remedy-accounting.mjs`: "a null total is an uncountable one"). It is only the projections that
 * guaranteed a number, and only their consumers that were blind. PURE.
 */
export const countOrNull = (v) => {
  // TYPE FIRST, then value. `Number([])` is 0 and `Number([5])` is 5, so a bare `Number.isFinite`
  // test lets an array become a count — caught by this change's own arm. Only a number, or a string
  // that is entirely a number, is a count; everything else is unknown.
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

export function parseNamedBand(raw) {
  let parsed;
  try { parsed = typeof raw === "string" ? JSON.parse(raw) : raw; }
  catch (e) { throw new Error(`named_band_unparseable: ${abbrev(String(e.message), 60)}`); }
  const blocks = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.blocks) ? parsed.blocks : null);
  if (!blocks) throw new Error("named_band_unparseable: expected a JSON ARRAY of {state, query, …} blocks");
  const enumerated = [];
  const crowds = [];
  for (const b of blocks) {
    if (!b || typeof b !== "object" || Array.isArray(b)) throw new Error("named_band_block_invalid: each block must be an object");
    const state = String(b.state ?? "").trim().toLowerCase();
    if (!BAND_STATES.includes(state)) throw new Error(`named_band_state_invalid:${String(b.state ?? "").slice(0, 30)} (one of: ${BAND_STATES.join(", ")})`);
    const query = String(b.query ?? "").trim();
    const prov = b.qid ? { _query: query, _qid: String(b.qid) } : { _query: query };
    if (state === "enumerated") {
      // THE DROP HERE IS DELIBERATE, AND IT IS NOT WHERE THE LOSS IS REPORTED — findCollapsedBands is.
      //
      // A block like `{state:"enumerated", total_hits:1, records:["NOVA (EU 018)"]}` loses its record on
      // this line: the member is not an object, so it is skipped. That is a TOTAL RECALL LOSS — a mark
      // that exists, reported as not found — and until now nothing said a word, because the one guard
      // aimed at exactly this counted `records.length`, the ARRAY, rather than what survived it.
      //
      // A REFUSAL WAS TRIED HERE FIRST AND WITHDRAWN, and the reason is worth keeping. A real archived
      // fixture carries twelve records that are all `null`: they are DE-IDENTIFICATION placeholders, and
      // the redaction preserved CARDINALITY (its consumer reads `records.length`) while discarding
      // SHAPE. A throw here would red a legitimate artifact, I cannot rule out a provider emitting a
      // null row on a live run, and it would open a second vocabulary beside `named_band_collapsed`,
      // which already has an established corrective path.
      //
      // So the parse stays LENIENT and the GATE gets its sight back. `Array.isArray` is now excluded
      // explicitly because `typeof [] === "object"`: a nested array used to enter the band and die later
      // at band-shape.mjs's `record_id` filter — the same loss, one step further from anything that
      // could name it.
      const recs = Array.isArray(b.records) ? b.records : [];
      for (const r of recs) { if (r && typeof r === "object" && !Array.isArray(r)) enumerated.push({ ...r, ...prov }); }
    } else {
      // count-first rescue (2026-07-10, copper-lattice): a crowd descriptor may carry per-term truth —
      // `term_counts` (each term's tool-derived count + disposition) and the fully-enumerated tractable
      // terms' `records`. Those records are REAL enumerated material (per-term slices paged to
      // has_more:false inside the rescue), so they join the enumerated stream with provenance and
      // judgment reads them like any other named-band record; the descriptor keeps the counts so the
      // clean-gate can discriminate sanctioned crowds from unverified ones. Old bands carry neither
      // key — their parse output is unchanged.
      //
      // THE TWIN OF THE ENUMERATED DROP ABOVE, and it lands in the same change rather than being found
      // separately later. The rescue's records go through the identical member test, so a count-first
      // rescue can lose its records exactly the way an enumerated slice can — and these are, by this
      // block's own comment, REAL enumerated material. `Array.isArray` is excluded for the same reason.
      if (Array.isArray(b.records)) {
        for (const r of b.records) { if (r && typeof r === "object" && !Array.isArray(r)) enumerated.push({ ...r, ...prov }); }
      }
      crowds.push({
        query, total_hits: countOrNull(b.total_hits), fetched: Number(b.fetched) || 0,
        sample: Array.isArray(b.sample) ? b.sample : [], reason: String(b.reason ?? "").slice(0, 400),
        // the block's plan identity survives the projection (2026-07-29): without it, Layer B could
        // join a crowd descriptor back to its plan entry only via query text / covered_by — carrying
        // the executor's qid stamp (when present; model-authored judgment blocks have none) makes the
        // join exact, like term_counts already is.
        ...(typeof b.qid === "string" && b.qid ? { qid: b.qid } : {}),
        ...(b.term_counts && typeof b.term_counts === "object" && !Array.isArray(b.term_counts) ? { term_counts: b.term_counts } : {}),
        // F2 owner lane (2026-07-29): `class_counts` is the per-CLASS truth the classSplitRescue writes
        // (the per-class rescue) and `covered_by` is the bare-owner count's pointer at its owner×term
        // slice qids. Both carry through EXACTLY like term_counts — this projection is the ONLY band
        // artifact judgment reads (register-named-band.json), so dropping either would hide WHICH class
        // leg stayed open behind the reason string's anonymous tally ("1 crowd, 2 enumerated…"), and
        // truncate the covered_by pointers with the reason's 400-char cap. Old bands carry neither key.
        ...(b.class_counts && typeof b.class_counts === "object" && !Array.isArray(b.class_counts) ? { class_counts: b.class_counts } : {}),
        ...(Array.isArray(b.covered_by) && b.covered_by.length ? { covered_by: b.covered_by } : {}),
        // — THE REFUSAL STAMP SURVIVES THE PROJECTION. `execute-plan.mjs` writes an errored slice
        // as `{state:"incomplete", total_hits:0, fetched:0, error:true}` and says why in its own header:
        // "the error:true stamp (a provider error is never confusable with a sanctioned crowd)". The
        // count is 0 DELIBERATELY — it is not a measurement, and `error` is the field that says so.
        // Dropping it here left the 0 standing alone, and a slice the provider REFUSED became
        // byte-identical to a slice the plan deliberately counted without fetching. Measured on a real
        // run: four capability-gap blocks carried `error:true, deferred:true` into this function and
        // reached record-carry.json with both fields gone and a sentence claiming the run "has a hit
        // COUNT for this slice". register-plan.mjs:1417 already enforces the same rule one layer up
        // ("a transient must not ship indistinguishable from a sanctioned descriptor") — it reads the
        // RAW blocks, which is why it could. Every consumer that reads THIS projection could not.
        // Conditional like the four keys above, so old bands carry neither key and nothing shifts.
        ...(b.error === true ? { error: true } : {}),
        ...(b.deferred === true ? { deferred: true } : {}),
      });
    }
  }
  return { enumerated, crowds };
}

/**
 * Find COLLAPSED enumerated slices: an `enumerated` block that CLAIMED hits (total_hits > 0) but carried
 * ZERO records into the band — the funnel enumerated a dangerous slice yet nothing reached the band ("zero
 * records reached the band"). This is a hard recall failure (a clean shipping over a searched-but-lost slice),
 * NOT a small open question, and must FAIL the run rather than degrade to a soft coverage flag. PURE; reuses
 * parseNamedBand's JSON-array/blocks front-matter (same token-first throw on a top-level defect). Returns
 * [{ query, total_hits }] — one entry per collapsed block (PER-BLOCK, never a per-axis aggregate: a 220-record
 * band with ONE collapsed slice is still caught).
 *
 * FLOOR-SAFE: a block with total_hits absent / 0 / non-numeric is NOT flagged (older funnels that did not emit
 * total_hits, and a legitimately empty slice whose count really is 0, must pass). `incomplete`/crowd blocks are
 * never flagged — a crowd is a sanctioned descriptor for judgment, never a clean. Malformed individual blocks
 * are skipped (parseNamedBand owns and throws those defect tokens; this never masks them).
 */
export function findCollapsedBands(raw) {
  let parsed;
  try { parsed = typeof raw === "string" ? JSON.parse(raw) : raw; }
  catch (e) { throw new Error(`named_band_unparseable: ${abbrev(String(e.message), 60)}`); }
  const blocks = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.blocks) ? parsed.blocks : null);
  if (!blocks) throw new Error("named_band_unparseable: expected a JSON ARRAY of {state, query, …} blocks");
  const collapsed = [];
  for (const b of blocks) {
    if (!b || typeof b !== "object" || Array.isArray(b)) continue;   // parseNamedBand owns block-shape failure
    if (String(b.state ?? "").trim().toLowerCase() !== "enumerated") continue;   // crowds are descriptors, by design
    const total = Number(b.total_hits);
    if (!Number.isFinite(total) || total <= 0) continue;             // floor-safe: absent / 0 / NaN count never fires
    // COUNT WHAT SURVIVES, NOT WHAT IS PRESENT. This counted `recs.length` — the ARRAY's length — so a
    // block claiming hits and carrying records no downstream reader can use passed the one guard aimed
    // at exactly that loss. Three shapes reached a delivered report through it: members that are not
    // objects (parseNamedBand drops them, deliberately and leniently — see there), nested arrays, and
    // records that ARE objects but carry no `record_id`, which merge keeps and band-shape.mjs then
    // filters away in silence.
    //
    // So the survivor test is the same predicate band-shape.mjs uses — `r?.record_id` — and the two
    // now agree by construction rather than by coincidence. A block that says it found something and
    // yields nothing a reader can join on IS collapsed, whatever its array length says.
    const recs = (Array.isArray(b.records) ? b.records : []).filter((r) => r && typeof r === "object" && !Array.isArray(r) && r.record_id);
    if (recs.length === 0) collapsed.push({ query: String(b.query ?? "").trim(), total_hits: total });
  }
  return collapsed;
}

/**
 * T1 (J1c) — terminal quarantine for a VOCABULARY miss on a model-authored judgment block.
 * copper-spire hard-failed primary-sweep on `named_band_state_invalid:verified`: a qid-less judgment
 * block carried a made-up state, the executor's merge preserved it across every retry, and the run
 * died on a label. After the warm re-emit ladder is exhausted, the DRIVER repairs the band: each
 * QID-LESS block with an unknown state is coerced to an honest `incomplete` DESCRIPTOR (fail-safe
 * direction — a descriptor for judgment, never a clean; the block's own content survives in
 * sample/reason so judgment still reads the material). A QID-STAMPED block with an unknown state
 * still throws — machine states are code-owned, so that is a tool bug, not a vocabulary miss.
 * PURE; parseNamedBand stays strict (replay/validators unchanged) — this is live-pipeline recovery.
 * Returns { blocks, quarantined:[{state, query}] }; blocks re-serializable as the repaired band.
 */
export function quarantineUnknownStates(raw) {
  let parsed;
  try { parsed = typeof raw === "string" ? JSON.parse(raw) : raw; }
  catch (e) { throw new Error(`named_band_unparseable: ${abbrev(String(e.message), 60)}`); }
  const blocks = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.blocks) ? parsed.blocks : null);
  if (!blocks) throw new Error("named_band_unparseable: expected a JSON ARRAY of {state, query, …} blocks");
  const out = [];
  const quarantined = [];
  for (const b of blocks) {
    if (!b || typeof b !== "object" || Array.isArray(b)) { out.push(b); continue; }   // parseNamedBand owns block-shape failure
    const state = String(b.state ?? "").trim().toLowerCase();
    if (BAND_STATES.includes(state)) { out.push(b); continue; }
    if (b.qid) throw new Error(`named_band_state_invalid:${String(b.state ?? "").slice(0, 30)} (qid-stamped block "${String(b.qid).slice(0, 40)}" — machine states are code-owned; tool bug, not repairable)`);
    const query = String(b.query ?? "").trim();
    quarantined.push({ state: String(b.state ?? "").slice(0, 30), query });
    out.push({
      state: "incomplete",
      query,
      // — a block already quarantined for an unrecognised state is the LAST place to invent a
      // count for it. This path is model-authored blocks only (a qid-stamped unknown state throws above).
      total_hits: countOrNull(b.total_hits),
      fetched: Array.isArray(b.records) ? b.records.length : (Number(b.fetched) || 0),
      sample: Array.isArray(b.records) ? b.records.slice(0, 20) : (Array.isArray(b.sample) ? b.sample : []),
      reason: `QUARANTINED unknown state '${String(b.state ?? "").slice(0, 30)}' — vocabulary miss on a model-authored judgment block; treat as a descriptor for judgment, never a clean${b.reason ? `. Original reason: ${String(b.reason).slice(0, 200)}` : ""}`,
    });
  }
  return { blocks: out, quarantined };
}

/**
 * Timeout-taint quarantine (copper-lattice 2026-07-08) — the T0 floor of the taint chain. A register-unit
 * pass killed at the wall can leave MODEL-AUTHORED (qid-less) blocks self-reporting `enumerated` with ZERO
 * carried records — the exact shape of the false 0/clean the SIGKILLed pass hand-wrote. When the pass's
 * jsonl reads TAINTED (register-taint.mjs), every such block is rewritten to an honest `incomplete`
 * DESCRIPTOR (fail-safe direction — a could-not-verify for judgment, never a clean). The reason carries
 * the literal marker `(taint)` — the discriminated clean-gate keys on it. NEVER touched: qid-stamped
 * blocks (tool-written — the executor's own states are code-truth), blocks CARRYING records (taint
 * demotes absence-claims, never discards carried material — recall-monotone), and blocks already
 * `incomplete`. PURE + idempotent; returns { blocks, quarantined:[{query}] }.
 */
export function taintQuarantineCleanBlocks(raw) {
  let parsed;
  try { parsed = typeof raw === "string" ? JSON.parse(raw) : raw; }
  catch (e) { throw new Error(`named_band_unparseable: ${abbrev(String(e.message), 60)}`); }
  const blocks = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.blocks) ? parsed.blocks : null);
  if (!blocks) throw new Error("named_band_unparseable: expected a JSON ARRAY of {state, query, …} blocks");
  const out = [];
  const quarantined = [];
  for (const b of blocks) {
    if (!b || typeof b !== "object" || Array.isArray(b)) { out.push(b); continue; }   // parseNamedBand owns block-shape failure
    const state = String(b.state ?? "").trim().toLowerCase();
    const recs = Array.isArray(b.records) ? b.records : [];
    if (b.qid || state !== "enumerated" || recs.length > 0) { out.push(b); continue; }
    const query = String(b.query ?? "").trim();
    quarantined.push({ query });
    out.push({
      state: "incomplete",
      query,
      total_hits: Number(b.total_hits) || 0,
      fetched: 0,
      sample: [],
      reason: `authored in a timeout-tainted pass — self-reported clean unverified; re-run required (taint)`,
    });
  }
  return { blocks: out, quarantined };
}

/** Flat list of every enumerated record across the band — the complete named material judgment reads. PURE. */
export function bandRecords(band) {
  return Array.isArray(band?.enumerated) ? band.enumerated : [];
}

/** The crowd descriptors (un-enumerated slices). Surfaced to judgment to act on (command/halt) — never a clean. PURE. */
export function bandCrowds(band) {
  return Array.isArray(band?.crowds) ? band.crowds : [];
}

/**
 * Merge several per-axis band artifacts into one (the union judgment reads across the funnel). De-dups
 * enumerated records by record_id (keeping the first), preserves every crowd descriptor. PURE.
 *
 * P2-B — THE STAMP UNION. The dedupe used to drop the duplicate whole, and with it the duplicate's
 * PROVENANCE. That is what erased the owner screen from the coverage instrument on the 2026-07-29
 * evidence run: the owner*element slices ran natively and returned records, but every one of those
 * records had already been surfaced by an earlier axis, so the merge (axis order ends with
 * incumbent-class) kept the primary-sweep copy and the incumbent `_qid` vanished. The digest's
 * exact-qid `band_lookup` then answered 0 for a slice that had answered 6, the run wrote "the
 * owner-by-owner screen produced no records, so it cannot be relied on", and a printed negative
 * shipped over a screen the run had disowned.
 *
 * The record set is UNCHANGED - one row per record_id, first occurrence wins, same order, same
 * fields. What changes is that the survivor now carries EVERY qid that surfaced it, in first-seen
 * order, as `_qids` (and every slice string as `_queries`). `_qid`/`_query` keep their first-seen
 * values byte-for-byte, so every existing reader is untouched; `band_lookup`'s qid filter matches
 * MEMBERSHIP of `_qids`, which is what makes the join to the plan-execution ledger complete.
 *
 * Deliberately NOT a re-count: cardinality is load-bearing downstream (floors, coverage, taint,
 * presence, positions and the recall reconciliation all read per-record), so a record surfaced by
 * four slices is still ONE record - it just now says all four.
 */
export function mergeNamedBands(bands) {
  const byId = new Map();
  const enumerated = [];
  const crowds = [];
  const stamp = (rec, r) => {
    const qid = r?._qid ?? null;
    const query = r?._query ?? null;
    if (qid && !rec._qids.includes(qid)) rec._qids.push(qid);
    if (query && !rec._queries.includes(query)) rec._queries.push(query);
  };
  for (const band of (bands ?? [])) {
    for (const r of bandRecords(band)) {
      const id = r?.record_id ?? null;
      const prior = id ? byId.get(id) : null;
      if (prior) { stamp(prior, r); continue; }
      // `_qids`/`_queries` are seeded from this first copy's own provenance - a qid-less
      // (model-authored) block still gets no qid invented for it.
      const rec = { ...r, _qids: [], _queries: [] };
      stamp(rec, r);
      if (id) byId.set(id, rec);
      enumerated.push(rec);
    }
    for (const c of bandCrowds(band)) crowds.push(c);
  }
  return { enumerated, crowds };
}

/** Every qid that surfaced a merged band record (the stamp union), first-seen first. PURE. */
export function recordQids(r) {
  const out = Array.isArray(r?._qids) ? r._qids.filter(Boolean).map(String) : [];
  const first = r?._qid ? String(r._qid) : null;
  return first && !out.includes(first) ? [first, ...out] : out;
}
