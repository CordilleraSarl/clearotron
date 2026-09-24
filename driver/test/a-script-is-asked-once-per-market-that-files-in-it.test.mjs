// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A SCRIPT IS ASKED ONCE PER MARKET THAT FILES IN IT, AND NOT AT ALL WHERE THE REGISTER FILES THE ROMANISED FORM.
//
// The transliteration axis used to ask every non-Latin variant the manifest carried, in every region the
// plan named. On a register that indexes non-Latin marks by their transliteration only, each of those
// questions went out as its romanised form, so a matter asked the same thing once per script and got the
// same answer each time. The compiler now reads the register's own declaration and the markets the matter
// frame names: a script is asked in the markets that register marks in it, never where none is named, and
// not at all on a register that files the romanised form.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compileRegisterPlan } from "../register-plan.mjs";
import { PROVIDER_CAPABILITIES } from "../register-capabilities.mjs";
import { marketsFilingScriptOf } from "../registration-scripts.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(DRIVER, rel), "utf8");

// The owner's sentence 3, word for word.
const SENTENCE_3 = "Ask one script question per market the frame names. Where the register files foreign marks by their romanised form, and it says so, the Latin question already covers them; do not ask it again in other scripts. A word's meaning in another language is asked only where the frame says that market matters and buyers would read the word as the mark.";

const KATAKANA = "ヴェルトリス", HAN = "维尔特里斯", HANGUL = "벨트리스", CYRILLIC = "Вельтрис";
const manifest = {
  schema_version: 1, mark: "VELTRIS", dominant_element: "VELTRIS", elements: [{ value: "VELTRIS", kind: "distinctive" }],
  variants: [{ value: "VELTRIS", category: "core" },
    { value: KATAKANA, category: "transliteration", romanization: "VERUTORISU" },
    { value: HAN, category: "transliteration", romanization: "WEI ER TE LI SI" },
    { value: HANGUL, category: "transliteration", romanization: "BELTEURISEU" },
    { value: CYRILLIC, category: "transliteration", romanization: "VELTRIS" },
    { value: "VELTRISU", category: "transliteration" },
    { value: "VELTR1S", category: "numeric" }],
  incumbent_classes: [], goods_words: ["software"],
};
const ASKED_BEFORE = manifest.variants.filter((v) => v.category === "transliteration" || v.category === "numeric").length;
const axis = (id, jurisdictions, frameMarkets = null) => compileRegisterPlan({ manifest, job: { jobKey: "t", classes: ["9"], jurisdictions },
  capabilities: PROVIDER_CAPABILITIES[id], frameMarkets }).entries.filter((e) => e.axis === "transliteration-numeric");
const byTerm = (entries) => new Map(entries.map((e) => [e.term, e]));

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
  assert.deepEqual(marketsFilingScriptOf(HAN, ["US", "EU", "CN", "JP", "TW"]), ["CN", "TW"]);
  assert.deepEqual(marketsFilingScriptOf(HANGUL, ["US", "EU", "CN", "JP"]), [], "a script no named market files in was given a market");
  assert.deepEqual(marketsFilingScriptOf("VELTRIS", ["CN", "JP"]), [], "a Latin value was treated as another script");
});

test("on a register that files the romanised form, no non-Latin question is asked", () => {
  assert.equal(PROVIDER_CAPABILITIES.clarivate.nativeScriptIndex, false, "the fixture register no longer declares romanised filing");
  for (const scope of [[["Global"], null], [["Global"], ["US", "EU", "CN", "JP"]], [["JP"], null], [["CN", "RU", "EU"], ["CN", "RU", "EU"]]]) {
    const terms = axis("clarivate", ...scope).map((e) => e.term);
    assert.deepEqual(terms.filter((t) => /[^\x00-\x7f]/.test(t)), [], `a non-Latin question was asked on the romanised register (${scope[0]})`);
    assert.ok(terms.includes("VELTR1S") && terms.includes("VELTRISU"), "a numeric or Latin transliteration question was lost");
  }
  // THE CONTROL: a register that indexes the characters still asks them.
  assert.ok(axis("corsearch", ["Global"], null).some((e) => e.term === KATAKANA), "the control register asked no native question");
});

test("a script is asked in the markets the frame names that file in it, and not where none does", () => {
  const worldwide = byTerm(axis("corsearch", ["Global"], ["US", "EU", "CN", "JP"]));
  assert.deepEqual([...worldwide.keys()].sort(), ["VELTR1S", "VELTRISU", HAN, KATAKANA].sort(), "a script no named market files in was asked");
  assert.ok(worldwide.get(KATAKANA).regions.includes("JP") && !worldwide.get(KATAKANA).regions.includes("CN"), "the katakana question is not scoped to Japan");
  assert.ok(worldwide.get(HAN).regions.includes("CN") && !worldwide.get(HAN).regions.includes("JP"), "the Chinese question is not scoped to China");
  // On a matter the client scoped to Japan, only the Japanese script is asked.
  const japan = byTerm(axis("corsearch", ["JP"], ["JP"]));
  assert.ok(japan.has(KATAKANA) && !japan.has(HAN) && !japan.has(HANGUL) && !japan.has(CYRILLIC));
  // A market the frame names beyond the client's instruction widens nothing.
  assert.ok(!byTerm(axis("corsearch", ["JP"], ["JP", "CN"])).has(HAN), "a market outside the instruction was asked");
});

test("with no market known the axis compiles as before, and a market the register cannot reach stays disclosed", () => {
  const before = axis("corsearch", ["Global"], null);
  assert.deepEqual(before.map((e) => e.term).sort(), [KATAKANA, HAN, HANGUL, CYRILLIC, "VELTRISU", "VELTR1S"].sort());
  assert.ok(before.every((e) => !e.regions?.length || e.regions.length > 2), "a question was scoped with no market to scope it to");
  // Signa does not reach Japan: the katakana question stays, deferred as it always was, never silently gone.
  const signaJapan = byTerm(axis("signa", ["JP"], ["JP"]));
  assert.ok(signaJapan.has(KATAKANA), "a market the register cannot reach lost its disclosed question");
});

test("no scope asks more than one question per variant, as before", () => {
  const shapes = [[["Global"], null], [["Global"], ["US", "EU", "CN", "JP"]], [["JP"], ["JP"]], [["CN"], ["CN"]], [["KR"], null],
    [["CN", "RU", "NZ", "PH", "EU", "UK", "US"], null], [["US", "EU"], ["US", "EU"]]];
  for (const id of Object.keys(PROVIDER_CAPABILITIES)) for (const [j, f] of shapes)
    assert.ok(axis(id, j, f).length <= ASKED_BEFORE, `${id} ${j} asks more than one question per variant`);
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
