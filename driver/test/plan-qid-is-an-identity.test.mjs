// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — A PLAN ENTRY'S QID NAMES ITS QUESTION, NOT ITS POSITION IN THE COMPILE ORDER.
//
// `slug` folds a term to [a-z0-9] with the literal "q" as its fallback, so EVERY non-Latin term
// produced the same slug and the mint disambiguated positionally — `q`, `q#2`, `q#3`, assigned by the
// order the compiler happened to walk the terms in. A Latin term kept a self-describing identity; a
// Cyrillic, Chinese or Japanese one did not. Fourth site of a Latin normaliser standing where an
// identity should be (after,).
//
// THE ISSUE FILED THIS AS LATENT and named the missing step: "whether any live path actually re-derives
// qids in a different order ... is the first thing to measure". `extendRegisterPlan` is that path — it
// meets a FROZEN plan with a FRESH compile whenever new variants arrive, and matched by exact qid
// string. The first two arms below are that measurement, kept as the regression: they are the shape
// that lost a term and billed another twice.
import { test } from "node:test";
import assert from "node:assert/strict";

import { extendRegisterPlan, compileRegisterPlan } from "../register-plan.mjs";
import { parseVariantManifestModel } from "../variant-manifest-model.mjs";

const entry = (qid, term, extra = {}) => ({ qid, axis: "mark-exact", predicate: "exact", term, nice_classes: [9], regions: ["RU"], ...extra });
const plan = (entries, fp = "a") => ({ plan_version: 1, derived_from: { variants_fingerprint: fp }, entries });
const termsOf = (p) => p.entries.map((e) => e.term);
const qidsOf = (p) => p.entries.map((e) => e.qid);

test("a term arriving FIRST in the compile order no longer displaces the terms behind it", () => {
  // THE MEASURED DEFECT, as a regression. Two Cyrillic terms frozen under old-scheme ordinals; a third
  // arrives and the compiler walks it first, so every ordinal behind it shifts by one. Before the fix
  // this produced `added: ["…q#3"]`, the plan held Расторопша TWICE, and Молочный чертополох — the term
  // that actually arrived — was never searched at all.
  const frozen = plan([entry("mark-exact:exact:q", "Чертополох"), entry("mark-exact:exact:q#2", "Расторопша")]);
  const fresh = plan([
    entry("mark-exact:exact:q", "Молочный чертополох"),      // NEW, takes the first ordinal
    entry("mark-exact:exact:q#2", "Чертополох"),
    entry("mark-exact:exact:q#3", "Расторопша"),
  ], "b");

  const { plan: out } = extendRegisterPlan(frozen, fresh);
  const terms = termsOf(out);
  assert.ok(terms.includes("Молочный чертополох"),
    "the arriving term is not in the plan — it was suppressed by an ordinal it happened to share, which is the whole defect");
  assert.equal(terms.filter((t) => t === "Расторопша").length, 1, "a stored term was duplicated — the same query runs twice and bills twice");
  assert.equal(terms.filter((t) => t === "Чертополох").length, 1);
  assert.equal(new Set(qidsOf(out)).size, qidsOf(out).length,
    "the extended plan carries a duplicate qid — everything downstream joins on that string exactly, so it would pair the wrong pair");
});

test("…and the Latin CONTROL behaved correctly all along, which is what made this a script defect", () => {
  // The same shape with Latin terms. It passed before the fix and must still pass: this arm is what
  // stops the fix being credited for a bug that was never script-specific.
  const frozen = plan([entry("mark-exact:exact:silybum", "Silybum"), entry("mark-exact:exact:cardus", "Cardus")]);
  const fresh = plan([
    entry("mark-exact:exact:mariana", "Mariana"),
    entry("mark-exact:exact:silybum", "Silybum"),
    entry("mark-exact:exact:cardus", "Cardus"),
  ], "b");
  const { plan: out, added } = extendRegisterPlan(frozen, fresh);
  assert.deepEqual(added, ["mark-exact:exact:mariana"]);
  assert.deepEqual(termsOf(out), ["Silybum", "Cardus", "Mariana"], "existing entries keep their order; the new one appends");
});

test("MIGRATION: an old-scheme frozen plan meeting a new-scheme compile neither duplicates nor drops", () => {
  // The hazard the fix would otherwise introduce, and the reason `added` is decided by the QUESTION.
  // A plan minted before this change carries `q` / `q#2`; a fresh compile of the SAME terms now mints
  // `q-<fp8>`. Keyed on the qid alone NOTHING matches and every non-Latin entry appends a second time —
  // the same duplication, arriving through the fix.
  const frozen = plan([entry("mark-exact:exact:q", "Чертополох"), entry("mark-exact:exact:q#2", "Расторопша")]);
  const fresh = plan([entry("mark-exact:exact:q-11111111", "Чертополох"), entry("mark-exact:exact:q-22222222", "Расторопша")], "b");

  const { plan: out, added } = extendRegisterPlan(frozen, fresh);
  assert.deepEqual(added, [], "the same two questions under new names are not new questions");
  assert.equal(out.entries.length, 2, "the stored plan doubled — every entry appended a second time under its new qid");
  assert.deepEqual(qidsOf(out), ["mark-exact:exact:q", "mark-exact:exact:q#2"],
    "a frozen qid was rewritten. The frozen plan is the executor's contract and the receipts, coverage rows and band join all key on the strings it already has");
  // `extendRegisterPlan` returns the ORIGINAL object when nothing is new — reuse, not a re-roll.
  assert.equal(out, frozen, "a no-op extend must return the stored plan itself, not a rebuilt copy");
});

test("the romanisation carriage merge survives the scheme change — it matches the question too", () => {
  // The field-level merge exists because append-by-qid alone made the carriage fix inert for any matter
  // with a stored plan. Across the scheme change a stored entry's qid is absent from the fresh compile,
  // so a qid-only lookup would make it inert AGAIN — the exact regression that merge was written to end.
  const frozen = plan([entry("mark-exact:exact:q", "Чертополох")]);
  const fresh = plan([entry("mark-exact:exact:q-11111111", "Чертополох", { romanizedTerms: ["Chertopolokh"] })], "b");
  const { plan: out, enriched } = extendRegisterPlan(frozen, fresh);
  assert.deepEqual(enriched, ["mark-exact:exact:q"], "the stored entry did not gain the romanisation across the rename");
  assert.deepEqual(out.entries[0].romanizedTerms, ["Chertopolokh"]);
  assert.equal(out.entries[0].qid, "mark-exact:exact:q", "enrichment is field-level — it never renames the entry");
});

test("a romanisation still never rides onto a DIFFERENT term, whichever key found the entry", () => {
  // The guard the merge already had, re-asserted now that a second lookup key exists: a question key
  // that matched loosely would graft one term's transliteration onto another's row, which is worse than
  // the inertness it cures.
  const frozen = plan([entry("mark-exact:exact:q", "Чертополох")]);
  const fresh = plan([entry("mark-exact:exact:q", "Расторопша", { romanizedTerms: ["Rastoropsha"] })], "b");
  const { plan: out } = extendRegisterPlan(frozen, fresh);
  const stored = out.entries.find((e) => e.term === "Чертополох");
  assert.equal(stored.romanizedTerms, undefined, "a different term's romanisation was grafted onto this entry");
});

test("a genuinely new question is ALWAYS added, even when it collides on a stored qid", () => {
  // The append guard. Deciding `added` by the question means a new entry can arrive carrying a qid the
  // stored plan already uses — an ordinal-named one does exactly that. It must be renamed, never dropped
  // and never allowed to shadow, and the new name must be derived from the question so a later recompile
  // reproduces it rather than minting yet another ordinal.
  const frozen = plan([entry("mark-exact:exact:q", "Чертополох")]);
  const fresh = plan([entry("mark-exact:exact:q", "Расторопша")], "b");
  const { plan: out, added } = extendRegisterPlan(frozen, fresh);
  assert.equal(out.entries.length, 2);
  assert.equal(new Set(qidsOf(out)).size, 2, "the appended entry shadowed the stored one under the same qid");
  assert.equal(added.length, 1);
  assert.notEqual(added[0], "mark-exact:exact:q", "the reported qid must be the one actually stored, not the colliding one");
  // Stable, not positional: the same collision resolves to the same name on a second run.
  const again = extendRegisterPlan(frozen, plan([entry("mark-exact:exact:q", "Расторопша")], "c"));
  assert.deepEqual(again.added, added, "the disambiguated qid is not reproducible — it is another ordinal by a different name");
});

test("an OR-stack and an owner sweep are their own questions, never folded into a bare term", () => {
  // The question key has to carry the same distinctions the entry does, or it becomes a new collapse one
  // level up — the failure mode this whole issue is an instance of.
  const frozen = plan([entry("mark-exact:exact:q", "Чертополох")]);
  const orStack = plan([{ qid: "mark-exact:exact:q", axis: "mark-exact", predicate: "exact", terms: ["Чертополох", "Расторопша"], nice_classes: [9], regions: ["RU"] }], "b");
  assert.equal(extendRegisterPlan(frozen, orStack).plan.entries.length, 2, "an OR-stack over the same first term is a different question");

  const owned = plan([entry("incumbent-class:default:q", "Чертополох", { axis: "incumbent-class", predicate: "default", owner: "ООО Ромашка" })]);
  const otherOwner = plan([entry("incumbent-class:default:q", "Чертополох", { axis: "incumbent-class", predicate: "default", owner: "ЗАО Василёк" })], "b");
  assert.equal(extendRegisterPlan(owned, otherOwner).plan.entries.length, 2,
    "two different non-Latin proprietors folded to one question — the same collapse rode the +owner- suffix");
});

// ── THE MINT ITSELF, which is where the ordinal was assigned ─────────────────────────────────────────

const MODEL = (variants) => JSON.stringify({
  schema_version: 1,
  mark: "DAWN: LEGENDS OF LUMENGARDE",
  dominant_element: "LUMENGARDE",
  elements: [{ value: "LUMENGARDE", kind: "distinctive" }],
  variants,
  incumbent_classes: ["9"],
});
const JOB = { jobKey: "TMP9999-lumengarde", classes: ["9"], jurisdictions: ["EU"] };
const compileWith = (variants) => compileRegisterPlan({
  manifest: parseVariantManifestModel(MODEL(variants)), job: JOB, skillVersion: "prelim-register@spec48",
});
const CYRILLIC = [
  { value: "Чертополох", category: "transliteration", rationale: "cyrillic" },
  { value: "Расторопша", category: "transliteration", rationale: "cyrillic" },
  { value: "Молочный чертополох", category: "transliteration", rationale: "cyrillic" },
];

test("the MINT gives each non-Latin term its own identity — no ordinals, no shared sentinel", () => {
  const plan = compileWith(CYRILLIC);
  const cyr = plan.entries.filter((e) => typeof e.term === "string" && /[Ѐ-ӿ]/.test(e.term));
  assert.ok(cyr.length >= 3, `expected the Cyrillic variants to compile into entries, got ${cyr.length}`);

  // The defect, stated as the assertion: an ordinal-disambiguated qid.
  const ordinals = cyr.filter((e) => /:q(#\d+)?$/.test(e.qid) || /:q(#\d+)?\+/.test(e.qid));
  assert.deepEqual(ordinals.map((e) => `${e.qid} -> ${e.term}`), [],
    "a non-Latin term is still identified by the bare `q` sentinel and its position in the compile order");

  // …and each term's identity is its own. One qid per term, no sharing.
  const byTerm = new Map();
  for (const e of cyr) {
    const key = `${e.axis}:${e.predicate}:${e.term}`;
    assert.ok(!byTerm.has(key) || byTerm.get(key) === e.qid, `two entries for one question disagree on identity: ${key}`);
    byTerm.set(key, e.qid);
  }
  assert.equal(new Set(cyr.map((e) => e.qid)).size, cyr.length, "two Cyrillic entries share a qid");
});

test("…and that identity does NOT move when the compile order does", () => {
  // The property the ordinals could not have. Same three terms, reversed manifest order: every term
  // must keep the qid it had. Before the fix this reassigned `q`, `q#2`, `q#3` to different terms and
  // the exact-string join downstream then matched the wrong band or reported the slice missing —
  // silently, because nothing could notice that `q#2` meant something else this time.
  const forward = compileWith(CYRILLIC);
  const reversed = compileWith([...CYRILLIC].reverse());
  const idOf = (plan) => new Map(plan.entries
    .filter((e) => typeof e.term === "string" && /[Ѐ-ӿ]/.test(e.term))
    .map((e) => [`${e.axis}:${e.predicate}:${e.term}`, e.qid]));

  const a = idOf(forward), b = idOf(reversed);
  assert.ok(a.size >= 3, "the sweep found no Cyrillic entries — the scan broke, it did not find an empty plan");
  for (const [question, qid] of a)
    assert.equal(b.get(question), qid, `"${question}" changed identity because the compiler walked the terms in a different order`);
});

test("a LATIN term's qid is byte-unchanged — the fix must move nothing that already worked", () => {
  // The blast-radius claim, asserted rather than asserted-in-prose. qids are keyed on across twenty
  // modules (receipts, coverage rows, the band join, the frozen plan on disk, plan-stability's Jaccard),
  // and every stored Latin plan has to keep matching.
  const plan = compileWith([
    { value: "EVERLITE", category: "phonetic", rationale: "sound-alike" },
    { value: "EVER LIGHT", category: "visual", rationale: "spacing" },
  ]);
  const everlite = plan.entries.find((e) => e.term === "EVERLITE");
  assert.ok(everlite, "the Latin variant did not compile");
  assert.match(everlite.qid, /:everlite(\+|$|#)/, "a Latin term's identity moved — it is the fold, and the fold was already self-describing");
  for (const e of plan.entries) assert.doesNotMatch(e.qid, /q-[0-9a-f]{8}/, "the fingerprint fallback fired on a plan with no non-Latin term");
});


// ── THE CLIENT'S OWN HOUSE ELEMENT IS NOT A CONFLICT AXIS ────────────────────────────────────────
//
// 2026-09-16: the mark was the client's own house mark plus a tagline, `dominant_element` was the house
// element, and the machine-built mutation forms were therefore built from it. Two such queries put
// 1,154 of a 2,146-record band on the table, reachable from nothing else. The reviewing lawyer searched
// the whole phrase, the shorter phrase and the last word.
const { excludeHouseElement } = await import("../register-plan.mjs");

const HOUSE_MODEL = {
  schema_version: 1,
  mark: "NOVAPULSE SOUND OF TOMORROW",
  dominant_element: "NOVAPULSE",
  elements: [{ value: "NOVAPULSE", kind: "distinctive" }, { value: "TOMORROW", kind: "distinctive" }],
  variants: [
    { value: "NOVAPULS", category: "visual", rationale: "one-letter mutation of the house element" },
    { value: "NOVAPULSE SOUND OF TOMORROW", category: "exact-phrase", rationale: "the whole phrase" },
    { value: "SOUND OF TOMORROW", category: "exact-phrase", rationale: "the remainder" },
  ],
  incumbent_classes: ["9"],
};
const HOUSE = { element: "NOVAPULSE", remainder: "SOUND OF TOMORROW" };

test("the house element stops being an axis, and the lawyer's three shapes all survive", () => {
  const r = excludeHouseElement(HOUSE_MODEL, HOUSE);
  assert.equal(r.refused, null);

  // 1. THE WHOLE PHRASE IS UNTOUCHED. The lawyer keeps it — what stops is treating the element as an
  // axis, not searching the mark the client actually applied for.
  assert.equal(r.manifest.mark, "NOVAPULSE SOUND OF TOMORROW");
  // 2. the shorter phrase is searchable on its own
  assert.ok(r.manifest.variants.some((v) => v.value === "SOUND OF TOMORROW"));
  // 3. the dominant word is the remainder's, never the house element's — this is the field the
  // mutation forms are built from, and it is the whole reason the band flooded
  assert.equal(r.manifest.dominant_element, "TOMORROW");

  assert.equal(r.manifest.variants.some((v) => v.value === "NOVAPULS"), false,
    "a one-letter mutation OF THE HOUSE ELEMENT names no word of the remainder and goes");
  assert.equal(r.manifest.elements.some((e) => e.value === "NOVAPULSE"), false);
  assert.deepEqual(r.manifest.incumbent_classes, ["9"], "the incumbent classes are not this rule's business");
});

test("REQUIREMENT 3 — the element is still confirmed once, as the client's own, by a query that runs", () => {
  const r = excludeHouseElement(HOUSE_MODEL, HOUSE);
  assert.equal(r.confirmation.term, "NOVAPULSE");
  assert.equal(r.confirmation.predicate, "owner",
    "an OWNER-scoped confirmation, not a conflict sweep — the exclusion is evidenced on the report by a "
    + "call that was made, never by a sentence saying one would have been");
  assert.equal(r.confirmation.house_element_confirmation, true);
});

test("THE FLOOR — an element that leaves nothing to search excludes NOTHING, and says which", () => {
  // The direction that reaches a client. Ownership can verify perfectly here; what is wrong is that the
  // whole mark was named. No downstream count catches it: "queries on the house element: 0" is true of a
  // plan holding no queries at all.
  for (const [h, why] of [
    // The whole mark named as the element leaves no remainder at all.
    [{ element: "NOVAPULSE SOUND OF TOMORROW", remainder: "" }, "house_element_incomplete"],
    [{ element: "NOVAPULSE", remainder: "   " }, "house_element_incomplete"],
    [{ element: "", remainder: "SOUND OF TOMORROW" }, "house_element_incomplete"],
    // THE JOIN THE FRAME CANNOT MAKE: a receipt describing a different mark than the one being planned.
    // Applying it would cut the dominant element down to a word that is not in this mark at all.
    [{ element: "NOVAPULSE", remainder: "SONG OF YESTERDAY" }, "house_element_remainder_not_in_mark"],
    [{ element: "QUANTAFLUX", remainder: "SOUND OF TOMORROW" }, "house_element_not_in_mark"],
  ]) {
    const r = excludeHouseElement(HOUSE_MODEL, h);
    assert.equal(r.refused, why);
    assert.equal(r.confirmation, null, "a refused exclusion confirms nothing either");
    // BYTE-IDENTICAL, not merely "still has queries". A transform that half-applied and then reported a
    // refusal would pass a looser assertion while having already dropped the mutation forms.
    assert.equal(JSON.stringify(r.manifest), JSON.stringify(HOUSE_MODEL),
      "the manifest comes back exactly as it went in — the run plans as if no receipt existed");
  }
});

test("the compiled plan loses the house element's own sweep and keeps the whole phrase", () => {
  const plan = (m) => compileRegisterPlan({ manifest: parseVariantManifestModel(JSON.stringify(m)),
    job: { jobKey: "TMP9999-novapulse", classes: ["9"], jurisdictions: ["EU"] },
    skillVersion: "prelim-register@spec48" });
  const before = plan(HOUSE_MODEL);
  const after = plan(excludeHouseElement(HOUSE_MODEL, HOUSE).manifest);

  const termsOf = (p) => p.entries.flatMap((e) => [e.term, ...(e.terms ?? [])]).filter(Boolean).map(String);
  const beforeTerms = termsOf(before), afterTerms = termsOf(after);

  // A FLOOR ON THE POPULATION BEFORE ANY CLAIM ABOUT WHAT IT OMITS. "No query on the house element" is
  // satisfied by a plan with no queries, which is the failure this whole rule could produce.
  assert.ok(after.entries.length >= 3, `the plan must still be a plan: ${after.entries.length} entries`);
  assert.ok(afterTerms.includes("NOVAPULSE SOUND OF TOMORROW"), "the whole phrase is still searched");
  assert.ok(afterTerms.includes("SOUND OF TOMORROW"), "and so is the shorter phrase");

  assert.ok(beforeTerms.includes("NOVAPULSE"),
    "precondition: today's plan DOES sweep the house element on its own — without this the arm below "
    + "would pass against a compile that never swept it");
  assert.equal(afterTerms.includes("NOVAPULSE"), false,
    "…and after the exclusion it is not swept as a term of its own");
});


// ── OWNERSHIP IS VERIFIED, NEVER ACCEPTED ───────────────────────────────────────────────────────
const { verifyHouseElementOwnership } = await import("../register-plan.mjs");

const OWNERS = ["Novapulse Audio GmbH"];
const CLASSES = ["9", "41"];
const REC = { record_id: "/mark/eu/1", owner_name: "Novapulse Audio GmbH", status: "Registered", classes: ["9"] };
const verify = (over = {}) => verifyHouseElementOwnership({
  element: "NOVAPULSE", classes: CLASSES, owners: OWNERS,
  lookup: async () => ({ ok: true, records: [REC] }), now: () => "T", ...over });

test("ownership verifies only on a live, client-owned registration in an instructed class", async () => {
  const r = await verify();
  assert.equal(r.verified, true);
  assert.equal(r.records.length, 1, "the evidence rides the receipt — the report states the exclusion on it");
  assert.equal(r.records[0].record_id, "/mark/eu/1");
});

test("EVERY way of not knowing lands on not-verified, and says which way it was", async () => {
  // The fail-closed leg, driven one path at a time. Each of these is a way an element could stop being
  // searched on something other than evidence, and not one of them may exclude anything.
  const cases = [
    [{ owners: [] }, /client_owner_unknown/],
    [{ classes: [] }, /instructed_classes_absent/],
    [{ lookup: undefined }, /lookup_unavailable/],
    [{ lookup: async () => ({ ok: false, reason: "provider 503" }) }, /lookup_did_not_answer/],
    [{ lookup: async () => { throw new Error("socket hang up"); } }, /lookup_threw/],
    [{ element: "" }, /house_element_absent/],
    [{ lookup: async () => ({ ok: true, records: [] }) }, /no_live_owned_registration/],
    // dead, right owner, right class
    [{ lookup: async () => ({ ok: true, records: [{ ...REC, status: "Expired" }] }) }, /no_live_owned_registration/],
    // live, right owner, WRONG class
    [{ lookup: async () => ({ ok: true, records: [{ ...REC, classes: ["25"] }] }) }, /no_live_owned_registration/],
    // live, right class, SOMEONE ELSE
    [{ lookup: async () => ({ ok: true, records: [{ ...REC, owner_name: "Quantaflux Holdings" }] }) }, /no_live_owned_registration/],
  ];
  for (const [over, re] of cases) {
    const r = await verify(over);
    assert.equal(r.verified, false, `must not verify: ${JSON.stringify(Object.keys(over))}`);
    assert.match(r.reason, re);
    assert.deepEqual(r.records, [], "an unverified receipt carries no evidence either");
  }
});

test("the three conditions are checked on ONE record, never assembled across several", async () => {
  // THE DEFECT A SEPARATE-COUNTS IMPLEMENTATION WOULD HAVE. None of these three is the client's live
  // in-class registration, but between them every condition is satisfied once — so a check that asked
  // "is any record live?", "is any in class?", "is any ours?" would verify an ownership nobody holds,
  // and an element would stop being searched on the strength of three unrelated rows.
  const r = await verify({ lookup: async () => ({ ok: true, records: [
    { ...REC, status: "Expired" },                                  // ours, in class, DEAD
    { ...REC, classes: ["25"] },                                    // ours, live, WRONG class
    { ...REC, owner_name: "Quantaflux Holdings" },                   // live, in class, NOT ours
  ] }) });
  assert.equal(r.verified, false);
  assert.match(r.reason, /no_live_owned_registration/);
});
