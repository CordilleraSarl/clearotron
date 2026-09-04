// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// deferred-coverage-surface.test.mjs —. Territories the matter ordered that the register does not
// cover reach a surface a reader sees.
//
// Both Depth 2 lanes have written `scope.deferredJurisdictions` since they were built and
// `git grep -n deferredJurisdictions origin/main` found two writes and NO reads. A client whose matter
// named Japan on a provider with no Japanese coverage got counts over the territories that ARE covered,
// with nothing on any rendered surface saying Japan was not among them.
//
// That is 's defect exactly — `deferred_coverage` rode the plan, the field existed, and nothing a
// reader sees read it, so the run shipped an EU-only clean with no row saying the US register was never
// searched. The correction comment in register-availability.mjs says so in those words, and the same
// sentence was true of this field until now.
//
// ── THE TWO FACTS THAT MUST NEVER FUSE ──────────────────────────────────────────────────────────────
//
//   deferredScope     the provider does not cover this territory AT ALL          (, here)
//   officeScope       the provider covers it and this DEPLOYMENT cannot reach it
//
// Different remedies — "switch provider" against "configure the member" — so an operator handed the
// wrong one goes looking for a fault that is not there. is the report of exactly that, which is
// why deliberately did not fold the two together and why this does not either.
import { test } from "node:test";
import assert from "node:assert/strict";

import { countLine, countPreflight } from "../register-count.mjs";
import { recordsLine } from "../register-records.mjs";

const entry = (extra = {}) => ({
  name: "KURENA", classes: [9], classScope: "mark",
  counts: { identical: { total: 3 }, containing: { total: 41 } },
  ...extra,
});

// ── the disclosure ───────────────────────────────────────────────────────────────────────────────────

test("#821 countLine names an ordered territory the register does not cover", () => {
  const line = countLine(entry({ deferredScope: ["JP"] }));
  assert.match(line, /JP was ordered for this matter/);
  assert.match(line, /outside this register's coverage entirely/);
  assert.match(line, /not counted/);
  // The remedy, because a disclosure a reader cannot act on is half a disclosure.
  assert.match(line, /needs a register that covers it/);
});

test("#821 the figures are still stated — this is a qualification, not a replacement", () => {
  const line = countLine(entry({ deferredScope: ["JP", "KR"] }));
  assert.match(line, /3 identical/, "the count the run DID take is still the headline");
  assert.match(line, /JP, KR were ordered/);
  assert.match(line, /they were not counted/);
});

test("#821 a run whose scope is fully covered says nothing extra — byte-identical to before", () => {
  const before = countLine(entry());
  assert.doesNotMatch(before, /ordered for this matter/);
  assert.equal(before, countLine(entry({ deferredScope: [] })), "an empty list is not a disclosure");
});

test("#821 the two gaps are separate sentences, and both appear when both are true", () => {
  const line = countLine(entry({
    deferredScope: ["JP"],
    officeScope: { counted: ["EU"], uncounted: [{ office: "US", why: "unconfigured" }] },
  }));
  assert.match(line, /US is covered by this register but was not searched on this system/, "#790's fact");
  assert.match(line, /JP was ordered for this matter and is outside this register's coverage/, "#821's fact");
  // The failure this guards is a future edit merging them into one "territories not covered" sentence,
  // which would send an operator to reconfigure a member for a territory no provider here covers.
  assert.ok(line.indexOf("not searched on this system") < line.indexOf("outside this register's coverage"),
    "the box gap and the coverage gap are distinct claims and must remain distinct sentences");
});

test("#821 recordsLine carries it on the EMPTY branch, where a clean negative is most dangerous", () => {
  const line = recordsLine({ name: "KURENA", terms: [{ term: "KURENA", ok: true }], records: [], deferredScope: ["JP"] });
  assert.match(line, /the register returned none/, "the sentence that reads as a clean sweep");
  assert.match(line, /JP was ordered for this matter/, "…now qualified by what was never searched");
  assert.match(line, /no filing from it could appear here whatever the register holds/);
});

test("#821 recordsLine carries it on the POPULATED branch too", () => {
  const line = recordsLine({
    name: "KURENA", terms: [{ term: "KURENA", ok: true }],
    records: [{ recordId: "/mark/eu/1", mark: "KURENA" }], available: 1, deferredScope: ["JP"],
  });
  assert.match(line, /1 filing listed/);
  assert.match(line, /JP was ordered for this matter/,
    "a listing WITH filings is where a reader is most likely to stop and assume the scope was the one ordered");
});

// ── the refusal, and the dead arm it replaces ────────────────────────────────────────────────────────

// The free tier's own shape: two offices and nothing else. `offices.covered` is the coverage contract
// and `translate` is the code→wire mapping, exactly as register-plan.test.mjs builds them.
const caps = (extra = {}) => ({ id: "free-tier", label: "Free tier", countProbe: "total",
  offices: { translate: (c) => ({ EU: "EM" })[c] ?? c, covered: ["EM", "US"] }, ...extra });

test("#821 an entirely uncovered scope refuses BEFORE spend, on a provider that declares no regionsRequired", () => {
  // The arm this replaces was gated on `capabilities.regionsRequired`, which NO provider in this repo
  // declares — so the refusal could never fire on the free tier, the one a stranger runs.
  const why = countPreflight({ capabilities: caps(), jurisdictions: ["JP"] });
  assert.ok(why, "a matter naming only territories the provider does not cover must not spend");
  assert.match(why, /JP/);
  assert.match(why, /no scope left to count in/);
  assert.match(why, /answer a question nobody asked/,
    "the reason must say why counting the covered territories instead would be wrong, not just that it stopped");
});

test("#821 PARTIAL coverage runs and discloses — refusing it would put back what #790 fixed", () => {
  assert.equal(countPreflight({ capabilities: caps(), jurisdictions: ["EU", "JP"] }), null,
    "one covered territory is a scope; the rest is a disclosure, per the 2026-08-12 ruling");
});

test("#821 a WORLDWIDE run is not an empty scope, and must never be refused as one", () => {
  // resolveRegions returns `regions: []` for BOTH "no territory filter" and "every named territory was
  // deferred". Reading the empty list alone refuses every worldwide run on every provider — the same
  // conflation had to thread `worldwide` through reachableRegions to avoid.
  assert.equal(countPreflight({ capabilities: caps(), jurisdictions: [] }), null, "no territories named");
  assert.equal(countPreflight({ capabilities: caps(), jurisdictions: null }), null, "none at all");
});

test("#821 a fully covered scope is untouched", () => {
  assert.equal(countPreflight({ capabilities: caps(), jurisdictions: ["EU", "US"] }), null);
});
