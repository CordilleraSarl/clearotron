// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// presence-reconciliation.mjs — every on-field-rated row ends in PRESENCE or a RECORDED REASON
// (2026-07-22; the unjoined-Sheet-2 leak).
//
// THE DEFECT THIS KILLS: register-findings.md's digest tables (`### Risk-relevant (` — Sheet-1 — and
// `### Incumbent-context (` — Sheet-2) carry rows the digest itself rated on-field (its own H*/S*
// context ratings), but SYNTHESIS alone decides which rows become findings — and a row it drops leaves
// ZERO trace on any delivered surface: findings.json never names it, the report never names it, and
// audit-from-spine's `/risk-relevant|watchlist/i` spine regex skips the Incumbent-context heading
// entirely, so the audit is blind too. Measured on two delivered runs: 6 and 11 unjoined Sheet-2 rows
// (0 on Sheet-1 in both). This module is the reconciliation: every rated row either JOINS the
// delivered set (presence), carries its own recorded exclusion basis (reason), or MINTS a doubt into
// the existing doubt-ledger chain (stitch → doubt-closure stage → the audit's `# Doubt Ledger`).
//
// NORTH STAR (annotate/disclose, never gate): this module never re-decides relevance — synthesis's
// drop stands. It only asks "where is the recorded reason?", and when none exists it records the
// QUESTION as a doubt. An OPEN presence doubt shipping in the Doubt Ledger is the system working.
//
// PURE by design (the doubt-ledger.mjs pattern): no I/O — the pipeline call site owns all file reads.
// The join primitives are IMPORTED from doubt-ledger.mjs (findingJoinFor / normalizeJoinText /
// distinct), never re-implemented — a local copy is exactly how two matchers drift apart. URI
// canonicalization is normalizeRecordUri applied to BOTH sides of every comparison (the
// recall-regression lesson: canonicalizing only one side makes a full-URL row unjoinable forever).

import { findingJoinFor, normalizeJoinText, distinct, PRESENCE_BIRTH_PLACE } from "./doubt-ledger.mjs";
import { normalizeRecordUri } from "./registry-fidelity.mjs";

const norm = normalizeJoinText;

// The record-uri shape, shared with pipeline.mjs CITED_URI_RE / predelivery-lint MARK_URI_RE.
const MARK_URI_RE = /\/mark\/[a-z]{2,6}\/[a-z0-9][a-z0-9_-]*/gi;

/** Every canonical /mark uri in `text`, lowercased + deduped. A full provider URL contributes its
 *  path — normalizeRecordUri applied per match keeps both sides of every join canonical. PURE. */
export function urisIn(text) {
  const out = new Set();
  for (const m of String(text ?? "").match(MARK_URI_RE) ?? []) {
    const u = normalizeRecordUri(m);
    if (u) out.add(u);
  }
  return [...out];
}

// ── the frozen sheet headings ─────────────────────────────────────────────────────────────────────
// digest.md dictates these two headings verbatim ("### Risk-relevant (orchestrator: Sheet 1
// candidates)" / "### Incumbent-context (orchestrator: Sheet 2 candidates)"); the parse keys on the
// frozen prefix up to the "(" so the parenthetical can evolve without breaking reconciliation.
const SHEET_HEADINGS = [
  { sheet: "risk-relevant", re: /^Risk-relevant\s*\(/i },
  { sheet: "incumbent-context", re: /^Incumbent-context\s*\(/i },
];

/**
 * Parse the on-field-rated rows out of register-findings.md: every pipe-table row under the two
 * frozen sheet headings that names ≥1 parseable /mark uri. Captures the row's mark + owner (by
 * column name, with positional fallback for headerless variants), its canonical uris, the row's own
 * rating/context text (all cells joined — this is where the digest's own on-field rating and any
 * recorded exclusion basis live), and the verbatim row line (the doubt's birth quote). A row with no
 * parseable uri mints nothing — an unidentifiable row can be neither joined nor doubted. PURE.
 *
 * @returns {Array<{sheet:string, mark:string, owner:string, uris:string[], text:string, line:string}>}
 */
export function parseRatedRows(registerFindingsText) {
  const rows = [];
  let sheet = null;          // inside a frozen sheet section?
  let columns = null;        // the current table's header cells (null until a header+separator seen)
  const splitRow = (line) => line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((s) => s.trim());
  const isSep = (line) => /^\s*\|[\s:|-]+\|\s*$/.test(line || "");
  const lines = String(registerFindingsText ?? "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^#{2,4}\s+(.*)/);
    if (h) {
      sheet = SHEET_HEADINGS.find((s) => s.re.test(h[1].trim()))?.sheet ?? null;
      columns = null;
      continue;
    }
    if (!sheet) continue;
    const line = lines[i];
    if (!line.trimStart().startsWith("|")) { columns = null; continue; }
    if (isSep(line)) continue;
    const cells = splitRow(line);
    if (!columns) { columns = cells; continue; }                      // first |-row of a table = header
    if (cells.every((c) => !c || c === "...")) continue;              // the digest's "..." filler rows
    const uris = urisIn(line);
    if (!uris.length) continue;                                       // no record identity — nothing to reconcile
    const col = (re, fallbackIdx) => {
      const k = columns.findIndex((c) => re.test(c));
      return (k >= 0 ? cells[k] : cells[fallbackIdx]) ?? "";
    };
    rows.push({
      sheet,
      mark: col(/^mark$/i, 1),
      owner: col(/^owner$/i, 2),
      uris,
      text: cells.filter(Boolean).join(" · "),
      line: line.trim(),
    });
  }
  return rows;
}

// ── recorded exclusion basis ──────────────────────────────────────────────────────────────────────
// A row whose OWN text already records why it is absent from the delivered set is satisfied — the
// reason exists, on the row, in the digest's own words. Explicit exclusion verbs + context/watch-only
// markers + dead-status words only; a bare rating or a "Registered" status never matches (a live rated
// row with no recorded basis is exactly the leak this module exists to catch).
const EXCLUSION_RE = /\b(?:dropped|excluded|screened[- ]out|ruled[- ]out|dismissed|not carried|not surfaced|context[- ]only|watch[- ]only|watchlist[- ]only|off[- ]field|no (?:conflict|overlap|risk)|priced (?:in|into)|dead|expired|lapsed|abandoned|cancelled|withdrawn|surrendered)\b/i;

/** True when the row's own text records an exclusion basis (a recorded reason). PURE. */
export function hasRecordedExclusion(rowText) {
  return EXCLUSION_RE.test(String(rowText ?? ""));
}

// ── the delivered set (URI primary) ───────────────────────────────────────────────────────────────
/**
 * The canonical uris the DELIVERY accounts for — presence or a recorded reason, either way the row's
 * record is answered somewhere a reader can find:
 *   - findings.json findings[].owner.registrations[].uri (presence as a finding);
 *   - uris named in actions[].text (the typed register — a monitoring action IS an answer);
 *   - Negative-results row uris in register-findings.md (a recorded drop IS a reason — the frozen
 *     drop-row schema puts the uri in Notes; scanned per-row anywhere in the row);
 *   - uris named in coverage-row areas (findings.json coverage[].area/note and the register
 *     coverage-ledger rows' unit/axis/scope/reason).
 * Both sides canonical (normalizeRecordUri) — the recall-regression lesson. PURE.
 */
export function deliveredUriSet({ findings = null, actions = null, coverageRows = null, registerFindingsText = "" } = {}) {
  const findingRecs = Array.isArray(findings) ? findings : (findings?.findings ?? []);
  const acts = Array.isArray(actions) ? actions : (Array.isArray(findings) ? [] : (findings?.actions ?? []));
  const covFindings = Array.isArray(findings) ? [] : (findings?.coverage ?? []);
  const out = new Set();
  for (const f of findingRecs) {
    for (const r of (Array.isArray(f?.owner?.registrations) ? f.owner.registrations : [])) {
      const u = normalizeRecordUri(r?.uri);
      if (u) out.add(u);
    }
  }
  for (const a of acts) for (const u of urisIn(a?.text)) out.add(u);
  // Negative-results rows: any table row inside a "negative result(s)" section (the frozen drop-row
  // schema — reasoning-tripwires parseDropRows reads the same section; here only the uris matter).
  let inNeg = false;
  for (const ln of String(registerFindingsText ?? "").split("\n")) {
    const h = ln.match(/^#{1,6}\s+(.*)/);
    if (h) { inNeg = /negative results?/i.test(h[1]); continue; }
    if (!inNeg || !ln.trimStart().startsWith("|")) continue;
    for (const u of urisIn(ln)) out.add(u);
  }
  for (const c of [...(coverageRows ?? []), ...covFindings]) {
    const area = [c?.unit, c?.axis, c?.scope, c?.reason, c?.area, c?.note].filter(Boolean).join(" ");
    for (const u of urisIn(area)) out.add(u);
  }
  return out;
}

// ── the mint ──────────────────────────────────────────────────────────────────────────────────────
/**
 * One doubt per rated row the delivered set does not account for. Join order per row:
 *   1. PRIMARY — canonical-uri equality against deliveredUriSet (both sides normalizeRecordUri);
 *   2. recorded exclusion basis in the row's own text (a recorded reason — satisfied);
 *   3. FALLBACK — mark+owner exact-token containment against the delivered findings via the shared
 *      findingJoinFor (the doubt-ledger primitive: distinctiveness floor + the two-token short-mark
 *      path — never re-implemented here).
 * Everything unjoined mints {birth:{place:"presence-reconciliation"}, subject:{mark, owner, uris}}
 * in the frozen doubt-record shape, status "open" — stitchDoubts / the doubt-closure stage decide
 * endings exactly as for every other doubt family. Never gates, never re-rates. PURE.
 *
 * `findings` = findings.json content ({findings, actions, coverage}) or a bare findings array;
 * `coverageRows` = register-coverage-ledger rows; `sourceName` = the artifact display name.
 */
export function mintPresenceDoubts(registerFindingsText, { findings = null, coverageRows = null, sourceName = "register-findings.md" } = {}) {
  const findingRecs = Array.isArray(findings) ? findings : (findings?.findings ?? []);
  const delivered = deliveredUriSet({ findings, coverageRows, registerFindingsText });
  const doubts = [];
  const perSheet = {};
  for (const row of parseRatedRows(registerFindingsText)) {
    if (row.uris.some((u) => delivered.has(u))) continue;             // presence (or a recorded uri-level reason)
    if (hasRecordedExclusion(row.text)) continue;                     // the row itself records its reason
    const terms = row.mark && distinct(norm(row.mark)) ? [row.mark] : [];
    const subject = { mark: row.mark, owner: row.owner, uris: row.uris, terms, text: row.text };
    if (findingJoinFor(subject, findingRecs)) continue;               // fallback: mark/owner presence as a finding
    const n = (perSheet[row.sheet] = (perSheet[row.sheet] ?? 0) + 1);
    doubts.push({
      id: `doubt:presence:${row.sheet}:${n}`,
      birth: { place: PRESENCE_BIRTH_PLACE, artifact: String(sourceName ?? ""), quote: row.line },
      subject,
      status: "open",
      ending: null,
    });
  }
  return doubts;
}
