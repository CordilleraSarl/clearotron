// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ONE SCRIPT QUESTION PER MARKET ON THE LIST, FOR EACH SCRIPT ITS BUYERS READ, AND THE READING TURN DECIDES WHETHER IT IS ASKED.
//
// The transliteration axis asked every non-Latin variant, and one a named market did not file in went to every region.
// On a test run of a crowded matter, 26 of 33 script questions went to all 186 offices for markets the frame never
// named, and one market got three. The compiler now asks a script form only for a market on the list whose buyers read
// that script, one per script it reads, in that market's offices; any other form is set aside in the plan with its
// reason, and reaches no coverage row. The list is the frame's markets (within the instructed ones), else the one market
// list the opening message names. Each script question still waits for the reading turn, and the propose tool holds a
// worker's own script proposal to the same rule. Every mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { proposeSupplemental } from "../engine/mcp/supplemental.mjs";
import { makeExecutePlan } from "../../providers/_shared/execute-plan.mjs";
import { compileRegisterPlan, awaitsReadingTurn } from "../register-plan.mjs";
import { PROVIDER_CAPABILITIES } from "../register-capabilities.mjs";
import { marketsFilingScriptOf, requiredScriptsFor, scriptQuestionsByMarket, SCRIPT_NOT_READ_REASON, SCRIPT_ALREADY_ASKED_REASON } from "../registration-scripts.mjs";
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
const compile = (id, jurisdictions, frameMarkets = null, marketList = null) => compileRegisterPlan({ manifest, job: { jobKey: "t", classes: ["9"], jurisdictions },
  capabilities: PROVIDER_CAPABILITIES[id], frameMarkets, marketList });
const axis = (...a) => compile(...a).entries.filter((e) => e.axis === "transliteration-numeric");
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

test("every form is asked or set aside with its reason, on every register, and each script question waits for the reading turn", () => {
  for (const id of Object.keys(PROVIDER_CAPABILITIES)) for (const [j, f] of SHAPES) {
    const plan = compile(id, j, f, { priorities: [], major: ["US", "EU", "CN", "JP", "GB"] });
    const entries = plan.entries.filter((e) => e.axis === "transliteration-numeric");
    const setAside = (plan.scripts_set_aside ?? []).map((x) => x.term);
    assert.deepEqual([...entries.map((e) => e.term), ...setAside].sort(), ON_AXIS, `${id} ${j} / frame ${f}: a form was neither asked nor set aside`);
    for (const x of plan.scripts_set_aside ?? []) assert.ok([SCRIPT_NOT_READ_REASON, SCRIPT_ALREADY_ASKED_REASON].includes(x.reason), `${x.term} was set aside with no reason`);
    for (const e of entries.filter((x) => isNonLatinTerm(x.term)))
      assert.ok(awaitsReadingTurn(e.when) || e.unsupported === true, `${id} ${j}: a script question runs without the reading turn releasing it`);
  }
});

test("a market takes one question per script its buyers read, in its own offices, and the rest are set aside", () => {
  // Japan reads katakana: its own form takes Japan, so the kanji form serves China alone.
  const named = byTerm(axis("corsearch", ["Global"], ["US", "EU", "CN", "JP"]));
  assert.ok(named.get(KATAKANA).regions.includes("JP") && !named.get(KATAKANA).regions.includes("CN"), "the katakana question is not Japan's");
  assert.ok(named.get(HAN).regions.includes("CN") && !named.get(HAN).regions.includes("JP"), "the kanji question is not China's alone");
  assert.equal(named.has(HANGUL), false, "a script no market on the list reads was asked");
  // EU's buyers read Greek and Cyrillic, so an EU matter asks both; the script floor still demands neither.
  const eu = byTerm(axis("corsearch", ["EU"], ["EU"]));
  assert.ok(eu.has(GREEK) && eu.has(CYRILLIC), "an EU matter lost a question in a script its buyers read");
  assert.deepEqual(requiredScriptsFor(["EU"]), {}, "an EU manifest now owes a script form");
  // A market outside the instruction widens nothing: Japan takes its katakana form, and the kanji one has no market.
  const jp = compile("corsearch", ["JP"], ["JP", "CN"]);
  assert.ok(!jp.entries.some((e) => e.term === HAN), "a market outside the instruction was asked");
  assert.deepEqual(jp.scripts_set_aside.find((x) => x.term === HAN)?.reason, SCRIPT_ALREADY_ASKED_REASON);
  // With no frame on record, the one market list decides: the majors include China and Japan.
  const list = byTerm(axis("corsearch", ["Global"], null, { priorities: [], major: ["US", "EU", "CN", "JP", "GB"] }));
  assert.ok(list.has(KATAKANA) && list.has(HAN), "the one market list did not ask its markets' scripts");
});

test("one form per market and script: a second form for the same market is set aside", () => {
  const second = "Велтрис";
  const r = scriptQuestionsByMarket([CYRILLIC, second, HAN], ["RU", "CN"]);
  assert.deepEqual(r.asked.map((q) => [q.value, q.markets]), [[CYRILLIC, ["RU"]], [HAN, ["CN"]]]);
  assert.deepEqual(r.setAside, [{ value: second, reason: SCRIPT_ALREADY_ASKED_REASON }]);
  assert.deepEqual(scriptQuestionsByMarket([CYRILLIC], ["RU"], { taken: ["RU:cyrillic"] }).asked, [], "a market that has its question took another");
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
  assert.ok(src.slice(at, at + 4000).includes("marketList: narrowingMarkets(instructedOrder(ctx.paths, ctx.job), ctx.profile)"),
    "the compile is not given the one market list");
  // The frame is accepted before the plan compiles, or there would be no markets to hand over.
  const frame = src.indexOf('must(await stage("matter-frame", ctx), "matter-frame")');
  const attach = src.indexOf("attachRegisterPlan(ctx);");
  assert.ok(frame > 0 && attach > frame, "the plan compiles before the matter frame is accepted");
});


// The propose tool, driven with the real executor against a stand-in register that records every request.
function seed(t, plan) {
  const run = mkdtempSync(join(tmpdir(), "script-market-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  mkdirSync(driverDir(run), { recursive: true });
  mkdirSync(join(run, "register-units"), { recursive: true });
  writeFileSync(driverDir(run, "register-plan.json"), JSON.stringify({ regions: ["JP", "RU"], nice_classes: ["9"], entries: [
    { qid: "transliteration-numeric:exact:cyr", axis: "transliteration-numeric", predicate: "exact", term: CYRILLIC, provenance: "variant", nice_classes: [9], regions: ["RU"] },
  ], ...plan }));
  const asked = [];
  const answer = (p) => { asked.push({ name: p.name, regions: p.regions ?? null }); return { type: "text", text: JSON.stringify({ state: "enumerated", total_hits: 0, count: 0, records: [] }) }; };
  const real = makeExecutePlan({ search: async (_a, p) => answer(p), enumerate: async (_a, p) => answer(p), capabilities: { id: "a-register-that-reads-every-script", nativeScriptIndex: true } });
  const propose = async (...terms) => JSON.parse((await proposeSupplemental({ axis: "transliteration-numeric", output_path: join(run, "register-units", "transliteration-numeric-band.json"),
    proposals: terms.map((term) => ({ predicate: "exact", term, nice_classes: [9], rationale: "the mark in another script" })) },
    { kind: "propose_supplemental", sessionKey: "run-x" }, { executePlan: (params, tctx) => real("auth", params, tctx) })).text);
  return { asked, propose };
}
const LISTED = { script_markets: ["JP", "RU"], script_questions_asked: ["RU:cyrillic"] };

test("the propose tool asks a worker's script form only for a market on the list that lacks one, in that market's offices", async (t) => {
  const { asked, propose } = seed(t, LISTED);
  const r = await propose(KATAKANA, "Велтрис", HANGUL);
  assert.deepEqual(asked.map((a) => a.regions), [["JP"]], `the register was not asked the katakana form in Japan alone: ${JSON.stringify(asked)}`);
  assert.deepEqual(r.excluded_script, ["Велтрис", HANGUL], "a form for a market that has its question, or for none on the list, was not left out");
  assert.deepEqual(r.rejected, [], "a form the rule leaves out became an open question");
});

test("a script form an earlier call asked keeps its market's place, and proposing it again asks nothing new", async (t) => {
  const { asked, propose } = seed(t, LISTED);
  await propose(KATAKANA);
  assert.equal(asked.length, 1, "guard: the first call asked the katakana form");
  const r = await propose("ベルトリス", KATAKANA);
  assert.deepEqual(r.excluded_script, ["ベルトリス"], "a second katakana form for Japan was not left out");
  assert.equal(asked.length, 1, `the register was asked again: ${JSON.stringify(asked)}`);
});

test("a plan whose manifest has no script form still records its markets, so a worker's script form is held to them", () => {
  const latin = { ...manifest, variants: manifest.variants.filter((v) => !isNonLatinTerm(v.value)) };
  const plan = compileRegisterPlan({ manifest: latin, job: { jobKey: "t", classes: ["9"], jurisdictions: ["JP"] }, capabilities: PROVIDER_CAPABILITIES.corsearch });
  assert.deepEqual([plan.script_markets, plan.script_questions_asked], [["JP"], []]);
});

test("a plan compiled with no market list holds no script proposal back", async (t) => {
  const { asked, propose } = seed(t, {});
  const r = await propose(HANGUL);
  assert.equal(asked.length, 1, "a script proposal was held back with no market list to hold it to");
  assert.equal(r.excluded_script, undefined);
});
