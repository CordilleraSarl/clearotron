// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// prelim-variants-record.mjs — the recording transport for the variant manifest.
//
// Conversion 3, after blind-frame, skeptic, frame-diff and matter-frame. It is
// the first conversion whose ruling includes CLASS 3, and the first that can DELETE a derivation rather
// than move one.
//
// ── WHAT MAKES THIS ONE DIFFERENT: THE SEAT ALREADY EMITS JSON ──────────────────────────────────────
//
// Every conversion so far turned prose into typed values. This stage already hands back a structured
// `variant-manifest.json` beside its prose twin — the dictation is a literal JSON SKELETON the seat has
// to format by hand, which `parseVariantManifestModel` then strict-parses. So the gain here is not
// "structure arrives"; it is that a model stops hand-formatting a structure the driver already validates,
// and the four `variantmodel_*_unknown` / `_invalid` families stop being reachable from a typed call.
//
// O3c measured the cost of that hand-formatting directly: 9 Bash calls with 4 WRITES across 15 attempts,
// and the shape is `python3 -c` over `variant-manifest.json` — the seat pre-checking its own JSON before
// saving it. That is CLASS 3, and the design's ruling is that such a check does not get a compute tool:
// it moves to the ACCEPTANCE BOUNDARY. `acceptPrelimVariants` measures on accept and refuses with the
// measured value, so the check runs on every call instead of when a seat remembers to run it.
//
// ── AND IT DELETES A DERIVATION, WHICH IS THE REAL PRIZE ────────────────────────────────────────────
//
// `scope-ledger.json` is read by the frame-diff scope check and by the jurisdiction resolver. Today the
// driver DERIVES it by parsing the `### Scope ledger` MARKDOWN TABLE out of the prose manifest
// (`renderScopeLedgerJson(readFileSync(P.variantManifest))`). A machine artifact the whole downstream
// depends on, recovered by re-reading a table a model typed on fixed column positions.
//
// The rows arrive as typed values now, so the driver renders the table for human readers AND serialises
// the ledger for code from the SAME values. The parse does not change hands — it stops existing. That is
// the difference between this conversion and matter-frame's, whose consumers still re-parse the driver's
// own render (recorded honestly at that conversion's retirement site rather than claimed away).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { captureCall, stampVerdict } from "./call-capture.mjs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //
import { refuseUndeclared as refuseUndeclaredShared, keepIfAbsent, lastAccepted, acceptedEnvelope } from "./preserve-merge.mjs";
import { parseVariantManifestModel } from "./variant-manifest-model.mjs";
// THE LEDGER'S CLOSED VOCABULARIES, IMPORTED — never re-declared here. See the note at their re-export.
import { SCOPE_LAYERS, SCOPE_STATUSES as SCOPE_STATUS } from "./scope-ledger.mjs";

export const MODEL_FILE = "variant-manifest.json";
export const PROSE_FILE = "variant-manifest.md";
const SCHEMA_VERSION = 1;

/** Where the call's evidence lives — the driver's own record of what the seat handed it. */
export function prelimVariantsCallPaths(runDir) {
  const dir = driverDir(runDir, "prelim-variants-calls");
  return { dir, payload: join(dir, "call-001.json"), accepted: join(dir, "accepted.json") };
}

// ── THE CLOSED VOCABULARIES ARE THE SHIPPED PARSER'S, AND THIS IS A RE-EXPORT, NOT A COPY ──────────
//
// The first cut of this file declared its own copy of the layer vocabulary — field, jurisdiction,
// variant, source — under a comment saying "taken from the shipped parser, never re-chosen here", while
// re-choosing it: the shipped parser orders the same four as variant, field, source, jurisdiction. The
// comment asserted the exact property it broke, which is why a reader could not catch it and 's scan
// could. That check binds every parsed declaration of a closed set to the live import, found two
// declarations of one name, and reported the disagreement.
//
// AND THEN THE FIX'S OWN COMMENT BROKE IT AGAIN, which is worth the line it costs to say. This note first
// quoted the offending declaration verbatim; scans SOURCE TEXT, so the quotation parsed as a THIRD
// declaration, and `stripLineComments` cut it at the line break so it read as a three-member set. The
// same trap the E3 lint hit when its own audit block counted as the violation it audits: a comment that
// reproduces a pattern is that pattern, to every reader that greps.
//
// Nothing behavioural turned on the order — both are membership tests — and that is the point: a second
// copy of a closed set is wrong before it is ever wrong in effect, and the one that IS ordered
// (`parseScopeLedgerFull`'s first-match walk) sits on the other side of the file.
export { SCOPE_LAYERS, SCOPE_STATUS };

const str = (v) => String(v ?? "").trim();
const list = (v) => (Array.isArray(v) ? v : []).map(str).filter(Boolean);

/**
 * The `### Scope ledger` table, rendered from typed rows.
 *
 * COLUMN ORDER IS THE PARSER'S, not a layout choice: `parseScopeLedger` reads `Layer | Item | Status |
 * Reason` off fixed positions, and the same table is what a lawyer reads in the manifest. Rendering it
 * from the rows the driver also serialises is what removes the round trip — the table and
 * `scope-ledger.json` are two projections of one object rather than one derived from the other.
 *
 * PURE.
 */
export function renderScopeLedgerTable(rows) {
  // FIVE COLUMNS, not four. `Layer | Item | Status | Reason | Reopen trigger` is the shape the skill doc
  // dictates and `parseScopeLedgerFull` reads — and the first cut of this renderer emitted four, which
  // would have dropped every dropped row's REOPEN TRIGGER from the table a lawyer reads while keeping it
  // in the JSON. The doc calls a dropped row with no reopen trigger "itself a coverage gap"; a renderer
  // that silently drops the column manufactures exactly that gap in the human-readable artifact.
  const out = ["### Scope ledger", "", "| Layer | Item | Status | Reason | Reopen trigger |", "|---|---|---|---|---|"];
  for (const r of rows) {
    // A pipe inside a cell would split it into two columns and shift every cell after it — the defect a
    // fixed-position parser cannot see, because the row still parses, just wrongly. Refused on accept
    // (below) rather than escaped here: a reason a seat wrote is evidence, and a transport that rewrites
    // it is not carrying it.
    out.push(`| ${r.layer} | ${r.item} | ${r.status} | ${r.reason} | ${r.reopen_trigger ?? ""} |`);
  }
  out.push("");
  return out;
}

/**
 * The prose manifest, rendered from the SAME model the JSON is serialised from.
 *
 * Rendering from the parsed model is what makes the two artifacts one statement: they cannot disagree
 * about a variant, because both are projections of one validated object. PURE.
 */
export function renderPrelimVariants(model, scopeRows) {
  // ── HEADING DEPTH IS LOAD-BEARING, AND THIS IS THE ONE THING IN THIS FILE NOT TO "TIDY" ────────────
  //
  // `variantsManifestAudit` (common-law-receipts.mjs) arms a term collector on any heading matching
  // /variants\b/i and closes it on the next heading AT THE SAME DEPTH OR SHALLOWER. Deeper headings are
  // sub-groups INSIDE the section and deliberately keep it armed — that is 's fix, for a real
  // manifest whose 84 variants sat under seven `####` sub-headings and parsed as zero.
  //
  // So a `## Variants` section followed by a `### Scope ledger` NEVER CLOSES, and every ledger row is
  // collected as a marketplace search term. Measured on the first cut of this renderer: the walk returned
  // the six real variants plus `Layer`, `field`, `jurisdiction`, `source` — the ledger's own column header
  // and layer names — and the common-law grid then demanded 7 receipts for each of them (`grid_join_missing`).
  // The layer literally called `variant` was the only one that escaped, because the collector skips cells
  // matching /^(variant|value|term)s?$/i. A phantom-term sweep is not a test artifact: the parser's own
  // comment records two live incidents from exactly this class.
  //
  // The dictated manifest never had the bug because the skill's format put `### Variants` and
  // `### Scope ledger` at the SAME depth, under a `## Mark:` heading — confirmed against the archived
  // manifest in test/fixtures/variant-manifest-2026-07-29. The driver's render reproduces those depths
  // rather than inventing its own, because the consumers were built against that shape.
  const out = ["# Variant manifest", ""];
  out.push(`## Mark: ${model.mark}`, "", `Dominant element: ${model.dominant_element}`, "");

  out.push("### Elements", "", "| Value | Kind |", "|---|---|");
  for (const e of model.elements) out.push(`| ${e.value} | ${e.kind} |`);
  out.push("");

  out.push(`### Variants (${model.variants.length})`, "", "| Value | Category | Romanisation | Rationale |", "|---|---|---|---|");
  for (const v of model.variants)
    out.push(`| ${v.value} | ${v.category} | ${v.romanization ?? ""} | ${v.rationale ?? ""} |`);
  out.push("");

  if (model.incumbent_classes?.length) out.push(`Incumbent classes: ${model.incumbent_classes.join(", ")}`, "");
  if (model.watchlist_owners?.length) out.push("### Watchlists", "", ...model.watchlist_owners.map((o) => `- ${o}`), "");
  // — the search floor, on the human surface because a reader auditing the run has to see what was
  // obliged as well as what was done. Rendered ONLY when designated: an empty section would read as a
  // floor of nothing rather than as no floor, and those are the two states this mechanism must keep apart.
  if (model.search_floor?.length)
    out.push("### Search floor", "",
      "These axes are this mark's search floor. A `coverage-limited` row on one of them is an unmet floor, "
      + "not an accepted limit — the axis stays disclosed and stays escalatable.", "",
      ...model.search_floor.map((a) => `- ${a}`), "");

  out.push(...renderScopeLedgerTable(scopeRows));
  out.push("---", "", "Rendered by the driver from the stage's `record_prelim_variants` call. "
    + `The structured model in ${MODEL_FILE} is the authority for the terms, and scope-ledger.json for the `
    + "ledger; this file is their human-readable projection.", "");
  return out.join("\n");
}

/**
 * Assemble and validate through the SHIPPED parser, then the Class 3 acceptance checks.
 *
 * `parseVariantManifestModel` is what `verify.mjs` runs against the artifact, so calling THAT rather than
 * re-checking the shape here is what stops the tool and the validator drifting apart — the frame-diff
 * precedent, and the reason the romanisation and term-shape families come along for free.
 *
 * Returns `{ok: true, model, scopeRows, content}` or `{ok: false, reason}`, reason token-first. PURE.
 */
/** The shape this tool declares, at every depth — what the ACCEPTOR enforces. */
const DECLARED = Object.freeze({
  "": ["mark", "dominant_element", "elements", "variants", "incumbent_classes", "search_floor", "watchlist_owners", "scope_ledger"],
  elements: ["value", "kind"],
  variants: ["value", "category", "rationale", "romanization"],
  scope_ledger: ["layer", "item", "status", "reason", "reopen_trigger"],
});

/** Refuse an undeclared key by path, at depth. Shared walk; the table above is what is this tool's. */
export const refuseUndeclared = (params) => refuseUndeclaredShared(params, DECLARED, "variantmodel");

/** The last ACCEPTED call for this run, or null. */
export function lastAcceptedPrelimVariants(runDir) {
  return lastAccepted(prelimVariantsCallPaths(String(runDir ?? "")).accepted, readFileSync);
}

/**
 * Merge a call onto the stored one. PURE. EVERY KEY DECIDED HERE, BEFORE IT IS WRITTEN.
 *
 * This transport wrote its artifact from the received call ALONE, so a repair rung that asked the seat
 * to correct part of it — and a seat that sent only the corrected part — silently deleted the rest.
 * Preserving rather than requiring, because nothing here can tell a first call from a repair and a
 * product refusal is never a pass. See preserve-merge.mjs for the class.
 */
export function mergePrelimVariantsCall(stored, received) {
  const base = stored ?? {};
  return {
    mark: received?.mark,
    dominant_element: received?.dominant_element,
    elements: received?.elements,
    variants: received?.variants,
    scope_ledger: received?.scope_ledger,
    // KEEP-IF-ABSENT. `search_floor` is the register-axis floor — it states which searches MUST run, so
    // a partial that drops it narrows the run's own definition of coverage and every completeness read
    // downstream then agrees with the narrowed version.
    incumbent_classes: keepIfAbsent(received?.incumbent_classes, base.incumbent_classes),
    search_floor: keepIfAbsent(received?.search_floor, base.search_floor),
    watchlist_owners: keepIfAbsent(received?.watchlist_owners, base.watchlist_owners),
  };
}

export function acceptPrelimVariants(params) {
  const model = {
    schema_version: SCHEMA_VERSION,
    mark: params?.mark,
    dominant_element: params?.dominant_element,
    elements: params?.elements,
    variants: params?.variants,
    incumbent_classes: params?.incumbent_classes,
    watchlist_owners: params?.watchlist_owners,
    // — the search-floor axes. Validated by the model parser (closed against REGISTER_AXES), not
    // here, so there is ONE definition of what a floor may name.
    search_floor: params?.search_floor,
  };
  for (const k of Object.keys(model)) if (model[k] === undefined) delete model[k];

  let parsed;
  try { parsed = parseVariantManifestModel(JSON.stringify(model)); }
  catch (e) { return { ok: false, reason: String(e?.message ?? e) }; }

  // ── CLASS 3: the checks the seat used to run with `python3 -c`, run here on every call ────────────
  const scopeRows = [];
  for (const r of (Array.isArray(params?.scope_ledger) ? params.scope_ledger : [])) {
    const layer = str(r?.layer).toLowerCase(), status = str(r?.status).toLowerCase();
    const item = str(r?.item), reason = str(r?.reason);
    if (!SCOPE_LAYERS.includes(layer))
      return { ok: false, reason: `variantmodel_scope_layer_invalid:${layer || "<empty>"} (one of: ${SCOPE_LAYERS.join(", ")})` };
    if (!SCOPE_STATUS.includes(status))
      return { ok: false, reason: `variantmodel_scope_status_invalid:${status || "<empty>"} (one of: ${SCOPE_STATUS.join(", ")})` };
    if (!item) return { ok: false, reason: "variantmodel_scope_item_missing: every ledger row names the thing it rules on" };
    // The pipe check. A fixed-position table parser cannot see this: the row still parses, into the
    // wrong columns. Refusing it here is the only place it is cheap.
    for (const [cell, v] of [["item", item], ["reason", reason]])
      if (v.includes("|"))
        return { ok: false, reason: `variantmodel_scope_pipe:${cell} — a "|" splits the rendered table cell and shifts every column after it; state it without the pipe (${v.slice(0, 40)})` };
    // `reopen_trigger` rides because the SERIALISED ledger carries it — `scopeLedgerJsonFromRows` emits
    // the field and the prose parser recovered it. A typed row missing it would make the recorded ledger
    // differ from the archived one on a field a consumer can read.
    const reopen_trigger = str(r?.reopen_trigger);
    if (reopen_trigger.includes("|"))
      return { ok: false, reason: `variantmodel_scope_pipe:reopen_trigger — a "|" splits the rendered table cell (${reopen_trigger.slice(0, 40)})` };
    scopeRows.push({ layer, item, status, reason, reopen_trigger });
  }

  return { ok: true, model: parsed, scopeRows, content: renderPrelimVariants(parsed, scopeRows) };
}

/**
 * Capture, validate, then write all three artifacts — in that order.
 *
 * The capture happens BEFORE the decision, as in every sibling transport: it exists even for a REFUSED
 * call, which is what makes its presence the discriminator a conversion is proven by.
 *
 * THE JSON IS WRITTEN FIRST, then the ledger, then the prose. Every consumer that matters reads one of
 * the first two, so a crash between writes leaves the run with its load-bearing files and a missing
 * restatement rather than a restatement of something never stored.
 */
export function recordPrelimVariants(runDir, received, { now = () => new Date().toISOString() } = {}) {
  const { dir, payload } = prelimVariantsCallPaths(String(runDir ?? ""));
  // — ONE FILE PER CALL, refusals included. This wrote a single fixed `call-001.json`,
  // so a turn refused and then re-sent kept only the survivor: the file whose header promises "including
  // calls that were refused" held the one call that was not. Sequence 1 still resolves to `call-001.json`,
  // so every consumer reading that name is unmoved. Best-effort throughout, as the capture always was —
  // a lost forensic record never fails a run.
  const nameFor = (seq) => join(dir, `call-${String(seq).padStart(3, "0")}.json`);
  const cap = captureCall({ nameFor, params: received, now });
  const captureFailed = cap.failed;
  const closeCapture = (v) => { stampVerdict(cap.path, v); return cap.path; };

  // ── ORDER IS THE MECHANISM ───────────────────────────────────────────────────
  //   1. CAPTURE what arrived (above), before any decision.
  //   2. REFUSE an undeclared key BY PATH, BEFORE the merge — a misplaced key must never reach the
  //      stored base, or the next repair inherits it.
  //   3. MERGE onto the last accepted call, so an omitted key comes back rather than being deleted.
  //   4. VALIDATE the MERGED call — it is what gets written; validating the received one would gate on
  //      a document nobody ships.
  //   5. WRITE the base only after 4 passes. A refused call must never become the base a later repair
  //      builds on, or one bad turn poisons every turn after it.
  const undeclared = refuseUndeclared(received);
  if (undeclared) {
    return { written: null, refused: undeclared, captured: closeCapture({ ok: false, refused: undeclared }), capture_failed: captureFailed };
  }
  const call = mergePrelimVariantsCall(lastAcceptedPrelimVariants(runDir), received);
  const verdict = acceptPrelimVariants(call);
  if (!verdict.ok) {
    return { written: null, refused: verdict.reason, captured: closeCapture({ ok: false, refused: verdict.reason }), capture_failed: captureFailed };
  }

  const at = join(String(runDir ?? ""), MODEL_FILE);
  const proseAt = join(String(runDir ?? ""), PROSE_FILE);
  try {
    writeFileSync(at, JSON.stringify(verdict.model, null, 2) + "\n");
    // Step 5. BEST-EFFORT, in its own try — see report-overview-record.mjs for why.
    try { writeFileSync(prelimVariantsCallPaths(String(runDir ?? "")).accepted, acceptedEnvelope(call, now())); }
    catch { /* a lost base is never a lost artifact */ }
    writeFileSync(proseAt, verdict.content);
  } catch (e) {
    return { written: null, refused: null, write_failed: String(e?.message ?? e).slice(0, 200),
      captured: closeCapture({ ok: false, write_failed: true }), capture_failed: captureFailed };
  }

  return {
    written: at,
    prose: proseAt,
    refused: null,
    variants: verdict.model.variants.length,
    scope_rows: verdict.scopeRows.length,
    captured: closeCapture({ ok: true }),
    capture_failed: captureFailed,
  };
}

/** The typed scope-ledger rows, for the driver's own serialisation. PURE — no re-parse of the table. */
export function recordedScopeRows(received) {
  const v = acceptPrelimVariants(received);
  return v.ok ? v.scopeRows : [];
}

/**
 * This run's scope-ledger rows AS RECORDED, or `null` when the manifest did not come through the tool.
 *
 * `null` IS THE SIGNAL, and it has to be distinguishable from `[]`: null means "no typed call was made,
 * fall back to parsing the prose" (an archived or replayed manifest), while `[]` means "the call was made
 * and it carried no ledger rows" — which is a manifest with an empty ledger, not a manifest to re-parse.
 * Collapsing the two would send the driver back to the table on a run that had already answered.
 *
 * The rows are re-validated through `acceptPrelimVariants` rather than trusted raw out of the capture:
 * the capture records what ARRIVED, untidied, including a refused call's params. IMPURE (reads the run).
 */
export function recordedScopeLedgerRows(runDir) {
  const dir0 = String(runDir ?? "");
  // ── THE ACCEPTED BASE FIRST ──────────────────────────────────────────────────
  //
  // This read the raw CAPTURE and re-validated it. That was right while every call was a whole
  // manifest; it is wrong now that a repair may send only the part it corrected. The capture of a
  // partial does not validate on its own, so this would have returned null — "no typed call, go and
  // parse the prose" — on a run whose merged call had validated and written a manifest. The accepted
  // base IS the merged, validated call, which is exactly what this wants.
  const merged = lastAcceptedPrelimVariants(dir0);
  if (merged) {
    const v = acceptPrelimVariants(merged);
    if (v.ok) return v.scopeRows;
  }
  // FALLBACK: runs that predate the base, which have a capture and no accepted.json. Unchanged
  // behaviour for them, and it is why this is a fallback rather than a replacement.
  let captured;
  try { captured = JSON.parse(readFileSync(prelimVariantsCallPaths(dir0).payload, "utf8")); }
  catch { return null; }                                  // no call — the prose path is the answer
  const v = acceptPrelimVariants(captured?.params);
  return v.ok ? v.scopeRows : null;                       // a refused call never wrote a manifest either
}

/** Was this run's manifest written through the typed transport? The ruled discriminator. */
export function prelimVariantsWasRecorded(runDir) {
  try { readFileSync(prelimVariantsCallPaths(String(runDir ?? "")).payload, "utf8"); return true; }
  catch { return false; }
}
