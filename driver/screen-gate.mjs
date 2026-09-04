// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// screen-gate.mjs — Fix 1b: the deterministic acceptance gate for Finding 1.
//
// Finding 1: batch-screen dropped two live, in-scope (Class 42) marks as "fashion" by inferring goods from
// the mark NAME — it has no goods/services text. The design rule ("a live, in-scope-class mark may not be
// dropped on a goods judgement unless its goods have actually been read") existed only as prose, so it
// leaked. This module makes it a control-flow gate: parse the FINAL register-findings negative-results drop
// rows and assert that any in-scope-live goods/field DROP had its record actually record_fetched (the digest
// must decide such a drop on the REAL goods, not the batch row). The fetched-URI set comes from the call
// ledger (provider-usage.fetchedRecordUris); this module is pure over (findingsContent, fetchedUriSet) so it
// tests without a real ledger.
//
// Row parsing mirrors pipeline.parseCoverageLedger: walk headings to find the negative-results section, then
// read its `|`-delimited table rows. The drop-row schema is FROZEN (buildAuditMd parses it):
//   | Mark | Search Term / Variant | Result | Notes |
// where Notes carries `URI <uri>; screen_verdict=<verdict>; class=<n>; status=<live|dead>; <reason>`
// (Fix 1c emits exactly those tokens).
//
// ── ONE RECORD PER ROW (2026-07-21) ────────────────────────────────────────────────────────────────────
// The gate above was written per ROW while nothing bounded a row to one RECORD, so a multi-URI batch row
// defeated it by construction: `notes.match(URI_RE)` returns the FIRST match, so a row listing 14 records
// under one shared rationale was policed on its first URI and the other 13 were dismissed unexamined
// (copper-vault NR10, 2026-07-21 — two live Cl.35 US filings reciting AI-integration services dropped as
// "no AI-customer overlap", a rationale factually false for them). The same gate fired correctly on 13
// single-URI rows in the same run at the same minute: the defect was row cardinality, not gate absence.
//
// So the gate now reads EVERY URI in the row (matchAll) and holds each one to the fetch requirement
// individually. Batches remain fine for RETRIEVAL (batch_screen, enumeration, _query attribution) — they
// are only forbidden as a unit of DISMISSAL, because a dismissal is a per-record judgment that owes that
// record's goods text.
//
// A goods/field drop row carrying NO record reference at all is likewise a violation now (it used to
// `continue` as "a provenance miss, not this gate's concern" — but no other gate caught it, so an unnamed
// drop was the cheapest way to dismiss a record invisibly). Such a row is reported with `uri: null`: the
// driver cannot code-fetch a record nobody named, so the repair is the digest naming it (or restoring the
// candidate) — see the recovery arm in pipeline.mjs.
//
// ── PARSE GAPS ARE NOT UNNAMED DROPS (2026-07-21) ──────────────────────────────────────────────────────
// CRITICAL distinction, learned the hard way: URI_RE's `[a-z]{2}` cannot see a 3-letter jurisdiction
// segment, and two real ones exist — `/mark/int/…` (Madrid/international, ROUTINE) and `/mark/uss/…`
// (US state registers). copper-vault NR2 is a goods drop whose ONLY record is `/mark/int/1700352`. If such
// a row were treated as "unnamed", it would violate FOREVER: the record is named, it may already be
// fetched, and no re-digest can satisfy a gate whose parser cannot read the answer — a guaranteed hard
// fail on any run touching a Madrid international. That is our parser's gap, not the digest's mistake, and
// punishing the run for it would be strictly worse than the recall loss we are fixing.
//
// So a row that references a record we cannot PARSE is a PARSE GAP: reported separately by
// findScreenGateParseGaps(), never a violation. This preserves today's exact behaviour for that class
// (no new failures) while putting the gap on the ledger where it is measurable. The real fix is the
// coordinated URI-grammar change across all eleven `\/mark\/[a-z]{2,6}\/` sites in the driver, which is
// under investigation — see the Bundle-1 PR. When it lands, this whole category disappears.

// A drop justified on goods/field grounds (the only drop kind this gate polices). Class/status/owner drops
// (dead-status, out-of-class) are batch-screen-authoritative and never match this.
const GOODS_FIELD_RE = /off-field|relevance gate|goods|field-irrelevant|descriptive-compound/i;

// A trademark URI as it appears in Notes, e.g. "/mark/cn/37554073-42" or "/mark/us/99999".
const URI_RE = /\/mark\/[a-z]{2,6}\/[\w-]+/i;

// The closed-set screen_verdict carried into Notes by Fix 1c (digest.md). surface:* = a real in-scope
// candidate that must NOT be goods-dropped without a record_fetch.
const SURFACE_VERDICTS = new Set(["surface:in-scope-live", "surface:all-class"]);

// "This cell references a SPECIFIC record" — wider than URI_RE on the jurisdiction segment (2-6 chars, so
// /mark/int/, /mark/uss/ and /mark/wipo/ all read as references) but still strict about the identifier:
// it must start alphanumeric. That excludes the glob forms digests write when they summarize a slice
// ("URI cluster /mark/es/*, /mark/eu/*", "URIs across /mark/* SIRENA set") — those name no record and are
// exactly the unnamed dismissals this gate exists to refuse, so they must NOT be excused as parse gaps.
// Its only job is to tell an unnamed drop apart from a record URI_RE cannot read (see the header note).
// Non-global: `test()` against a /g regex advances lastIndex between calls and alternates true/false.
const RECORD_REF_RE = /\/mark\/[a-z]{2,6}\/[a-z0-9][^\s;,|)]*/i;

function parseVerdict(notes) {
  const m = notes.match(/screen_verdict\s*=\s*([\w:-]+)/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Find in-scope-live goods/field drops whose record was never record_fetched.
 *
 * A row is IN SCOPE for the gate when it is a goods/field DROP and either
 *   (primary) its screen_verdict is surface:in-scope-live / surface:all-class, OR
 *   (fallback) it carries NO verdict (pre-Fix-1c digests, or a hand-written row)
 * A surface verdict means "real in-scope candidate" — dropping it on goods without a fetch is the Finding-1
 * failure. A drop:* / deepfetch:* verdict means the row is not an in-scope-live goods drop, so it is never
 * flagged (even if unfetched). The verdict-absent fallback is conservative (recall-positive): a goods/field
 * drop with no fetch is treated as a guess unless proven fetched.
 *
 * Within an in-scope row, EVERY URI is checked independently (one record per row is the contract — see the
 * header note); each unfetched URI is its own violation. A row naming NO record at all yields ONE violation
 * with `uri: null` — the drop can be neither examined nor audited. A row whose only reference is one URI_RE
 * cannot parse (`/mark/int/…`, `/mark/uss/…`) is NOT a violation — it is a parse gap, reported by
 * findScreenGateParseGaps(); treating it as unnamed would make it permanently unclearable.
 *
 * @param {string} findingsContent  the register-findings.md text
 * @param {Set<string>} fetchedUriSet  record_fetch target URIs for the run (see provider-usage.fetchedRecordUris)
 * @returns {Array<{uri:string|null, mark:string, result:string, notes:string}>} offending rows (empty ⇒ clean)
 */
export function findScreenGateViolations(findingsContent, fetchedUriSet) {
  // URI-granularity normalization: the record_fetch ledger logs the registration-INSTANCE URI (e.g.
  // /mark/ch/57860/2014) while the gate parses each Notes URI through URI_RE, which stops at the first
  // SLASH (→ /mark/ch/57860). Reduce BOTH sides through the SAME regex so a slash-separated /<year> (or
  // other instance) suffix is not a false-negative on the membership test — the DELPHINOL false hard-halt
  // that blocked a live pharma matter twice on 2026-06-17 (the record WAS fetched, logged as …/2014).
  //
  // …and CASE-FOLD, for the same reason at a different granularity (2026-07-28). The fetched universe is
  // already lower-cased at BOTH its sources — collectRecordBodies keys on `target.toLowerCase()`,
  // readRecordArtifacts on `uri.toLowerCase()` — while the Notes URI is whatever the findings file wrote.
  // On corsearch that never diverged (its record ids are numeric), so a case-SENSITIVE membership test
  // looked correct for as long as there was one provider. Clarivate mints `/mark/<office>/<GUID>` with an
  // upper-case guid, so EVERY drop row missed the set: 641 in-scope-live marks on the first live run were
  // disclosed as "record not retrievable" and clamped the verdict to CONDITIONAL, with the records sitting
  // in _records/ the whole time and the code-fetch reporting zero failures.
  // Fold once, here, on both sides — the surrounding system already treats these URIs case-insensitively.
  const toGateUri = (u) => (typeof u === "string" ? (u.match(URI_RE)?.[0] ?? u).toLowerCase() : u);
  const fetched = fetchedUriSet instanceof Set ? new Set([...fetchedUriSet].map(toGateUri)) : new Set();
  const violations = [];
  let inNeg = false;

  for (const ln of (findingsContent || "").split("\n")) {
    const h = ln.match(/^#{1,6}\s+(.*)/);
    if (h) { inNeg = /negative results/i.test(h[1]); continue; }
    if (!inNeg || !ln.trimStart().startsWith("|")) continue;

    const cells = ln.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((s) => s.trim());
    if (cells.length < 4) continue;                            // not a 4-col data row
    const mark = cells[0];
    if (/^mark$/i.test(mark) || /^[-:\s]+$/.test(mark)) continue; // header / separator row
    const result = cells[2];
    const notes = cells.slice(3).join(" | ");                  // Notes is the last column (rejoin if it held a pipe)

    if (!GOODS_FIELD_RE.test(result)) continue;                // not a goods/field drop → not this gate's concern

    const verdict = parseVerdict(notes);
    const inScopeLive = verdict === null ? true : SURFACE_VERDICTS.has(verdict);
    if (!inScopeLive) continue;                                // drop:* / deepfetch:* → not an in-scope-live goods drop

    // EVERY record named in the row, not just the first: a batch row is 14 dismissals wearing one rationale.
    // Deduped per row (the same URI written twice is one record, one obligation).
    const uris = [...new Set([...notes.matchAll(new RegExp(URI_RE, "gi"))].map((m) => m[0]))];
    if (!uris.length) {
      // A record we cannot PARSE (/mark/int/…, /mark/uss/…) is not an unnamed drop — see the header note.
      // Today's behaviour is preserved for it; findScreenGateParseGaps() surfaces it instead.
      if (RECORD_REF_RE.test(notes)) continue;
      violations.push({ uri: null, mark, result, notes });      // an unnamed drop: nothing to examine, nothing to audit
      continue;
    }
    for (const uri of uris) if (!fetched.has(toGateUri(uri))) violations.push({ uri, mark, result, notes });
  }
  return violations;
}

// ── WHY THE GATE SAW NOTHING ──────────────────────────────────────────────────────────────
//
// `findScreenGateViolations` returning `[]` has FIVE causes and only three of them mean the run is clean:
//
//   findings-absent  the findings file is not on disk. The gate reads `existsSync(...) ? read : ""`, so
//                    a missing file yields "" yields no violations — SILENTLY. The gate runs downstream
//                    of the stage that writes that file, so this is a driver defect wearing a clean run's
//                    clothes. THE SUSPECTED  CAUSE.
//   findings-empty   present but blank/whitespace. Same silence, same class.
//   no-drop-rows     the digest dropped nothing on goods. Genuinely clean.
//   all-fetched      it dropped rows and every one names a record the run actually fetched. Genuinely
//                    clean, and the gate working as designed.
//   unnamed-drops-unarmed
//                    it dropped rows on goods, every one names NO record, and CLEAROTRON_SCREEN_GATE_UNNAMED
//                    is not "enforce" — so the caller's own filter drops them and the gate is clean BY
//                    CONFIGURATION, not because nothing was dropped. This is the DEFAULT mode, so folding
//                    it into no-drop-rows would put a false label on the commonest path: the reader would
//                    be told the digest dropped nothing on goods when it dropped and nobody counted.
//                    Its own name, because that is the whole point of this function.
//
// A month and three separate failure reports produced no diagnosis of because the zero could not
// say which of these five it was — the same disease the funnel test's own header names about its assertion
// message (/: a diagnostic that does not reach the reader has not been produced), one layer in.
// This does not change what the gate DOES. It changes what a clean gate can be asked afterwards.
//
// The drop-row count comes from `findScreenGateViolations` itself with an EMPTY fetched set — every drop
// row is a violation when nothing is fetched — so there is no second parser here to drift from the
// first. `unnamedArmed` mirrors the caller's own filter so the count means the same thing on both paths.
export function screenGateZeroCause({ findingsPresent, findingsContent = "", unnamedArmed = false } = {}) {
  const nothing = { findingsBytes: null, dropRows: null, dropRowsUnfiltered: null };
  if (!findingsPresent) return { cause: "findings-absent", ...nothing };
  const text = String(findingsContent ?? "");
  // BYTES, because the field says bytes: marks carry non-ASCII and String.length counts UTF-16 units,
  // so the two diverge on exactly the corpus this engine exists for and someone will compare it to wc -c.
  const findingsBytes = Buffer.byteLength(text, "utf8");
  if (!text.trim()) return { cause: "findings-empty", findingsBytes, dropRows: null, dropRowsUnfiltered: null };
  const all = findScreenGateViolations(text, new Set());
  const rows = unnamedArmed ? all : all.filter((x) => x.uri);
  const cause = rows.length ? "all-fetched"
    : all.length ? "unnamed-drops-unarmed"      // dropped, but this mode does not count them — NOT "nothing dropped"
    : "no-drop-rows";
  return { cause, findingsBytes, dropRows: rows.length, dropRowsUnfiltered: all.length };
}

/**
 * Record references in goods/field drop rows that URI_RE cannot parse — `/mark/int/…` (Madrid),
 * `/mark/uss/…` (US state registers), or any future segment shape our grammar does not cover.
 *
 * These are NOT violations (see the header note: they would be unclearable, since no re-digest can satisfy
 * a parser that cannot read the answer). They are the ledger of what the gate is currently blind to, so the
 * exposure is measurable before and after the coordinated URI-grammar fix. Same row scoping and same
 * in-scope test as findScreenGateViolations, so the two functions always talk about the same rows.
 *
 * PURE. @returns {Array<{ref:string, mark:string, result:string}>} (empty ⇒ the gate saw every record)
 */
export function findScreenGateParseGaps(findingsContent) {
  const gaps = [];
  let inNeg = false;
  for (const ln of (findingsContent || "").split("\n")) {
    const h = ln.match(/^#{1,6}\s+(.*)/);
    if (h) { inNeg = /negative results/i.test(h[1]); continue; }
    if (!inNeg || !ln.trimStart().startsWith("|")) continue;
    const cells = ln.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((s) => s.trim());
    if (cells.length < 4) continue;
    const mark = cells[0];
    if (/^mark$/i.test(mark) || /^[-:\s]+$/.test(mark)) continue;
    const result = cells[2];
    const notes = cells.slice(3).join(" | ");
    if (!GOODS_FIELD_RE.test(result)) continue;
    const verdict = parseVerdict(notes);
    if (verdict !== null && !SURFACE_VERDICTS.has(verdict)) continue;
    // every ref the permissive matcher sees, minus every ref the real parser could read
    const parseable = new Set([...notes.matchAll(new RegExp(URI_RE, "gi"))].map((m) => m[0].toLowerCase()));
    for (const m of notes.matchAll(new RegExp(RECORD_REF_RE, "gi"))) {
      const ref = m[0];
      if (![...parseable].some((u) => ref.toLowerCase().startsWith(u))) gaps.push({ ref, mark, result });
    }
  }
  return gaps;
}
