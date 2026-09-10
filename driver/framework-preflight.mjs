// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE FRAMEWORK PRE-FLIGHT — read a deck and its manifest and say what they declare, before either
// rates a real matter.
//
// A customer's counsel writes a risk framework as two files: a prose deck they can argue with, and a
// small manifest that gives code the band words. Until now the only way to find out whether the pair
// worked was to point a company at it and run a matter. Three things went wrong in that order, and each
// of them looked like something else:
//
//   the manifest is refused          — the run fails by a token, hours in, naming a JSON key
//   the deck and the manifest differ — nothing fails; the profile screen renders the framework's title
//                                      and its coloured band pills and silently omits the box saying what
//                                      the bands mean, so the page looks built and is missing half of it
//   the deck resolves somewhere else — nothing fails; another framework rates the matter
//
// IT REPORTS AND DOES NOT GRADE. The pre-flight says what the framework declares — the ladder in its own
// order, the entity the deck names, the shape it is, which file answered — and where the two files
// disagree it says which band and what the deck did not do. It has no opinion on whether the rubric is a
// good one: a rubric is a legal document, and a check that scored one would be a content lint in a
// different costume. Nothing here reads what a band MEANS, only that the deck defines it.
//
// AGREEMENT IS THE RENDERER'S OWN READ, not a second one. `bandMeaningRows` in profile-service.mjs is the
// walk the profile screen makes; this calls it. A pre-flight with its own matcher would pass a deck the
// page then drops, which is the defect it exists to remove rather than a smaller version of it.

import { readFileSync } from "node:fs";
import { config } from "./driver.config.mjs";
import { loadFrameworkManifest, manifestPathFor, DEFAULT_FRAMEWORK } from "./framework.mjs";
import { bandMeaningRows } from "./profile-service.mjs";

/**
 * WHY A DECK SERVED FROM THE REPO IS WORTH A SENTENCE, and why only sometimes.
 *
 * Skill resolution is layered: the config store wins, the repo answers when the store is silent. That
 * fallback is the migration design and every generic methodology file relies on it. For a FRAMEWORK it is
 * different in kind, because the shipped tree carries decks under the same filenames customers use for
 * their own — `risk-framework.md`, `risk-framework-demo.md`, `risk-framework-triage.md`, which are the
 * three `files[]` re-includes after excluding `risk-framework-*`. Take a customer's deck out of the
 * config store and the repo's copy answers: readable, valid, and not theirs. Nothing throws and the
 * matter is rated under another company's rubric.
 *
 * So: reported when an overlay is configured and did not hold the file. Silent on a single-tree install,
 * where there is no other copy for it to have been.
 */
export const SUBSTITUTION_SAY = (r) =>
  `served from the shipped tree, not the configured store — the store has no ${r.rel}, so ${r.basePath} answered. `
  + `A customer deck removed from the store is replaced by the shipped file of the same name rather than missed.`;

const layerSay = {
  overlay: "the configured store",
  base: "the shipped tree (the configured store does not hold it)",
  "base-only": "the shipped tree",
  missing: "nowhere — neither the configured store nor the shipped tree holds it",
};

/**
 * Everything the pre-flight found about one framework, as data. `ok` is the whole verdict; `refusals`
 * says why when it is false, in sentences written for the person who wrote the files.
 *
 * `resolve` and `read` are injected so the lint can drive a planted tree — the CLI passes neither and
 * gets the engine's own resolution, which is the point of the check.
 */
export function preflightFramework(fwPath, { resolve, read } = {}) {
  const resolveOne = resolve ?? ((rel) => config.resolveSkillPathReport(rel));
  const readOne = read ?? ((p) => readFileSync(p, "utf8"));
  const manifestRel = manifestPathFor(fwPath);
  const out = {
    fwPath, manifestRel, ok: false, refusals: [], substitutions: [],
    deck: null, manifest: null, declares: null, bands: null,
  };

  for (const [name, rel] of [["deck", fwPath], ["manifest", manifestRel]]) {
    let r;
    try { r = resolveOne(rel); }
    catch (e) { out.refusals.push({ code: "skills_overlay_unreadable", say: String(e?.message ?? e) }); return out; }
    out[name] = { rel, path: r.path, layer: r.layer, from: layerSay[r.layer] ?? r.layer };
    if (r.layer === "base") out.substitutions.push({ ...r, say: SUBSTITUTION_SAY(r) });
  }

  let manifest;
  try { manifest = loadFrameworkManifest((rel) => resolveOne(rel).path, fwPath); }
  catch (e) {
    out.refusals.push({ code: "manifest", say: String(e?.message ?? e) });
    return out;
  }
  out.declares = {
    key: manifest.framework_key, title: manifest.title, entity: manifest.entity_label,
    sourceDeck: manifest.source_deck, shape: manifest.structure.kind,
    ladder: manifest.bands.map((b) => ({ label: b.label, tone: b.tone })),
  };

  let deckText;
  try { deckText = readOne(out.deck.path); }
  catch (e) {
    out.refusals.push({ code: "deck_unreadable", say: `the deck could not be read at ${out.deck.path}: ${String(e?.message ?? e)}` });
    return out;
  }

  // The entity label has to appear in the prose, because the deck speaks about the company by name and a
  // manifest naming a company the deck never mentions is a pair from two different frameworks.
  if (!deckText.toLowerCase().includes(String(manifest.entity_label).toLowerCase()))
    out.refusals.push({ code: "entity_absent",
      say: `the manifest names "${manifest.entity_label}" as the company, and the deck prose never uses that name.` });

  out.bands = bandMeaningRows(deckText, manifest) ?? [];
  const missed = out.bands.filter((b) => b.miss);
  if (missed.length)
    out.refusals.push({ code: "bands_disagree",
      say: `${missed.length} of ${out.bands.length} bands are named in the manifest and not defined in the deck. `
        + "The profile screen shows what the bands mean only when EVERY band is defined, so one miss empties the whole box.",
      bands: missed.map((b) => ({ band: b.band, miss: b.miss })) });

  out.ok = out.refusals.length === 0;
  return out;
}

/** The report as lines for a reader. No colour, no verdict word the caller has not earned. */
export function formatPreflight(r) {
  const L = [];
  L.push(`Framework: ${r.fwPath}${r.fwPath === DEFAULT_FRAMEWORK ? "  (this installation's default)" : ""}`);
  if (r.deck) L.push(`  deck      ${r.deck.path}`, `            read from ${r.deck.from}`);
  if (r.manifest) L.push(`  manifest  ${r.manifest.path}`, `            read from ${r.manifest.from}`);
  if (r.declares) {
    const d = r.declares;
    L.push("", `It declares itself "${d.title}" (${d.key}), a ${d.shape}-shaped framework rating ${d.entity}.`,
      `Transcribed from: ${d.sourceDeck}`, "", "The ladder, highest risk first:");
    for (const [i, b] of d.ladder.entries()) L.push(`  ${i + 1}. ${b.label.padEnd(16)} ${b.tone}`);
  }
  if (r.bands?.length) {
    L.push("", "What the deck defines:");
    for (const b of r.bands) L.push(b.miss ? `  ✗ ${b.band.padEnd(16)} ${b.miss}` : `  ✓ ${b.band.padEnd(16)} ${b.meaning}`);
  }
  for (const s of r.substitutions) L.push("", `WARNING  ${s.rel}: ${s.say}`);
  if (r.refusals.length) {
    L.push("", "Not ready:");
    for (const f of r.refusals) L.push(`  ${f.say}`);
  } else {
    L.push("", "The deck and the manifest agree. Nothing was created and nothing was rated.");
  }
  return L.join("\n");
}
