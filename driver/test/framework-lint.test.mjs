// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Framework-lint (doc 50) — replaces doctrine-diff.test.mjs, whose premise (byte-identical rating tables
// across every framework file) is repealed: the framework in force RATES the matter, so per-customer decks
// legitimately diverge. What must hold instead:
//   1. every shipped risk-framework*.md has a parsing .manifest.json sidecar (vocabulary for code);
//   2. the prose deck and its manifest agree — one heading per band label, the entity named in the prose;
//   3. the shipped decks carry the doc-50 facts (house 4 bands w/ Moderate + "the company"; zephyr the two
//      deltas — Medium + Zephyr/Volt/Kaskade; aurora matrix-shaped, 5 bands incl. Low);
//   4. bands-shaped decks carry NO residual Composite/Level rating machinery (that mechanism now lives only
//      in matrix-shaped frameworks that state it as their own — e.g. Aurora Interactive's);
//   5. the manifest layer itself rejects rule-shaped content (digit labels, thresholds) — vocabulary only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseFrameworkManifest, loadFrameworkManifest, manifestPathFor, DEFAULT_FRAMEWORK,
  bandIndex, normalizeBand, bandTone, lowestBand, highestBand, aboveLowestBand, worstBand,
} from "../framework.mjs";
import { loadProfiles } from "../profiles.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_DIR = join(ROOT, "skills", "prelim-search");
const frameworkFiles = readdirSync(SKILL_DIR).filter((f) => /^risk-framework.*\.md$/.test(f));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const VALID = {
  schema_version: 1, framework_key: "acme", title: "Acme risk framework", source_deck: "Acme deck",
  entity_label: "Acme", bands: [{ label: "High", tone: "high" }, { label: "Manageable", tone: "low" }],
  structure: { kind: "bands" },
};

// ── 1+2: every shipped framework file has a manifest, and the prose deck agrees with it ─────────────────
test("every shipped risk-framework*.md has a parsing manifest whose bands + entity appear in the prose", () => {
  assert.ok(frameworkFiles.length >= 3, `expected the three shipped frameworks, found: ${frameworkFiles.join(", ")}`);
  for (const f of frameworkFiles) {
    const fwPath = `skills/prelim-search/${f}`;
    const manifest = loadFrameworkManifest(ROOT, fwPath);   // throws framework_manifest_missing / parse errors
    const prose = readFileSync(join(SKILL_DIR, f), "utf8");
    for (const b of manifest.bands) {
      // a bands-shaped deck defines each band under its own heading; a matrix-shaped deck defines them in
      // its matrix/meanings table rows — either way the deck must actually speak its manifest's words
      const where = manifest.structure.kind === "bands"
        ? new RegExp(`^#{1,6}[^\\n]*\\b${esc(b.label)}\\b`, "im")
        : new RegExp(`\\|\\s*\\*\\*${esc(b.label)}\\*\\*`, "i");
      assert.match(prose, where, `${f}: band "${b.label}" must be defined in the deck prose (heading or table row)`);
    }
    assert.ok(prose.toLowerCase().includes(manifest.entity_label.toLowerCase()),
      `${f}: the entity label "${manifest.entity_label}" must appear in the deck prose`);
  }
});

test("every shipped profile's framework selection (and the house default) resolves to a manifest", () => {
  const profiles = loadProfiles({ force: true });
  const paths = new Set([DEFAULT_FRAMEWORK]);
  for (const p of profiles.values()) if (p.frameworkPath) paths.add(p.frameworkPath);
  for (const fwPath of paths) {
    const m = loadFrameworkManifest(ROOT, fwPath);
    assert.ok(m.bands.length >= 2, `${fwPath}: manifest loads with bands`);
  }
});

// ── 3: the doc-50 shipped anchors ────────────────────────────────────────────────────────────────────────
test("house default: 4 bands (Very High/High/Moderate/Manageable), no Low, entity 'the company', bands-shaped", () => {
  const m = loadFrameworkManifest(ROOT, "skills/prelim-search/risk-framework.md");
  assert.equal(m.framework_key, "house-default");
  assert.deepEqual(m.bands.map((b) => b.label), ["Very High", "High", "Moderate", "Manageable"]);
  assert.equal(m.entity_label, "the company");
  assert.equal(m.structure.kind, "bands");
  assert.equal(bandIndex(m, "Low"), -1, "there is no Low — a clear win is not a rated conflict");
});

test("zephyr: the house default with exactly the two deck deltas (band 3 'Medium'; entity Zephyr/Volt/Kaskade)", () => {
  const house = loadFrameworkManifest(ROOT, "skills/prelim-search/risk-framework.md");
  const m = loadFrameworkManifest(ROOT, "skills/prelim-search/risk-framework-zephyr.md");
  assert.equal(m.framework_key, "zephyr");
  assert.deepEqual(m.bands.map((b) => b.label), ["Very High", "High", "Medium", "Manageable"]);
  assert.deepEqual(m.bands.map((b) => b.tone), house.bands.map((b) => b.tone), "same ladder shape/tones as the house deck");
  assert.equal(m.entity_label, "Zephyr/Volt/Kaskade");
  assert.equal(m.structure.kind, "bands");
});

test("aurora: matrix-shaped, 5 bands ending in Low (its Level-A output), entity Aurora Interactive", () => {
  const m = loadFrameworkManifest(ROOT, "skills/prelim-search/risk-framework-aurora.md");
  assert.equal(m.framework_key, "aurora");
  assert.deepEqual(m.bands.map((b) => b.label), ["Very High", "High", "Medium", "Manageable", "Low"]);
  assert.equal(m.entity_label, "Aurora Interactive");
  assert.equal(m.structure.kind, "matrix");
  const prose = readFileSync(join(SKILL_DIR, "risk-framework-aurora.md"), "utf8");
  assert.match(prose, /ceilings are hard/i, "the matrix framework states its own ceilings in the deck prose");
});

// ── 4: bands-shaped decks carry no residual score machinery ─────────────────────────────────────────────
test("bands-shaped decks (house, zephyr) carry no Composite/Level rating machinery", () => {
  for (const f of frameworkFiles) {
    const manifest = loadFrameworkManifest(ROOT, `skills/prelim-search/${f}`);
    if (manifest.structure.kind !== "bands") continue;
    const prose = readFileSync(join(SKILL_DIR, f), "utf8");
    assert.doesNotMatch(prose, /\bComposite\b/i, `${f}: no Composite scores in a bands-shaped deck`);
    assert.doesNotMatch(prose, /\bLevel\s+[A-E]\b/, `${f}: no Level A–E scale in a bands-shaped deck`);
    assert.doesNotMatch(prose, /\b[1-5]\s*[-–—]\s*(Very High|High|Medium|Moderate|Manageable|Low)\b/i,
      `${f}: no numbered band rows in a bands-shaped deck`);
  }
});

// ── 5: the manifest layer rejects rule-shaped content (vocabulary only) ─────────────────────────────────
test("parseFrameworkManifest: closed keys, ordered unique bands, tones, no digit labels", () => {
  assert.deepEqual(parseFrameworkManifest(JSON.stringify(VALID)).framework_key, "acme");
  const bad = (patch, re) => assert.throws(() => parseFrameworkManifest({ ...VALID, ...patch }), re);
  bad({ extra: 1 }, /framework_manifest_key_unknown:extra/);
  bad({ schema_version: 2 }, /framework_manifest_version_invalid/);
  bad({ framework_key: "Not A Slug" }, /framework_key_invalid/);
  bad({ title: "" }, /framework_title_missing/);
  bad({ entity_label: "  " }, /framework_entity_label_missing/);
  bad({ bands: [{ label: "High", tone: "high" }] }, /framework_bands_invalid:1/);
  bad({ bands: [{ label: "High", tone: "high" }, { label: "HIGH", tone: "low" }] }, /framework_band_label_duplicate/);
  bad({ bands: [{ label: "High", tone: "blazing" }, { label: "Manageable", tone: "low" }] }, /framework_band_tone_invalid:blazing/);
  bad({ bands: [{ label: "Tier 3", tone: "high" }, { label: "Manageable", tone: "low" }] }, /framework_band_label_invalid/);
  bad({ bands: [{ label: "High", tone: "high", rank: 1 }, { label: "Manageable", tone: "low" }] }, /framework_band_key_unknown:rank/);
  bad({ structure: { kind: "scores" } }, /framework_structure_kind_invalid:scores/);
  bad({ structure: { kind: "matrix", axes: [""] } }, /framework_structure_axes_invalid/);
  assert.throws(() => parseFrameworkManifest("{nope"), /framework_manifest_unparseable/);
  assert.throws(() => loadFrameworkManifest(ROOT, "skills/prelim-search/no-such-framework.md"), /framework_manifest_missing/);
});

// ── band helpers ─────────────────────────────────────────────────────────────────────────────────────────
test("band helpers: rank by manifest order, case-insensitive, lowest-band predicate", () => {
  const m = parseFrameworkManifest({ ...VALID, bands: [
    { label: "Very High", tone: "severe" }, { label: "High", tone: "high" },
    { label: "Moderate", tone: "medium" }, { label: "Manageable", tone: "low" },
  ] });
  assert.equal(bandIndex(m, "moderate"), 2);
  assert.equal(normalizeBand(m, "  MODERATE "), "Moderate");
  assert.equal(normalizeBand(m, "Medium"), null, "a label from another framework's vocabulary is not a band here");
  assert.equal(bandTone(m, "very high"), "severe");
  assert.equal(highestBand(m), "Very High");
  assert.equal(lowestBand(m), "Manageable");
  assert.equal(aboveLowestBand(m, "Moderate"), true);
  assert.equal(aboveLowestBand(m, "Manageable"), false, "the lowest band is not 'material' — the old composite>=3 line, re-expressed");
  assert.equal(aboveLowestBand(m, "Nonsense"), false);
  assert.equal(worstBand(m, ["Manageable", "moderate", "junk"]), "Moderate");
  assert.equal(worstBand(m, ["junk"]), null);
  assert.equal(manifestPathFor("skills/prelim-search/risk-framework-zephyr.md"), "skills/prelim-search/risk-framework-zephyr.manifest.json");
});
