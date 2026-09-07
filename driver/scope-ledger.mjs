// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// scope-ledger.mjs — the machine mirror of the prelim-variants `### Scope ledger` (the frame-omission
// design: the blind-pass framing fix, approved into this file — the code is its own record).
//
// prelim-variants emits a prose `### Scope ledger` table — one row per variant / field / source the
// run CONSIDERED and DROPPED (or applied), each carrying the observation that should REOPEN it. The
// driver CODE-DERIVES scope-ledger.json from that prose (renderScopeLedgerJson, called after
// prelim-variants validates) so the JSON is authored by the driver, never the model, and matches the
// prose BY CONSTRUCTION — exactly the coverage-ledger.mjs pattern. The blind frame-diff reads the
// dropped set + reopen triggers to decide which omissions to escalate.
//
// Like coverage-ledger.mjs / common-law-receipts.mjs this module is PURE (no node imports) so it tests
// offline, and its strict parser THROWS with the offending token FIRST so a corrective-retry hint can
// key on it. The DERIVE is never-killed by the caller (a malformed prose table → log + skip; the
// frame-diff degrades to reading the manifest prose directly — the run always delivers).

// The scope ledger spans the frame layers the blind pass re-derives, PLUS jurisdiction (Round 2 Change 1):
// the instructed territories the run is scoped to (applied) + any considered and excluded (dropped, with the
// reason). Scope is LEGAL EFFECT in the instructed territories — derived per matter from the request, never a
// fixed market default. BARE tokens only.
export const SCOPE_LAYERS = ["variant", "field", "source", "jurisdiction"];
// A row is either applied (searched/kept) or dropped (considered and set aside — the reopen-bearing set).
export const SCOPE_STATUSES = ["applied", "dropped"];

const norm = (s) => (s || "").trim().replace(/^["'`]+|["'`]+$/g, "").toLowerCase();
const short = (v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 40);

// A table data row's cells, or null if the line isn't one (mirrors common-law-receipts.rowCells).
function rowCells(ln) {
  if (!ln.trimStart().startsWith("|")) return null;
  const cells = ln.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((s) => s.trim());
  if (cells.length < 2) return null;
  if (cells.every((c) => /^[-:\s]*$/.test(c))) return null; // separator row
  return cells;
}

/**
 * Parse the `### Scope ledger` markdown table out of variant-manifest.md into rows
 * [{layer, item, status, reason, reopen_trigger}] — the prose path. Columns are
 * `Layer | Item | Status | Reason | Reopen trigger`; the Layer cell classifies to one of
 * {variant, field, source}, the Status cell to {applied, dropped} (tolerating a suffix like
 * `dropped — off-field`, the qualifier kept in reason). Rows that cannot classify are dropped AND
 * returned in dropped[] so a degraded path can name them. PURE.
 */
export function parseScopeLedgerFull(md) {
  const rows = [];
  const dropped = [];
  let inLedger = false;
  for (const ln of (md || "").split("\n")) {
    const h = ln.match(/^#{2,4}\s+(.*)/);
    if (h) { inLedger = /scope ledger/i.test(h[1]); continue; }
    if (!inLedger || !ln.trimStart().startsWith("|")) continue;
    const cells = rowCells(ln);
    if (!cells) continue;
    const layerCell = (cells[0] || "").toLowerCase();
    if (/^layer$/i.test(cells[0] ?? "")) continue; // header row
    const layer = SCOPE_LAYERS.find((l) => new RegExp(`\\b${l}\\b`).test(layerCell));
    const statusM = (cells[2] || "").match(/applied|dropped/i);
    if (!layer || !statusM) { dropped.push(ln.trim().replace(/\s+/g, " ").slice(0, 120)); continue; }
    rows.push({
      layer,
      item: cells[1] ?? "",
      status: statusM[0].toLowerCase(),
      reason: cells[3] ?? "",
      reopen_trigger: cells[4] ?? "",
    });
  }
  return { rows, dropped };
}
export function parseScopeLedger(md) {
  return parseScopeLedgerFull(md).rows;
}

// `additionalProperties:false` by hand (no JSON-schema lib in the driver — see coverage-ledger.mjs).
const ROW_KEYS = ["layer", "item", "status", "reason", "reopen_trigger"];

/**
 * Parse + strictly validate the saved JSON scope ledger. Returns rows
 * `[{layer, item, status, reason, reopen_trigger}]` (layer/status lowercased canonical). Throws on
 * ANY defect, offending token FIRST:
 *   scope_ledger_unparseable | scope_key_unknown:<key> | scope_layer_invalid:<layer>
 *   | scope_status_invalid:<status>
 * An EMPTY array is allowed (a matter may legitimately drop nothing — unlike the coverage ledger,
 * the scope ledger has no per-axis completeness obligation).
 */
export function parseScopeLedgerJson(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { throw new Error(`scope_ledger_unparseable: ${short(e.message)}`); }
  if (!Array.isArray(parsed)) throw new Error("scope_ledger_unparseable: top level must be a JSON ARRAY of row objects");
  const rows = [];
  for (const r of parsed) {
    if (!r || typeof r !== "object" || Array.isArray(r))
      throw new Error("scope_ledger_unparseable: every row must be a plain object");
    for (const k of Object.keys(r)) {
      if (!ROW_KEYS.includes(k)) throw new Error(`scope_key_unknown:${short(k)} (keys are EXACTLY: ${ROW_KEYS.join(", ")})`);
    }
    const layer = String(r.layer ?? "").trim().toLowerCase();
    if (!SCOPE_LAYERS.includes(layer))
      throw new Error(`scope_layer_invalid:${short(r.layer)} (not in: ${SCOPE_LAYERS.join(", ")})`);
    const status = String(r.status ?? "").trim().toLowerCase();
    if (!SCOPE_STATUSES.includes(status))
      throw new Error(`scope_status_invalid:${short(r.status)} (EXACTLY one bare token of: ${SCOPE_STATUSES.join(" / ")})`);
    rows.push({
      layer,
      item: typeof r.item === "string" ? r.item.trim() : "",
      status,
      reason: typeof r.reason === "string" ? r.reason : "",
      reopen_trigger: typeof r.reopen_trigger === "string" ? r.reopen_trigger : "",
    });
  }
  return rows;
}

/**
 * CODE-DERIVE the JSON scope ledger FROM the prose `### Scope ledger` table (the driver calls this after
 * prelim-variants validates; never-killed at the call site). PURE. Throws `scope_ledger_unparseable`
 * when the prose carries a Scope ledger heading but yields no classifiable row, so the caller's catch
 * routes to the manifest-prose-fallback path (the run still delivers). Returns a JSON ARRAY string that
 * round-trips through parseScopeLedgerJson.
 */
export function renderScopeLedgerJson(md) {
  const { rows } = parseScopeLedgerFull(md);
  if (!rows.length) throw new Error("scope_ledger_unparseable: no Scope ledger rows in prose");
  return scopeLedgerJsonFromRows(rows);
}

/**
 * The ledger's JSON, from ROWS — the serialiser both paths share (conversion 3).
 *
 * ── WHY THIS IS SPLIT OUT ───────────────────────────────────────────────────────────────────────────
 *
 * `scope-ledger.json` is read by the frame-diff scope check and the jurisdiction resolver. Until
 * conversion 3 the only way to produce it was `renderScopeLedgerJson(md)` — parse the `### Scope ledger`
 * MARKDOWN TABLE back out of a prose manifest a model had typed, on fixed column positions. A machine
 * artifact the downstream depends on, recovered from a table.
 *
 * `record_prelim_variants` now receives those rows TYPED, so the driver can serialise them directly. Both
 * paths call THIS function, which is what makes the recorded and the archived ledger byte-identical for
 * the same rows by construction rather than by an assertion someone has to maintain — and it is why the
 * prose parse can stay for archives (the anchor rule: a new way in, never a replacement) without becoming
 * a second source of truth.
 *
 * PURE.
 */
export function scopeLedgerJsonFromRows(rows) {
  return JSON.stringify((rows ?? []).map((r) => ({
    layer: r.layer, item: r.item, status: r.status, reason: r.reason ?? "", reopen_trigger: r.reopen_trigger ?? "",
  })));
}

/**
 * The dominant element the manifest names ("Dominant element: X" / "dominant element is X"), normalized
 * lowercase, or "" when absent. The frame-diff code backstop matches reopen directives against it so a
 * model that under-flags `dominant_element_gap` cannot suppress the gap on the spine. PURE.
 */
// Round 2 Change 1 — the run's IN-SCOPE jurisdictions = the `applied` jurisdiction-layer rows (the instructed
// territories + any the model judged effective-in-them). Normalized upper-case tokens (US, EU, CN…). The
// register dispatch + the frame-diff jurisdiction selector read this as the authoritative scope. PURE.
export function scopeJurisdictions(rows) {
  return (rows ?? [])
    .filter((r) => r && String(r.layer).toLowerCase() === "jurisdiction" && String(r.status).toLowerCase() === "applied")
    .map((r) => String(r.item || "").trim().toUpperCase())
    .filter(Boolean);
}
// Jurisdictions the matter CONSIDERED and EXCLUDED (dropped jurisdiction rows) — carried so a frame-diff
// over-reach flag can tell "deliberately excluded, with a reason" from "wandered in unjustified". PURE.
//
// NOTE a dropped jurisdiction row is NOT an instruction to skip the territory. The ledger's own language is
// "coverage-limited, NOT excluded" — it discloses reach, it does not narrow dispatch. Nothing here feeds the
// register plan, deliberately (the register-plan mint in pipeline.mjs keeps the plan on raw intake so a run is never searched
// narrower than what it enforces).
export function excludedJurisdictions(rows) {
  return (rows ?? [])
    .filter((r) => r && String(r.layer).toLowerCase() === "jurisdiction" && String(r.status).toLowerCase() === "dropped")
    .map((r) => String(r.item || "").trim().toUpperCase())
    .filter(Boolean);
}

// ── The variant layer: the ONLY layer whose `dropped` is unambiguous ─────────────────────────────────────
// 2026-07-18. The scope ledger carries judgment's decisions on four layers; until now the funnel read only
// `jurisdiction`, and only for disclosure. The `variant` rows say which FORM FAMILIES are worth searching for
// THIS mark, with legal reasoning — e.g. Drivers Haven dropped phonetic/visual/numeric because "a sound-alike
// of a saturated common-word compound is itself made of common words with no distinctive owner to confuse
// (collision-plausibility, NOT noise)". The form floor generated all three anyway; the ledger row even said
// "form floor still machine-generated". This is the selector that closes that loop.
//
// Where the other three layers stand (measured 2026-07-18 across 21 runs):
//   `field`  — NOT wired, and should not be: sector reasoning, NOT a class allowlist. 19 of 21 runs carry the
//              same class number in both an `applied` and a `dropped` row (Asterion drops "AI/ML-infra (cl. 9/42)"
//              while applying "gaming hardware (cl. 9/28/41/42)"). Deriving classes here drops cl. 9 — the
//              primary class. Judgment makes no class decision separate from intake; there is nothing to honour.
//   `jurisdiction` — NOT wired to dispatch, and should not be: "coverage-limited, NOT excluded" (above).
//   `source` — WRITE-ONLY, and that IS a bug — the same one this selector fixes for `variant`, still open.
//              126 applied / 34 dropped rows across the corpus, and the drops are unambiguous ("Not this
//              product's channel", "off-channel", "no software dimension to a canned drink"). Common-law
//              channels come from `channelsFromMatterContext` (matter-context PROSE) — never from here. On
//              Drivers Haven judgment applied Steam/Epic/GOG/itch.io/PlayStation/Nintendo + gaming press and
//              dropped developer ecosystems; the sweep actually ran amazon, walmart, bestbuy, target, newegg
//              and ebay. The two lists are unrelated. Not fixed here because common-law is a different lane
//              needing its own validation — tracked as the follow-up to this change.
//
// Mapping is CONSERVATIVE and fail-open: an item that does not unambiguously name one axis is never matched,
// so an unrecognised row widens nothing and narrows nothing. `edit-1` is absent by design — the exhaustive
// edit-1 floor is doctrine (radiusFor), not a family judgment may drop.
const VARIANT_FAMILY_AXES = [
  { axis: "phonetic-family",   test: /\bphonetic\b|\bsound[- ]?alike\b/i },
  { axis: "visual-confusable", test: /\bvisual\b|\blook[- ]?alike\b|\bhomoglyph\b|\btypograph/i },
  { axis: "transliteration",   test: /\btranslit|\bforeign[- ]?script\b|\bcross[- ]?script\b/i },
];

/**
 * The form-floor axes judgment DROPPED for this matter, as axis tokens the form floor understands
 * ("phonetic-family" | "visual-confusable" | "transliteration"). Reads `variant`-layer rows with
 * status `dropped`. Unrecognised items are ignored (fail-open — never under-search on a parse miss).
 * A family that appears BOTH applied and dropped is treated as APPLIED (the widening row wins). PURE.
 */
export function droppedVariantFamilies(rows) {
  const applied = new Set(), dropped = new Set();
  for (const r of rows ?? []) {
    if (!r || String(r.layer).toLowerCase() !== "variant") continue;
    const status = String(r.status).toLowerCase();
    if (!SCOPE_STATUSES.includes(status)) continue;
    const item = String(r.item || "");
    for (const { axis, test } of VARIANT_FAMILY_AXES) {
      if (test.test(item)) (status === "applied" ? applied : dropped).add(axis);
    }
  }
  return [...dropped].filter((a) => !applied.has(a)).sort();
}

export function dominantElementFromManifest(md) {
  // accept the canonical labelled form ("Dominant element: X") and the prose form ("… element is X …")
  const m = String(md || "").match(/dominant[ -]?element\s*(?:is\s+|[:\-—]+\s*)([^\n.;(]+)/i);
  if (!m) return "";
  // strip a trailing relational/locational clause so "NOVAPULSE in the gaming field" → "NOVAPULSE"
  const s = m[1].split(/\s+(?:in|for|on|across|within|as|covering)\b/i)[0];
  return norm(s);
}

/**
 * The FORMATIVE ROOT the manifest names ("Formative root: X") — the distinctive stem that a FAMILY of marks
 * shares, after stripping weak/separable affixes (BIO-, plural -S, etc.). For a mark like BIOVELTRIN the dominant element
 * is VELTRIN but the formative root is VELTRI — and the exact-in-class-live floor must search the ROOT so it
 * catches VELTRI DIAGNOSTICS / VELTRI GENETICS (which do NOT contain the full "VELTRIN"). "" when absent — the
 * floor then falls back to the dominant element alone (today's behaviour; the root only ever WIDENS). PURE.
 */
export function formativeRootFromManifest(md) {
  const m = String(md || "").match(/formative[ -]?root\s*(?:is\s+|[:\-—]+\s*)([^\n.;(]+)/i);
  if (!m) return "";
  const s = m[1].split(/\s+(?:in|for|on|across|within|as|covering)\b/i)[0];
  return norm(s);
}

/**
 * The common-law search CHANNELS the matter frame named for this matter's industry/goods — its
 * "Search channels: <domains>" line (#5). Used ONLY for the generic fallback (a named profile's curated
 * platforms stand). Keeps only domain-shaped tokens (+ the literal "web"); [] when none named, so the caller
 * keeps the profile default — never worse than today. PURE. (Lives here with the other frame-signal parsers.)
 */
export function channelsFromMatterContext(md) {
  return channelsDiagnosis(md).channels;
}

/** The states `channelsFromMatterContext`'s empty array used to collapse into one another. */
export const CHANNEL_STATES = Object.freeze(["named", "no-document", "no-line", "all-rejected"]);

const DOMAIN_SHAPED = (s) => /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(s) || s.toLowerCase() === "web";

/**
 * The same parse, with the REASON an empty result is empty.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────────
 *
 * `channelsFromMatterContext` returned `[]` for four different facts, and the caller (pipeline.mjs, the
 * generic-profile branch) has no else — so all four silently fall back to the profile's platforms. The
 * fallback itself is DELIBERATE and documented ("frame named none ⇒ keep the profile default, never
 * worse"), and nothing here changes it. What was missing is which fact happened:
 *
 *   no-document   there is no matter-context file to read — we could not look
 *   no-line       the file is there and carries no "Search channels:" line — the seat never answered
 *   all-rejected  the seat DID answer and every value was discarded for not being domain-shaped
 *                 ("Amazon marketplace", "the App Store") — the expensive one, and the one that reads
 *                 exactly like a considered "none" in the record
 *   named         channels were named and are used
 *
 * "The frame named none" and "we could not read the frame's line" are different facts and only one of
 * them is a clean. Collapsing them is the ENOENT-is-not-EACCES shape: an absence that cannot say why is
 * indistinguishable from a decision.
 *
 * PURE, and `channels` is byte-identical to what the old function returned in every state, so no caller
 * behaviour moves — this adds a reason, never a verdict.
 */
export function channelsDiagnosis(md) {
  const text = String(md || "");
  if (!text.trim()) return { state: "no-document", channels: [], offered: [], rejected: [] };
  const m = text.match(/search channels?\s*[:\-—]\s*([^\n]+)/i);
  if (!m) return { state: "no-line", channels: [], offered: [], rejected: [] };
  const offered = m[1].split(/[,;]/).map((s) => s.trim().replace(/[.\s]+$/, "")).filter(Boolean);
  const channels = offered.filter(DOMAIN_SHAPED);
  const rejected = offered.filter((s) => !DOMAIN_SHAPED(s));
  // OFFERED-BUT-ALL-REJECTED, never "offered nothing": a line reading `Search channels:` with an empty
  // tail is `no-line`'s twin in effect but not in cause, and it lands here as all-rejected with an
  // empty `offered` — which is honest, because the seat did write the line.
  return { state: channels.length ? "named" : "all-rejected", channels, offered, rejected };
}
