// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// acceptance 1, SECOND BRANCH: a run that cannot name one vendor and one billing mode says so
// plainly, at summary level, rather than leaving a reader to infer it.
//
// The issue was raised by a human reading round 21f9b0ad's receipt and noticing that two of three
// `byBilling` keys differed in their SECOND field. The data was already right; the inference was manual.
// These tests pin the sentence that removes the inference — and, more importantly, pin the three ways
// such a sentence normally goes wrong: it counts something that is not a vendor, it goes quiet when it
// has nothing to say, and it reads as reassuring when it is actually ignorant.
//
// SCOPE: the statement only. Nothing here touches which vendor a lane uses or whether it should — that is
//, owner-parked. Acceptance point 3 is NOT in scope either: it was already satisfied before this
// change, measured on round 21f9b0ad (`status.json.economics.byBilling`, three buckets, jx present with
// vendor+meter+model). This adds the sentence beside that table, not the table.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { billingComposition, vendorOf } from "../run-economics.mjs";

const bucket = (engine, authMode, model, dispatches) => ({ engine, authMode, model, dispatches });

// The real shape, off round 21f9b0ad's own receipt — 29/12/1 dispatches.
const LIVE = {
  "openai-agent|subscription|gpt-5.6-sol": bucket("openai-agent", "subscription", "gpt-5.6-sol", 29),
  "anthropic-direct|api-key|claude-haiku-4-5-20251001": bucket("anthropic-direct", "api-key", "claude-haiku-4-5-20251001", 12),
  "code|not-provider-billed|code:execute-plan": bucket("code", "not-provider-billed", "code:execute-plan", 1),
};

test("#1209 THE CASE THAT RAISED IT: the mixed run says it cannot name one of either", () => {
  const c = billingComposition(LIVE);
  // REMAINDER — VENDORS, NOT ENGINES. This run really is two vendors; what changed is that the
  // field now says who was billed. `engines` keeps what was stamped, so nothing the old assertion
  // proved has been given up.
  assert.deepEqual(c.vendors, ["anthropic", "openai"]);
  assert.deepEqual(c.engines, ["anthropic-direct", "openai-agent"]);
  assert.deepEqual(c.unmappedEngines, []);
  assert.deepEqual(c.billingModes, ["api-key", "subscription"]);
  assert.equal(c.mixedVendors, true);
  assert.equal(c.mixedBillingModes, true);
  assert.match(c.statement, /CANNOT state a single vendor or billing mode/);
  // The consequence must be in the sentence, not left to the reader who already had to infer it once.
  assert.match(c.statement, /anthropic-direct/);
  assert.match(c.statement, /openai-agent/);
});

test("#1209 CODE-SIDE IS NOT A VENDOR — or every run in the product reads as mixed", () => {
  // `code:execute-plan` rides nearly every run. Counting it would make multi-vendor the universal answer
  // and the field worthless — the `web`-channel defect exactly: a member the driver always adds,
  // making every run look anomalous.
  const c = billingComposition(LIVE);
  assert.ok(!c.vendors.includes("code"), "code-side counted as a vendor");
  assert.ok(!c.billingModes.includes("not-provider-billed"), "not-provider-billed counted as a billing mode");
  // Set aside, not silently dropped: the exclusion is reported so a reader can see it happened.
  assert.equal(c.notProviderBilledDispatches, 1);
});

test("#1209 a code-side-ONLY run names no vendor, and does not name 'code' as one", () => {
  const c = billingComposition({ "code|not-provider-billed|code:execute-plan": bucket("code", "not-provider-billed", "code:execute-plan", 3) });
  assert.deepEqual(c.vendors, []);
  assert.match(c.statement, /cannot name a vendor or a billing mode/);
  assert.ok(!/one vendor \(code\)/.test(c.statement), "code-side was promoted to the run's vendor");
});

test("#1209 ONE VENDOR still gets the sentence — an absent field must never read as purity", () => {
  // If this only appeared when mixed, a reader could not tell "single vendor" from "never computed".
  // That is the exact failure mode this issue is about, reintroduced one level up.
  const c = billingComposition({ "openai-agent|subscription|gpt-5.6-sol": bucket("openai-agent", "subscription", "gpt-5.6-sol", 40) });
  assert.equal(c.mixedVendors, false);
  assert.equal(c.mixedBillingModes, false);
  assert.equal(c.basis, "byBilling");
  assert.match(c.statement, /one vendor \(openai\)/);
  assert.match(c.statement, /one billing mode \(subscription\)/);
  assert.ok(c.statement.length > 0, "a single-vendor run said nothing at all");
});

test("#1209 ONE VENDOR, TWO METERS — the case the issue calls out by name", () => {
  // "Anthropic rounds STILL mix billing modes (subscription CLI + API key are the same vendor, different
  // meters)". A vendor-only check would call this run clean, which is the whole point of splitting the
  // two questions.
  const c = billingComposition({
    "anthropic-agent|subscription|claude-sonnet-5": bucket("anthropic-agent", "subscription", "claude-sonnet-5", 30),
    "anthropic-direct|api-key|claude-haiku-4-5-20251001": bucket("anthropic-direct", "api-key", "claude-haiku-4-5-20251001", 11),
  });
  assert.equal(c.mixedBillingModes, true, "two meters on one vendor read as a single billing mode");
  assert.deepEqual(c.billingModes, ["api-key", "subscription"]);
  assert.match(c.statement, /CANNOT state a single vendor or billing mode/);
});

test("#1209 NO TELEMETRY is unknown, never 'one vendor'", () => {
  const c = billingComposition({}, { telemetryPresent: false });
  assert.equal(c.basis, "unknown");
  assert.equal(c.mixedVendors, null, "a missing measurement answered the question as `false`");
  assert.equal(c.mixedBillingModes, null);
  assert.equal(c.complete, false);
  assert.match(c.statement, /no dispatch telemetry/);
});

test("#1209 an EMPTY rollup is unknown too — zero buckets is not a pure run", () => {
  const c = billingComposition({});
  assert.equal(c.basis, "unknown");
  assert.equal(c.mixedVendors, null);
  assert.match(c.statement, /journalled no dispatches/);
});

test("#1209 UNSTAMPED rows are counted apart and never listed as a vendor named 'unknown'", () => {
  const c = billingComposition({
    "openai-agent|subscription|gpt-5.6-sol": bucket("openai-agent", "subscription", "gpt-5.6-sol", 20),
    "unknown|unknown|legacy-alias": bucket("unknown", "unknown", "legacy-alias", 4),
  });
  assert.deepEqual(c.vendors, ["openai"], "'unknown' was listed as if it were a vendor's name");
  assert.deepEqual(c.engines, ["openai-agent"], "'unknown' reached the engine list, which is for STAMPED engines");
  // An UNSTAMPED row and an UNPLACEABLE engine are different failures and must not merge. `unknown` is
  // excluded upstream as unattributed and never reaches the vendor table at all — so it must not turn up
  // here as an engine that bills to nobody, which would double-count the same 4 dispatches.
  assert.deepEqual(c.unmappedEngines, []);
  assert.equal(c.unattributedDispatches, 4);
  assert.equal(c.complete, false, "a partly-attributed composition claimed to be complete");
  assert.match(c.statement, /INCOMPLETE/);
});

test("#1209 a fully attributed run says so — `complete` is not decoration", () => {
  assert.equal(billingComposition(LIVE).complete, true);
  assert.equal(billingComposition(LIVE).unattributedDispatches, 0);
});

test("#1209 SHAPE FUZZ: null and undefined do not throw", () => {
  // `= {}` defaults on undefined and NOT on null. Same finding as 's planVsExecutedChannels, which
  // threw on a null it was documented to accept.
  for (const [a, b] of [[null, null], [undefined, undefined], [null, undefined], [{}, null]]) {
    const c = billingComposition(a, b);
    assert.equal(c.basis, "unknown", `billingComposition(${a}, ${b}) did not degrade to unknown`);
  }
});

test("#1209 the statement is DERIVED — every name in it comes from the buckets it describes", () => {
  // The sentence has no second source, so it cannot drift from the table. Proven by construction rather
  // than asserted in a comment: every vendor and mode named must appear in the input.
  const c = billingComposition(LIVE);
  const engines = new Set(Object.values(LIVE).map((b) => b.engine));
  const modes = new Set(Object.values(LIVE).map((b) => b.authMode));
  // Engines come STRAIGHT from the buckets. Vendors are one derivation away, so the check is that every
  // vendor is the image of an engine that is present — not that a vendor is itself an engine name, which
  // is the confusion 's remainder was.
  for (const e of c.engines) assert.ok(engines.has(e), `statement names an engine absent from byBilling: ${e}`);
  for (const v of c.vendors) assert.ok([...engines].some((e) => vendorOf(e) === v),
    `statement names a vendor no engine in byBilling bills to: ${v}`);
  for (const m of c.billingModes) assert.ok(modes.has(m), `statement names a billing mode absent from byBilling: ${m}`);
  for (const v of c.vendors) assert.match(c.statement, new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("#1209 it reaches the LEAN SUMMARY, which is the surface a reader polls", () => {
  // The acceptance says "at the summary level". _driver/economics.json carrying it is not enough: the
  // summary on status.json is what polled surfaces read, and it is deliberately small, so a field can be
  // correct in the full record and absent where it is looked for.
  const src = readFileSync(new URL("../run-economics.mjs", import.meta.url), "utf8");
  const at = src.indexOf("const summary = {");
  assert.ok(at > 0, "the lean summary moved — this assertion is measuring nothing");
  const block = src.slice(at, src.indexOf("};", at));
  assert.match(block, /billingComposition: econ\.billingComposition/,
    "the composition is computed but never reaches the summary a reader actually polls");
});

// ── REMAINDER — ONE VENDOR, TWO ENGINES ────────────────────────────────────────────────────────

test("#1209 an ALL-ANTHROPIC run states ONE vendor, however many engines it stamped", () => {
  // THE REMAINDER, DIRECTLY. Once the API-key split was fixed, the first jx-bearing run stamped
  // `anthropic-agent` on agentic stages and `anthropic-direct` on the jx lanes — one vendor, two engines
  // — and the receipt counted the LABELS and declared it could not name a vendor. On origin/main this
  // same input returns vendors: ["anthropic-agent", "anthropic-direct"] and mixedVendors: true.
  const c = billingComposition({
    "anthropic-agent|subscription|claude-sonnet-5": bucket("anthropic-agent", "subscription", "claude-sonnet-5", 30),
    "anthropic-direct|subscription|claude-haiku-4-5-20251001": bucket("anthropic-direct", "subscription", "claude-haiku-4-5-20251001", 11),
  });
  assert.deepEqual(c.vendors, ["anthropic"]);
  assert.equal(c.mixedVendors, false, "two engine labels for one vendor still read as a vendor mix");
  assert.match(c.statement, /one vendor \(anthropic\)/);
  // AND THE ENGINE SPLIT IS NOT DESTROYED TO GET THERE. Answering by collapsing the labels would
  // throw away the evidence that raised it.
  assert.deepEqual(c.engines, ["anthropic-agent", "anthropic-direct"]);
  assert.match(c.statement, /2 engines \(anthropic-agent, anthropic-direct\)/);
});

test("#1209 the two meters still separate under one vendor — mixedBillingModes is untouched", () => {
  // The issue's own words: "subscription CLI + API key are the same vendor, different meters". Making
  // the vendor claim true must not make the billing claim false, and this is the arm that would catch a
  // fix that quietened both.
  const c = billingComposition({
    "anthropic-agent|subscription|claude-sonnet-5": bucket("anthropic-agent", "subscription", "claude-sonnet-5", 30),
    "anthropic-direct|api-key|claude-haiku-4-5-20251001": bucket("anthropic-direct", "api-key", "claude-haiku-4-5-20251001", 11),
  });
  assert.deepEqual(c.vendors, ["anthropic"]);
  assert.equal(c.mixedVendors, false);
  assert.equal(c.mixedBillingModes, true, "one vendor on two meters stopped being flagged");
  assert.match(c.statement, /CANNOT state a single vendor or billing mode/);
});

test("#1209 an engine the table cannot place is NAMED and blocks the single-vendor claim", () => {
  // The safe direction. A future engine that nobody adds a row for must not be quietly folded into
  // whichever vendor it superficially resembles, and must not be silently dropped either — a vendor
  // claim covering two thirds of the spend is worse than no claim.
  const c = billingComposition({
    "anthropic-agent|subscription|claude-sonnet-5": bucket("anthropic-agent", "subscription", "claude-sonnet-5", 30),
    "mistral-direct|api-key|whatever": bucket("mistral-direct", "api-key", "whatever", 5),
  });
  assert.deepEqual(c.vendors, ["anthropic"]);
  assert.deepEqual(c.unmappedEngines, ["mistral-direct"]);
  assert.equal(c.mixedVendors, true, "an unplaceable engine let a single-vendor claim stand");
  assert.match(c.statement, /bill to no vendor this build can name \(mistral-direct\)/);
  assert.match(c.statement, /NOT the whole run/);
});

test("#1209 every engine the tree stamps has a vendor row", () => {
  // The table is closed, so its completeness is the thing that decides whether `unmappedEngines` is a
  // real signal or a permanent nag. Checked against the engines the code actually writes.
  for (const e of ["anthropic-agent", "anthropic-direct", "anthropic-completions", "openai-agent"])
    assert.ok(vendorOf(e), `${e} is stamped by the driver and bills to no vendor this table names`);
  assert.equal(vendorOf("code"), null, "code-side must not resolve to a vendor — it is excluded upstream");
  assert.equal(vendorOf("unknown"), null, "'unknown' must never resolve to a vendor's name");
});
