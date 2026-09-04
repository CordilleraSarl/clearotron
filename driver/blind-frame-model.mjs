// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// blind-frame-model.mjs — strict parser for the blind-frame stage's machine output
// (blind-frame-model.json), the frame-omission design's Property 1 (Independence).
//
// The blind-frame stage is STARVED of the matter frame: it receives ONLY the raw instruction (mark,
// goods, classes, territories, manner of use) and re-derives the threat model cold across four layers —
// element + neighbours BOTH directions, field by goods-overlap, sources by real channel, ranking by
// goods-overlap. It saves a structured model the frame-diff stage diffs against what the run actually
// scoped. This module strict-parses that model so a defect surfaces as a token-first reason the
// corrective/warm ladder can repair (validator NEVER throws — verify.mjs catches).
//
// PURE (no node imports) → tests offline. Mirrors coverage-ledger.mjs / findings-model.mjs.

// add/drop = the both-directions element neighbours (VELTRIN→VELTRI is "drop"); phonetic/homophone =
// sound-alikes; neighbour = a one-keystroke real-word / famous-mark neighbour (CHROME on NOVAPULSE);
// composite = the element inside a larger mark (VELTRI-composite cluster).
export const VARIANT_DIRECTIONS = ["add", "drop", "phonetic", "homophone", "neighbour", "composite"];
// the spine is ranked by goods-overlap with the actual product, not by class number + registration status.
export const RANKING_BASES = ["goods-overlap", "class-number"];

const short = (v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
const MODEL_KEYS = ["schema_version", "dominant_element", "variants", "fields", "sources", "ranking_basis"];
const VARIANT_KEYS = ["value", "direction", "rationale"];
const FIELD_KEYS = ["goods", "on_field", "rationale"];
const SOURCE_KEYS = ["channel", "rationale"];

function checkKeys(obj, allowed, tokenPrefix) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) throw new Error(`${tokenPrefix}:${short(k)} (keys are EXACTLY: ${allowed.join(", ")})`);
  }
}

/**
 * Strict-parse the blind-frame model. Returns the normalized object
 * `{schema_version, dominant_element, variants[], fields[], sources[], ranking_basis}`. Throws on ANY
 * defect, offending token FIRST:
 *   blindframe_unparseable | blindframe_key_unknown:<key> | blindframe_dominant_element_missing
 *   | blindframe_variants_empty | blindframe_variant_key_unknown:<key> | blindframe_direction_invalid:<dir>
 *   | blindframe_field_on_field_invalid | blindframe_ranking_basis_invalid:<basis>
 */
export function parseBlindFrameModel(raw) {
  let m;
  try { m = JSON.parse(raw); }
  catch (e) { throw new Error(`blindframe_unparseable: ${short(e.message)}`); }
  if (!m || typeof m !== "object" || Array.isArray(m))
    throw new Error("blindframe_unparseable: top level must be a JSON OBJECT");
  checkKeys(m, MODEL_KEYS, "blindframe_key_unknown");

  const dominant_element = String(m.dominant_element ?? "").trim();
  if (!dominant_element) throw new Error("blindframe_dominant_element_missing: name the dominant element (the spine) the blind re-derivation locks onto");

  const variants = Array.isArray(m.variants) ? m.variants : null;
  if (!variants || !variants.length) throw new Error("blindframe_variants_empty: at least one variant (the element + its neighbours, both directions)");
  const outVariants = variants.map((v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("blindframe_unparseable: every variant must be a plain object");
    checkKeys(v, VARIANT_KEYS, "blindframe_variant_key_unknown");
    const direction = String(v.direction ?? "").trim().toLowerCase();
    if (!VARIANT_DIRECTIONS.includes(direction))
      throw new Error(`blindframe_direction_invalid:${short(v.direction)} (not in: ${VARIANT_DIRECTIONS.join(", ")})`);
    return { value: String(v.value ?? "").trim(), direction, rationale: typeof v.rationale === "string" ? v.rationale : "" };
  });

  const fields = Array.isArray(m.fields) ? m.fields : [];
  const outFields = fields.map((f) => {
    if (!f || typeof f !== "object" || Array.isArray(f)) throw new Error("blindframe_unparseable: every field must be a plain object");
    checkKeys(f, FIELD_KEYS, "blindframe_field_key_unknown");
    if (typeof f.on_field !== "boolean") throw new Error(`blindframe_field_on_field_invalid:${short(f.goods)} (on_field must be a JSON boolean)`);
    return { goods: String(f.goods ?? "").trim(), on_field: f.on_field, rationale: typeof f.rationale === "string" ? f.rationale : "" };
  });

  const sources = Array.isArray(m.sources) ? m.sources : [];
  const outSources = sources.map((s) => {
    if (!s || typeof s !== "object" || Array.isArray(s)) throw new Error("blindframe_unparseable: every source must be a plain object");
    checkKeys(s, SOURCE_KEYS, "blindframe_source_key_unknown");
    return { channel: String(s.channel ?? "").trim(), rationale: typeof s.rationale === "string" ? s.rationale : "" };
  });

  const ranking_basis = String(m.ranking_basis ?? "").trim().toLowerCase();
  if (!RANKING_BASES.includes(ranking_basis))
    throw new Error(`blindframe_ranking_basis_invalid:${short(m.ranking_basis)} (EXACTLY one of: ${RANKING_BASES.join(" / ")})`);

  return {
    schema_version: m.schema_version ?? 1,
    dominant_element,
    variants: outVariants,
    fields: outFields,
    sources: outSources,
    ranking_basis,
  };
}
