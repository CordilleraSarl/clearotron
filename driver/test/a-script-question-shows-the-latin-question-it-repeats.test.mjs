// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A SCRIPT QUESTION SHOWS THE LATIN QUESTION IT REPEATS. The unit manual tells the reading turn: "Where the
// register files foreign marks by their romanised form, and it says so, the Latin question already covers
// them; do not ask it again in other scripts." The turn could not follow it. It saw its own axis only, and
// each script question as its characters, while the register searched the romanised spellings, one of
// them a Latin question on another axis. On a test run, 2026-09-25, it released 4 such repeats.
//
// The dispatch now shows, on a register that declares romanised filing, the romanised form each script
// question is searched by and every Latin question in the plan that asks it. It decides nothing: the turn
// still releases or withholds each one with its reason. On a register that indexes the characters, or
// declares nothing, the dispatch is unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileRegisterPlan, latinQuestionsOfRomanisedForm } from "../register-plan.mjs";
import { PROVIDER_CAPABILITIES } from "../register-capabilities.mjs";
import { STAGES } from "../stages.mjs";

const CYRILLIC = "Талворин", KATAKANA = "タルヴォリン";
const manifest = {
  schema_version: 1, mark: "TALVORIN", dominant_element: "TALVORIN", elements: [{ value: "TALVORIN", kind: "distinctive" }],
  variants: [{ value: "TALVORIN", category: "core" },
    // Its romanised form is the mark itself: on a register that files the romanised form, the Latin question again.
    { value: CYRILLIC, category: "transliteration", romanization: "TALVORIN" },
    // Its romanised form is a reading no Latin question asks.
    { value: KATAKANA, category: "transliteration", romanization: "TARUVORIN" }],
  incumbent_classes: [], goods_words: ["software"],
};
const planOn = (id) => compileRegisterPlan({ manifest, job: { jobKey: "t", classes: ["9"], jurisdictions: ["RU", "JP"] },
  capabilities: PROVIDER_CAPABILITIES[id], frameMarkets: ["RU", "JP"] });
const P = { variantManifest: "vm.json", matterContext: "mc.md", registerBand: (a) => `band-${a}.json`, registerUnit: (a) => `unit-${a}.md`, registerPlan: "plan.json" };
const dispatch = (plan, capabilities) => STAGES["register-unit"].message({ paths: P, axis: "transliteration-numeric", job: { classes: [9] }, registerPlan: plan, capabilities });
const lineOf = (message, qid) => message.split("\n").find((l) => l.startsWith(`- qid "${qid}":`)) ?? "";
const HEADER = "This register files foreign marks by their romanised form, and says so: a question below in another script is searched by the romanised form shown on it.";

test("on a register that files the romanised form, a script question shows its romanised form and the Latin question that asks it", () => {
  assert.equal(PROVIDER_CAPABILITIES.clarivate.nativeScriptIndex, false, "the fixture register no longer declares romanised filing");
  const plan = planOn("clarivate");
  const cyrillic = plan.entries.find((e) => e.term === CYRILLIC), katakana = plan.entries.find((e) => e.term === KATAKANA);
  const identical = plan.entries.find((e) => e.provenance === "mark" && e.term === "TALVORIN" && e.predicate === "exact");
  assert.ok(cyrillic && katakana && identical, "guard: the plan compiled both script questions and the identical question");
  assert.equal(cyrillic.axis, "transliteration-numeric");
  assert.notEqual(identical.axis, cyrillic.axis, "guard: the Latin question sits on another axis, out of the turn's own list");

  const message = dispatch(plan, PROVIDER_CAPABILITIES.clarivate);
  assert.ok(message.includes(HEADER), "the turn is not told the register files foreign marks by their romanised form");
  const repeat = lineOf(message, cyrillic.qid);
  assert.ok(repeat.includes(` · searched here by its romanised form ["TALVORIN"]`), `the romanised form is missing: ${repeat}`);
  assert.ok(repeat.includes(`; the Latin question qid "${identical.qid}" asks exact "TALVORIN"`), `the Latin question it repeats is not named: ${repeat}`);
  assert.ok(repeat.includes("WAITING FOR YOU"), "the script question no longer waits for the turn: the dispatch must not decide it");
  // A reading no Latin question asks is shown as searched, and named against nothing.
  const fresh = lineOf(message, katakana.qid);
  assert.ok(fresh.includes(` · searched here by its romanised form ["TARUVORIN"]`), `the romanised form is missing: ${fresh}`);
  assert.doesNotMatch(fresh, /the Latin question qid/, "a script question no Latin question asks was named against one");
  // Every Latin question named is a real plan entry that asks the romanised form.
  for (const y of latinQuestionsOfRomanisedForm(plan, cyrillic)) {
    const e = plan.entries.find((x) => x.qid === y.qid);
    assert.ok(e && e.term === "TALVORIN" && e.expected_kind === "enumerate", `named a question that does not ask the form: ${y.qid}`);
  }
});

test("on a register that indexes the characters, or declares nothing, the dispatch is unchanged", () => {
  for (const id of Object.keys(PROVIDER_CAPABILITIES).filter((p) => PROVIDER_CAPABILITIES[p].nativeScriptIndex !== false)) {
    const plan = planOn(id);
    const message = dispatch(plan, PROVIDER_CAPABILITIES[id]);
    assert.equal(message, dispatch(plan, null), `${id}: the dispatch changed on a register that does not file the romanised form`);
    assert.ok(!message.includes(HEADER) && !message.includes("searched here by its romanised form"), `${id}: a romanised form was shown`);
  }
});

test("only a plain listing question counts as the Latin question", () => {
  const script = { qid: "t:exact:s", axis: "transliteration-numeric", predicate: "exact", term: CYRILLIC, romanizedTerms: ["TAL VORIN", "TALVORIN"], expected_kind: "enumerate" };
  const plain = { qid: "p:default:a", axis: "primary-sweep", predicate: "default", term: "Talvorin", expected_kind: "enumerate" };
  const stacked = { qid: "p:exact:b", axis: "primary-sweep", predicate: "exact", terms: ["ORVANEL", "TAL-VORIN"], expected_kind: "enumerate" };
  const narrower = [
    { qid: "p:exact:owner", axis: "incumbent-class", predicate: "exact", term: "TALVORIN", owner: "An Owner Ltd", expected_kind: "enumerate" },
    { qid: "p:contains:goods", axis: "primary-sweep", predicate: "contains", term: "TALVORIN", goods_text: ["software"], expected_kind: "enumerate" },
    { qid: "s:exact:count", axis: "saturation-probe", predicate: "exact", term: "TALVORIN", expected_kind: "count" },
    { qid: "p:exact:unsupported", axis: "primary-sweep", predicate: "exact", term: "TALVORIN", unsupported: true, expected_kind: "enumerate" },
    { qid: "t:exact:other", axis: "transliteration-numeric", predicate: "exact", term: "Талворін", romanizedTerms: ["TALVORIN"], expected_kind: "enumerate" },
  ];
  const plan = { entries: [script, plain, stacked, ...narrower] };
  assert.deepEqual(latinQuestionsOfRomanisedForm(plan, script), [
    { qid: plain.qid, predicate: "default", term: "Talvorin" },
    { qid: stacked.qid, predicate: "exact", term: "TAL-VORIN" },
  ]);
  // A Latin entry, or one with no romanised form, has no Latin question to repeat.
  assert.deepEqual(latinQuestionsOfRomanisedForm(plan, plain), []);
  assert.deepEqual(latinQuestionsOfRomanisedForm(plan, { ...script, romanizedTerms: [] }), []);
});
