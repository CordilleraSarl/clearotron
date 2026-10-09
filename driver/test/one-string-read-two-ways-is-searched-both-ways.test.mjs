// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ONE STRING READ TWO WAYS IS SEARCHED BOTH WAYS.
//
// The same Han characters have a Chinese reading and a Japanese one, and the variant manifest lists the
// string once per reading. The plan compiler took two romanisations of one string for the model
// contradicting itself and compiled the string with neither. A register that files non-Latin marks by their
// romanised form then refused the bare characters, and the client read the slice as "not searched" although
// both readings could be searched. Every reading now rides the entry, and the register answers it in the one
// request the entry already made.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileRegisterPlan } from "../register-plan.mjs";
import { PROVIDER_CAPABILITIES } from "../register-capabilities.mjs";
import { queryMarkTerms } from "../../providers/_shared/execute-plan.mjs";
import { nativeScriptIndexGap } from "../../providers/_shared/script-form.mjs";
import { substituteRomanizedNames } from "../../providers/clarivate/src/core.js";

const HAN = "山川";
const manifestWith = (variants) => ({
  schema_version: 1, mark: "TORVANE", dominant_element: "TORVANE", elements: [{ value: "TORVANE", kind: "distinctive" }],
  variants: [{ value: "TORVANE", category: "core" }, ...variants],
  incumbent_classes: [], goods_words: ["software"],
});
const hanEntries = (variants) => compileRegisterPlan({
  manifest: manifestWith(variants), job: { jobKey: "t", classes: ["9"], jurisdictions: ["Global"] },
  capabilities: PROVIDER_CAPABILITIES.clarivate, frameMarkets: ["CN", "JP"],
}).entries.filter((e) => e.term === HAN);
const TWO_READINGS = [
  { value: HAN, category: "transliteration", romanization: "SHAN CHUAN" },
  { value: HAN, category: "transliteration", romanization: "YAMA KAWA" },
];

test("two readings of one string ride every entry for it, each spelled both ways", () => {
  const entries = hanEntries(TWO_READINGS);
  assert.ok(entries.length >= 1, "the string was not compiled at all");
  for (const e of entries)
    assert.deepEqual(e.romanizedTerms, ["SHAN CHUAN", "SHANCHUAN", "YAMA KAWA", "YAMAKAWA"], `${e.qid} does not carry both readings`);
});

test("one reading listed twice, in another case, stays one reading", () => {
  const entries = hanEntries([
    { value: HAN, category: "transliteration", romanization: "SHAN CHUAN" },
    { value: HAN, category: "transliteration", romanization: "Shan Chuan" },
  ]);
  assert.ok(entries.length >= 1, "the string was not compiled at all");
  for (const e of entries) assert.deepEqual(e.romanizedTerms, ["SHAN CHUAN", "SHANCHUAN"], `${e.qid} doubled a reading`);
});

test("a register that files the romanised form answers the entry, in one request, instead of refusing it", () => {
  const capabilities = PROVIDER_CAPABILITIES.clarivate;
  assert.equal(capabilities.nativeScriptIndex, false, "the fixture register no longer declares romanised filing");
  const [e] = hanEntries(TWO_READINGS);
  const query = substituteRomanizedNames(e, {}, null);
  assert.equal(nativeScriptIndexGap(capabilities, queryMarkTerms(e, query)), null, "the register still refuses the entry");
  assert.deepEqual(query.names, e.romanizedTerms, "the one request does not ask every reading");
  // The control: with no reading carried, the same characters are refused. That rule stays.
  const { romanizedTerms: _dropped, ...bare } = e;
  assert.ok(nativeScriptIndexGap(capabilities, queryMarkTerms(bare, substituteRomanizedNames(bare, {}, null))),
    "bare characters are no longer refused");
});
