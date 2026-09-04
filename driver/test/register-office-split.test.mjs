// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — DEPTH 2 SPLITS OFF A REGISTER IT CANNOT REACH, RUNS THE REST, AND SAYS SO ON THE PAGE.
//
// built the split and applied it at plan compile. Depth 2's count and record lanes compile no
// plan: they resolved regions against the FULL declared coverage and handed them to the adapter, which
// on a composite fans out to every member. The unconfigured one refuses, the composite correctly
// declines to return a partial sum, and a box with a working EU half reported every count as
// unavailable. 's own acceptance — "free-tier starts and ships a disclosed US deferral" — was met
// on the plan lane and never on these two, which is what observed.
//
// THE TWO HALVES ONLY MAKE SENSE TOGETHER, so they are asserted together throughout:
//   1. the unreachable office is not asked, so the reachable half produces real figures;
//   2. the rendered line says which register was not searched.
// Narrowing alone is WORSE than the refusal it replaces — a confident number, smaller than the truth,
// reading as though it covered everything ordered. Half of this file exists to fail if half ships.
//
// The sidecar fields are checked too, but never on their own: `scope.deferredJurisdictions` has been
// written by both lanes since they were built and nothing reads it, which is exactly how 's
// `deferred_coverage` shipped a false clean. A field is not a disclosure.

import { test } from "node:test";
import assert from "node:assert/strict";

import { reachableRegions, unavailableOffices } from "../register-availability.mjs";
import { countPreflight, countRegisterHits, countLine } from "../register-count.mjs";
import { listRegisterRecords, recordsLine } from "../register-records.mjs";

// The free tier's shape, as capabilities.js composes it: covers EU+US, no regionsRequired.
const FREE_TIER = {
  id: "free-tier",
  label: "Free tier (EUIPO + USPTO local index)",
  countProbe: "cheap",
  composedOf: ["euipo", "uspto-local"],
  offices: { covered: ["EU", "US"], vocabulary: "iso-3166-plus-eu" },
};

/** What register-unreachable.mjs returns on a box with EUIPO wired and no US index. */
const NO_US = [{ office: "US", memberId: "uspto-local", missing: ["USPTO_LOCAL_DB"] }];

// ── the pure narrowing ──────────────────────────────────────────────────────────────────────────────

test("#790 an ordered EU+US scope narrows to the offices this box can reach", () => {
  const { regions, dropped } = reachableRegions(["EU", "US"], NO_US, FREE_TIER.offices.covered, false);
  assert.deepEqual(regions, ["EU"]);
  assert.deepEqual(dropped.map((d) => d.office), ["US"]);
  assert.deepEqual(dropped[0].missing, ["USPTO_LOCAL_DB"], "the variable rides the drop, for the message");
});

// THE CASE A FILTER GETS WRONG. resolveRegions yields [] for a worldwide matter, and [] does NOT mean
// "no offices" downstream — free-tier's routeRegions reads it as UNRESTRICTED and hands the call to
// every member, the unconfigured one included. So filtering [] yields [] and fixes nothing. The
// reachable list has to be SUBSTITUTED. Without this test the fix passes on the EU+US case and the
// worldwide case still dies exactly as reported.
test("#790 a worldwide scope substitutes the reachable offices — an empty region filter is not an empty scope", () => {
  const { regions, dropped } = reachableRegions([], NO_US, FREE_TIER.offices.covered, true);
  assert.deepEqual(regions, ["EU"], "[] would route to every member, including the one that is not wired");
  assert.deepEqual(dropped.map((d) => d.office), ["US"]);
});

// THE OTHER MEANING OF `regions: []`, and the one that produces a FALSE SENTENCE if it is folded into
// the case above. resolveRegions returns [] both for "unrestricted" and for "every named territory
// fell outside this provider's coverage" — a JP-only matter on the free tier. Substituting the covered
// list there counts a Japanese matter over the EU and tells the client its US coverage is incomplete:
// two registers they never ordered, one of them dressed as a gap in their search.
test("#790 an entirely UNCOVERED scope is not treated as worldwide, and yields no office gap", () => {
  const { regions, dropped } = reachableRegions([], NO_US, FREE_TIER.offices.covered, false);
  assert.deepEqual(regions, [], "the EU was never ordered — it must not be substituted in");
  assert.deepEqual(dropped, [], "and the US is not a gap in a matter that named Japan");
});

test("#790 nothing unreachable is byte-identical in and out, for every single-source provider", () => {
  for (const input of [["EU", "US"], [], ["JP"]]) {
    for (const worldwide of [true, false]) {
      const { regions, dropped } = reachableRegions(input, [], ["EU", "US"], worldwide);
      assert.deepEqual(regions, input);
      assert.deepEqual(dropped, []);
    }
  }
});

test("#790 dropped names only the offices this scope asked for", () => {
  // Ordered EU only, on a box missing the US. The US is unreachable and IRRELEVANT — disclosing it
  // would tell a client their EU-only search has a US gap, which is not a fact about their matter.
  const { regions, dropped } = reachableRegions(["EU"], NO_US, FREE_TIER.offices.covered, false);
  assert.deepEqual(regions, ["EU"]);
  assert.deepEqual(dropped, [], "an office outside the ordered scope is not a gap in it");
});

// ── the boundary: empty coverage refuses BEFORE spend ───────────────────────────────────────────────

test("#790 a US-only matter on a box with no US index refuses by name, before spend", () => {
  const refusal = countPreflight({
    capabilities: FREE_TIER, jurisdictions: ["US"], unreachable: NO_US,
  });
  assert.ok(refusal, "nothing is left to count in — this must not start");
  assert.match(refusal, /USPTO_LOCAL_DB/, "name the variable, not 'the free tier is misconfigured' (#660)");
  assert.match(refusal, /uspto-local/, "and the member that serves it");
  assert.doesNotMatch(refusal, /\bEU\b/, "the EU is not part of this refusal — it was never ordered");
});

test("#790 a partial scope does NOT refuse — that is the whole ruling", () => {
  assert.equal(countPreflight({ capabilities: FREE_TIER, jurisdictions: ["EU", "US"], unreachable: NO_US }), null);
  assert.equal(countPreflight({ capabilities: FREE_TIER, jurisdictions: null, unreachable: NO_US }), null,
    "worldwide on a half-wired free tier runs over the half it has");
});

test("#790 a fully wired box reaches the same preflight verdict as before the split existed", () => {
  for (const j of [["US"], ["EU", "US"], null]) {
    assert.equal(countPreflight({ capabilities: FREE_TIER, jurisdictions: j, unreachable: [] }), null);
  }
});

// The JP case through the real preflight. `reachable` is empty here too — but for the OTHER reason,
// and the refusal above must not fire, because naming USPTO_LOCAL_DB at someone who ordered Japan
// sends them to fix a variable that would not have helped.
test("#790 an entirely uncovered scope does not trigger the unreachable-office refusal", () => {
  const refusal = countPreflight({ capabilities: FREE_TIER, jurisdictions: ["JP"], unreachable: NO_US });
  // landed the other half: this scope IS now refused, by the COVERAGE arm. The assertion that
  // matters is unchanged and is the whole reason this test exists — WHICH fact the operator is handed.
  // Naming USPTO_LOCAL_DB at someone who ordered Japan sends them to fix a variable that would not have
  // helped, and is the report of exactly that mistake.
  assert.ok(refusal, "an entirely uncovered scope refuses before spend (#821)");
  assert.match(refusal, /which free-tier does not cover/, "the coverage fact");
  assert.doesNotMatch(refusal, /USPTO_LOCAL_DB|not searched on this system|unreachable/,
    "JP is uncovered, not unreachable — a different fact with a different remedy");
});

test("#790 a JP-only matter is never counted over the EU, and is never told its US coverage is short", async () => {
  const seen = [];
  const doc = await countRegisterHits({
    marks: [{ name: "IRONWHISK" }], classes: [9], jurisdictions: ["JP"],
    provider: "free-tier", capabilities: FREE_TIER,
    counter: async (_t, _p, { regions }) => { seen.push(regions); return { ok: true, total: 3 }; },
    unreachable: NO_US, variantCap: 2,
  });
  for (const regions of seen) assert.deepEqual(regions, [], "substituting the covered list here searches territories nobody ordered");
  assert.equal(doc.marks[0].officeScope, undefined);
  assert.equal(doc.scope.unreachableOffices, undefined);
  assert.doesNotMatch(countLine(doc.marks[0]), /US/, "a US gap is not a fact about a Japanese matter");
});

// ── the count lane: the reachable half runs, the rest is disclosed ──────────────────────────────────

/** A counter that RECORDS what it was asked, and refuses if the US is in the regions — the way the
 *  real composite does when uspto-local is not wired. A stub that quietly succeeded would let the
 *  narrowing regress without a test noticing. */
function watchfulCounter(seen) {
  return async (_term, _predicate, { regions }) => {
    seen.push(regions);
    if ((regions ?? []).includes("US")) {
      return { ok: false, total: null,
        reason: "the uspto-local member could not count, so the free tier's total over EU+US is UNKNOWN — not the partial sum of the sources that did answer." };
    }
    return { ok: true, total: 7 };
  };
}

test("#790 the count lane no longer asks for the register it cannot reach, so the EU half produces figures", async () => {
  const seen = [];
  const doc = await countRegisterHits({
    marks: [{ name: "IRONWHISK" }], classes: [9], jurisdictions: ["EU", "US"],
    provider: "free-tier", capabilities: FREE_TIER, counter: watchfulCounter(seen),
    unreachable: NO_US, variantCap: 2,
  });

  assert.ok(seen.length, "the counter was called at all");
  for (const regions of seen) assert.ok(!regions.includes("US"), `US was still asked for: ${JSON.stringify(regions)}`);

  const identical = doc.marks[0].counts.identical;
  assert.equal(identical.total, 7, "before this fix every cell was unavailable on this exact configuration");
});

test("#790 the figures carry the register they cover, and the rendered line says which was not searched", async () => {
  const doc = await countRegisterHits({
    marks: [{ name: "IRONWHISK" }], classes: [9], jurisdictions: ["EU", "US"],
    provider: "free-tier", capabilities: FREE_TIER, counter: watchfulCounter([]),
    unreachable: NO_US, variantCap: 2,
  });

  assert.deepEqual(doc.marks[0].officeScope.counted, ["EU"]);
  assert.deepEqual(doc.marks[0].officeScope.uncounted.map((u) => u.office), ["US"]);
  assert.deepEqual(doc.scope.unreachableOffices.map((u) => u.office), ["US"]);

  // THE HALF THAT MAKES THE OTHER HALF HONEST. Without this line the report shows a real number over a
  // silently narrowed scope, which is a worse answer than the refusal this replaced.
  const line = countLine(doc.marks[0]);
  assert.match(line, /Counted in EU only/);
  assert.match(line, /US is covered by this register but was not searched/);
  assert.match(line, /never a finding of none/, "it must not read as an absence of filings");
  assert.doesNotMatch(line, /USPTO_LOCAL_DB/, "an env var name is for the operator, not the client's report");
});

test("#790 a fully wired count renders exactly the line it rendered before", async () => {
  const doc = await countRegisterHits({
    marks: [{ name: "IRONWHISK" }], classes: [9], jurisdictions: ["EU", "US"],
    provider: "free-tier", capabilities: FREE_TIER, counter: async () => ({ ok: true, total: 7 }),
    unreachable: [], variantCap: 2,
  });
  assert.equal(doc.marks[0].officeScope, undefined, "absent, not an empty object — an archived doc must render identically");
  assert.equal(doc.scope.unreachableOffices, undefined);
  assert.doesNotMatch(countLine(doc.marks[0]), /was not searched/);
});

// ── the record lane: the same defect, the same fix ──────────────────────────────────────────────────

test("#790 the record lane narrows too, and its empty listing is not reported as a clean negative", async () => {
  const seen = [];
  const doc = await listRegisterRecords({
    marks: [{ name: "IRONWHISK" }], classes: [9], jurisdictions: ["EU", "US"],
    provider: "free-tier", capabilities: FREE_TIER,
    lister: async (_term, { regions }) => {
      seen.push(regions);
      return { ok: true, records: [], total: 0 };
    },
    unreachable: NO_US, variantCap: 2,
  });

  for (const regions of seen) assert.ok(!regions.includes("US"), `US was still asked for: ${JSON.stringify(regions)}`);
  assert.deepEqual(doc.scope.unreachableOffices.map((u) => u.office), ["US"]);

  // The dangerous sentence. "the register returned none under the name or any close variation of it"
  // over a scope narrowed to EU is a false clean, and it is the branch a narrowing fix forgets.
  const line = recordsLine(doc.marks[0]);
  assert.match(line, /US is covered by this register but was not searched/);
  assert.match(line, /EU/, "and it says which register the 'none' actually covers");
});

test("#790 a fully wired listing renders exactly the line it rendered before", async () => {
  const doc = await listRegisterRecords({
    marks: [{ name: "IRONWHISK" }], classes: [9], jurisdictions: ["EU", "US"],
    provider: "free-tier", capabilities: FREE_TIER,
    lister: async () => ({ ok: true, records: [], total: 0 }),
    unreachable: [], variantCap: 2,
  });
  assert.equal(doc.marks[0].officeScope, undefined);
  assert.doesNotMatch(recordsLine(doc.marks[0]), /was not searched/);
});

// ── the binding stays single ────────────────────────────────────────────────────────────────────────

test("#790 there is exactly one binding of the office split to the environment", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { join, dirname } = await import("node:path");
  const driver = dirname(dirname(fileURLToPath(import.meta.url)));
  // `unavailableOffices` is the pure function; anything calling it has to supply `requirementsFor`,
  // and THAT is the environment binding. Two of them is how a planner and a preflight come to disagree
  // about which variable matters — the half-check defect and both had to fix, and the reason
  // this was extracted rather than copied.
  //
  // MATCHES THE BINDING'S SYNTAX, NOT THE WORD. The first cut of this test searched for the bare name
  // and failed on a COMMENT in register-count.mjs explaining why the lookup is injected — the same
  // "mentioned is not used" defect hit, where naming a variable in prose marked it documented.
  // Comment lines are stripped and the property form `requirementsFor:` is what counts, because that
  // is what an actual injection looks like and a sentence about one does not.
  const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/;
  const binds = (src) => src.split("\n").filter((l) => !COMMENT_LINE.test(l)).join("\n").includes("requirementsFor:");
  const callers = ["pipeline.mjs", "pipeline-knockout.mjs", "register-unreachable.mjs", "register-count.mjs", "register-records.mjs"]
    .filter((f) => binds(readFileSync(join(driver, f), "utf8")));
  assert.deepEqual(callers, ["register-unreachable.mjs"],
    `the member→variable lookup must live in one file, found in: ${callers.join(", ")}`);
});

test("#790 unavailableOffices and reachableRegions agree on the same box", () => {
  // End to end over the two pure functions, with the member→variable lookup the real binding injects.
  const unavailable = unavailableOffices(FREE_TIER, {
    requirementsFor: (id) => (id === "uspto-local"
      ? { offices: ["US"], missing: ["USPTO_LOCAL_DB"] }
      : { offices: ["EU"], missing: [] }),
  });
  assert.deepEqual(unavailable, NO_US);
  assert.deepEqual(reachableRegions(["EU", "US"], unavailable, FREE_TIER.offices.covered, false).regions, ["EU"]);
});
