// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A SCRIPT QUESTION IS SCOPED TO THE MARKETS THAT FILE IN IT, AND THE READING TURN, NOT THE COMPILER, DECIDES WHETHER IT IS ASKED.
//
// The transliteration axis asked every non-Latin variant in every region the plan named. On a register
// that indexes non-Latin marks by their transliteration only, a script question whose romanised form is
// the Latin question went out as that Latin question again. The manual now tells the reading turn so:
// one script question per market the frame names, and none again where the register files the romanised
// form. The compiler scopes each script question to the markets the frame names that file in its script,
// where the registrable-scripts table has such a row, and drops none of them: each one waits for the
// reading turn, which releases or withholds it with a reason the audit workbook prints.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compileRegisterPlan, awaitsReadingTurn } from "../register-plan.mjs";
import { PROVIDER_CAPABILITIES } from "../register-capabilities.mjs";
import { marketsFilingScriptOf, requiredScriptsFor } from "../registration-scripts.mjs";
import { isNonLatinTerm } from "../../providers/_shared/script-form.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(DRIVER, rel), "utf8");

// The owner's sentence 3, word for word.
const SENTENCE_3 = "Ask one script question per market the frame names. Where the register files foreign marks by their romanised form, and it says so, the Latin question already covers them; do not ask it again in other scripts. A word's meaning in another language is asked only where the frame says that market matters and buyers would read the word as the mark.";

const KATAKANA = "ヴェルトリス", HAN = "维尔特里斯", HANGUL = "벨트리스", CYRILLIC = "Вельтрис", GREEK = "Βελτρις";
const manifest = {
  schema_version: 1, mark: "VELTRIS", dominant_element: "VELTRIS", elements: [{ value: "VELTRIS", kind: "distinctive" }],
  variants: [{ value: "VELTRIS", category: "core" },
    { value: KATAKANA, category: "transliteration", romanization: "VERUTORISU" },
    { value: HAN, category: "transliteration", romanization: "WEI ER TE LI SI" },
    { value: HANGUL, category: "transliteration", romanization: "BELTEURISEU" },
    // Its romanised form is the mark itself: on a register that files the romanised form, the Latin question again.
    { value: CYRILLIC, category: "transliteration", romanization: "VELTRIS" },
    { value: GREEK, category: "transliteration", romanization: "VELTRIS" },
    { value: "VELTRISU", category: "transliteration" },
    { value: "VELTR1S", category: "numeric" }],
  incumbent_classes: [], goods_words: ["software"],
};
const ON_AXIS = manifest.variants.filter((v) => v.category === "transliteration" || v.category === "numeric").map((v) => v.value).sort();
const axis = (id, jurisdictions, frameMarkets = null) => compileRegisterPlan({ manifest, job: { jobKey: "t", classes: ["9"], jurisdictions },
  capabilities: PROVIDER_CAPABILITIES[id], frameMarkets }).entries.filter((e) => e.axis === "transliteration-numeric");
const byTerm = (entries) => new Map(entries.map((e) => [e.term, e]));
const SHAPES = [[["Global"], null], [["Global"], ["US", "EU", "CN", "JP"]], [["JP"], ["JP"]], [["JP"], null], [["CN"], ["CN"]], [["KR"], null],
  [["EU"], ["EU"]], [["MK"], ["MK"]], [["CN", "RU", "NZ", "PH", "EU", "UK", "US"], null], [["CN", "RU", "EU"], ["CN", "RU", "EU"]], [["US", "EU"], ["US", "EU"]]];

test("sentence 3 is in the register unit's manual as written, and the meaning-token paragraph is gone", () => {
  const unit = read("skills/clearance-register/unit.md");
  assert.ok(unit.includes(SENTENCE_3), "sentence 3 is not in unit.md word for word");
  assert.doesNotMatch(unit, /For each foreign-transliteration variant `register_enumerate` the transliterated form/);
  assert.doesNotMatch(unit, /\*\*Meaning token — same enumeration\.\*\*/);
  assert.match(unit, /For each numeric-substitution variant enumerate its query\./, "the numeric variants lost their instruction");
  // Each other place that asks for the meaning token now points at sentence 3.
  const pointers = (unit.match(/where the frame says that market matters \(see `transliteration-numeric`\)/g) ?? []).length;
  assert.equal(pointers, 2, "the saturation-probe and primary-sweep bullets do not both point at sentence 3");
  assert.match(unit, /meaning token \(if flagged, and the frame says that market matters\)/);
  assert.match(read("skills/clearance-register/register-recipes.md"), /`translit-\*-meaning` variant and the frame says that market matters, add/);
});

test("the markets that file in a script are the ones that register marks in it", () => {
  assert.deepEqual(marketsFilingScriptOf(KATAKANA, ["US", "EU", "CN", "JP"]), ["JP"]);
  // Japan's register holds kanji marks, so it counts for a Han question's scope; its floor still demands only katakana.
  assert.deepEqual(marketsFilingScriptOf(HAN, ["US", "EU", "CN", "JP", "TW"]), ["CN", "JP", "TW"]);
  assert.deepEqual(Object.keys(requiredScriptsFor(["JP"])), ["katakana"], "scoping changed what a Japan matter must render");
  assert.deepEqual(marketsFilingScriptOf(HANGUL, ["US", "EU", "CN", "JP"]), [], "a script no named market files in was given a market");
  assert.deepEqual(marketsFilingScriptOf("VELTRIS", ["CN", "JP"]), [], "a Latin value was treated as another script");
});

test("every shape compiles every script question, on every register, and each one waits for the reading turn", () => {
  for (const id of Object.keys(PROVIDER_CAPABILITIES)) for (const [j, f] of SHAPES) {
    const entries = axis(id, j, f);
    assert.deepEqual(entries.map((e) => e.term).sort(), ON_AXIS, `${id} ${j} / frame ${f}: the axis compiled a different set of questions`);
    for (const e of entries.filter((x) => isNonLatinTerm(x.term)))
      assert.ok(awaitsReadingTurn(e.when) || e.unsupported === true, `${id} ${j}: a script question runs without the reading turn releasing it`);
  }
  // On the register that files the romanised form, the two whose romanised form is the mark itself are still
  // compiled: the reading turn withholds them with its reason, the compiler leaves no question unrecorded.
  assert.equal(PROVIDER_CAPABILITIES.clarivate.nativeScriptIndex, false, "the fixture register no longer declares romanised filing");
  const romanised = byTerm(axis("clarivate", ["Global"], ["US", "EU", "CN", "JP"]));
  for (const t of [CYRILLIC, GREEK]) assert.deepEqual(romanised.get(t)?.romanizedTerms, ["VELTRIS"], "a romanised twin of the mark was not compiled");
});

test("a script question is scoped to the named markets that file in it, and kept whole where none does", () => {
  const worldwide = byTerm(axis("corsearch", ["Global"], ["US", "EU", "CN", "JP"]));
  assert.ok(worldwide.get(KATAKANA).regions.includes("JP") && !worldwide.get(KATAKANA).regions.includes("CN"), "the katakana question is not scoped to Japan");
  assert.ok(worldwide.get(HAN).regions.includes("CN") && !worldwide.get(HAN).regions.includes("US"), "the Chinese question is not scoped to China");
  // Naming China beside Japan keeps Japan in the kanji question's regions, as a Japan-only matter does.
  assert.ok(worldwide.get(HAN).regions.includes("JP"), "naming China took Japan out of the kanji question");
  // No named market's row lists Korean, Cyrillic or Greek, so those keep the plan's regions.
  const whole = axis("corsearch", ["Global"], null).find((e) => e.term === "VELTR1S").regions;
  for (const t of [HANGUL, CYRILLIC, GREEK]) assert.deepEqual(worldwide.get(t).regions, whole, `a question with no filing market among those named was narrowed`);
  // An EU matter keeps its Greek and Cyrillic questions, and a Japan matter its kanji one.
  const eu = byTerm(axis("corsearch", ["EU"], ["EU"]));
  assert.ok(eu.has(GREEK) && eu.has(CYRILLIC), "an EU matter lost a question in a script its register holds");
  assert.ok(byTerm(axis("corsearch", ["JP"], ["JP"])).has(HAN), "a Japan matter lost its kanji question");
  // A market the frame names beyond the client's instruction widens nothing.
  assert.ok(!byTerm(axis("corsearch", ["JP"], ["JP", "CN"])).get(HAN).regions.includes("CN"), "a market outside the instruction was asked");
});

test("with no market known the axis compiles as before, and a market the register cannot reach stays disclosed", () => {
  const before = axis("corsearch", ["Global"], null);
  assert.deepEqual(before.map((e) => e.term).sort(), ON_AXIS);
  const regionCounts = new Set(before.map((e) => JSON.stringify(e.regions)));
  assert.equal(regionCounts.size, 1, "a question was scoped with no market to scope it to");
  // Signa does not reach Japan: the katakana question stays, deferred as it always was, never silently gone.
  const signaJapan = byTerm(axis("signa", ["JP"], ["JP"]));
  assert.ok(signaJapan.has(KATAKANA), "a market the register cannot reach lost its disclosed question");
});

test("the pipeline hands the compiler the frame's markets", () => {
  const src = read("pipeline.mjs");
  const at = src.indexOf("compiled = compileRegisterPlan({");
  assert.ok(at > 0 && src.slice(at, at + 4000).includes("frameMarkets: lastAcceptedMatterFrame(P.runDir)?.scope_jurisdictions ?? null"),
    "the compile is not given the markets the matter frame names");
  // The frame is accepted before the plan compiles, or there would be no markets to hand over.
  const frame = src.indexOf('must(await stage("matter-frame", ctx), "matter-frame")');
  const attach = src.indexOf("attachRegisterPlan(ctx);");
  assert.ok(frame > 0 && attach > frame, "the plan compiles before the matter frame is accepted");
});

