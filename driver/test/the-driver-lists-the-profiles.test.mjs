// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lever 3 — which findings earn a grounded profile is chosen by the DRIVER, not described to the seat.
//
// The architecture's rule: prefer driver selection wherever the typed key precedes the dispatch. The
// band is on findings.json before narrative-refutation runs, so there is nothing for the seat to judge.
// The driver lists ordinals and unlisted work is never asked for — which has none of a directive's
// failure modes, all three of which this issue has now seen: carried and ignored, carried and misread,
// and not carried at all by a dispatch nobody checked.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { profileOrdinals, profileSelectionDirective, bandRank } from "../profile-selection.mjs";
import { depthFor } from "../search-policy.mjs";

const BANDS = [{ label: "Very High" }, { label: "High" }, { label: "Moderate" }, { label: "Manageable" }];
const F = (ordinal, band) => ({ ordinal, band });
const FINDINGS = { findings: [F(1, "Very High"), F(2, "High"), F(3, "Moderate"), F(4, "Manageable"), F(5, "Manageable")] };

test("#1503 the rank is ordinal against the run's own manifest, and an unlisted band is rank 0", () => {
  assert.equal(bandRank("Very High", BANDS), 1);
  assert.equal(bandRank("Manageable", BANDS), 4);
  assert.equal(bandRank("Nonesuch", BANDS), 0, "a band this manifest does not list must not resolve to a rank");
  assert.equal(bandRank("", BANDS), 0);
  assert.equal(bandRank("High", null), 0, "with no manifest there is no rank to give");
});

test("#1503 a rank cut lists the ordinals at or above it", () => {
  const sel = profileOrdinals({ findings: FINDINGS, bandOrder: BANDS, maxRank: 3 });
  assert.deepEqual(sel.ordinals, [1, 2, 3]);
  assert.equal(sel.total, 5);
  assert.match(profileSelectionDirective(sel), /by ordinal: 1, 2, 3\./);
  assert.match(profileSelectionDirective(sel), /changes nothing about what you refute/,
    "the instruction must say what it does NOT change, or a reviewer reads a shorter list as a shorter review");
});

test("#1503 EVERY UNREADABLE STATE IS 'ALL' — wrong toward depth, never toward brevity", () => {
  // A profile nobody asked about simply goes missing, and the only symptom is its absence. So every way
  // of not knowing resolves to null, which emits no instruction and leaves today's behaviour.
  for (const [why, args] of [
    ["no cut on the row", { findings: FINDINGS, bandOrder: BANDS }],
    ["a zero cut", { findings: FINDINGS, bandOrder: BANDS, maxRank: 0 }],
    ["no findings", { bandOrder: BANDS, maxRank: 3 }],
    ["an empty findings list", { findings: { findings: [] }, bandOrder: BANDS, maxRank: 3 }],
    ["an unparseable findings doc", { findings: "not a document", bandOrder: BANDS, maxRank: 3 }],
    ["no manifest", { findings: FINDINGS, maxRank: 3 }],
    ["a manifest with no bands", { findings: FINDINGS, bandOrder: [], maxRank: 3 }],
  ]) {
    assert.equal(profileOrdinals(args).ordinals, null, `${why} produced a selection`);
    assert.equal(profileSelectionDirective(profileOrdinals(args)), "", `${why} still emitted an instruction`);
  }
});

test("#1503 a BAND-LESS finding is INCLUDED and counted — absence of a key is not permission to skip", () => {
  // Deliberately the opposite of the narrative rule, which excludes band-less findings from PROSE.
  // Whether the reviewer may LOOK at a finding is a different question from whether it earns a write-up,
  // and folding the two would be a second, unruled cut riding on this one.
  const withNone = { findings: [F(1, "Very High"), F(2, null), F(3, "Manageable"), F(4, "Nonesuch")] };
  const sel = profileOrdinals({ findings: withNone, bandOrder: BANDS, maxRank: 2 });
  assert.deepEqual(sel.ordinals, [1, 2, 4], "a finding with no band, or an unlisted one, was dropped");
  assert.equal(sel.keyless, 2, "the keyless count is how a reader tells a cut from a coverage hole");
});

test("#1503 a cut that keeps EVERYTHING emits nothing — byte-identical where it changes nothing", () => {
  // Otherwise a run whose findings all sit above the cut would carry an instruction listing every
  // ordinal, which is a different dispatch for no difference in what is asked.
  const sel = profileOrdinals({ findings: { findings: [F(1, "Very High"), F(2, "High")] }, bandOrder: BANDS, maxRank: 3 });
  assert.equal(sel.ordinals, null);
  assert.equal(profileSelectionDirective(sel), "");
});

test("#1503 a cut that keeps NOTHING says so explicitly — an empty list is not an absent one", () => {
  // The dangerous silence: `ordinals: []` rendered as "" would read as "profile everything".
  const sel = profileOrdinals({ findings: { findings: [F(1, "Manageable"), F(2, "Manageable")] }, bandOrder: BANDS, maxRank: 1 });
  assert.deepEqual(sel.ordinals, []);
  assert.match(profileSelectionDirective(sel), /write NO grounded profiles/);
  assert.match(profileSelectionDirective(sel), /Refute the narrative in full as usual/);
});

test("#1503 the per-product rows carry the cut, and one-country does not", () => {
  assert.equal(depthFor({ product: "global-preliminary-search" }).profileKeptBandRank, 3);
  assert.equal(depthFor({ product: "multi-country-focus-search" }).profileKeptBandRank, 3);
  assert.equal("profileKeptBandRank" in depthFor({ product: "full-country-search" }), false,
    "the one-country row grew a cut — its dispatch must list nothing and stay unchanged");
});

test("#1503 THE CALL SITE computes it on ctx, so the recheck sends the SAME list", () => {
  // A verdict-recheck resumes the same session. If it re-derived the selection it could hand that
  // session a different list than the one it was given — the two-dispatches-disagreeing shape this
  // issue is made of. Set once on ctx, read by every dispatch of the stage.
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  assert.match(src, /ctx\.profileSelection = profileOrdinals\(/,
    "nothing computes the profile selection onto ctx");
  assert.equal((src.match(/profileOrdinals\(/g) ?? []).length, 1,
    "the selection is computed in more than one place — two computations can disagree, and a recheck "
    + "that re-derived it could hand a resumed session a different list than the one it was given");
});
