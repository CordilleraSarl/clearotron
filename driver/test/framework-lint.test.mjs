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
//
// ── IT USED TO CHECK ONLY THE FOUR DECKS THIS REPOSITORY SHIPS ─────────────────────────────────────────
//
// The decks this lint exists to protect are the ones a customer writes, and those live in the config
// store, not here. Two lines put every one of them out of reach: the population came from a readdir of
// `ROOT/skills/prelim-search`, and every path resolved by joining the repository root — while the engine
// resolves the same paths through the config store first and the repository second. So the lint saw the
// bundled profiles, passed, and said nothing whatever about the files it was written for; and where a
// customer deck and a shipped one share a filename, the two resolutions read DIFFERENT FILES and neither
// noticed. It resolves the engine's way now, and the population is every deck either root offers.
//
// AND IT AGREED WITH ITSELF RATHER THAN WITH THE PAGE. Checking that a band label appears in a heading is
// not the question a deck's author is asking; the question is whether the profile screen will show what
// their bands mean. Those are different tests, and two shipped decks passed this one while failing that:
// their pages rendered a title and coloured band pills and silently omitted the box. The agreement check
// is now the pre-flight, which calls the renderer's own walk, so a deck this lint passes is a deck the
// page can draw.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseFrameworkManifest, loadFrameworkManifest, manifestPathFor, DEFAULT_FRAMEWORK,
  bandIndex, normalizeBand, bandTone, lowestBand, highestBand, aboveLowestBand, worstBand,
} from "../framework.mjs";
import { loadProfiles } from "../profiles.mjs";
import { config } from "../driver.config.mjs";
import { preflightFramework } from "../framework-preflight.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";   // — one corpus floor, shared with the guard that reads for it

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_DIR = join(ROOT, "skills", "prelim-search");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Every risk framework THE ENGINE CAN REACH, as skills-relative paths — the config store's decks and the
 * repository's, deduped, with the store winning a shared filename exactly as resolution does.
 *
 * A readdir of one directory answers a different question, and answered it green for months.
 */
export function reachableFrameworks(roots = config.skillsGrantRoots) {
  const seen = new Map();
  for (const root of roots) {                                   // store first, repository second
    const dir = join(root, "prelim-search");
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => /^risk-framework.*\.md$/.test(x)))
      if (!seen.has(f)) seen.set(f, `skills/prelim-search/${f}`);
  }
  // GUARDED HERE, NOT AT EACH ROOT. A configured store with no frameworks of its own is the ordinary
  // state and an empty read of it means nothing; a run where NEITHER root offered one means this lint
  // walked a tree it could not see, and every arm below would then assert its rule over nothing and pass.
  nonEmpty(seen, `risk frameworks under any skills root (${roots.join(", ")})`);
  return [...seen.entries()].map(([file, rel]) => ({ file, rel })).sort((a, b) => a.file.localeCompare(b.file));
}
const frameworks = reachableFrameworks();
const frameworkFiles = frameworks.map((f) => f.file);

/**
 * DECKS THIS REPOSITORY SHIPS THAT THE PROFILE SCREEN CANNOT DRAW, each with what the deck does not do.
 *
 * A list of exceptions is normally the rule written backwards, so this one is held from both sides: a
 * deck outside it must agree with the renderer, and a deck INSIDE it must still disagree. Repairing one
 * therefore reds this arm until the entry comes out, and no entry can quietly outlive its defect.
 *
 * The repair for the one below is not mechanical, which is why it is recorded rather than made. The deck
 * is matrix-shaped and its band table has two columns where the renderer reads three (band, meaning,
 * response). Four of its five rows carry both halves already and split at a sentence or a colon; the
 * fifth, `Low`, states "No practical obstacle on the evidence read" and no response at all. Writing that
 * missing sentence is a change to a rating rubric, which belongs to whoever owns the rubric.
 */
const CANNOT_BE_DRAWN = new Map([
  ["risk-framework-demo.md", "matrix-shaped with a two-column band table; the renderer reads three cells "
    + "(band, meaning, response), and the Low row states a meaning and no response"],
]);

const VALID = {
  schema_version: 1, framework_key: "acme", title: "Acme risk framework", source_deck: "Acme deck",
  entity_label: "Acme", bands: [{ label: "High", tone: "high" }, { label: "Manageable", tone: "low" }],
  structure: { kind: "bands" },
};

// ── 1+2: every framework the engine can reach has a manifest, and the prose deck agrees with it ─────────
test("every reachable risk-framework*.md has a parsing manifest whose bands + entity appear in the prose", () => {
  assert.ok(frameworkFiles.length >= 3, `expected at least the shipped frameworks, found: ${frameworkFiles.join(", ")}`);
  for (const { file: f, rel: fwPath } of frameworks) {
    // resolved the ENGINE's way — the config store first — so a customer deck is read where it lives
    const manifest = loadFrameworkManifest((rel) => config.resolveSkillPath(rel), fwPath);
    const prose = readFileSync(config.resolveSkillPath(fwPath), "utf8");
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
    const m = loadFrameworkManifest((rel) => config.resolveSkillPath(rel), fwPath);
    assert.ok(m.bands.length >= 2, `${fwPath}: manifest loads with bands`);
  }
});

// ── the walk that finds them refuses a tree it cannot see ───────────────────────────────────────────────
test("the framework population refuses to be empty, and a store with no frameworks of its own is not empty", () => {
  const empty = mkdtempSync(join(tmpdir(), "fw-none-"));
  try {
    assert.throws(() => reachableFrameworks([empty]), /VACUOUS: risk frameworks under any skills root/,
      "neither root offered one: every arm below would assert its rule over nothing");
    mkdirSync(join(empty, "prelim-search"), { recursive: true });
    assert.throws(() => reachableFrameworks([empty]), /VACUOUS: risk frameworks under any skills root/,
      "an existing but frameworkless directory is the same nothing");
    // a store that carries no framework is ORDINARY — the repository's decks are still reachable
    assert.ok(reachableFrameworks([empty, join(ROOT, "skills")]).length >= 4,
      "one empty root does not empty the population");
  } finally { rmSync(empty, { recursive: true, force: true }); }
});

// ── 2b: the agreement a DECK'S AUTHOR is asking about — will the page draw their bands ──────────────────
test("every reachable framework the renderer can draw, and the ones it cannot are exactly the recorded set", () => {
  assert.ok(frameworks.length >= 4, `a population this small cannot be the frameworks: ${frameworkFiles.join(", ")}`);
  const cannot = [];
  for (const { file: f, rel } of frameworks) {
    const r = preflightFramework(rel);
    const disagrees = r.refusals.filter((x) => x.code === "bands_disagree" || x.code === "entity_absent");
    if (!disagrees.length) { assert.ok(!CANNOT_BE_DRAWN.has(f), `${f}: recorded as undrawable and the renderer draws it — remove the entry`); continue; }
    cannot.push(f);
    const why = disagrees.map((x) => x.say + (x.bands ?? []).map((b) => `\n      ${b.band}: ${b.miss}`).join("")).join(" ");
    assert.ok(CANNOT_BE_DRAWN.has(f),
      `${f}: the profile screen would show this framework's title and band pills and omit what the bands mean.\n    ${why}`);
  }
  assert.deepEqual(cannot.sort(), [...CANNOT_BE_DRAWN.keys()].sort(),
    "the recorded set is the whole of what the renderer cannot draw");
});

// ── 2c: a deck served from the repository while a store is configured says so ───────────────────────────
//
// The silent case is NOT a missing file — that resolves to a base path nothing holds and the read throws
// by name. It is a deck ABSENT FROM THE STORE and PRESENT IN THE REPOSITORY: readable, valid, and not the
// customer's. `risk-framework-aurora.md` and `risk-framework-zephyr.md` ship under the names customers use
// for their own, so this is reachable by deleting one file.
test("a deck the store does not hold, answered by the repository's file of the same name, is reported", () => {
  const store = mkdtempSync(join(tmpdir(), "fw-store-"));
  const before = process.env.CLEAROTRON_INSTRUCTIONS_DIR;
  try {
    mkdirSync(join(store, "skills", "prelim-search"), { recursive: true });
    // the store holds ONE framework and not the other, which is the customer-deck-removed state
    for (const f of ["risk-framework-zephyr.md", "risk-framework-zephyr.manifest.json"])
      writeFileSync(join(store, "skills", "prelim-search", f), readFileSync(join(SKILL_DIR, f), "utf8"));
    process.env.CLEAROTRON_INSTRUCTIONS_DIR = join(store, "skills");

    const held = config.resolveSkillPathReport("skills/prelim-search/risk-framework-zephyr.md");
    assert.equal(held.layer, "overlay", "the store's own deck is served from the store");

    const swapped = config.resolveSkillPathReport("skills/prelim-search/risk-framework-aurora.md");
    assert.equal(swapped.layer, "base", "a deck the store does not hold is served by the repository's copy");
    assert.equal(swapped.path, join(SKILL_DIR, "risk-framework-aurora.md"));

    const absent = config.resolveSkillPathReport("skills/prelim-search/risk-framework-nobody-wrote.md");
    assert.equal(absent.layer, "missing", "held by neither root — the read that follows reports it");

    // and the pre-flight a person runs says it in a sentence rather than leaving them the layer word
    const r = preflightFramework("skills/prelim-search/risk-framework-aurora.md");
    assert.equal(r.substitutions.length, 2, "the deck AND its manifest both came from the repository");
    assert.match(r.substitutions[0].say, /not the configured store/);
    assert.equal(preflightFramework("skills/prelim-search/risk-framework-zephyr.md").substitutions.length, 0,
      "a framework the store holds is not reported — the report is about substitution, not about the repository");
  } finally {
    if (before === undefined) delete process.env.CLEAROTRON_INSTRUCTIONS_DIR;
    else process.env.CLEAROTRON_INSTRUCTIONS_DIR = before;
    rmSync(store, { recursive: true, force: true });
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
