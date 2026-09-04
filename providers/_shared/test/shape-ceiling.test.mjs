// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── A RESULT WINDOW THAT BELONGS TO THE QUERY, NOT TO THE PROVIDER ──────────────────────────
//
// The kernel has always had ONE ceiling per provider, tested against the page-0 total. That models a
// vendor whose result window is a property of the vendor. Signa's is a property of the query SHAPE:
// add `filters.owner_name` and paging stops at 400 rows, where the same term unfiltered reaches 2047.
//
// WHAT WAS WRONG BEFORE, since it was never a false clean and the distinction is the point. The band
// paged to 400, the next request came back HTTP 400, and the loop returned `incomplete` with a
// transport error for its reason. Safe. Also wrong twice:
//
//   · Judgment got a fact about OUR PAGING — "this cursor points beyond the 400 result pagination
//     window" — where the true statement is about the REGISTER: this owner holds more filings than
//     this provider will page, so the band is a crowd.
//   · The count-first per-CLASS rescue never ran. It exists for exactly this shape — an owner-scoped
//     query crowding across several classes, counted per class so every tractable leg is enumerated
//     individually — and it is reached from the CEILING TEST, which the band died before reaching.
//
// The tests below are the four things that have to hold, and the third and fourth are the ones that
// would fail silently: a shape ceiling that leaked onto every band would convert tractable work into
// sanctioned crowds, and nothing downstream can tell an over-declared crowd from a real one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { makeEnumerate, isOwnerScoped } from "../enumerate.mjs";
import { ownerWindowCeiling } from "../../signa/src/core.js";
import { OWNER_SCOPED_WINDOW } from "../../signa/src/capabilities.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const parse = (r) => JSON.parse(r.text);

// A stub provider on the "cheap" seam (the page-0 response IS the count), paging a fixed corpus.
// `window` is the vendor's own hard stop: past that row the request is an error, exactly as signa's is.
function stub({ total, window: hardWindow = Infinity, ceilingFor = null, pageSize = 100 }) {
  const calls = { search: 0, pages: [] };
  const search = async (_auth, params) => {
    calls.search += 1;
    const page = Number(params.page ?? 0);
    const from = page * pageSize;
    calls.pages.push(from);
    const scoped = Array.isArray(params.nice_classes) && params.nice_classes.length === 1
      ? Math.min(total, 150) : total;      // a class leg is a smaller slice of the same corpus
    if (from >= hardWindow) {
      return { type: "text", text: `ERROR: HTTP 400 — this cursor points beyond the ${hardWindow} result pagination window.` };
    }
    const rows = [];
    for (let i = from; i < Math.min(scoped, from + pageSize); i += 1) rows.push({ record_id: `r${i}`, uri: `u${i}` });
    return { type: "text", text: JSON.stringify({ total_hits: scoped, results: rows, has_more: from + rows.length < scoped }) };
  };
  const { enumerate } = makeEnumerate({
    search,
    count: null,
    rowScreen: (row) => ({ screen_verdict: "in", record_id: row.record_id }),
    hasAnyElement: (p) => Boolean(p?.query || p?.owner),
    capabilities: { countProbe: "cheap", screenSource: "search-row", pageSize, pageGuard: 60, ceilingDefault: 600 },
    ...(ceilingFor ? { ceilingFor } : {}),
  });
  return { enumerate, calls };
}

test("the declaration itself: owner-scoped narrows, every other shape does not", () => {
  assert.equal(OWNER_SCOPED_WINDOW, 400, "the measured window — a vendor fact, not a tuning knob");
  assert.equal(ownerWindowCeiling({ query: "nike", owner: "ACME HOLDINGS BV" }), 400);
  assert.equal(ownerWindowCeiling({ owners: ["ACME HOLDINGS BV"] }), 400);
  // `null`, not 400, and not 0: the shape imposes nothing and the provider default must stand.
  assert.equal(ownerWindowCeiling({ query: "nike" }), null);
  assert.equal(ownerWindowCeiling({ query: "nike", nice_classes: [5] }), null);
  assert.equal(ownerWindowCeiling({ query: "nike", owner: "   " }), null, "a blank owner is not an owner scope");
  assert.equal(ownerWindowCeiling({}), null);
  // …and it keys on the SAME predicate the per-class rescue triggers on. Two hand-written copies is
  // the drift that would leave the window firing where the rescue does not.
  for (const p of [{ owner: "X" }, { owners: ["X"] }, { query: "q" }, { owner: "  " }]) {
    assert.equal(ownerWindowCeiling(p) === OWNER_SCOPED_WINDOW, isOwnerScoped(p));
  }
});

test("AC1: an owner band over the window is a CROWD with a sample, not a transport error", async () => {
  const { enumerate, calls } = stub({ total: 521, window: 400, ceilingFor: ownerWindowCeiling });
  const r = await enumerate({}, { query: "nike", owner: "ACME HOLDINGS BV" }, {});
  const j = parse(r);
  assert.equal(j.state, "incomplete");
  assert.equal(j.total_hits, 521, "the register's own number, carried — never null and never 0 here");
  assert.match(j.reason, /exceeds the enumerate ceiling 400/);
  assert.doesNotMatch(j.reason, /pagination window|provider error/,
    "judgment must read a fact about the REGISTER, not about our cursor");
  assert.ok(j.sample.length > 0, "a crowd descriptor carries a sample — a bare count is not evidence");
  assert.equal(calls.search, 1, "ONE round trip: the page-0 response is the count, and the ceiling is tested on it");
});

test("AC2: the count-first per-CLASS rescue is now REACHABLE on that band", async () => {
  const { enumerate } = stub({ total: 521, window: 400, ceilingFor: ownerWindowCeiling });
  const r = await enumerate({}, { query: "nike", owner: "ACME HOLDINGS BV", nice_classes: [5, 9, 25, 35, 42] }, {});
  const j = parse(r);
  assert.ok(j.class_counts, "the rescue this window blocked is the whole reason it needed a name");
  assert.deepEqual(Object.keys(j.class_counts).sort(), ["25", "35", "42", "5", "9"].sort());
  // Every leg is a slice under the window, so every leg is individually enumerable — the portfolio shape.
  for (const [c, v] of Object.entries(j.class_counts)) {
    assert.equal(v.disposition, "enumerated", `class ${c}: a tractable leg must be opened, never left "unopened"`);
    assert.ok(v.total_hits > 0, `class ${c}: a populated leg is never recorded 0`);
  }
});

test("AC4: a band that COULD be enumerated does not become a crowd", async () => {
  // The same provider, the same total, no owner scope: the window does not apply and the band pages
  // to exhaustion under the provider's own ceiling. This is the assertion that catches a shape ceiling
  // leaking onto every query — an under-search wearing a sanctioned crowd descriptor.
  const { enumerate } = stub({ total: 521, ceilingFor: ownerWindowCeiling });
  const j = parse(await enumerate({}, { query: "nike" }, {}));
  assert.equal(j.state, "enumerated");
  assert.equal(j.count, 521, "every record fetched — 521 is over the 400 owner window and under the 600 ceiling");
});

test("AC3: with no ceilingFor, the kernel is byte-identical — including on an owner-scoped band", async () => {
  // Every provider but signa passes no `ceilingFor`, so this is their path. An owner-scoped band of
  // 521 must behave exactly as any other band of 521 does: enumerated, under the 600 default.
  const owned = parse(await stub({ total: 521 }).enumerate({}, { query: "nike", owner: "ACME HOLDINGS BV" }, {}));
  const plain = parse(await stub({ total: 521 }).enumerate({}, { query: "nike" }, {}));
  assert.equal(owned.state, "enumerated");
  assert.equal(owned.count, plain.count);
  // …and the provider ceiling still bites where it always did.
  const big = parse(await stub({ total: 900 }).enumerate({}, { query: "nike" }, {}));
  assert.equal(big.state, "incomplete");
  assert.match(big.reason, /exceeds the enumerate ceiling 600/);
});

test("AC3, by source: signa is the only provider that declares a shape ceiling", () => {
  // Behaviour above proves the kernel default is unchanged; this proves nobody else opted in. Read
  // from the tree rather than assumed, because the dep is passed inside each core and is invisible
  // from outside it — the exact place a second opt-in could land unnoticed.
  const declared = [];
  for (const id of ["corsearch", "clarivate", "signa", "euipo", "uspto-local", "free-tier"]) {
    const src = readFileSync(join(ROOT, "providers", id, "src", "core.js"), "utf8");
    if (/\bceilingFor\s*:/.test(src)) declared.push(id);
  }
  assert.deepEqual(declared, ["signa"],
    "a second provider declaring a shape ceiling is a coverage change, and it must arrive as a failing test here");
});

test("a shape ceiling can only NARROW the tuned ceiling, never raise it", async () => {
  // CLEAROTRON_ENUMERATE_CEILING is a tuning knob; the window is an HTTP 400. Tuning must not be able to
  // page a band past a bound the vendor enforces — it would not return more records, it would fail.
  const prev = process.env.CLEAROTRON_ENUMERATE_CEILING;
  process.env.CLEAROTRON_ENUMERATE_CEILING = "5000";
  try {
    const j = parse(await stub({ total: 521, window: 400, ceilingFor: ownerWindowCeiling })
      .enumerate({}, { query: "nike", owner: "ACME HOLDINGS BV" }, {}));
    assert.equal(j.state, "incomplete");
    assert.match(j.reason, /exceeds the enumerate ceiling 400/, "the window wins over the tuned ceiling");
  } finally {
    if (prev === undefined) delete process.env.CLEAROTRON_ENUMERATE_CEILING;
    else process.env.CLEAROTRON_ENUMERATE_CEILING = prev;
  }

  // And the reverse: a tuned ceiling BELOW the window still wins, because min() is min().
  const prev2 = process.env.CLEAROTRON_ENUMERATE_CEILING;
  process.env.CLEAROTRON_ENUMERATE_CEILING = "100";
  try {
    const j = parse(await stub({ total: 300, window: 400, ceilingFor: ownerWindowCeiling })
      .enumerate({}, { query: "nike", owner: "ACME HOLDINGS BV" }, {}));
    assert.match(j.reason, /exceeds the enumerate ceiling 100/);
  } finally {
    if (prev2 === undefined) delete process.env.CLEAROTRON_ENUMERATE_CEILING;
    else process.env.CLEAROTRON_ENUMERATE_CEILING = prev2;
  }
});
