// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the free tier: EUIPO + the local US index, composed into one register.
//
// The composite adds exactly two things over its members: a DERIVED capability contract, and the
// ARITHMETIC of putting two answers together. Those are what these tests pin, and the arithmetic is the
// half that cannot be tested against real sources — neither member can be made to answer "I do not know
// how many I hold" on demand, and that is precisely the case where a plausible wrong answer is
// available (a partial sum, a short band, a clean negative over half a tier).

import { test } from "node:test";
import assert from "node:assert/strict";

import { CAPABILITIES, FREE_TIER_MEMBER_IDS, memberForOffice, overlappingOffices,
  derivePredicates, deriveTriState, deriveOptionalList } from "../src/capabilities.js";
import { CAPABILITIES as EUIPO } from "../../euipo/src/capabilities.js";
import { CAPABILITIES as USPTO } from "../../uspto-local/src/capabilities.js";
import { doSearch, doEnumerate, doCountHits, doRecordFetch, doBatchScreen, doImageFetch,
  routeRegions, memberParams, neutralPaging, _setMemberCore, _resetMemberCores } from "../src/core.js";

const text = (o) => ({ type: "text", text: JSON.stringify(o) });
const err = (m) => ({ type: "text", text: `ERROR: ${m}` });
const parse = (r) => JSON.parse(r.text);
const isErr = (r) => r.text.startsWith("ERROR");

/** Stand both members in. Anything not overridden throws if called, so an unexpected call is loud. */
function members({ euipo = {}, uspto = {} } = {}) {
  _resetMemberCores();
  const guard = (id) => new Proxy({ CAPABILITIES: id === "euipo" ? EUIPO : USPTO }, {
    get(t, k) {
      // `then` must stay undefined: _setMemberCore wraps the stub in Promise.resolve(), and a Proxy that
      // answers `then` with a function makes the stub a THENABLE — the promise then tries to resolve
      // through it and the core never arrives.
      if (k === "then" || typeof k === "symbol") return undefined;
      if (k in t) return t[k];
      const stubs = id === "euipo" ? euipo : uspto;
      // An EXPLICIT null means "this member does not export that tool at all" — uspto-local really has
      // no doImageFetch. Without this the proxy's throwing fallback makes every key look present, and a
      // `typeof core.doImageFetch === "function"` guard passes on a member that has none.
      if (k in stubs && stubs[k] === null) return undefined;
      const impl = stubs[k];
      if (impl) return impl;
      return () => { throw new Error(`${id}.${String(k)} was called and no stub was provided`); };
    },
  });
  _setMemberCore("euipo", guard("euipo"));
  _setMemberCore("uspto-local", guard("uspto-local"));
}

// ── the derived contract ────────────────────────────────────────────────────────────────────────────

test("#548 offices are the UNION — that is the one field composing genuinely widens", () => {
  assert.deepEqual([...CAPABILITIES.offices.covered].sort(), ["EU", "US"]);
  assert.deepEqual(FREE_TIER_MEMBER_IDS, ["euipo", "uspto-local"]);
});

test("#548 maxOrWidth is the MIN, not the max — the wider member's bound would emit rejected queries", () => {
  assert.equal(EUIPO.maxOrWidth, 50);
  assert.equal(USPTO.maxOrWidth, 25);
  assert.equal(CAPABILITIES.maxOrWidth, 25, "planning to 50 would send OR-stacks the US index refuses");
});

test("#548 predicates INTERSECT — a predicate any member lacks is null here, never quietly weakened", () => {
  assert.equal(CAPABILITIES.predicates.phonetic, null, "neither member has a phonetic mode");
  for (const k of ["exact", "default", "wildcardPrefix", "wildcardSuffix", "wildcardInfix", "owner"]) {
    assert.ok(typeof CAPABILITIES.predicates[k] === "string" && CAPABILITIES.predicates[k].length,
      `${k} is expressible on both members`);
    assert.match(CAPABILITIES.predicates[k], /euipo: .* \| uspto-local: /,
      "and the mode names BOTH sources — one vendor's string would misdescribe the other");
  }
  assert.deepEqual(Object.keys(CAPABILITIES.predicates).sort(),
    ["default", "exact", "owner", "phonetic", "wildcardInfix", "wildcardPrefix", "wildcardSuffix"],
    "the predicate contract is CLOSED — every key declared, as a mode or an explicit null");
});

test("#548 the tri-state and boolean fields take the WEAKEST member", () => {
  assert.equal(EUIPO.nativeScriptIndex, true);
  assert.equal(USPTO.nativeScriptIndex, null, "the index is UNPROBED for native script");
  assert.equal(CAPABILITIES.nativeScriptIndex, null,
    "one undeclared member makes the composite undeclared — never rounded to false, which would claim a probe nobody ran");
  assert.equal(EUIPO.oppositions, true);
  assert.equal(USPTO.oppositions, false);
  assert.equal(CAPABILITIES.oppositions, false, "AND: the composite cannot promise what one source lacks");
});

test("#548 countProbe takes the costlier mode, and kernel bounds take the min", () => {
  assert.equal(CAPABILITIES.countProbe, "cheap",
    "euipo's probe is a BILLABLE page-0 search; the composite pays the most expensive member's price");
  assert.equal(CAPABILITIES.kernel.pageSize, Math.min(EUIPO.kernel.pageSize, USPTO.kernel.pageSize));
  assert.equal(CAPABILITIES.kernel.namesChunkDefault, 25);
});

test("#548 queryableStatuses is ABSENT, not empty — one member never declared it", () => {
  assert.ok(Array.isArray(EUIPO.queryableStatuses) && EUIPO.queryableStatuses.length);
  assert.equal(USPTO.queryableStatuses, undefined);
  assert.ok(!("queryableStatuses" in CAPABILITIES),
    "an empty array would claim NO status is queryable, which is a different and false statement from 'undeclared'");
});

test("#548 the contract is frozen all the way down", () => {
  for (const o of [CAPABILITIES, CAPABILITIES.predicates, CAPABILITIES.offices, CAPABILITIES.kernel])
    assert.ok(Object.isFrozen(o));
});

test("#548 members are office-DISJOINT, so no record_id can ever need matching across sources", () => {
  assert.deepEqual(overlappingOffices(), []);
});

// ── routing ─────────────────────────────────────────────────────────────────────────────────────────

test("#548 translate spans both vocabularies, and an uncovered code returns null rather than a guess", () => {
  assert.equal(CAPABILITIES.offices.vocabulary, "iso-3166-plus-eu", "the SUPERSET — EU is not an ISO country");
  assert.equal(CAPABILITIES.offices.translate("EU"), "EU");
  assert.equal(CAPABILITIES.offices.translate("EM"), "EU", "the EUIPO spelling still lands");
  assert.equal(CAPABILITIES.offices.translate("US"), "US");
  assert.equal(CAPABILITIES.offices.translate("CH"), null, "an uncovered office defers; it is never routed anywhere");
  assert.equal(memberForOffice("EM").id, "euipo");
  assert.equal(memberForOffice("US").id, "uspto-local");
  assert.equal(memberForOffice("CH"), null);
});

test("#548 an EMPTY regions list is UNRESTRICTED — every member, over its own whole coverage", () => {
  const r = routeRegions([]);
  assert.deepEqual(r, [{ id: "euipo", regions: null }, { id: "uspto-local", regions: null }],
    "worldwide on the free tier honestly means EU+US; every other territory was deferred before the plan compiled");
});

test("#548 a mixed request splits by office, each member seeing only its own", () => {
  assert.deepEqual(routeRegions(["EU", "US"]).routed,
    [{ id: "euipo", regions: ["EU"] }, { id: "uspto-local", regions: ["US"] }]);
  assert.deepEqual(routeRegions(["US"]).routed, [{ id: "uspto-local", regions: ["US"] }]);
  assert.deepEqual(routeRegions(["CH"]).unrouted, ["CH"]);
});

// ── search: the merge arithmetic ────────────────────────────────────────────────────────────────────

test("#548 a merged page sums the totals, concatenates the rows, and ORs has_more", () => {
  members({
    euipo: { doSearch: async () => text({ total_hits: 7, has_more: false, results: [{ record_id: "/mark/eu/1" }] }) },
    uspto: { doSearch: async () => text({ total_hits: 3, has_more: true, results: [{ record_id: "/mark/us/2" }] }) },
  });
  return doSearch(null, { names: ["X"], regions: ["EU", "US"] }, {}).then((r) => {
    const p = parse(r);
    assert.equal(p.total_hits, 10);
    assert.equal(p.has_more, true, "enumeration stops only when NO member has more");
    assert.deepEqual(p.results.map((x) => x.record_id), ["/mark/eu/1", "/mark/us/2"]);
  });
});

test("#548 ONE member with an unknown total makes the composite total UNKNOWN — never a partial sum", async () => {
  // This is the dangerous shape: 7 is a real number, smaller than the truth, and indistinguishable
  // downstream from a complete one. On this provider the search response IS the count.
  members({
    euipo: { doSearch: async () => text({ total_hits: 7, has_more: false, results: [{ record_id: "/mark/eu/1" }] }) },
    uspto: { doSearch: async () => text({ total_hits: null, has_more: false, results: [{ record_id: "/mark/us/2" }] }) },
  });
  const p = parse(await doSearch(null, { names: ["X"], regions: ["EU", "US"] }, {}));
  assert.equal(p.total_hits, null, "null is the truth; 7 would be a completeness claim over a source that never answered");
  assert.notEqual(p.total_hits, 0, "and never 0 — 'we could not ask' is not 'there are none'");
  assert.equal(p.results.length, 2, "the rows that DID come back are still carried");
});

test("#548 a member ERROR fails the whole slice, naming the source — half a band is never a whole answer", async () => {
  members({
    euipo: { doSearch: async () => text({ total_hits: 7, has_more: false, results: [{ record_id: "/mark/eu/1" }] }) },
    uspto: { doSearch: async () => err("uspto_local_search — index is stale") },
  });
  const r = await doSearch(null, { names: ["X"], regions: ["EU", "US"] }, {});
  assert.ok(isErr(r));
  assert.match(r.text, /uspto-local member/);
  assert.match(r.text, /INCOMPLETE and must not be read as a whole-tier answer/);
});

test("#548 an uncovered region refuses as a CAPABILITY GAP, so it defers instead of grinding the repair ladder", async () => {
  members({});
  const r = await doSearch(null, { names: ["X"], regions: ["CH"] }, {});
  assert.ok(isErr(r));
  assert.match(r.text, /capability-gap:/, "the marker is what turns error:true into error+deferred");
  assert.match(r.text, /no member of the free tier covers CH/);
});

// ── enumerate: the state arithmetic ─────────────────────────────────────────────────────────────────

test("#548 both members enumerated ⇒ enumerated, totals summed, records merged", async () => {
  members({
    euipo: { doEnumerate: async () => text({ state: "enumerated", total_hits: 2, records: [{ record_id: "/mark/eu/1" }, { record_id: "/mark/eu/2" }] }) },
    uspto: { doEnumerate: async () => text({ state: "enumerated", total_hits: 1, records: [{ record_id: "/mark/us/3" }] }) },
  });
  const p = parse(await doEnumerate(null, { names: ["X"], regions: ["EU", "US"] }, {}));
  assert.equal(p.state, "enumerated");
  assert.equal(p.total_hits, 3);
  assert.equal(p.count, 3);
});

test("#548 ONE incomplete member makes the BAND incomplete — a half-tier sweep is not a clean negative", async () => {
  members({
    euipo: { doEnumerate: async () => text({ state: "enumerated", total_hits: 2, records: [{ record_id: "/mark/eu/1" }, { record_id: "/mark/eu/2" }] }) },
    uspto: { doEnumerate: async () => text({ state: "incomplete", total_hits: 9000, fetched: 1, sample: [{ record_id: "/mark/us/3" }], reason: "crowd" }) },
  });
  const p = parse(await doEnumerate(null, { names: ["X"], regions: ["EU", "US"] }, {}));
  assert.equal(p.state, "incomplete", "a band that exhausted the EU and gave up on the US is not a completed EU+US enumeration");
  assert.match(p.reason, /uspto-local: crowd/, "and it says WHICH source and why");
  assert.equal(p.fetched, 3, "the records already gathered ride along as the sample they are");
});

test("#548 a member error during enumerate is an ERROR, not a short band", async () => {
  members({
    euipo: { doEnumerate: async () => text({ state: "enumerated", total_hits: 1, records: [{ record_id: "/mark/eu/1" }] }) },
    uspto: { doEnumerate: async () => err("uspto_local_enumerate — db locked") },
  });
  const r = await doEnumerate(null, { names: ["X"], regions: ["EU", "US"] }, {});
  assert.ok(isErr(r), "a slice that did not run must never wear a completeness claim");
  assert.match(r.text, /must not be read as a whole-tier answer/);
});

// ── count ───────────────────────────────────────────────────────────────────────────────────────────

test("#548 counts sum, and the per-member split is reported", async () => {
  members({
    euipo: { doCountHits: async () => ({ ok: true, total: 12 }) },
    uspto: { doCountHits: async () => ({ ok: true, total: 30 }) },
  });
  const r = await doCountHits(null, { names: ["X"], regions: ["EU", "US"] }, {});
  assert.deepEqual({ ok: r.ok, total: r.total, per: r.per_member }, { ok: true, total: 42, per: { euipo: 12, "uspto-local": 30 } });
});

test("#548 one member that cannot count makes the TOTAL unknown — not the partial sum, not 0", async () => {
  members({
    euipo: { doCountHits: async () => ({ ok: true, total: 12 }) },
    uspto: { doCountHits: async () => ({ ok: false, total: null, reason: "no index built" }) },
  });
  const r = await doCountHits(null, { names: ["X"], regions: ["EU", "US"] }, {});
  assert.equal(r.ok, false);
  assert.equal(r.total, null, "12 would be a real number, smaller than the truth, and unreadable as partial");
  assert.match(r.reason, /UNKNOWN — not the partial sum/);
});

// ── record-level routing ────────────────────────────────────────────────────────────────────────────

test("#548 a record fetch routes by the office IN THE ID — it can never reach the wrong source", async () => {
  const seen = [];
  members({
    euipo: { doRecordFetch: async (a, p) => { seen.push(["euipo", p.record_id]); return text({ ok: true }); } },
    uspto: { doRecordFetch: async (a, p) => { seen.push(["uspto", p.record_id]); return text({ ok: true }); } },
  });
  await doRecordFetch(null, { record_id: "/mark/eu/018922211" }, {});
  await doRecordFetch(null, { record_id: "/mark/us/86272665" }, {});
  assert.deepEqual(seen, [["euipo", "/mark/eu/018922211"], ["uspto", "/mark/us/86272665"]]);
});

test("#548 a record id for an uncovered office, or no office at all, is a capability gap", async () => {
  members({});
  for (const id of ["/mark/ch/12345", "not-a-record-id", ""]) {
    const r = await doRecordFetch(null, { record_id: id }, {});
    assert.ok(isErr(r) && r.text.includes("capability-gap:"), `${id} must refuse, loudly`);
  }
});

test("#548 batch screen splits by office and merges, and refuses rather than silently dropping ids", async () => {
  members({
    // `rows` — the neutral name, and what every real member returns. These stubs used to answer
    // in `results`, a vocabulary no shipped provider uses; the composite read it because it guessed
    // across four names, and a stub speaking whatever the composite happens to read proves nothing.
    euipo: { doBatchScreen: async (a, p) => text({ rows: p.record_ids.map((u) => ({ record_id: u, screen: "eu" })) }) },
    uspto: { doBatchScreen: async (a, p) => text({ rows: p.record_ids.map((u) => ({ record_id: u, screen: "us" })) }) },
  });
  const p = parse(await doBatchScreen(null, { record_ids: ["/mark/eu/1", "/mark/us/2", "/mark/eu/3"] }, {}));
  assert.equal(p.count, 3);
  assert.deepEqual(p.results.map((x) => x.screen), ["eu", "eu", "us"]);

  const bad = await doBatchScreen(null, { record_ids: ["/mark/eu/1", "/mark/ch/9"] }, {});
  assert.ok(isErr(bad) && bad.text.includes("capability-gap:"),
    "an id nobody covers must refuse — screening 1 of 2 and reporting success is the silent-drop this repo punishes");
});

// ── — the RESULT vocabulary at the member boundary ─────────────────────────────────────────────
//
// The composite used to read `rows ?? screened ?? results ?? records`. On euipo, `screened` is a COUNT.
// The chain never fired on it because `rows` was always present and `??` falls through on null/undefined
// alone — a contract resting on the ordering of a `??` chain and the presence of one key. What must
// happen when a member answers in a name the contract does not declare is a LOUD refusal, because the
// alternative reads downstream exactly like "nothing matched".
test("#688 a member answering in a vocabulary the contract does not declare REFUSES, naming its keys", async () => {
  members({
    euipo: { doBatchScreen: async (a, p) => text({ results: p.record_ids.map((u) => ({ record_id: u })) }) },
  });
  const r = await doBatchScreen(null, { record_ids: ["/mark/eu/1"] }, {});
  assert.ok(isErr(r), "a foreign row vocabulary must fail, not screen zero records");
  assert.match(r.text, /`rows` array/);
  assert.match(r.text, /keys: results/, "the refusal names what the member DID return, so the fix is obvious");
  assert.match(r.text, /never judged/);
});

test("#688 euipo's `screened` is a COUNT and must never be read as the row list", async () => {
  members({
    // euipo's real shape: a `screened` COUNT beside the `rows` array (providers/euipo/src/core.js).
    euipo: { doBatchScreen: async (a, p) => text({
      asked: p.uris.length, screened: p.uris.length, not_found: [],
      rows: p.uris.map((u) => ({ record_id: u, screen: "eu" })),
    }) },
  });
  const p = parse(await doBatchScreen(null, { record_ids: ["/mark/eu/1", "/mark/eu/2"] }, {}));
  assert.equal(p.count, 2);
  assert.deepEqual(p.rows.map((x) => x.record_id), ["/mark/eu/1", "/mark/eu/2"],
    "the rows come from `rows` — a reader that took `screened` would have taken the integer 2");
});

// ── — the REQUEST vocabulary at the same boundary ──────────────────────────────────────────────
//
// euipo reads page/size, the local index reads limit/offset. One forwarded `{...params}` meant whichever
// vocabulary the caller sent, the OTHER member silently used its default page. These assert the
// translation in both directions and, just as importantly, that neither member ever sees the other's.
test("#698 a page/size caller reaches uspto-local as limit/offset, and euipo as page/size", async () => {
  const seen = {};
  members({
    euipo: { doSearch: async (a, p) => { seen.euipo = p; return text({ total_hits: 1, has_more: false, results: [] }); } },
    uspto: { doSearch: async (a, p) => { seen.uspto = p; return text({ total_hits: 1, has_more: false, results: [] }); } },
  });
  await doSearch(null, { names: ["X"], regions: ["EU", "US"], page: 2, size: 50 }, {});

  assert.equal(seen.euipo.page, 2);
  assert.equal(seen.euipo.size, 50);
  assert.equal(seen.uspto.limit, 50);
  assert.equal(seen.uspto.offset, 100, "page 2 of 50 is offset 100 — the window the caller asked for");

  // The leak, closed in both directions: a member must never see the other's spelling.
  assert.equal(seen.euipo.limit, undefined);
  assert.equal(seen.euipo.offset, undefined);
  assert.equal(seen.uspto.page, undefined);
  assert.equal(seen.uspto.size, undefined);
});

test("#698 a limit/offset caller reaches euipo as page/size — the same translation, the other way", async () => {
  const seen = {};
  members({
    euipo: { doSearch: async (a, p) => { seen.euipo = p; return text({ total_hits: 1, has_more: false, results: [] }); } },
    uspto: { doSearch: async (a, p) => { seen.uspto = p; return text({ total_hits: 1, has_more: false, results: [] }); } },
  });
  await doSearch(null, { names: ["X"], regions: ["EU", "US"], limit: 20, offset: 60 }, {});
  assert.equal(seen.euipo.page, 3, "offset 60 at size 20 is page 3");
  assert.equal(seen.euipo.size, 20);
  assert.equal(seen.uspto.limit, 20);
  assert.equal(seen.uspto.offset, 60);
});

test("#698 a ragged offset is NOT rounded into a page — it rides through where it means something", async () => {
  const seen = {};
  members({
    euipo: { doSearch: async (a, p) => { seen.euipo = p; return text({ total_hits: 1, has_more: false, results: [] }); } },
    uspto: { doSearch: async (a, p) => { seen.uspto = p; return text({ total_hits: 1, has_more: false, results: [] }); } },
  });
  await doSearch(null, { names: ["X"], regions: ["EU", "US"], limit: 20, offset: 65 }, {});
  // 65 is not a whole number of 20-row pages. Rounding it would quietly move the window the caller
  // asked for, which is the same class of silent wrongness this issue is about.
  assert.equal(seen.euipo.page, undefined, "no page is invented from a window euipo cannot express");
  assert.equal(seen.euipo.size, 20);
  assert.equal(seen.uspto.offset, 65, "the member that CAN express it gets it exactly");
});

// The guard on the fix itself. `memberParams` gives a member it does not know NO paging rather than a
// guessed one — safe, but silent, and silent is what this issue is about. A new member added without a
// paging decision would page from its defaults forever and nothing would say so. This makes that red.
test("#698 every free-tier member has a declared paging vocabulary — a new one cannot be added without deciding", () => {
  for (const id of FREE_TIER_MEMBER_IDS) {
    const sub = memberParams(id, { names: ["X"], page: 1, size: 10 });
    const paged = sub.page !== undefined || sub.size !== undefined || sub.limit !== undefined || sub.offset !== undefined;
    assert.ok(paged,
      `member "${id}" has no entry in MEMBER_PAGING, so the composite hands it no paging at all and it `
      + `silently serves its default page for every request. Declare its vocabulary.`);
  }
});

test("#698 a caller that states no paging leaves both members on their own defaults", async () => {
  const seen = {};
  members({
    euipo: { doSearch: async (a, p) => { seen.euipo = p; return text({ total_hits: 1, has_more: false, results: [] }); } },
    uspto: { doSearch: async (a, p) => { seen.uspto = p; return text({ total_hits: 1, has_more: false, results: [] }); } },
  });
  await doSearch(null, { names: ["X"], regions: ["EU", "US"] }, {});
  for (const k of ["page", "size", "limit", "offset"]) {
    assert.equal(seen.euipo[k], undefined, `euipo must not be handed a fabricated ${k}`);
    assert.equal(seen.uspto[k], undefined, `uspto-local must not be handed a fabricated ${k}`);
  }
});

test("#548 an image fetch for a member that serves no images is a SOURCE LIMITATION, not an absent image", async () => {
  members({ euipo: { doImageFetch: async () => text({ ok: true }) }, uspto: { doImageFetch: null } });
  assert.ok(!isErr(await doImageFetch(null, { record_id: "/mark/eu/1" }, {})));
  const r = await doImageFetch(null, { record_id: "/mark/us/2" }, {});
  assert.ok(isErr(r) && r.text.includes("capability-gap:"));
  assert.match(r.text, /serves no mark images/);
  assert.match(r.text, /not an absent image/);
});

// ── the derivation RULES, over synthetic members ────────────────────────────────────────────────────
//
// The tests above check the rules against the two members that exist today, and for two rules that is
// not a test at all: euipo and uspto-local both declare `phonetic: null` and both declare every other
// predicate, so intersection and UNION give the identical answer. The break matrix proved it — swapping
// `some` for `every` in the predicate derivation reddened nothing.
//
// A third member with an ability the others lack is the case that matters, and it is the case a future
// free source will actually be. So the rules are pure functions and these drive them directly.

const M = (id, over = {}) => ({ id, predicates: { exact: `${id}-exact`, default: `${id}-default`,
  wildcardPrefix: null, wildcardSuffix: null, wildcardInfix: null, phonetic: null, owner: null }, ...over });

test("#548 RULE: a predicate ONE member lacks is null on the composite, never the other's mode", () => {
  const a = M("a", { predicates: { exact: "A", default: "A", wildcardPrefix: "A", wildcardSuffix: null, wildcardInfix: null, phonetic: "A", owner: "A" } });
  const b = M("b", { predicates: { exact: "B", default: "B", wildcardPrefix: null, wildcardSuffix: null, wildcardInfix: null, phonetic: null, owner: "B" } });
  const p = derivePredicates([a, b]);
  assert.equal(p.exact, "a: A | b: B", "both express it — and BOTH modes are stated");
  assert.equal(p.wildcardPrefix, null, "a has it, b does not ⇒ the COMPOSITE does not");
  assert.equal(p.phonetic, null, "the union would have handed this back as 'A' and searched b some other way");
  assert.equal(p.owner, "a: A | b: B");
  assert.equal(p.wildcardSuffix, null, "neither has it");
});

test("#548 RULE: a single member composes to itself — the derivation adds nothing on its own", () => {
  const a = M("a", { predicates: { exact: "A", default: null, wildcardPrefix: null, wildcardSuffix: null, wildcardInfix: null, phonetic: null, owner: null } });
  assert.equal(derivePredicates([a]).exact, "a: A");
  assert.equal(derivePredicates([a]).default, null);
});

test("#548 RULE: tri-state — one UNDECLARED member makes the composite undeclared", () => {
  const pick = (m) => m.v;
  assert.equal(deriveTriState([{ v: true }, { v: true }], pick), true);
  assert.equal(deriveTriState([{ v: true }, { v: false }], pick), false, "probed-and-absent is false");
  assert.equal(deriveTriState([{ v: true }, { v: null }], pick), null, "undeclared beats true");
  assert.equal(deriveTriState([{ v: false }, { v: null }], pick), null, "and undeclared beats false too");
  assert.equal(deriveTriState([{ v: true }, {}], pick), null, "an absent field is undeclared, not false");
});

test("#548 RULE: an optional declared list survives only if EVERY member declares it", () => {
  const both = [{ k: ["A", "B", "C"] }, { k: ["B", "C", "D"] }];
  assert.deepEqual(deriveOptionalList(both, "k"), ["B", "C"], "and then it is the INTERSECTION");
  assert.equal(deriveOptionalList([{ k: ["A"] }, {}], "k"), undefined,
    "one member that never declared it ⇒ UNDECLARED. [] would claim no value is queryable, which is false.");
  assert.deepEqual(deriveOptionalList([{ k: ["A"] }, { k: ["B"] }], "k"), [],
    "an EMPTY intersection is a real answer: both declared, and they share nothing");
});

// ── · THE SCREEN THAT SCREENED NOTHING (found by adversarial review, 2026-08-11) ───────────────
//
// doBatchScreen was wrong at BOTH seams, and the two errors concealed each other. It read
// `params.record_ids` and forwarded `record_ids` to members that read `params.uris`, so each member got
// an empty list; then it read the returned rows from `parsed.results ?? parsed.records`, and no member
// returns either name (corsearch and uspto-local return `rows`, euipo returns `screened`).
//
// The output was `{count: 0, results: []}` — well-formed, error-free, and over records nobody looked at.
// Batch screen decides which surfaced records are in scope, so an empty screen is not a visible failure:
// it is every candidate silently unscreened.
//
// The stubs below return what the REAL members return. A stub returning what the composite happens to
// read is how this passed review for as long as it did.

test("#548: batch screen actually screens — both param spellings, one return vocabulary", async () => {
  _resetMemberCores();
  _setMemberCore("euipo", { CAPABILITIES: { offices: { covered: ["EU"] } },
    // — CORRECTED to euipo's real shape. This stub returned `screened` as an ARRAY of rows, which
    // is not what providers/euipo/src/core.js returns: there, `screened` is the row COUNT and the rows
    // ride in `rows`, like every other provider. The stub mirrored what the composite guessed rather
    // than what the member sends, which is the failure mode is about — a test that agrees with the
    // code about a fact neither of them checked. `not_found` is real and is kept: an unanswered id is
    // not a screening verdict.
    doBatchScreen: async (a, p) => ({ type: "text", text: JSON.stringify({
      asked: (p?.uris ?? []).length,
      screened: (p?.uris ?? []).length,
      not_found: [],
      rows: (p?.uris ?? []).map((u) => ({ record_id: u, verdict: "keep" })) }) }) });
  _setMemberCore("uspto-local", { CAPABILITIES: { offices: { covered: ["US"] } },
    // uspto-local and corsearch return `rows`.
    doBatchScreen: async (a, p) => ({ type: "text", text: JSON.stringify({
      rows: (p?.uris ?? []).map((u) => ({ record_id: u, verdict: "keep" })) }) }) });
  try {
    for (const key of ["uris", "record_ids"]) {
      const r = await doBatchScreen(null, { [key]: ["/mark/us/1", "/mark/eu/2"], in_scope_classes: [9] }, { kind: "t" });
      const parsed = JSON.parse(r.text);
      assert.equal(parsed.count, 2, `called with ${key}: both records must be screened, not silently dropped`);
      assert.equal(parsed.rows.length, 2, `called with ${key}: rows is the name the other providers return`);
      assert.equal(parsed.results.length, 2, "…and results is kept so the old name still reads");
    }
  } finally { _resetMemberCores(); }
});

test("#548: a member whose row list cannot be found REFUSES rather than reporting an empty screen", async () => {
  // The property that would have caught the original defect on its own. An unrecognised shape must not
  // degrade to zero rows: zero is indistinguishable downstream from "nothing matched".
  _resetMemberCores();
  _setMemberCore("euipo", { CAPABILITIES: { offices: { covered: ["EU"] } },
    doBatchScreen: async () => ({ type: "text", text: JSON.stringify({ mystery: [] }) }) });
  try {
    const r = await doBatchScreen(null, { uris: ["/mark/eu/1"] }, { kind: "t" });
    assert.match(r.text, /^ERROR/, "an unreadable row list is a refusal, never an empty screen");
    assert.match(r.text, /never judged/);
  } finally { _resetMemberCores(); }
});
