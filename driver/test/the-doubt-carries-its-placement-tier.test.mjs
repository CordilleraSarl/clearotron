// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — doubt-closure driver selection, keyed on the PLACEMENT TIER.
//
// The key had to move once already. Keying on the band or disposition of the finding a doubt is about
// CANNOT BIND — doubt-closure-grading-cannot-bind.test.mjs proves it, and 0 of 420 open doubts across 28
// delivered runs measured it. The tier is a different key with a different provenance: it comes from the
// carry artifact, which the stitch cannot have consumed.
//
// Every arm here drives the REAL producers. A fixture I hand-build cannot tell me the mint stamps the
// field — it can only tell me my fixture has it.
import test from "node:test";
import assert from "node:assert/strict";
import { reconcilePlacementCarry, mintPlacementCarryDoubts } from "../placement-carry.mjs";
import { mintRecordCarryDoubts } from "../record-carry.mjs";
import { doubtsForClosure, doubtSelectionNote, keptTiersFor, cutStateFor } from "../doubt-selection.mjs";
import { placementsChecks } from "../predelivery-lint.mjs";
import { PLACEMENT_TIERS } from "../placement-model.mjs";

const placement = (mark, tier, extra = {}) => ({
  mark, owner: `${mark} Holdings SA`, jurisdiction: "CH", records: [`/mark/ch/${mark.toLowerCase()}`],
  tier, reason: "placed by the inquiry", ...extra,
});

// register-findings.md that mentions NONE of the marks below, so every placement lands `uncarried`
// and the mint has something to mint. Asserted, not assumed — see the control arm.
const CARRIES_NOTHING = "# Register findings\n\n## Risk-relevant\n\n(nothing this pass)\n";

const doubtsFor = (placements) =>
  mintPlacementCarryDoubts(reconcilePlacementCarry({ placements, registerFindingsText: CARRIES_NOTHING }));

// ── 1. the producers stamp the key they were already holding ────────────────────────────────────────

test("#1503 CONTROL — the placement mint actually mints, or every arm below is vacuous", () => {
  const d = doubtsFor([placement("VOLTMAX", "headline-candidate")]);
  assert.ok(d.length > 0, "reconcilePlacementCarry + mintPlacementCarryDoubts produced NO doubts on a "
    + "placement no findings text mentions — the fixture stopped reaching the uncarried class, and every "
    + "assertion below would pass over an empty list");
});

test("#1503 placement-carry writes the tier as a FIELD, not only into the prose", () => {
  for (const tier of PLACEMENT_TIERS) {
    const [d] = doubtsFor([placement("VOLTMAX", tier)]);
    assert.equal(d.subject.placementTier, tier,
      `a ${tier} placement minted a doubt with placementTier=${JSON.stringify(d?.subject?.placementTier)}. `
      + "The tier is in `subject.text` either way, which is exactly the failure: prose the selection cannot read.");
  }
});

test("#1503 an entry that declared NO tier carries the producer's own sentinel, not a second name for it", () => {
  const [d] = doubtsFor([{ ...placement("VOLTMAX", undefined), tier: undefined }]);
  assert.equal(d.subject.placementTier, "(untiered)",
    "reconcilePlacementCarry already writes `(untiered)` for an entry with no tier. Folding it to null "
    + "here would give one absence two names, and two readers a way to disagree about it");
});

test("#1503 record-carry stamps the tier through the seat, and NULL where the record never reached placement", () => {
  const withSeat = mintRecordCarryDoubts({ unreasoned: [
    { uri: "/mark/ch/voltmax", mark: "VOLTMAX", owner: "VOLTMAX Holdings SA", reach: "placed",
      stopped_at: "digest", detail: "silent drop", placement: { tier: "sheet-2", mark: "VOLTMAX", owner: "", carry: "uncarried" } },
  ] });
  assert.equal(withSeat.doubts[0].subject.placementTier, "sheet-2");

  const noSeat = mintRecordCarryDoubts({ unreasoned: [
    { uri: "/mark/ch/other", mark: "OTHER", owner: "", reach: "retrieved", stopped_at: null,
      detail: "no ground recorded", placement: null },
  ] });
  assert.equal(noSeat.doubts[0].subject.placementTier, null,
    "the in-line screen and the synthesis seam carry `placement: null` because the record never reached "
    + "placement. That is a fact about the record, and it must read as keyless rather than as a gap");
});

// ── 2. the selection, and the direction it fails in ─────────────────────────────────────────────────

const openDoubt = (id, placementTier) => ({ id, status: "open", subject: { placementTier } });

test("#1503 no cut, an unknown cut and `every-doubt` all select EVERY doubt", () => {
  const doubts = [openDoubt("a", "headline-candidate"), openDoubt("b", "watchlist-annex")];
  for (const cut of [null, undefined, "every-doubt", "bands 1+2", "HEADLINE-CANDIDATE typo'd"]) {
    const sel = doubtsForClosure({ doubts, doubtClosure: cut });
    assert.equal(sel.ids, null,
      `cut ${JSON.stringify(cut)} produced a selection. An unreadable cut must dispatch everything: being `
      + "wrong toward asking costs one cheap call, being wrong toward silence drops a question about a "
      + "record the reader IS being shown");
  }
});

test("#1503 a live cut keeps its tiers, drops the rest, and DISPATCHES the keyless", () => {
  const doubts = [
    openDoubt("head", "headline-candidate"),
    openDoubt("sheet", "sheet-2"),
    openDoubt("annex", "watchlist-annex"),
    openDoubt("filtered", "out-of-scope-filtered"),
    openDoubt("keyless", null),
    openDoubt("untiered", "(untiered)"),
  ];
  const sel = doubtsForClosure({ doubts, doubtClosure: "headline-candidate+sheet-2" });
  assert.deepEqual(sel.ids, ["head", "sheet", "keyless", "untiered"]);
  assert.equal(sel.dropped, 2, "watchlist-annex and out-of-scope-filtered sit below the cut");
  assert.equal(sel.keyless, 2, "a doubt with no tier — and `(untiered)`, which IS no tier — is asked about, "
    + "never dropped: it cannot be shown to sit below the cut, and that is not the same as sitting below it");
  assert.equal(sel.keyed, 4);
  assert.equal(sel.total, 6);
});

test("#1503 case is folded at the comparison, so a tier written in another case still joins", () => {
  const sel = doubtsForClosure({ doubts: [openDoubt("a", "  Headline-Candidate  "), openDoubt("b", "SHEET-2")],
    doubtClosure: "headline-candidate+sheet-2" });
  assert.equal(sel.ids, null, "both are kept, so the selection collapses to 'every doubt'");
  // …and the fold is doing the work, not the cut being permissive:
  const dropped = doubtsForClosure({ doubts: [openDoubt("a", "WATCHLIST-ANNEX")], doubtClosure: "headline-candidate" });
  assert.deepEqual(dropped.ids, [], "an upper-case tier OUTSIDE the cut is still dropped");
});

test("#1503 a cut that keeps everything is BYTE-IDENTICAL to no selection", () => {
  const doubts = [openDoubt("a", "headline-candidate"), openDoubt("b", "headline-candidate")];
  const sel = doubtsForClosure({ doubts, doubtClosure: "headline-candidate" });
  assert.equal(sel.ids, null, "selecting every doubt must report NO selection, so the dispatch and the "
    + "spec sidecar are unchanged rather than merely equivalent");
  assert.equal(doubtSelectionNote(sel), "", "and it records no note, because nothing was selected");
});

test("#1503 the note states what was dropped and what was asked for want of a key", () => {
  const sel = doubtsForClosure({
    doubts: [openDoubt("a", "headline-candidate"), openDoubt("b", "watchlist-annex"), openDoubt("c", null)],
    doubtClosure: "headline-candidate" });
  const note = doubtSelectionNote(sel);
  assert.match(note, /2 of 3 doubt\(s\) dispatched/);
  assert.match(note, /1 dropped below the cut/);
  assert.match(note, /1 dispatched for want of a tier/);
});

// ── 3. the INERTNESS claim, over every product ──────────────────────────────────────────────────────

// THE RULED CUTS, and where they come from — because the provenance is the whole risk here.
//
// 's architecture table has THREE rows and its columns are `P4 | P3 | P2`. The row that carries
// these tier words is `placement-inquiry trace`, whose typed key is the placement tier. The
// `doubt-closure` row carries `all | bands 1+2 | band 1`, keyed on FINDING CLASS — and eggie measured
// 0 of 420 open doubts joining on finding class, which is why the key had to move at all.
//
// So these values are the placement-inquiry row's, adopted for doubt-closure BECAUSE IT IS NOW THE SAME
// KEY. That is an inference, not a transcription, and it is the reason this arm names its source rather
// than just its values: the owner's one-word answer settles the KEY, and whoever merges this is also
// assenting to the CUTS. Products: 's body names product 3 as multi-country; product 4 is
// full-country-search, pinned byte-identical by owner ruling ("its already great") and therefore absent
// from this set — its row stays `every-doubt`.
const RULED_CUTS = Object.freeze([
  "global-preliminary-search=headline-candidate",          // P2
  "multi-country-focus-search=headline-candidate+sheet-2", // P3
]);

test("#1503 exactly the ruled products resolve to a live doubt-closure cut, and no others", async () => {
  // WAS "no product resolves to a live cut" — the inertness claim, true while the ruling was open. The
  // mechanism shipped inert deliberately and that argument had been enforced for ONE product of three:
  // depth-ladder-table's ONE_COUNTRY_TODAY restates product 4's row value-by-value, and the two GRADED
  // products had nothing pinning this field. Measured then by planting a live cut on each row in turn:
  //
  //   full-country-search        → 2 arms red
  //   global-preliminary-search  → NOTHING red, across all three doubt test files
  //   multi-country-focus-search → NOTHING red
  //
  // Found in review by role-e2e scruffy, on merged code. A guard's subject list is as complete as
  // whoever typed it, and mine had one name in it. The arm now pins the ruled set the same way, so a
  // fourth product, or a changed cut, is a deliberate edit here and not a drift.
  const { PRODUCT_POLICIES, depthFor } = await import("../search-policy.mjs");
  const products = Object.keys(PRODUCT_POLICIES);

  // CONTROL 1 — the population is real.
  assert.ok(products.length >= 3,
    `only ${products.length} product(s) resolved — the table moved, and the scan below would agree with `
    + "itself over an empty set");
  // CONTROL 2 — the predicate can say YES. Without this a broken keptTiersFor reports every row inert.
  assert.ok(keptTiersFor("headline-candidate"),
    "keptTiersFor no longer recognises a cut it defines, so the scan below cannot report a live one");

  // RESOLVED THE WAY THE DRIVER RESOLVES IT — depthFor(), not the table literal, because an unknown or
  // ungraded product falls back to full-country-search's row and a literal read would miss that path.
  // And keyed on keptTiersFor rather than on the string "every-doubt": the question is whether the cut
  // would SELECT, not whether it is spelled the way today's rows spell it.
  const live = products
    .map((p) => [p, depthFor({ product: p })?.doubtClosure])
    .filter(([, cut]) => keptTiersFor(cut))
    .map(([p, cut]) => `${p}=${cut}`);

  assert.deepEqual(live.slice().sort(), RULED_CUTS.slice().sort(),
    "the live doubt-closure cuts are not the ruled set. Adding, removing or re-spelling a cut changes "
    + "which doubts the seat is dispatched, so it is a spec change and RULED_CUTS above is where it is "
    + "recorded — with the row of #1503's table it came from. Live now:\n  " + live.join("\n  "));

  // AND THE DIRECTION THE SET CANNOT SHOW: product 4 must still select every doubt. An empty or
  // mis-spelled cut on that row would drop out of `live` and read as compliance with the ruling.
  const { depthFor: df } = await import("../search-policy.mjs");
  assert.equal(df({ product: "full-country-search" })?.doubtClosure, "every-doubt",
    "product 4's row is pinned byte-identical by owner ruling; a cut here is a spec change, and its "
    + "ABSENCE from the live set above is not evidence — an unrecognised cut word looks identical");
});

// ── 4. the two tables that must not drift apart ─────────────────────────────────────────────────────

test("#1503 every cut word the depth table allows is one the selection can act on", async () => {
  const { readFileSync } = await import("node:fs");
  const table = readFileSync(new URL("./depth-ladder-table.test.mjs", import.meta.url), "utf8");
  const m = table.match(/doubtClosure:\s*\[([^\]]*)\]/);
  assert.ok(m, "the depth-ladder table no longer declares a doubtClosure vocabulary — this arm is reading "
    + "a shape that moved, not agreeing with one");
  const words = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  assert.ok(words.length >= 2, `only ${words.length} cut word(s) found — the parse broke`);
  for (const w of words) {
    if (w === "every-doubt") { assert.equal(keptTiersFor(w), null); continue; }
    const kept = keptTiersFor(w);
    assert.ok(Array.isArray(kept) && kept.length,
      `the depth table allows "${w}" and doubt-selection.mjs does not recognise it, so a product row set `
      + "to it would silently dispatch every doubt while the table claims it is graded");
    for (const t of kept)
      assert.ok(PLACEMENT_TIERS.includes(t), `"${w}" keeps "${t}", which is not a placement tier`);
  }
});

// ── 5. the lint row — a disclosure that must not read as a defect ───────────────────────────────────

test("#1503 the zero-URI disclosure fires on presence, names the count, and NEVER blocks", () => {
  const rows = [placement("VOLTMAX", "headline-candidate"), { ...placement("NOVA", "sheet-2"), records: [] }];
  const c = placementsChecks({ placements: rows }).find((x) => x.id === "placement-rows-without-uri");
  assert.ok(c, "no placement-rows-without-uri row was produced for a placements set that contains one");
  assert.equal(c.pass, false, "only a failing check's detail reaches a reader, so a disclosure has to flag");
  assert.notEqual(c.structural, true, "this must never block delivery — records: [] is CONTRACTUAL for a "
    + "common-law candidate, and a row that blocks on correct data gets an ignore-list within a week");
  assert.match(c.detail, /1 of 2 placement row\(s\)/);
  assert.match(c.detail, /NOT a defect/);
});

test("#1503 the disclosure is SILENT when every row names a record — it is not an always-on banner", () => {
  const c = placementsChecks({ placements: [placement("VOLTMAX", "headline-candidate")] })
    .find((x) => x.id === "placement-rows-without-uri");
  assert.equal(c, undefined, "a set where every row carries a URI has no boundary to disclose");
});

// ── 6. the CALL SITE, which the arms above do not reach ─────────────────────────────────────────────

test("#1503 the pipeline reads the cut, and the SIDECAR lists exactly what the DISPATCH carries", async () => {
  // A TEXT GUARD, said plainly: it cannot see a runtime gate, and it is not trying to. What it catches
  // is the drift it is aimed at — the spec sidecar listing ids the dispatch does not carry, which tells
  // the seat it may speak about doubts it was never shown.
  //
  // It exists because everything above tests `doubtsForClosure` and the two mints DIRECTLY. Nothing
  // tested that the pipeline passes the cut in or uses the answer, and a helper whose call site has no
  // arm is 's shape exactly: a full suite green with the change reverted.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");

  assert.ok(src.includes("doubtClosure: ctx.depth?.doubtClosure ?? null"),
    "the pipeline no longer passes the depth row's cut into doubtsForClosure, so every product runs "
    + "ungraded whatever the table says. NOTE depth-ladder-table's declared-only arm does NOT catch this: "
    + "it only asks whether the string `depth?.doubtClosure` appears anywhere in this file, and a comment "
    + "naming it would satisfy that regex");

  for (const [needle, why] of [
    ["ctx.openDoubts = dispatchDoubts.map(", "the DISPATCH is built from the full open set again, so the selection decides nothing"],
    ["openIds: [...dispatchDoubts.map(", "the sidecar's openIds is no longer the dispatched set — the seat is being told it may speak about ids it was never shown"],
    ["bornIn: Object.fromEntries(dispatchDoubts", "the sidecar's bornIn map covers doubts the dispatch does not carry"],
  ]) assert.ok(src.includes(needle), `${why}\n  missing: ${needle}`);

  assert.ok(!/openIds:\s*\[\.\.\.openAfterStitch/.test(src),
    "openIds is built from openAfterStitch — that is the exact regression this arm exists for");
});

// ── the counts are the MEASUREMENT, and they were protected by nothing ──────────────────────────────

test("#1503 the tier counts are REAL under `every-doubt` — the only cut that ships", () => {
  // THE DEFECT THIS PINS. `doubtsForClosure` returned `{keyed: 0, keyless: 0}` before the loop whenever
  // no cut was live, and `TIER_CUTS["every-doubt"] === null`, so every shipped product recorded hard
  // zeros. R2 on 44654e02: `{of: 31, selected: 31, keyed: 0, keyless: 0}`. Found by role-e2e eggie on
  // the artifacts, not by this suite — the arm above asserts `ids === null` and says nothing about the
  // counts, so the counts were RECORDING-ONLY and a recording-only field is protected by a test or by
  // nothing.
  const doubts = [openDoubt("a", "headline-candidate"), openDoubt("b", "sheet-2"), openDoubt("c", "(untiered)")];

  const sel = doubtsForClosure({ doubts, doubtClosure: "every-doubt" });
  assert.equal(sel.keyed, 2, "two of these three carry a tier, and `every-doubt` must still count them");
  assert.equal(sel.keyless, 1, "the `(untiered)` sentinel is counted keyless, cut or no cut");
  assert.equal(sel.dropped, 0, "nothing can be dropped when everything is kept");
  assert.equal(sel.ids, null,
    "and the DISPATCH must not move — counting is the only thing this changed, so the run stays "
    + "byte-identical under the shipped cut");

  // CONTROL, and it is what makes the three numbers above evidence: the same fixture under a LIVE cut
  // reports the same keyed/keyless. If a future change made the counts depend on the cut, these two
  // would drift and the pair says so.
  const live = doubtsForClosure({ doubts, doubtClosure: "headline-candidate" });
  assert.equal(live.keyed, sel.keyed, "keyed is a property of the doubts, not of the cut");
  assert.equal(live.keyless, sel.keyless, "keyless is a property of the doubts, not of the cut");
  assert.equal(live.dropped, 1, "and only the LIVE cut drops anything — `sheet-2` is below this cut");
});

test("#1503 no cut still reports null ids when a doubt carries no id at all", () => {
  // The edge the `ids.length === list.length` test alone gets wrong: a doubt with no id is skipped by
  // the loop, so `ids` is SHORTER than the list through no selection having been made. Without the
  // `!keepSet` short-circuit that reads as a selection, and the dispatch stops being byte-identical on
  // a run where nothing was cut.
  const doubts = [openDoubt("a", "headline-candidate"), { subject: { placementTier: "sheet-2" } }];
  const sel = doubtsForClosure({ doubts, doubtClosure: "every-doubt" });
  assert.equal(sel.ids, null, "no cut is live, so nothing was selected and the dispatch is unchanged");
  assert.equal(sel.total, 2, "total counts the list as given, including the unusable entry");
  assert.equal(sel.keyed, 1, "only the entry with an id reaches the counter");
});

test("#1503 the event names WHICH silence it resolved — a typo does not read like the shipped cut", () => {
  // `keptTiersFor` returns null for `every-doubt` and for a word it does not know, deliberately: a typo
  // must not silently drop every keyed doubt. The cost is that both record identically, so a misspelt
  // row looks graded while the dispatch is not. 's arm catches a bad word on the ROW; this is the
  // same question on the run that actually happened.
  assert.equal(cutStateFor("every-doubt"), "every-doubt");
  assert.equal(cutStateFor("headline-candidate"), "live");
  assert.equal(cutStateFor("headline-candidat"), "unrecognised", "a typo is named as one");
  assert.equal(cutStateFor(null), "absent");
  assert.equal(cutStateFor("HEADLINE-CANDIDATE"), "live", "case is folded here as it is at the join");

  // THE PROTOTYPE REACH. `TIER_CUTS[word]` is a bare lookup, so without an own-property test
  // `constructor` resolves to a function and reads as a word the table knows.
  for (const inherited of ["constructor", "toString", "valueOf", "hasOwnProperty"])
    assert.equal(cutStateFor(inherited), "unrecognised",
      `${inherited} is not a cut word — the lookup must not reach the prototype`);
  // CONTROL — and the own-property test must still ACCEPT the real words, or the loop above is satisfied
  // by a function that calls everything unrecognised.
  assert.equal(cutStateFor("headline-candidate+sheet-2"), "live");

  // Threaded onto the result the run records, not computed twice at the call site.
  const doubts = [openDoubt("a", "headline-candidate")];
  assert.equal(doubtsForClosure({ doubts, doubtClosure: "every-doubt" }).cutState, "every-doubt");
  assert.equal(doubtsForClosure({ doubts, doubtClosure: "nonsense" }).cutState, "unrecognised");
  assert.equal(doubtsForClosure({ doubts, doubtClosure: "headline-candidate" }).cutState, "live");
});
