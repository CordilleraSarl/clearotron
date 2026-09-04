// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// framework.mjs — the risk-framework MANIFEST layer (doc 50: the framework in force rates the matter).
//
// The framework itself is a PROSE deck (skills/prelim-search/risk-framework*.md) — the customer's own legal
// judgment written down, which synthesis reads and reasons WITH. This module carries the small
// machine-readable sidecar (<framework>.manifest.json) that lets validators, the renderer, the archive index
// and the profile UI consume the framework's VOCABULARY — band words, severity order, entity label, source —
// without parsing prose. HARD RULE: the manifest carries vocabulary and order ONLY. Never a mapping table,
// threshold, or decision rule — those live in the deck prose, where the model reasons with them (the
// judgment mandate). Band labels may not contain digits for exactly that reason.
//
// This is also the single home for the framework SELECTION helpers (previously duplicated in stages.mjs and
// profile-service.mjs): profile.frameworkPath if set, else the Generic default. A profile with no framework of
// its own rates under the Generic default — nothing in between (doc 50).

import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── selection (the ?? fallback IS the "Generic default rates the matter" rule) ────────────────────────────
export const DEFAULT_FRAMEWORK = "skills/prelim-search/risk-framework.md";
export const DEFAULT_WORKED_EXAMPLES = "skills/prelim-search/worked-examples.md";
export const frameworkFor = (profile) => profile?.frameworkPath ?? DEFAULT_FRAMEWORK;
export const workedExamplesFor = (profile) => profile?.workedExamplesPath ?? DEFAULT_WORKED_EXAMPLES;

/** skills/prelim-search/risk-framework-x.md → skills/prelim-search/risk-framework-x.manifest.json.
 *  The manifest path is DERIVED, never a profile knob — the profile names only the .md. */
export const manifestPathFor = (fwPath) => String(fwPath).replace(/\.md$/, ".manifest.json");

// ── manifest shape ───────────────────────────────────────────────────────────────────────────────────────
// {
//   "schema_version": 1,
//   "framework_key":  "house-default",            // the rated_under_framework tripwire token
//   "title":          "Generic default risk framework",
//   "source_deck":    "<the deck of record this transcribes>",
//   "entity_label":   "the company",              // how the deck names the client side in prose
//   "bands":          [{ "label": "Very High", "tone": "severe" }, ...],   // ordered highest → lowest
//   "structure":      { "kind": "bands" | "matrix", "axes"?: [..], "display_note"?: "..." }   // display only
// }
// bands[0] is the most severe; rank = array index; the LAST band is the framework's lowest. `tone` is a
// closed presentation enum mapping onto the existing render/index colour ramp. `structure` describes the
// deck's shape for UI text — for "matrix" the actual matrix and its ceilings live in the deck prose.

export const BAND_TONES = ["severe", "high", "medium", "low", "minimal"];
const MANIFEST_KEYS = ["schema_version", "framework_key", "title", "source_deck", "entity_label", "bands", "structure"];
const BAND_KEYS = ["label", "tone"];
const STRUCTURE_KEYS = ["kind", "axes", "display_note"];
const STRUCTURE_KINDS = ["bands", "matrix"];
const KEY_RE = /^[a-z][a-z0-9-]{1,39}$/;
// no digits in a band label — a numbered band is a score in disguise, and scores are what this replaces
const BAND_LABEL_RE = /^[A-Za-z][A-Za-z /-]*$/;

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const short = (v) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s == null ? String(v) : (s.length > 40 ? s.slice(0, 40) + "…" : s); };
const onlyKeys = (obj, allowed, token) => {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) throw new Error(token(k));
};

/** Parse + validate a framework manifest. Pure; throws token-first (framework_*) so the caller's error
 *  routing works the same way findings_* / finding_* tokens do. Returns the validated manifest. */
export function parseFrameworkManifest(raw) {
  let m;
  try { m = typeof raw === "string" ? JSON.parse(raw) : raw; }
  catch (e) { throw new Error(`framework_manifest_unparseable: ${short(e.message)}`); }
  if (!isPlainObject(m)) throw new Error("framework_manifest_unparseable: top level must be a JSON OBJECT");
  onlyKeys(m, MANIFEST_KEYS, (k) => `framework_manifest_key_unknown:${short(k)}`);

  if (m.schema_version !== 1) throw new Error(`framework_manifest_version_invalid:${short(m.schema_version)} (schema_version must be 1)`);
  if (typeof m.framework_key !== "string" || !KEY_RE.test(m.framework_key))
    throw new Error(`framework_key_invalid:${short(m.framework_key)} (lowercase slug [a-z0-9-], 2-40 chars)`);
  for (const k of ["title", "source_deck", "entity_label"]) {
    if (typeof m[k] !== "string" || !m[k].trim()) throw new Error(`framework_${k}_missing (a non-empty string is required)`);
  }

  if (!Array.isArray(m.bands) || m.bands.length < 2 || m.bands.length > 8)
    throw new Error(`framework_bands_invalid:${Array.isArray(m.bands) ? m.bands.length : short(m.bands)} (2-8 bands, ordered highest to lowest)`);
  const seen = new Set();
  for (const b of m.bands) {
    if (!isPlainObject(b)) throw new Error(`framework_band_invalid:${short(b)} (each band is { label, tone })`);
    onlyKeys(b, BAND_KEYS, (k) => `framework_band_key_unknown:${short(k)}`);
    if (typeof b.label !== "string" || !BAND_LABEL_RE.test(b.label.trim()) || b.label.trim().length > 24)
      throw new Error(`framework_band_label_invalid:${short(b.label)} (letters/space/slash/hyphen only — no digits, no thresholds)`);
    const norm = b.label.trim().toLowerCase();
    if (seen.has(norm)) throw new Error(`framework_band_label_duplicate:${short(b.label)}`);
    seen.add(norm);
    if (!BAND_TONES.includes(b.tone)) throw new Error(`framework_band_tone_invalid:${short(b.tone)} (one of: ${BAND_TONES.join(", ")})`);
  }

  if (!isPlainObject(m.structure)) throw new Error("framework_structure_invalid (structure { kind } is required)");
  onlyKeys(m.structure, STRUCTURE_KEYS, (k) => `framework_structure_key_unknown:${short(k)}`);
  if (!STRUCTURE_KINDS.includes(m.structure.kind))
    throw new Error(`framework_structure_kind_invalid:${short(m.structure.kind)} (one of: ${STRUCTURE_KINDS.join(", ")})`);
  if (m.structure.axes !== undefined && (!Array.isArray(m.structure.axes) || m.structure.axes.some((a) => typeof a !== "string" || !a.trim())))
    throw new Error("framework_structure_axes_invalid (axes must be non-empty strings)");
  if (m.structure.display_note !== undefined && typeof m.structure.display_note !== "string")
    throw new Error("framework_structure_note_invalid (display_note must be a string)");
  return m;
}

/** Load + parse the manifest sitting beside a framework .md. rootDir is the prelim-driver dir (the dir
 *  skills/ paths are relative to — the same base reads() uses). */
// `rootDir` may be a string (legacy: join against it) OR a resolver function taking the manifest's
// skills-relative path and returning an absolute one — the layered overlay-over-base lookup
// (driver.config.resolveSkillPath). The driver MUST resolve a framework exactly as the agent does, or the
// two read different files: that divergence is what killed the first Aurora Interactive run (framework_manifest_missing
// against the bundled tree while the agent was pointed at the config store).
export function loadFrameworkManifest(rootDir, fwPath) {
  const rel = manifestPathFor(fwPath);
  const p = typeof rootDir === "function" ? rootDir(rel) : join(rootDir, rel);
  let raw;
  try { raw = readFileSync(p, "utf8"); }
  catch { throw new Error(`framework_manifest_missing:${short(rel)} (every risk framework ships a .manifest.json sidecar)`); }
  return parseFrameworkManifest(raw);
}

// ── band helpers (rank = severity position; 0 is the most severe, length-1 the framework's lowest) ──────
const normLabel = (s) => String(s ?? "").trim().toLowerCase();

/** Index of a band label in the manifest (case-insensitive), or -1. */
export function bandIndex(manifest, label) {
  const n = normLabel(label);
  return manifest.bands.findIndex((b) => normLabel(b.label) === n);
}

/** The manifest's canonical casing for a band label, or null when the label is not a band. */
export function normalizeBand(manifest, label) {
  const i = bandIndex(manifest, label);
  return i === -1 ? null : manifest.bands[i].label;
}

export const bandTone = (manifest, label) => manifest.bands[bandIndex(manifest, label)]?.tone ?? null;
export const lowestBand = (manifest) => manifest.bands[manifest.bands.length - 1].label;
export const highestBand = (manifest) => manifest.bands[0].label;

/** True when the label sits ABOVE the framework's lowest band (the "material finding" predicate — the
 *  band-vocabulary re-expression of the old composite>=3 gates, judgment-free by construction). */
export function aboveLowestBand(manifest, label) {
  const i = bandIndex(manifest, label);
  return i !== -1 && i < manifest.bands.length - 1;
}

/** The most severe band label among the given labels (unknown labels ignored); null when none are bands. */
export function worstBand(manifest, labels) {
  let best = -1;
  for (const l of labels ?? []) {
    const i = bandIndex(manifest, l);
    if (i !== -1 && (best === -1 || i < best)) best = i;
  }
  return best === -1 ? null : manifest.bands[best].label;
}
