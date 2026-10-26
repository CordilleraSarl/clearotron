// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN OWNER QUESTION LEAVES ROOM FOR THE REST OF THE REQUEST.
//
// An owner is widened by the register's own spellings of the company, up to the width the parser's nesting cap
// allows. That width was spent on the owner value alone, but the cap counts every OR operand in the request: on a
// test run of a crowded matter an owner question on a mark in four classes was refused 60 times with "Document
// nesting depth (501) exceeds the maximum allowed (500)", which is the 496 owner spellings plus the mark's one term and
// the four classes. The spellings now take only the width the other fields leave, and the least likely ones give way.
//
// Driven through the real enumerate arm with the network stubbed, so the request asserted is the request a run sends.
// Every mark and owner is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as core from "../src/core.js";
import { CAPABILITIES } from "../src/capabilities.js";

const { doEnumerate, OWNER_FIELD } = core;
const otherOrOperands = (p) => (typeof core.otherOrOperands === "function" ? core.otherOrOperands(p) : Number.NaN);
const operandsOf = (body) => (body.searchFields ?? []).reduce((n, f) => n + String(f?.value ?? "").split(" OR ").filter(Boolean).length, 0);

// A register that resolves the owner to 600 spellings and counts 0 for every question; each count request is kept.
async function withRegister(fn) {
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    const reply = (status, answer) => new Response(JSON.stringify(answer), { status, headers: { "content-type": "application/json" } });
    if (String(url).endsWith("/resolution/company"))
      return reply(200, { companies: Array.from({ length: 600 }, (_, i) => ({ applicantName: `OSTRAVEL QUINE HOLDING ${i + 1}`, registrationOfficeCode: "US", confidenceScore: 90 })) });
    if (String(url).endsWith("/count")) asked.push(body);
    return reply(200, { counts: Object.fromEntries((body.registrationOfficeCodes ?? []).map((o) => [o, 0])), ids: {}, totalResults: 0 });
  };
  try { return { out: await fn(), asked }; } finally { globalThis.fetch = real; }
}

test("the request's other fields are counted as the request builder joins them", () => {
  assert.equal(otherOrOperands({ names: ["QZORVA"], nice_classes: [9, 38, 41, 42] }), 5);
  assert.equal(otherOrOperands({ owner: "Ostravel Quine" }), 0, "a bare owner question has nothing else beside it");
  assert.equal(otherOrOperands({ names: ["QZORVA", "QZORVEK"], nice_classes: [9, 9], goods_text: ["computer game software"] }), 4);
});

test("an owner question on a mark in four classes fits the nesting cap, and the owner keeps the rest of the width", async () => {
  const { out, asked } = await withRegister(() => doEnumerate("k", "https://x",
    { names: ["QZORVA"], owner: "Ostravel Quine Holding", nice_classes: [9, 38, 41, 42], regions: ["US"], match_mode: "exact" }, null));
  assert.ok(asked.length > 0, "guard: no count request was sent, so this proves nothing");
  for (const body of asked) assert.ok(operandsOf(body) <= CAPABILITIES.maxOrWidth, `a request carries ${operandsOf(body)} OR operands, past the width the cap allows`);
  const owner = (asked[0].searchFields ?? []).find((f) => f?.name === OWNER_FIELD);
  assert.equal(String(owner?.value ?? "").split(" OR ").length, CAPABILITIES.maxOrWidth - 5, "the owner did not keep the width the other fields leave");
  assert.equal(JSON.parse(out.text).state, "enumerated");
});

test("a bare owner question still takes the whole width", async () => {
  const { asked } = await withRegister(() => doEnumerate("k", "https://x", { owner: "Ostravel Quine Holding", regions: ["US"] }, null));
  const owner = (asked[0].searchFields ?? []).find((f) => f?.name === OWNER_FIELD);
  assert.equal(String(owner?.value ?? "").split(" OR ").length, CAPABILITIES.maxOrWidth);
});
